/**
 * Avalia páginas públicas com Lighthouse usando o Chromium do Playwright.
 * Salva relatórios HTML/JSON por página e mantém revisões manuais separadas
 * das verificações automáticas. A pontuação não certifica conformidade WCAG.
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "frontend/package.json"));
const { default: lighthouse } = await import(
  pathToFileURL(require.resolve("lighthouse")).href
);
const { launch } = await import(
  pathToFileURL(require.resolve("chrome-launcher")).href
);
const { chromium } = require("@playwright/test");
const [baseURL, runDir] = process.argv.slice(2);
if (!baseURL || !runDir)
  throw new Error("Execute pelo npm run audit:a11y:lighthouse.");
const output = resolve(runDir, "lighthouse");
await mkdir(output, { recursive: true });
const rows = [];
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless", "--disable-gpu", "--no-first-run"],
});
try {
  for (const route of [
    "/",
    "/login",
    "/shop",
    "/register/customer",
    "/shared-purchases",
  ]) {
    const id = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
    try {
      const result = await lighthouse(new URL(route, baseURL).href, {
        port: chrome.port,
        onlyCategories: ["accessibility"],
        output: ["json", "html"],
        logLevel: "error",
        formFactor: "desktop",
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
      });
      if (!result) throw new Error("Lighthouse não retornou relatório.");
      const { lhr, report } = result;
      await writeFile(resolve(output, `${id}.json`), report[0]);
      await writeFile(resolve(output, `${id}.html`), report[1]);
      const refs = lhr.categories.accessibility.auditRefs.map(
        ({ id }) => lhr.audits[id],
      );
      rows.push({
        route,
        requestedUrl: lhr.requestedUrl,
        finalUrl: lhr.finalDisplayedUrl,
        fetchTime: lhr.fetchTime,
        lighthouseVersion: lhr.lighthouseVersion,
        userAgent: lhr.userAgent,
        environment: lhr.environment,
        dataMode: "backend-real-read-only-public",
        score: lhr.categories.accessibility.score,
        runtimeError: lhr.runtimeError,
        warnings: lhr.runWarnings,
        failed: refs.filter(
          (audit) => audit.scoreDisplayMode !== "manual" && audit.score === 0,
        ),
        passed: refs.filter((audit) => audit.score === 1),
        manual: refs.filter((audit) => audit.scoreDisplayMode === "manual"),
        notApplicable: refs.filter(
          (audit) => audit.scoreDisplayMode === "notApplicable",
        ),
        errors: refs.filter((audit) => audit.scoreDisplayMode === "error"),
      });
      console.log(
        `Lighthouse ${route}: ${lhr.categories.accessibility.score === null ? "inconclusivo" : lhr.categories.accessibility.score * 100}`,
      );
    } catch (error) {
      rows.push({ route, error: error.message });
    }
  }
} finally {
  await chrome.kill();
  await writeFile(
    resolve(runDir, "lighthouse.json"),
    JSON.stringify(rows, null, 2),
  );
}
process.exitCode = rows.some(
  (row) => row.error || row.runtimeError || row.errors?.length,
)
  ? 1
  : 0;
