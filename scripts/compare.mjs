/**
 * Compara duas rodadas por contexto e ocorrência, preservando a cobertura.
 * Um achado ausente só é classificado como não mais detectado quando seu
 * contexto foi reavaliado; ausência de execução não significa correção.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Normaliza IDs da rota e parâmetros transitórios para comparar a mesma tela.
export const canonicalView = (value) => {
  const url = new URL(value, "http://audit.invalid");
  const path = url.pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
  const params = [...url.searchParams]
    .filter(([key]) => !["highlight", "orderId"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return (
    path + (params.length ? "?" + new URLSearchParams(params).toString() : "")
  );
};
export function contextKey(value) {
  return JSON.stringify([
    canonicalView(value.url),
    value.stage ?? "",
    value.project ?? "",
    value.dataMode ?? "",
    value.scope ?? "document",
  ]);
}
export function issueKey(issue) {
  // HTML, texto, porta temporária e contagem podem mudar sem alterar a identidade do achado.
  return JSON.stringify([contextKey(issue), issue.rule, issue.target]);
}
export function compareSummaries(previous, current) {
  const indexAutomaticViolations = (report) =>
    new Map(
      (report.issues ?? [])
        .filter((i) => i.classification === "automatic-violation")
        .map((i) => [issueKey(i), i]),
    );
  const previousViolations = indexAutomaticViolations(previous);
  const currentViolations = indexAutomaticViolations(current);
  const previousCoverage = new Set(
    (previous.auditCoverage ?? []).map(contextKey),
  );
  const currentCoverage = new Set(
    (current.auditCoverage ?? []).map(contextKey),
  );
  const manualReviewKeys = new Set(
    (current.issues ?? [])
      .filter((i) => i.classification === "requires-manual-review")
      .map(issueKey),
  );
  const result = {
    new: [],
    newCoverage: [],
    persistent: [],
    noLongerDetected: [],
    inconclusiveNow: [],
    notReevaluated: [],
    testRegressions: [],
    testImprovements: [],
    testsNotReevaluated: [],
  };
  for (const [key, issue] of currentViolations) {
    if (previousViolations.has(key)) result.persistent.push(issue);
    else if (previousCoverage.has(contextKey(issue))) result.new.push(issue);
    else result.newCoverage.push(issue);
  }
  // Sem cobertura atual, um achado anterior continua pendente de reavaliação.
  for (const [key, issue] of previousViolations) {
    if (currentViolations.has(key)) continue;
    if (!currentCoverage.has(contextKey(issue)))
      result.notReevaluated.push(issue);
    else if (manualReviewKeys.has(key)) result.inconclusiveNow.push(issue);
    else result.noLongerDetected.push(issue);
  }
  // Resultados funcionais são comparados separadamente das ocorrências do axe.
  const testKey = (test) =>
    JSON.stringify([
      test.file?.replaceAll("\\", "/"),
      test.title,
      test.project,
    ]);
  const tests = new Map(
    (current.tests ?? []).map((test) => [testKey(test), test]),
  );
  for (const test of previous.tests ?? []) {
    const next = tests.get(testKey(test));
    if (!next || next.status === "skipped")
      result.testsNotReevaluated.push(test);
    else if (test.status === "expected" && next.status === "unexpected")
      result.testRegressions.push(next);
    else if (test.status === "unexpected" && next.status === "expected")
      result.testImprovements.push(next);
  }
  const staticEvaluated = (report) =>
    report.evaluatedTools?.static ??
    report.environment?.commands?.some((command) => command.name === "static");
  const staticKey = (item) =>
    JSON.stringify([
      item.file.replaceAll("\\", "/").replace(/^.*?frontend\/src\//, "src/"),
      item.rule,
      item.message,
    ]);
  const previousStaticIssues = new Map(
    (previous.staticIssues ?? []).map((item) => [staticKey(item), item]),
  );
  const currentStaticIssues = new Map(
    (current.staticIssues ?? []).map((item) => [staticKey(item), item]),
  );
  const staticChanges = {
    new: [],
    persistent: [],
    noLongerDetected: [],
    notReevaluated: [],
  };
  for (const [key, item] of currentStaticIssues)
    staticChanges[previousStaticIssues.has(key) ? "persistent" : "new"].push(
      item,
    );
  for (const [key, item] of previousStaticIssues)
    if (!currentStaticIssues.has(key))
      staticChanges[
        staticEvaluated(current) ? "noLongerDetected" : "notReevaluated"
      ].push(item);
  const lighthouseChanges = {
    new: [],
    persistent: [],
    noLongerDetected: [],
    notReevaluated: [],
  };
  const indexLighthouseFailures = (report) =>
    new Map(
      (report.lighthouse ?? []).flatMap((row) =>
        (row.failed ?? []).map((audit) => [
          JSON.stringify([row.route, audit.id]),
          { route: row.route, rule: audit.id },
        ]),
      ),
    );
  const previousLighthouseFailures = indexLighthouseFailures(previous);
  const currentLighthouseFailures = indexLighthouseFailures(current);
  for (const [key, item] of currentLighthouseFailures)
    lighthouseChanges[
      previousLighthouseFailures.has(key) ? "persistent" : "new"
    ].push(item);
  for (const [key, item] of previousLighthouseFailures)
    if (!currentLighthouseFailures.has(key)) {
      const row = (current.lighthouse ?? []).find(
        (row) => row.route === item.route,
      );
      const applicable =
        row &&
        !row.error &&
        !row.runtimeError &&
        !(row.errors ?? []).some((audit) => audit.id === item.rule);
      lighthouseChanges[
        applicable ? "noLongerDetected" : "notReevaluated"
      ].push(item);
    }
  return {
    ...result,
    staticChanges,
    lighthouseChanges,
    counts: Object.fromEntries(
      Object.entries(result).map(([key, value]) => [key, value.length]),
    ),
    warnings: [
      "Unidades de comparação são chaves de ocorrência por regra, seletor, estado, perfil, dados e escopo; não representam todos os defeitos possíveis.",
      "Não mais detectado significa ausência na mesma amostra automatizada, não confirmação de conformidade ou de correção manual.",
      ...([
        "frontend/e2e/helpers/accessibility-audit.ts",
        "accessibility/playwright.config.ts",
      ].some(
        (file) =>
          previous.environment?.sourceFilesSha256?.[file] &&
          current.environment?.sourceFilesSha256?.[file] &&
          previous.environment.sourceFilesSha256[file] !==
            current.environment.sourceFilesSha256[file],
      )
        ? [
            "O helper ou a configuração de auditoria mudou: ausências podem refletir a coleta/estabilização, não uma correção da aplicação.",
          ]
        : []),
      ...(JSON.stringify(previous.environment?.versions) !==
      JSON.stringify(current.environment?.versions)
        ? [
            "Versões das ferramentas diferem: interpretar mudanças considerando a cobertura das regras.",
          ]
        : []),
      ...(!previous.auditCoverage?.length || !current.auditCoverage?.length
        ? [
            "Uma rodada não dispõe de cobertura axe suficiente; ausências não são classificadas como correções.",
          ]
        : []),
    ],
  };
}

export async function loadSummary(directory) {
  const summary = JSON.parse(
    await readFile(resolve(directory, "summary.json"), "utf8"),
  );
  if (!summary.auditCoverage) {
    // Recupera a cobertura de relatórios antigos sem reescrever a rodada anterior.
    summary.auditCoverage = [];
    async function scan(path) {
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return;
        throw e;
      }
      for (const entry of entries) {
        const file = resolve(path, entry.name);
        if (entry.isDirectory()) await scan(file);
        else if (entry.name.endsWith("-axe.json")) {
          const audit = JSON.parse(await readFile(file, "utf8"));
          summary.auditCoverage.push({
            url: audit.url,
            scope: audit.scope ?? "document",
            ...audit.evaluation,
          });
        }
      }
    }
    await scan(resolve(directory, "artifacts"));
  }
  return summary;
}
export async function compareRuns(previousDir, currentDir) {
  if (resolve(previousDir) === resolve(currentDir))
    throw new Error("Choose two distinct runs");
  const result = compareSummaries(
    await loadSummary(previousDir),
    await loadSummary(currentDir),
  );
  result.previousRun = resolve(previousDir);
  result.currentRun = resolve(currentDir);
  await writeFile(
    resolve(currentDir, "comparison.json"),
    JSON.stringify(result, null, 2),
  );
  const labels = {
    new: "Novas na cobertura comparável",
    newCoverage: "Observadas em cobertura nova",
    persistent: "Persistentes",
    noLongerDetected: "Não mais detectadas no mesmo escopo",
    inconclusiveNow: "Agora inconclusivas",
    notReevaluated: "Não reavaliadas",
    testRegressions: "Regressões de testes anteriormente aprovados",
    testImprovements: "Testes que passaram na reavaliação",
    testsNotReevaluated: "Testes não reavaliados",
  };
  await writeFile(
    resolve(currentDir, "comparison.md"),
    [
      "# Comparação entre rodadas",
      "",
      `Anterior: ${result.previousRun}`,
      `Atual: ${result.currentRun}`,
      "",
      "| Classificação | Chaves distintas |",
      "| --- | --- |",
      ...Object.entries(result.counts).map(
        ([key, count]) => `| ${labels[key]} | ${count} |`,
      ),
      "",
      ...result.warnings.map((line) => "- " + line),
      "",
      "## Análise estática e Lighthouse (grupos de achados)",
      "",
      ...[
        ["Estático", result.staticChanges],
        ["Lighthouse", result.lighthouseChanges],
      ].flatMap(([tool, changes]) => [
        `### ${tool}`,
        "",
        ...Object.entries(changes).map(
          ([name, values]) => `- ${name}: ${values.length}`,
        ),
        "",
      ]),

      ...Object.keys(labels).flatMap((key) => [
        `## ${labels[key]}`,
        "",
        ...result[key].map((item) =>
          item.rule
            ? `- ${canonicalView(item.url)} — ${item.stage} — ${item.project} — ${item.rule} — ${JSON.stringify(item.target)}`
            : `- ${item.title} (${item.project})`,
        ),
        "",
      ]),
    ].join("\n"),
  );
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [before, after] = process.argv.slice(2);
  if (!before || !after)
    throw new Error("Usage: node compare.mjs PREVIOUS_RUN CURRENT_RUN");
  const result = await compareRuns(resolve(before), resolve(after));
  console.log(JSON.stringify(result.counts, null, 2));
}
