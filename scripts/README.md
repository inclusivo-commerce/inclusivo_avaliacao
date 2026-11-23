# Avaliação automatizada de acessibilidade

Os scripts desta pasta apoiam a avaliação de acessibilidade do Inclusivo,
registrando verificações automatizadas e evidências para análise no TCC.

## Ferramentas utilizadas

- **Playwright:** reproduz interações e verifica o comportamento da interface em perfis de desktop e celular.
- **axe-core:** identifica violações automatizáveis de regras associadas à WCAG.
- **ESLint com jsx-a11y:** analisa práticas de acessibilidade no código dos componentes.
- **Lighthouse:** complementa a avaliação de páginas públicas.

## Cenários avaliados

Os testes abrangem páginas públicas e autenticadas, navegação por teclado,
foco, preferências de acessibilidade, formulários, mensagens e notificações.
Também contemplam estados de carregamento, erro e recuperação.

Os cenários utilizam respostas de API controladas ou um backend real com banco
descartável, conforme o objetivo de cada teste.

## Organização dos scripts

- `run.mjs`: coordena as etapas da avaliação e registra o ambiente utilizado.
- `report.mjs`: reúne os resultados e gera os relatórios.
- `compare.mjs`: compara achados e cobertura entre avaliações.
- `lighthouse.mjs`: realiza as verificações com Lighthouse.
- `sandbox.mjs` e `sandbox.py`: preparam o backend e os dados isolados.
- `.accessibility/` e `.evaluation/`: contêm os cenários de teste.
- `.helpers/accessibility-audit.ts`: reúne funções de auditoria e verificação de foco.

## Evidências e limites

A avaliação produz relatórios, arquivos JSON e capturas de tela para apoiar a
análise dos achados. Violações automáticas, avisos de código, falhas de teste e
resultados inconclusivos são apresentados separadamente.

A ausência de violações automáticas não comprova conformidade integral com WCAG
ou ABNT. A avaliação deve ser complementada por revisão humana, incluindo o uso
de leitores de tela e a análise da adequação do conteúdo.

## Referências técnicas

- **Playwright** — execução dos cenários no navegador, auditoria por estado da interface e anexos de teste. [Guia de testes de acessibilidade](https://playwright.dev/docs/accessibility-testing)
- **axe-core** — integração com os testes e classificação dos achados automáticos e inconclusivos. [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) · [Documentação da API](https://www.deque.com/axe/core-documentation/api-documentation/)
- **ESLint e jsx-a11y** — execução e regras da análise estática de acessibilidade em componentes JSX. [Referência da linha de comando](https://eslint.org/docs/latest/use/command-line-interface) · [Regras do plugin jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#supported-rules)
- **Lighthouse** — interpretação da pontuação de acessibilidade das páginas auditadas. [Documentação da pontuação](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)
- **WCAG 2.2 (W3C)** — referência para os critérios de sucesso e os níveis A e AA abordados pelos testes. [Recomendação WCAG 2.2](https://www.w3.org/TR/WCAG22/)
