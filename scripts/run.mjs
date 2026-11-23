/**
 * Ponto de entrada da avaliação: compila o frontend, prepara o ambiente,
 * executa as ferramentas e consolida as evidências em uma pasta por rodada.
 * Os códigos de saída são registrados mesmo quando uma ferramenta encontra falhas.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { generateReports } from "./report.mjs";
import { startSandbox } from "./sandbox.mjs";
import { compareRuns } from "./compare.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(root, "frontend");
const args = process.argv.slice(2);
const stamp =
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const runDir = resolve(root, "accessibility/results", stamp);
await mkdir(runDir, { recursive: true });
const commands = [];
// A comparação padrão usa a rodada anterior, antes de atualizar latest.json.
const requestedBaseline = args
  .find((arg) => arg.startsWith("--compare-to="))
  ?.slice(13);
let baseline;
if (requestedBaseline) baseline = resolve(requestedBaseline);
else {
  try {
    baseline = JSON.parse(
      await readFile(
        resolve(root, "accessibility/results/latest.json"),
        "utf8",
      ),
    ).runDir;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function run(name, script, params, env = {}) {
  const started = new Date().toISOString();
  const log = resolve(runDir, `${name}.log`);
  let output = "";
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(frontend, script), ...params],
      {
        cwd: frontend,
        windowsHide: true,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? 1));
  });
  await writeFile(log, output);
  commands.push({ name, script, args: params, exitCode, started, log });
  return exitCode;
}
// Versões e hashes ajudam a distinguir mudanças da aplicação e das ferramentas.
const versions = {};
for (const name of [
  "@playwright/test",
  "@axe-core/playwright",
  "axe-core",
  "lighthouse",
  "eslint",
  "eslint-plugin-jsx-a11y",
  "vite",
  "typescript",
  "tailwindcss",
]) {
  try {
    versions[name] = JSON.parse(
      await readFile(
        resolve(frontend, "node_modules", name, "package.json"),
        "utf8",
      ),
    ).version;
  } catch {
    versions[name] = "unavailable";
  }
}
const git = await new Promise((done) => {
  const child = spawn("git", ["rev-parse", "HEAD"], {
    cwd: root,
    windowsHide: true,
  });
  let value = "";
  child.stdout.on("data", (chunk) => {
    value += chunk;
  });
  child.once("error", () => done("unavailable"));
  child.once("exit", () => done(value.trim()));
});
const metadata = {
  commit: git,
  lockfileSha256: createHash("sha256")
    .update(await readFile(resolve(frontend, "package-lock.json")))
    .digest("hex"),
  sourceDiffSha256: createHash("sha256")
    .update(execFileSync("git", ["diff", "HEAD"], { cwd: root }))
    .digest("hex"),
  sourceState: "working-tree; inspect diff together with this commit",
  started: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  versions,
  commands,
  normativeTarget:
    "WCAG 2.2 A/AA; partial verified ABNT references; no conformance certification",
  requestedArgs: args,
};
metadata.sourceFilesSha256 = {};
for (const file of [
  "accessibility/run.mjs",
  "accessibility/report.mjs",
  "accessibility/lighthouse.mjs",
  "accessibility/playwright.config.ts",
  "frontend/e2e/evaluation/evaluation-a11y.spec.ts",
  "frontend/e2e/accessibility/keyboard-operation.spec.ts",
  "frontend/e2e/evaluation/evaluation-chat-a11y.spec.ts",
  "frontend/e2e/evaluation/evaluation-notifications-a11y.spec.ts",
  "frontend/e2e/helpers/accessibility-audit.ts",
  "frontend/e2e/evaluation/evaluation-expanded-a11y.spec.ts",
  "frontend/e2e/evaluation/evaluation-real-api-a11y.spec.ts",
  "frontend/e2e/fixtures/real-accessibility.ts",
  "accessibility/sandbox.py",
  "accessibility/sandbox.mjs",
  "accessibility/compare.mjs",
]) {
  metadata.sourceFilesSha256[file] = createHash("sha256")
    .update(await readFile(resolve(root, file)))
    .digest("hex");
}
let server;
let sandbox;
try {
  const build = await run("build", "node_modules/vite/bin/vite.js", ["build"]);
  if (build !== 0)
    throw new Error("Build falhou; testes de navegador não executados.");
  if (args.includes("--isolated-backend")) {
    sandbox = await startSandbox(root, runDir);
    metadata.sandbox = {
      database: "disposable-postgresql",
      schema: "alembic-upgrade-head",
      services: "local-development-provider; external network blocked",
      accounts: "unique-per-case",
      rateLimits: "disabled-only-in-disposable-instance",
    };
  }
  // Reserve a free loopback port: never silently reuse a stale preview build.
  const port = await new Promise((done, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selected = probe.address().port;
      probe.close(() => done(selected));
    });
  });
  const baseURL = `http://127.0.0.1:${port}`;
  metadata.baseURL = baseURL;
  server = spawn(
    process.execPath,
    [
      resolve(frontend, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: frontend,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...(sandbox ? { VITE_BACKEND_TARGET: sandbox.apiURL } : {}),
      },
    },
  );
  server.on("error", (error) => {
    metadata.serverError = error.message;
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(baseURL, { signal: AbortSignal.timeout(3000) })).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!ready) throw new Error("Preview local não iniciou.");
  try {
    const response = await fetch(`${baseURL}/api/product/`, {
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    metadata.backend = {
      catalogStatus: response.status,
      products: Array.isArray(body) ? body.length : null,
    };
  } catch (error) {
    metadata.backend = { error: error.message };
  }

  if (!args.includes("--lighthouse-only")) {
    await run("static", "node_modules/eslint/bin/eslint.js", [
      "--config",
      "eslint.a11y.config.js",
      "src",
      "--format",
      "json",
      "--output-file",
      resolve(runDir, "eslint.json"),
    ]);
    const projects = args.filter((arg) => arg.startsWith("--project="));
    const pageArg = args.find((arg) => arg.startsWith("--page="))?.slice(7);
    const keyboard = "@keyboard|teclado|foco|skip link|Tab|lateralidade";
    const expanded =
      "@expanded|notificações abertas e retorno|conversa, rascunho e envio";
    // A ordem abaixo define a prioridade quando mais de um filtro é informado.
    const grep = args.includes("--real-only")
      ? "@real-api"
      : args.includes("--components")
        ? "@regression|notificações abertas e retorno|conversa, rascunho e envio"
        : pageArg
          ? pageArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : args.includes("--expanded")
            ? expanded
            : args.includes("--keyboard")
              ? keyboard
              : "@a11y|@responsive";
    await run(
      "playwright",
      "node_modules/@playwright/test/cli.js",
      [
        "test",
        "--config",
        resolve(root, "accessibility/playwright.config.ts"),
        "--grep",
        grep,
        ...(projects.length
          ? projects
          : ["--project=chromium", "--project=mobile-chromium"]),
      ],
      {
        A11Y_RUN_DIR: runDir,
        A11Y_LIVE: "1",
        A11Y_BASE_URL: baseURL,
        ...(sandbox
          ? { A11Y_SANDBOX_WORK: sandbox.work, A11Y_PYTHON: sandbox.python }
          : {}),
      },
    );
  }
  if (!args.includes("--keyboard") && !args.includes("--skip-lighthouse")) {
    await run("lighthouse", "../accessibility/lighthouse.mjs", [
      baseURL,
      runDir,
    ]);
  }
} catch (error) {
  metadata.infrastructureError = error.message;
  console.error(error.message);
} finally {
  // Mesmo após falha, encerra os processos e tenta preservar o relatório da rodada.
  if (server && !server.killed) server.kill();
  if (sandbox) {
    try {
      await sandbox.stop();
      metadata.sandbox.stopped = true;
    } catch (error) {
      metadata.cleanupError = error.message;
    }
  }
  metadata.finished = new Date().toISOString();
  await writeFile(
    resolve(runDir, "environment.json"),
    JSON.stringify(metadata, null, 2),
  );
  await generateReports(runDir);
  if (baseline) {
    try {
      const comparison = await compareRuns(baseline, runDir);
      console.log("Comparison:", JSON.stringify(comparison.counts));
    } catch (error) {
      await writeFile(resolve(runDir, "comparison-error.txt"), error.message);
      console.error("Comparison unavailable:", error.message);
    }
  }
  await writeFile(
    resolve(root, "accessibility/results/latest.json"),
    JSON.stringify({ runDir }, null, 2),
  );
  console.log(`\nRelatórios: ${runDir}`);
  process.exitCode =
    metadata.infrastructureError ||
    metadata.cleanupError ||
    commands.some((command) => command.exitCode !== 0)
      ? 1
      : 0;
}
