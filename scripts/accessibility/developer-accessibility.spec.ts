import { productDetailsName } from "../helpers/locators";
import { expect, test } from "@playwright/test";
import {
  authenticate,
  clientUser,
  mockBaseApi,
  products,
} from "../fixtures/api";
import {
  auditAccessibility,
  expectFocusVisible,
  tabTo,
} from "../helpers/accessibility-audit";

const STORAGE_KEY = "stepease-accessibility-preferences";
const combinedPreferences = {
  fontSize: 24,
  highContrast: false,
  lineHeight: 2,
  dyslexicFont: true,
  reduceMotion: true,
  grayscale: false,
  bigCursor: true,
  consent: true,
  letterSpacing: 2,
  wordSpacing: 2,
  highlightLinks: true,
  highlightHeadings: true,
  highlightControls: true,
  readingGuide: true,
};

test.describe("@a11y auditoria pelos desenvolvedores", () => {
  test("compra por teclado: busca, produto, endereço, frete e checkout", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await authenticate(page, clientUser);
    await page.goto("/shop");

    const skip = page.getByRole("link", {
      name: /Ir para o conteúdo principal/i,
    });
    await expect(skip).toBeAttached();
    await page.keyboard.press("Tab");
    await expectFocusVisible(skip);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await tabTo(
      page,
      page.getByRole("searchbox", {
        name: "Buscar por produto, marca ou descrição",
      }),
    );
    await page.keyboard.type("Aurora");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "1 produto encontrado para Aurora" }),
    ).toHaveAttribute("aria-live", "polite");
    await tabTo(
      page,
      page.getByRole("link", { name: productDetailsName(products[0].name) }),
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/product\/1$/);
    await expect(page).toHaveTitle(/Detalhes do produto/);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Detalhes do produto, página carregada." }),
    ).toBeAttached();

    await auditAccessibility(page, testInfo, "produto");
    await tabTo(
      page,
      page.getByRole("button", { name: "Comprar agora", exact: true }),
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/shipping$/);
    const address = page.getByRole("radio", { name: /Cliente de teste/ });
    await tabTo(page, address);
    await page.keyboard.press("Space");
    await expect(address).toBeChecked();
    const standard = page.getByRole("radio", { name: "Padrão", exact: true });
    await tabTo(page, standard);
    await page.keyboard.press("ArrowDown");
    const express = page.getByRole("radio", { name: "Expressa", exact: true });
    await expect(express).toBeFocused();
    await expect(express).toBeChecked();
    await expectFocusVisible(express);

    await auditAccessibility(page, testInfo, "frete");
    await tabTo(
      page,
      page.getByRole("button", { name: /Continuar para pagamento/ }),
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/checkout$/);
    await tabTo(page, page.getByRole("button", { name: /Finalizar e pagar/ }));
    await expectFocusVisible(
      page.getByRole("button", { name: /Finalizar e pagar/ }),
    );

    await auditAccessibility(page, testInfo, "checkout");
  });

  test("erros de login são associados aos campos e corrigíveis por teclado", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    let requests = 0;
    await page.route("**/api/login", async (route) => {
      requests += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      });
    });
    await page.goto("/login");

    await tabTo(
      page,
      page.getByRole("button", { name: "Entrar", exact: true }),
    );
    await page.keyboard.press("Enter");
    const email = page.getByRole("textbox", {
      name: "E-mail (obrigatório)",
      exact: true,
    });
    const password = page.getByLabel("Senha (obrigatória)", { exact: true });
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(/E-mail é obrigatório/);
    await expect(password).toHaveAccessibleDescription("Senha é obrigatória");
    expect(requests).toBe(0);

    await auditAccessibility(page, testInfo, "login-validacao");
    await page.keyboard.type(clientUser.email);
    await tabTo(page, password);
    await page.keyboard.type("senha-segura");
    await tabTo(page, page.getByRole("button", { name: "Mostrar senha" }));
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await expect(
      page.getByRole("button", { name: "Ocultar senha" }),
    ).toBeFocused();
    await tabTo(
      page,
      page.getByRole("button", { name: "Entrar", exact: true }),
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Login inválido");
    await expect(email).toHaveAttribute("aria-invalid", "false");
    expect(requests).toBe(1);

    await auditAccessibility(page, testInfo, "login-rejeitado");
  });

  test("carrinho anuncia inclusão e mantém foco dentro do diálogo", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await authenticate(page, clientUser);
    let quantity = 0;
    await page.route(/\/api\/cart\/?$/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          user_id: 1,
          items: quantity
            ? [{ id: 11, product_id: 1, product: products[0], quantity }]
            : [],
        }),
      }),
    );
    await page.route("**/api/cart/items", async (route) => {
      quantity = route.request().postDataJSON().quantity;
      await route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.goto("/product/1");

    const add = page.getByRole("button", {
      name: "Adicionar ao carrinho",
      exact: true,
    });
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /unidade de Tênis Aurora adicionada ao carrinho/ }),
    ).toHaveAttribute("aria-live", "polite");
    const trigger = page.getByRole("button", {
      name: "Carrinho de compras, 1 item",
      exact: true,
    });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /Meu carrinho/ });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
    const close = dialog.getByRole("button", { name: "Fechar carrinho" });
    await tabTo(page, close);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();

    await auditAccessibility(page, testInfo, "carrinho");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("painel e confirmações são operáveis por teclado com retorno de foco", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto("/login");

    const trigger = page.getByRole("button", {
      name: "Abrir controles de acessibilidade",
    });
    await tabTo(page, trigger);
    await expectFocusVisible(trigger);
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", {
      name: "Acessibilidade",
      exact: true,
    });
    await expect(
      panel.getByRole("heading", { name: "Acessibilidade" }),
    ).toBeFocused();
    await tabTo(page, panel.getByRole("button", { name: /^Seção Aparência / }));
    await page.keyboard.press("Enter");
    const contrast = panel.getByRole("button", {
      name: /^Contraste /,
      exact: true,
    });
    await tabTo(page, contrast);
    await page.keyboard.press("Space");
    await expect(
      panel.getByRole("button", { name: "Ativar alto contraste", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      panel.getByRole("button", { name: "Cancelar", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(contrast).toBeFocused();
    await expect(contrast).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await expect(contrast).toBeFocused();
    await expect(contrast).toHaveAttribute("aria-pressed", "true");

    await auditAccessibility(
      page,
      testInfo,
      "painel-contraste",
      "[data-accessibility-ui]",
    );
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abrir controles de acessibilidade" }),
    ).toBeFocused();
  });

  test("salvamento sobrevive ao reload e restauração remove apenas a seção escolhida", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto("/login");

    await page
      .getByRole("button", { name: "Abrir controles de acessibilidade" })
      .click();
    const panel = page.getByRole("region", {
      name: "Acessibilidade",
      exact: true,
    });
    await panel.getByLabel("Espaçamento entre letras").selectOption("2");
    await panel.getByRole("button", { name: /^Seção Navegação / }).click();
    await panel
      .getByRole("button", { name: /^Destacar links /, exact: true })
      .click();
    await panel.getByRole("button", { name: /^Seção Preferências / }).click();
    const remember = panel.getByRole("checkbox", {
      name: "Lembrar neste dispositivo",
    });
    await remember.check();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          STORAGE_KEY,
        ),
      )
      .toMatchObject({ consent: true, letterSpacing: 2, highlightLinks: true });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/a11y-letter-spacing/);
    await expect(page.locator("html")).toHaveClass(/a11y-highlight-links/);
    await page
      .getByRole("button", { name: "Abrir controles de acessibilidade" })
      .click();
    await panel.getByRole("button", { name: "Restaurar leitura" }).click();
    await expect(page.locator("html")).not.toHaveClass(/a11y-letter-spacing/);
    await expect(page.locator("html")).toHaveClass(/a11y-highlight-links/);
    await panel.getByRole("button", { name: /^Seção Preferências / }).click();
    await panel.getByRole("button", { name: "Restaurar preferências" }).click();
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
      )
      .toBeNull();
    await expect(page.locator("html")).toHaveClass(/a11y-highlight-links/);
    await panel.getByRole("button", { name: "Restaurar padrão" }).click();
    await expect(page.locator("html")).not.toHaveClass(/a11y-highlight/);

    await auditAccessibility(page, testInfo, "preferencias-restauradas");
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/a11y-highlight/);
  });

  test("painel continua utilizável quando armazenamento é bloqueado", async ({
    page,
  }) => {
    await mockBaseApi(page);
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key)
          throw new DOMException("Armazenamento bloqueado", "SecurityError");
        original.call(this, name, value);
      };
    }, STORAGE_KEY);
    await page.goto("/login");

    await page
      .getByRole("button", { name: "Abrir controles de acessibilidade" })
      .click();
    const panel = page.getByRole("region", {
      name: "Acessibilidade",
      exact: true,
    });
    await panel.getByRole("button", { name: /^Seção Preferências / }).click();
    await panel
      .getByRole("checkbox", { name: "Lembrar neste dispositivo" })
      .click();
    await expect(
      panel.getByRole("checkbox", { name: "Lembrar neste dispositivo" }),
    ).not.toBeChecked();
    await expect(panel.getByText(/Não foi possível salvar/)).toBeAttached();
    await panel.getByRole("button", { name: "Aumentar fonte" }).click();
    await expect(page.locator("html")).toHaveCSS("font-size", "18px");
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
      )
      .toBeNull();
  });

  test("menu móvel fecha com Escape, retorna foco e permite navegar por teclado", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await mockBaseApi(page);
    await page.goto("/login");

    const trigger = page.getByRole("button", {
      name: "Abrir menu",
      exact: true,
    });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const menu = page.locator("#mobile-navigation-menu");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Início", exact: true }),
    ).toBeFocused();
    await expect(menu.locator(":scope > div")).toHaveCSS("opacity", "1");

    await auditAccessibility(page, testInfo, "menu-movel");
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await tabTo(page, menu.getByRole("link", { name: "Loja", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/shop$/);
    await expect(menu).not.toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Loja, página carregada." }),
    ).toBeAttached();
  });

  test("busca do cabeçalho associa o diálogo e devolve foco ao fechar", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto("/login");

    const trigger = page.getByRole("button", {
      name: "Buscar produtos",
      exact: true,
    });
    await tabTo(page, trigger);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Buscar na loja" });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute(
      "aria-controls",
      "navbar-search-panel",
    );
    const input = dialog.getByRole("searchbox", { name: "Termo de busca" });
    await expect(input).toBeFocused();
    await page.keyboard.type("Aurora");

    await auditAccessibility(page, testInfo, "busca-cabecalho");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("guia acompanha ponteiro e desativação remove a régua", async ({
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
    await page.keyboard.press("Escape");
    const viewport = page.viewportSize()!;
    await page.mouse.move(100, Math.round(viewport.height * 0.3));
    await expect
      .poll(() =>
        page
          .locator("[data-reading-guide]")
          .evaluate((element) => element.getBoundingClientRect().top),
      )
      .toBeCloseTo(Math.round(viewport.height * 0.3) - 6, 0);
    await expect(page.locator("[data-reading-guide]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.locator("[data-reading-guide]")).toHaveCSS(
      "pointer-events",
      "none",
    );
    await page
      .getByRole("button", { name: "Abrir controles de acessibilidade" })
      .click();
    await page
      .getByRole("button", { name: /^Guia de leitura /, exact: true })
      .click();
    await expect(page.locator("[data-reading-guide]")).toHaveCount(0);
  });

  for (const route of ["/login", "/shop", "/product/1"]) {
    test(`ajustes combinados em tela estreita: ${route}`, async ({
      page,
    }, testInfo) => {
      await mockBaseApi(page);
      await page.addInitScript(
        ({ key, preferences }) =>
          localStorage.setItem(key, JSON.stringify(preferences)),
        { key: STORAGE_KEY, preferences: combinedPreferences },
      );
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(route);

      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("html")).toHaveCSS("font-size", "24px");
      if (route === "/product/1")
        await expect(
          page.getByRole("heading", { name: products[0].name, exact: true }),
        ).toBeVisible();
      if (route === "/shop")
        await expect(
          page.getByRole("link", {
            name: productDetailsName(products[0].name),
          }),
        ).toBeVisible();
      const reflow = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        overflow: Array.from(document.querySelectorAll<HTMLElement>("main *"))
          .filter(
            (element) =>
              element.getBoundingClientRect().right >
              document.documentElement.clientWidth + 1,
          )
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            text: element.textContent?.slice(0, 80),
          }))
          .slice(0, 12),
      }));
      expect(reflow.scroll, JSON.stringify(reflow)).toBeLessThanOrEqual(
        reflow.width + 1,
      );
      const menu = page.getByRole("button", {
        name: "Abrir menu",
        exact: true,
      });
      await expect
        .poll(() =>
          menu.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await page
        .getByRole("button", { name: "Abrir controles de acessibilidade" })
        .click();
      const panel = page.getByRole("region", {
        name: "Acessibilidade",
        exact: true,
      });
      await expect(
        panel.getByRole("button", { name: /^Guia de leitura /, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const bounds = (await panel.locator("..").locator("..").boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);

      await auditAccessibility(page, testInfo, "ajustes-combinados");
      await panel.getByRole("button", { name: "Restaurar padrão" }).click();
      await expect(page.locator("html")).toHaveCSS("font-size", "16px");
      await expect(page.locator("[data-reading-guide]")).toHaveCount(0);
    });
  }

  for (const mode of ["highContrast", "grayscale"] as const) {
    test(`aparência da página inteira: ${mode}`, async ({ page }, testInfo) => {
      await mockBaseApi(page);
      await page.addInitScript(
        ({ key, preferences }) =>
          localStorage.setItem(key, JSON.stringify(preferences)),
        {
          key: STORAGE_KEY,
          preferences: {
            ...combinedPreferences,
            fontSize: 16,
            lineHeight: 1.5,
            dyslexicFont: false,
            bigCursor: false,
            letterSpacing: 0,
            wordSpacing: 0,
            readingGuide: false,
            highContrast: mode === "highContrast",
            grayscale: mode === "grayscale",
          },
        },
      );
      await page.goto("/shop");

      await expect(
        page.getByRole("link", { name: productDetailsName(products[0].name) }),
      ).toBeVisible();
      if (mode === "highContrast")
        await expect(page.locator("html")).toHaveClass(/high-contrast/);
      else
        await expect(page.locator("html")).toHaveCSS("filter", "grayscale(1)");
      await auditAccessibility(page, testInfo, `aparencia-${mode}`);
    });
  }

  test("texto ampliado a 200% continua legível e formulário operável", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto("/login");

    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    await expect(page.locator("body")).toHaveCSS("font-size", "32px");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await page.addStyleTag({
      content: "body { font-family: monospace !important; }",
    });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    const email = page.getByRole("textbox", {
      name: "E-mail (obrigatório)",
      exact: true,
    });
    await tabTo(page, email);
    await page.keyboard.type(clientUser.email);
    await tabTo(page, page.getByLabel("Senha (obrigatória)", { exact: true }));
    await page.keyboard.type("senha-segura");
    await tabTo(
      page,
      page.getByRole("button", { name: "Entrar", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: "Entrar", exact: true }),
    ).toBeInViewport();

    await auditAccessibility(page, testInfo, "texto-200");
  });

  test("preferências do sistema preservam foco e reduzem movimento", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await page.goto("/shop");

    const skip = page.getByRole("link", {
      name: /Ir para o conteúdo principal/i,
    });
    await expect(skip).toBeAttached();
    await page.keyboard.press("Tab");
    await expectFocusVisible(skip);
    const motion = await skip.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        transition: parseFloat(style.transitionDuration),
        animation: parseFloat(style.animationDuration),
      };
    });
    expect(motion.transition).toBeLessThanOrEqual(0.01);
    expect(motion.animation).toBeLessThanOrEqual(0.01);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();

    await auditAccessibility(page, testInfo, "cores-forcadas-movimento");
  });
});
