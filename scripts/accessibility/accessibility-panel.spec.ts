import { expect, test } from "@playwright/test";
import { auditAccessibility } from "../helpers/accessibility-audit";
import { mockBaseApi } from "../fixtures/api";

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
]) {
  test(`@a11y @responsive painel completo sem cortes e com espaçamento em ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockBaseApi(page);
    await page.goto("/login");

    await page
      .getByRole("button", { name: "Abrir controles de acessibilidade" })
      .click();
    const panel = page.getByRole("region", {
      name: "Acessibilidade",
      exact: true,
    });
    await panel
      .locator("..")
      .locator("..")
      .screenshot({ path: testInfo.outputPath("panel-overview.png") });
    await panel.getByRole("button", { name: /^Seção Leitura / }).click();
    await expect(
      panel.getByRole("button", { name: "Aumentar fonte" }),
    ).not.toBeVisible();
    await panel
      .locator("..")
      .locator("..")
      .screenshot({ path: testInfo.outputPath("panel-categories.png") });
    await panel.getByRole("button", { name: /^Seção Leitura / }).click();
    for (const title of ["Navegação", "Aparência", "Preferências"]) {
      await panel
        .getByRole("button", { name: new RegExp(`^Seção ${title} `) })
        .click();
    }
    await panel.getByLabel("Espaçamento entre letras").selectOption("2");
    await panel.getByLabel("Espaçamento entre palavras").selectOption("2");
    for (const name of [
      "Destacar links",
      "Destacar títulos",
      "Destacar controles",
    ]) {
      await panel.getByRole("button", { name }).click();
      await expect(panel.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    const contentText = page.locator("main p").first();
    const spaces = await contentText.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        letter: parseFloat(style.letterSpacing),
        word: parseFloat(style.wordSpacing),
      };
    });
    expect(spaces.letter).toBeGreaterThan(0);
    expect(spaces.word).toBeGreaterThan(0);
    const lastAction = panel.getByRole("button", { name: "Restaurar padrão" });
    await lastAction.focus();
    await expect(lastAction).toBeInViewport();
    const bounds = (await panel.locator("..").locator("..").boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);

    await auditAccessibility(page, testInfo, "painel-completo");
    await panel
      .getByRole("button", { name: /^Seção Leitura / })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("panel.png") });
    await lastAction.click();
    await expect(page.locator("html")).not.toHaveClass(
      /a11y-(letter-spacing|word-spacing|highlight)/,
    );
    await panel
      .getByRole("button", { name: /^Contraste /, exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Ativar alto contraste", exact: true })
      .click();
    await expect(page.locator("html")).toHaveClass(/high-contrast/);
    await panel
      .getByRole("button", { name: /^Seção Leitura / })
      .scrollIntoViewIfNeeded();
    await auditAccessibility(
      page,
      testInfo,
      "painel-alto-contraste",
      "[data-accessibility-ui]",
    );
    await panel
      .locator("..")
      .locator("..")
      .screenshot({ path: testInfo.outputPath("panel-high-contrast.png") });
  });
}

test("@a11y guia de leitura funciona por teclado e não bloqueia controles", async ({
  page,
}) => {
  await mockBaseApi(page);
  await page.goto("/login");

  await page
    .getByRole("button", { name: "Abrir controles de acessibilidade" })
    .click();
  await page
    .getByRole("button", { name: /^Guia de leitura /, exact: true })
    .click();
  const slider = page.getByRole("slider", {
    name: "Posição do guia de leitura",
  });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("55");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(page.locator("[data-reading-guide]")).toHaveCSS(
    "pointer-events",
    "none",
  );
  const top = await page
    .locator("[data-reading-guide]")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(0.55 * 720 - 12);
  await page
    .getByRole("button", { name: "Abrir controles de acessibilidade" })
    .click();
  await expect(slider).toHaveValue("60");
  await page.getByRole("button", { name: "Restaurar leitura" }).click();
  await expect(page.locator("[data-reading-guide]")).toHaveCount(0);
});

test("@a11y estrutura acompanha a rota e mantém preferências da sessão", async ({
  page,
}) => {
  await mockBaseApi(page);
  await page.goto("/login");

  await page
    .getByRole("button", { name: "Abrir controles de acessibilidade" })
    .click();
  const panel = page.getByRole("region", {
    name: "Acessibilidade",
    exact: true,
  });
  await panel.getByLabel("Espaçamento entre letras").selectOption("1");
  await panel.getByRole("button", { name: /^Seção Navegação / }).click();
  const oldTitle = (await page.locator("main h1").innerText())
    .replace(/\s+/g, " ")
    .trim();
  await expect(
    panel.getByRole("button", { name: oldTitle, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Página inicial da Inclusivo" })
    .first()
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("html")).toHaveClass(/a11y-letter-spacing/);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("stepease-accessibility-preferences"),
    ),
  ).toBeNull();
  const title = page.locator("main h1");
  const titleText = (await title.innerText()).replace(/\s+/g, " ").trim();
  await expect(
    panel.getByRole("button", { name: titleText, exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: oldTitle, exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: titleText, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(title).toBeFocused();
});
