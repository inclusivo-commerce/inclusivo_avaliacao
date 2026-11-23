/**
 * Consolida as evidências já coletadas; não executa testes no navegador.
 * Violações do axe, itens inconclusivos e avisos estáticos permanecem separados
 * para evitar interpretar uma sugestão de lint como falha WCAG confirmada.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const abntSource =
  "https://www2.camara.leg.br/a-camara/estruturaadm/gestao-na-camara-dos-deputados/responsabilidade-social-e-ambiental/acessibilidade/pdfs/ABNTNBR17225AcessibilidadeDigitalparaWeb.pdf";
// Deliberately small: only specific rules with a checked normative reference.
const abntByRule = {
  "color-contrast": { clause: "5.11.3", pdfPage: 39 },
  "html-has-lang": { clause: "5.13.2", pdfPage: 42 },
  "html-lang-valid": { clause: "5.13.2", pdfPage: 42 },
  list: { clause: "5.5.1", pdfPage: 28 },
  listitem: { clause: "5.5.1", pdfPage: 28 },
};
export function wcagCriteria(tags = []) {
  return tags
    .filter((tag) => /^wcag\d{3,4}$/.test(tag))
    .map((tag) => {
      const digits = tag.slice(4);
      return `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
    });
}
const md = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ");
async function optionalJSON(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function generateReports(directory) {
  const environment = await optionalJSON(
    resolve(directory, "environment.json"),
  );
  const playwright = await optionalJSON(resolve(directory, "playwright.json"));
  const staticReport = await optionalJSON(resolve(directory, "eslint.json"));
  const lighthouse = await optionalJSON(resolve(directory, "lighthouse.json"));
  const tests = [];
  function collect(suites = [], parents = []) {
    for (const suite of suites) {
      const prefix = [...parents, suite.title].filter(Boolean);
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          tests.push({
            title: [...prefix, spec.title].join(" > "),
            file: spec.file,
            line: spec.line,
            project: test.projectName,
            status: test.status,
            annotations: test.annotations ?? [],
            attempts: test.results.map((result) => ({
              status: result.status,
              duration: result.duration,
              errors: result.errors?.map((error) => error.message),
              attachments: result.attachments?.map(({ name, path }) => ({
                name,
                path: path && relative(directory, path).replaceAll("\\", "/"),
              })),
            })),
          });
        }
      collect(suite.suites, prefix);
    }
  }
  collect(playwright?.suites);
  const audits = [];
  // Each run has its own directory, so stale reports cannot enter this result.
  async function scan(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.name.endsWith("-axe.json")) {
        const result = await optionalJSON(file);
        audits.push({
          file: relative(directory, file).replaceAll("\\", "/"),
          ...result,
        });
      }
    }
  }
  await scan(resolve(directory, "artifacts"));
  // Uma ocorrência corresponde a um nó afetado em uma auditoria, não a um defeito único.
  const issues = [];
  for (const audit of audits)
    for (const kind of ["violations", "incomplete"])
      for (const rule of audit[kind] ?? []) {
        for (const node of rule.nodes)
          issues.push({
            classification:
              kind === "violations"
                ? "automatic-violation"
                : "requires-manual-review",
            url: audit.url,
            stage: audit.evaluation?.stage,
            project: audit.evaluation?.project,
            dataMode: audit.evaluation?.dataMode ?? "controlled-api-fixtures",
            scope: audit.scope,
            rule: rule.id,
            impact: rule.impact,
            wcag: wcagCriteria(rule.tags),
            abnt: abntByRule[rule.id]
              ? { ...abntByRule[rule.id], source: abntSource }
              : null,
            target: node.target,
            html: node.html,
            failureSummary: node.failureSummary,
            help: rule.help,
            helpUrl: rule.helpUrl,
            evidence: audit.file,
            reviewNote:
              rule.id === "aria-hidden-focus" &&
              node.html.includes('tabindex="0"') &&
              node.html.includes("width: 1px")
                ? "Possível proxy de foco do componente de interface. O resultado original do axe foi preservado; confirmar comportamento com teclado/leitor de tela antes de concluir defeito."
                : undefined,
          });
      }
  // O lint descreve o código; seus avisos não confirmam falhas em tempo de execução.
  const staticIssues = (staticReport ?? []).flatMap((file) =>
    file.messages.map((message) => ({
      file: file.filePath,
      line: message.line,
      column: message.column,
      rule: message.ruleId,
      severity: message.severity,
      message: message.message,
      classification: "static-finding-not-confirmed-runtime-wcag-failure",
    })),
  );
  const violations = issues.filter(
    (issue) => issue.classification === "automatic-violation",
  );
  const manual = issues.filter(
    (issue) => issue.classification === "requires-manual-review",
  );
  const severity = Object.fromEntries(
    ["critical", "serious", "moderate", "minor", "unknown"].map((impact) => [
      impact,
      violations.filter((issue) => (issue.impact ?? "unknown") === impact)
        .length,
    ]),
  );
  const pages = [
    ...new Set(audits.map((audit) => new URL(audit.url).pathname)),
  ];
  const counts = {
    tests: tests.length,
    passed: tests.filter((test) => test.status === "expected").length,
    failed: tests.filter((test) => test.status === "unexpected").length,
    skipped: tests.filter((test) => test.status === "skipped").length,
    flaky: tests.filter((test) => test.status === "flaky").length,
    auditedPaths: pages.length,
    auditedViews: new Set(
      audits.map(
        (audit) => new URL(audit.url).pathname + new URL(audit.url).search,
      ),
    ).size,
    liveAxeAudits: audits.filter((audit) =>
      audit.evaluation?.dataMode?.startsWith("backend-real"),
    ).length,
    controlledAxeAudits: audits.filter(
      (audit) => !audit.evaluation?.dataMode?.startsWith("backend-real"),
    ).length,
    axeAudits: audits.length,
    axeRuleEvaluations: audits.reduce(
      (total, audit) =>
        total +
        ["violations", "passes", "incomplete", "inapplicable"].reduce(
          (sum, key) => sum + (audit[key]?.length ?? 0),
          0,
        ),
      0,
    ),
    violationOccurrences: violations.length,
    inconclusiveOccurrences: manual.length,
    staticFindings: staticIssues.length,
    severity,
    lighthouseRuns: (lighthouse ?? []).filter(
      (row) => !row.error && !row.runtimeError,
    ).length,
  };
  const structuralObservations = audits
    .filter(
      (audit) =>
        audit.documentSnapshot && audit.documentSnapshot.mainCount !== 1,
    )
    .map((audit) => ({
      url: audit.url,
      project: audit.evaluation?.project,
      mainCount: audit.documentSnapshot.mainCount,
      classification: "structural-observation-requires-review",
      evidence: audit.file,
      interpretation:
        "Região principal ausente ou repetida; avaliar navegação por regiões e mecanismo de salto. Não equivale a atribuição automática de falha WCAG.",
    }));
  const reportGeneration = {
    generatedAt: new Date().toISOString(),
    generatorSha256: createHash("sha256")
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest("hex"),
  };
  // A comparação precisa saber o que foi medido, inclusive quando não houve violações.
  const auditCoverage = audits.map((audit) => ({
    url: audit.url,
    scope: audit.scope ?? "document",
    ...audit.evaluation,
    file: audit.file,
  }));
  const evaluatedTools = {
    axe: audits.length > 0,
    static: staticReport !== null,
    lighthouse: lighthouse !== null,
  };
  const summary = {
    evaluatedTools,
    auditCoverage,
    reportGeneration,
    environment,
    counts,
    pages,
    tests,
    issues,
    staticIssues,
    lighthouse,
    structuralObservations,
    limitations: [
      "Ausência de violações automáticas não comprova conformidade WCAG ou ABNT.",
      "Ocorrências incluem repetições entre páginas, estados e perfis; não representam defeitos únicos.",
      "Autenticação, carrinho, compra e mensagens dos cenários controlados usam fixtures, sem transações externas.",
      "Consultar dataMode e environment.json: backend real pode ser público somente leitura ou PostgreSQL descartável autenticado; Lighthouse permanece público.",
      "320px e fonte raiz ampliada não equivalem a testar zoom nativo do navegador nem leitor de tela.",
      "Amostra intencional e cenários existentes; sem amostragem aleatória integral da WCAG-EM.",
      "Mapeamento ABNT parcial e específico por regra; ausência de cláusula não indica ausência de requisito.",
    ],
  };
  await writeFile(
    resolve(directory, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    resolve(directory, "issues.json"),
    JSON.stringify(issues, null, 2),
  );
  const labels = {
    tests: "Cenários listados",
    passed: "Aprovados",
    failed: "Falhas",
    skipped: "Ignorados",
    flaky: "Instáveis",
    auditedPaths: "Caminhos com auditoria axe",
    auditedViews: "URLs/abas com auditoria axe",
    liveAxeAudits: "Auditorias axe com backend real",
    controlledAxeAudits: "Auditorias axe com APIs controladas",
    axeAudits: "Auditorias axe",
    axeRuleEvaluations: "Avaliações de regras axe (inclui não aplicáveis)",
    violationOccurrences: "Ocorrências de violações axe",
    inconclusiveOccurrences: "Ocorrências inconclusivas axe",
    staticFindings: "Achados estáticos",
    lighthouseRuns: "Execuções Lighthouse concluídas",
  };
  const lines = [
    "# Relatório consolidado de acessibilidade — Inclusivo",
    "",
    `Execução: ${environment?.started ?? "não registrada"}. Commit: ${environment?.commit ?? "consultar environment.json"}.`,
    "",
    "| Medida | Resultado |",
    "| --- | --- |",
    ...Object.entries(counts)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => `| ${labels[key] ?? key} | ${value} |`),
    "",
    "## Gravidade das ocorrências axe",
    "",
    "| Impacto | Ocorrências |",
    "| --- | --- |",
    ...Object.entries(severity).map(
      ([impact, count]) => `| ${impact} | ${count} |`,
    ),
    "",
    "## Lighthouse — acessibilidade",
    "",
    "| Página | Pontuação /100 | Falhas | Aprovadas | Revisões manuais |",
    "| --- | --- | --- | --- | --- |",
    ...(lighthouse ?? []).map(
      (row) =>
        `| ${row.route} | ${row.error || row.runtimeError ? "ERRO" : row.score === null ? "inconclusivo" : Math.round(row.score * 100)} | ${row.failed?.length ?? "—"} | ${row.passed?.length ?? "—"} | ${row.manual?.length ?? "—"} |`,
    ),
    "",
    "A pontuação Lighthouse é uma média ponderada das auditorias incluídas, não porcentagem de conformidade WCAG. Revisões manuais permanecem pendentes.",
    "",
    "## Cobertura e limitações",
    "",
    ...summary.limitations.map((line) => `- ${line}`),
    "",
    "## Infraestrutura",
    "",
    ...(environment?.commands ?? []).map(
      (command) =>
        `- ${command.name}: código de saída ${command.exitCode}; log: ${command.name}.log.`,
    ),
    ...(environment?.infrastructureError
      ? [`- Falha de infraestrutura: ${environment.infrastructureError}`]
      : []),
    ...(!playwright ? ["- Playwright: não executado ou sem relatório."] : []),
    ...(!lighthouse ? ["- Lighthouse: não executado ou sem relatório."] : []),
    "",
    "Detalhes: [relatório técnico](technical.md), [priorização](priorities.md), [resumo acadêmico](academic.md), [JSON consolidado](summary.json).",
    "",
  ];
  await writeFile(resolve(directory, "README.md"), lines.join("\n"));
  const tech = [
    "# Relatório técnico",
    "",
    "## Ambiente",
    "",
    "```json",
    JSON.stringify(environment, null, 2),
    "```",
    "",
    "## Cenários executados",
    "",
    "| Cenário | Perfil | Resultado |",
    "| --- | --- | --- |",
    ...tests.map(
      (test) => `| ${md(test.title)} | ${test.project} | ${test.status} |`,
    ),
    "",
    "## Verificações de integração confirmadas",
    "",
    ...tests.flatMap((test) =>
      (test.annotations ?? [])
        .filter((annotation) => annotation.type === "verification")
        .map(
          (annotation) =>
            `- ${md(test.title)} (${test.project}): ${md(annotation.description)}`,
        ),
    ),
    "",
    "## Falhas de teste (comportamento ou pré-condição; não são automaticamente falhas WCAG)",
    "",
    ...tests
      .filter((test) => test.status === "unexpected")
      .flatMap((test) => [
        `### ${md(test.title)} — ${test.project}`,
        "",
        "```text",
        ...test.attempts.flatMap((attempt) => attempt.errors ?? []),
        "```",
        "",
      ]),
    "## Violações e itens inconclusivos do axe",
    "",
    ...issues.flatMap((issue, i) => [
      `### ${i + 1}. ${issue.rule} — ${issue.classification}`,
      "",
      `Página: ${issue.url}; estado: ${issue.stage}; perfil: ${issue.project}; dados: ${issue.dataMode}; escopo: ${issue.scope}.`,
      `Impacto: ${issue.impact ?? "não definido"}; WCAG: ${issue.wcag.join(", ") || "sem critério atribuído pela ferramenta"}.`,
      `ABNT: ${issue.abnt ? `[${issue.abnt.clause}](${issue.abnt.source}#page=${issue.abnt.pdfPage}) — vínculo restrito a esta regra` : "não mapeada nesta avaliação"}.`,
      `Seletor: ${JSON.stringify(issue.target)}`,
      "",
      "```html",
      issue.html,
      "```",
      ...(issue.reviewNote ? [issue.reviewNote] : []),
      issue.failureSummary ??
        "Resultado inconclusivo: inspecionar o elemento e o JSON do axe.",
      `[Explicação e orientação de correção](${issue.helpUrl}). [Evidência JSON](${issue.evidence}).`,
      "",
    ]),
    "## Observações estruturais para inspeção",
    "",
    ...structuralObservations.map(
      (item) =>
        `- ${item.url} (${item.project}): ${item.mainCount} regiões principais. ${item.interpretation} Evidência: ${item.evidence}`,
    ),
    "",
    "## Análise estática",
    "",
    "Achados de código exigem confirmação no DOM e no comportamento. A ferramenta não determina sozinha a violação de um critério.",
    "",
    ...staticIssues.map(
      (issue) =>
        `- ${md(relative(resolve(directory, "../../.."), issue.file))}:${issue.line}:${issue.column} — ${issue.rule}: ${md(issue.message)}`,
    ),
    "",
    "## Lighthouse",
    "",
    "JSON/HTML completos na pasta lighthouse; lighthouse.json contém falhas, aprovadas, não aplicáveis e revisões manuais com detalhes dos elementos.",
    "",
  ];
  for (const row of lighthouse ?? []) {
    tech.push(
      `### Lighthouse ${row.route}`,
      "",
      `URL: ${row.finalUrl ?? row.requestedUrl ?? "não disponível"}; data: ${row.fetchTime ?? "não disponível"}; versão: ${row.lighthouseVersion ?? "não disponível"}.`,
      ...(row.error || row.runtimeError
        ? [`Falha: ${row.error ?? JSON.stringify(row.runtimeError)}`]
        : []),
      "Falhas:",
      ...(row.failed ?? []).map(
        (audit) => `- ${audit.id}: ${audit.title}. ${audit.description}`,
      ),
      "Requer avaliação manual:",
      ...(row.manual ?? []).map(
        (audit) => `- ${audit.id}: ${audit.title}. ${audit.description}`,
      ),
      "Aprovadas:",
      ...(row.passed ?? []).map((audit) => `- ${audit.id}: ${audit.title}`),
      "Não aplicáveis:",
      ...(row.notApplicable ?? []).map(
        (audit) => `- ${audit.id}: ${audit.title}`,
      ),
      "Auditorias com erro:",
      ...(row.errors ?? []).map(
        (audit) => `- ${audit.id}: ${audit.errorMessage ?? audit.title}`,
      ),
      "",
    );
  }
  await writeFile(resolve(directory, "technical.md"), tech.join("\n"));
  const lighthouseFindings = (lighthouse ?? []).flatMap((row) =>
    (row.failed ?? []).map((audit) => ({
      route: row.route,
      rule: audit.id,
      title: audit.title,
      wcag: wcagCriteria(audit.details?.debugData?.tags ?? []),
      classification: (audit.details?.debugData?.tags ?? []).includes(
        "best-practice",
      )
        ? "best-practice-requires-review"
        : "lighthouse-finding",
    })),
  );
  const grouped = new Map();
  for (const issue of violations) {
    const key = `${issue.impact}:${issue.rule}`;
    if (!grouped.has(key))
      grouped.set(key, {
        rule: issue.rule,
        impact: issue.impact,
        wcag: issue.wcag,
        urls: new Set(),
        count: 0,
        helpUrl: issue.helpUrl,
      });
    grouped.get(key).urls.add(new URL(issue.url).pathname);
    grouped.get(key).count++;
  }
  const order = ["critical", "serious", "moderate", "minor", null];
  const groups = [...grouped.values()].sort(
    (a, b) => order.indexOf(a.impact) - order.indexOf(b.impact),
  );
  await writeFile(
    resolve(directory, "priorities.md"),
    [
      "# Priorização de correções sugeridas",
      "",
      "Nenhuma correção em componentes de produção foi aplicada nesta etapa. Impacto é a classificação do axe; validar contexto e alcance antes de corrigir.",
      "",
      "| Regra | Impacto | WCAG | Ocorrências | Páginas | Orientação |",
      "| --- | --- | --- | --- | --- | --- |",
      ...groups.map(
        (group) =>
          `| ${group.rule} | ${group.impact} | ${group.wcag.join(", ")} | ${group.count} | ${[...group.urls].join(", ")} | [Como investigar/corrigir](${group.helpUrl}) |`,
      ),
      "",
      "## Achados complementares do Lighthouse",
      "",
      "| Página | Regra | Classificação | WCAG informada pela ferramenta |",
      "| --- | --- | --- | --- |",
      ...lighthouseFindings.map(
        (item) =>
          `| ${item.route} | ${item.rule} | ${item.classification} | ${item.wcag.join(", ") || "não atribuída; verificar contexto"} |`,
      ),
      "",
      "## Falhas de cenário a investigar",
      "",
      ...tests
        .filter((test) => test.status === "unexpected")
        .map(
          (test) =>
            `- ${md(test.title)} (${test.project}). Consultar erro e captura no relatório técnico.`,
        ),
      "",
      "## Estrutura de navegação a revisar",
      "",
      ...structuralObservations.map(
        (item) =>
          `- ${new URL(item.url).pathname} (${item.project}): ${item.mainCount} regiões principais; investigar regiões e skip link antes de aprovar navegação.`,
      ),
      "",
      "## Revisão estática e humana",
      "",
      `${manual.length} ocorrências inconclusivas aguardam revisão humana. ${staticIssues.length} achados estáticos aguardam confirmação. Falhas de teste estão em technical.md.`,
      "",
    ].join("\n"),
  );
  await writeFile(
    resolve(directory, "academic.md"),
    [
      "# Resumo para adaptação ao TCC",
      "",
      `Em ${environment?.started ?? "data não registrada"}, avaliou-se uma amostra intencional de interfaces do Inclusivo, tendo como alvo os critérios A e AA da WCAG 2.2. A organização do procedimento foi orientada pela WCAG-EM, com inventário, delimitação de escopo, seleção de estados e documentação das evidências. Não se afirma execução integral da metodologia ou certificação.`,
      "",
      `Foram utilizados Playwright ${environment?.versions?.["@playwright/test"]}, axe-core ${environment?.versions?.["axe-core"]}, Lighthouse ${environment?.versions?.lighthouse} e eslint-plugin-jsx-a11y ${environment?.versions?.["eslint-plugin-jsx-a11y"]}. O ambiente foi ${environment?.platform}, Node ${environment?.node}; versões de navegador, viewport, datas e URLs estão nos artefatos.`,
      "",
      `O relatório registrou ${counts.tests} testes: ${counts.passed} aprovados, ${counts.failed} com falha, ${counts.skipped} ignorados e ${counts.flaky} instáveis. Foram produzidas ${counts.axeAudits} auditorias axe em ${counts.auditedPaths} caminhos, com ${counts.violationOccurrences} ocorrências de violação e ${counts.inconclusiveOccurrences} ocorrências inconclusivas. As contagens incluem repetições e não medem percentual de conformidade.`,
      "",
      `Foram registradas ${counts.lighthouseRuns} execuções Lighthouse concluídas e ${counts.staticFindings} achados estáticos. As falhas de testes podem representar barreiras, pré-condições ausentes ou limitações dos cenários; requerem interpretação antes da atribuição normativa.`,
      "",
      ...summary.limitations.map((line) => `- ${line}`),
      "",
      "O checklist manual permanece pendente. Resultados de leitores de tela, adequação dos textos alternativos, ordem lógica e usabilidade não foram inferidos dos testes automáticos.",
      "",
    ].join("\n"),
  );
  return summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = dirname(fileURLToPath(import.meta.url));
  const input = process.argv[2]
    ? resolve(process.argv[2])
    : JSON.parse(await readFile(resolve(root, "results/latest.json"), "utf8"))
        .runDir;
  await generateReports(input);
  console.log(`Relatórios regenerados: ${input}`);
}
