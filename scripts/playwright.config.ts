/**
 * Configuração da avaliação consolidada, chamada por accessibility/run.mjs.
 * Desktop e celular usam a mesma rodada, mas salvam evidências por projeto.
 * Sem retries: uma falha não é ocultada por uma segunda tentativa automática.
 */
import {
  defineConfig,
  devices,
} from "../frontend/node_modules/@playwright/test/index.mjs";
import { resolve } from "node:path";

const output = process.env.A11Y_RUN_DIR;
if (!output)
  throw new Error(
    "Use npm run audit:a11y para definir um diretório de execução isolado.",
  );

export default defineConfig({
  testDir: "../frontend/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  outputDir: resolve(output, "artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(output, "playwright.json") }],
    [
      "html",
      { outputFolder: resolve(output, "playwright-html"), open: "never" },
    ],
  ],
  use: {
    baseURL: process.env.A11Y_BASE_URL || "http://127.0.0.1:4175",
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
