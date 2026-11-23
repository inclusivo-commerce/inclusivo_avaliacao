/**
 * Controla o ciclo de vida do backend descartável usado pelos testes reais.
 * Prepara PostgreSQL, inicia a API, aguarda prontidão e oferece a função stop.
 * A11Y_PYTHON permite selecionar o Python do backend explicitamente.
 */
import { spawn } from "node:child_process";
import { readFile, open } from "node:fs/promises";
import { resolve } from "node:path";

export async function startSandbox(root, runDir) {
  const work = resolve(runDir, "private");
  const python =
    process.env.A11Y_PYTHON ||
    resolve(
      root,
      "backend",
      process.platform === "win32"
        ? ".venv/Scripts/python.exe"
        : ".venv/bin/python",
    );
  const script = resolve(root, "accessibility/sandbox.py");
  async function command(action) {
    const log = await open(resolve(runDir, `sandbox-${action}.log`), "a");
    try {
      const code = await new Promise((done, reject) => {
        const child = spawn(python, [script, action, "--work-dir", work], {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", log.fd, log.fd],
        });
        child.on("error", reject);
        child.on("exit", (code) => done(code));
      });
      if (code !== 0)
        throw new Error(
          `Sandbox ${action} failed; inspect sandbox-${action}.log`,
        );
    } finally {
      await log.close();
    }
  }
  try {
    await command("prepare");
  } catch (error) {
    // Preparation can fail after postgres started; stop our own cluster as well.
    try {
      await command("stop");
    } catch {
      /* Preserve the original failure and cleanup log. */
    }
    throw error;
  }
  const info = JSON.parse(
    await readFile(resolve(work, "prepared.json"), "utf8"),
  );
  const log = await open(resolve(work, "api.log"), "a");
  const api = spawn(python, [script, "serve", "--work-dir", work], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  let launchError;
  api.on("error", (error) => {
    launchError = error;
  });
  const apiURL = `http://127.0.0.1:${info.apiPort}`;
  async function stop() {
    if (api.pid && api.exitCode === null && !api.killed) {
      const closed = new Promise((done) => api.once("exit", done));
      api.kill();
      await closed;
    }
    await log.close();
    await command("stop");
  }
  try {
    for (let i = 0; i < 100; i++) {
      if (launchError || api.exitCode !== null)
        throw new Error("Sandbox API exited; inspect private/api.log");
      try {
        if (
          (
            await fetch(`${apiURL}/api/health/ready`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        )
          return { apiURL, work, python, stop };
      } catch {
        /* starting */
      }
      await new Promise((done) => setTimeout(done, 300));
    }
    throw new Error("Sandbox API readiness timed out");
  } catch (error) {
    await stop();
    throw error;
  }
}
