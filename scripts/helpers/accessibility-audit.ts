import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

export async function auditAccessibility(
  page: Page,
  testInfo: TestInfo,
  stage: string,
  include?: string,
  soft = false,
) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.getAnimations().filter((animation) => {
              const timing = animation.effect?.getComputedTiming();
              return (
                animation.playState === "running" &&
                timing &&
                Number.isFinite(Number(timing.endTime))
              );
            }).length,
        ),
      {
        timeout: 5000,
        message:
          "Aguardar término das animações finitas antes de medir o estado estável",
      },
    )
    .toBe(0);
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ]);
  builder = builder.exclude(
    'div[aria-label="Notifications (F8)"] > span[aria-hidden="true"]',
  );
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const documentSnapshot = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(
      (element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent?.trim(),
      }),
    ),
    mainCount: document.querySelectorAll('main,[role="main"]').length,
    formCount: document.querySelectorAll("form").length,
    liveRegions: Array.from(
      document.querySelectorAll('[aria-live],[role="status"],[role="alert"]'),
    ).map((element) => ({
      role: element.getAttribute("role"),
      live: element.getAttribute("aria-live"),
      text: element.textContent?.trim().slice(0, 200),
    })),
    limitation:
      "Inventário estrutural; adequação da hierarquia e dos anúncios exige revisão humana.",
  }));
  const path = testInfo.outputPath(`${stage}-axe.json`);
  await writeFile(
    path,
    JSON.stringify(
      {
        evaluation: {
          stage,
          testId: testInfo.testId,
          title: testInfo.titlePath.join(" > "),
          project: testInfo.project.name,
          viewport: page.viewportSize(),
          browserVersion: page.context().browser()?.version(),
          dataMode: testInfo.titlePath.join(" ").includes("@real-api")
            ? "backend-real-isolated"
            : testInfo.title.includes("@live")
              ? "backend-real-read-only"
              : "controlled-api-fixtures",
        },
        documentSnapshot,
        scope: include ?? "document",
        ...results,
      },
      null,
      2,
    ),
  );
  await testInfo.attach(`${stage}-axe`, {
    path,
    contentType: "application/json",
  });
  const screenshot = testInfo.outputPath(`${stage}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach(stage, { path: screenshot, contentType: "image/png" });
  // Todos os impactos WCAG são verificados. Itens "incomplete" ficam no relatório
  // para revisão humana; não são automaticamente classificados como aprovados.
  const verify = soft ? expect.soft : expect;
  verify(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}

// Chega ao controle percorrendo a ordem de Tab, sem focus() ou cliques.
export async function tabTo(page: Page, target: Locator, limit = 100) {
  await expect(target).toBeVisible();
  for (let index = 0; index < limit; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Controle não alcançado por Tab: ${(await target.getAttribute("aria-label")) ?? (await target.textContent())}`,
  );
}

export async function expectFocusVisible(target: Locator) {
  await expect(target).toBeFocused();
  expect(
    await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.matches(":focus-visible") &&
        ((style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none")
      );
    }),
  ).toBe(true);
}
