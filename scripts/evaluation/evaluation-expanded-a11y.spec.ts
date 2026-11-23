import { productDetailsName } from "../helpers/locators";
import { test, expect } from "@playwright/test";
import { mockBaseApi, products } from "../fixtures/api";
import { auditAccessibility, tabTo } from "../helpers/accessibility-audit";

test.describe("@a11y @expanded estados difíceis", () => {
  for (const failure of ["transport", "http503"]) {
    test(`loja: ${failure}, carregamento e recuperação`, async ({
      page,
    }, info) => {
      await mockBaseApi(page);
      let broken = true;
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await page.route("**/api/product/", async (route) => {
        if (broken)
          return failure === "transport"
            ? route.abort("failed")
            : route.fulfill({ status: 503, json: {} });
        await gate;
        return route.fulfill({ json: products });
      });
      await page.goto("/shop");

      await expect(
        page.getByRole("alert").filter({ hasText: /\S/ }),
      ).toContainText("Não foi possível carregar a loja");

      await auditAccessibility(
        page,
        info,
        `loja-${failure}-erro`,
        undefined,
        true,
      );
      broken = false;
      await tabTo(page, page.getByRole("button", { name: "Tentar novamente" }));
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: "Carregando produtos..." }),
      ).toHaveAttribute("aria-live", "polite");

      await auditAccessibility(
        page,
        info,
        `loja-${failure}-carregando`,
        undefined,
        true,
      );
      release();
      await expect(
        page.getByRole("link", { name: productDetailsName(products[0].name) }),
      ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: /\S/ }),
      ).toHaveCount(0);

      await auditAccessibility(
        page,
        info,
        `loja-${failure}-recuperada`,
        undefined,
        true,
      );
    });
  }
  for (const route of ["/login", "/register/customer"]) {
    test(`formulário ${route}: erros simultâneos sem submissão externa`, async ({
      page,
    }, info) => {
      await mockBaseApi(page);
      let submissions = 0;
      await page.route("**/api/**", (route) => {
        if (route.request().method() === "POST") {
          submissions++;
          return route.abort("blockedbyclient");
        }
        return route.fallback();
      });
      await page.goto(route);

      const submit = page.locator('form button[type="submit"]').first();
      await tabTo(page, submit);
      await page.keyboard.press("Enter");
      const invalid = page.locator(
        'form input:invalid, form select:invalid, form textarea:invalid, form [aria-invalid="true"]',
      );
      await expect.poll(() => invalid.count()).toBeGreaterThanOrEqual(2);
      await expect(invalid.first()).toBeFocused();
      const errors = await invalid.evaluateAll((elements) =>
        elements.map((element) => ({
          id: element.id,
          ariaInvalid: element.getAttribute("aria-invalid"),
          describedBy: element.getAttribute("aria-describedby"),
          nativeInvalid:
            element instanceof HTMLInputElement
              ? !element.validity.valid
              : null,
          nativeMessage:
            element instanceof HTMLInputElement
              ? element.validationMessage
              : null,
        })),
      );
      await info.attach("form-validation-associations", {
        body: JSON.stringify(errors, null, 2),
        contentType: "application/json",
      });
      expect(submissions).toBe(0);

      await auditAccessibility(
        page,
        info,
        `multiplos-erros-${route.split("/").at(-1)}`,
        undefined,
        true,
      );
    });
  }
});

test.describe("@a11y @expanded @regression componentes compartilhados", () => {
  for (const route of ["/login", "/shop", "/product/1"]) {
    test(`navbar e busca por teclado em ${route}`, async ({ page }, info) => {
      await mockBaseApi(page);
      await page.goto(route);

      await expect(page.locator("main").first()).toBeVisible();
      if (route !== "/product/1")
        await auditAccessibility(page, info, "pagina-publica", undefined, true);
      const trigger = page.getByRole("button", {
        name: "Buscar produtos",
        exact: true,
      });
      await tabTo(page, trigger);
      await page.keyboard.press("Enter");
      const panel = page.getByRole("dialog", { name: "Buscar na loja" });
      await expect(
        panel.getByRole("searchbox", { name: "Termo de busca" }),
      ).toBeFocused();
      await page.keyboard.type("Aurora");

      await auditAccessibility(
        page,
        info,
        "navbar-busca",
        "#navbar-search-panel",
        true,
      );
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible();
      await expect(trigger).toBeFocused();
    });
  }

  test("modal de lateralidade: setas, Tab, Shift+Tab e retorno do foco", async ({
    page,
  }, info) => {
    await mockBaseApi(page);
    await page.goto("/product/1");

    const trigger = page.getByRole("button", { name: /Escolher meu pé/ });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    const left = dialog.getByRole("radio", { name: /Pé esquerdo/ });
    await tabTo(page, left);
    await page.keyboard.press("ArrowRight");
    await expect(
      dialog.getByRole("radio", { name: /Pé direito/ }),
    ).toBeChecked();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBeTruthy();
    await auditAccessibility(
      page,
      info,
      "modal-lateralidade-teclado",
      '[role="dialog"]',
      true,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("painel de acessibilidade abre e fecha preservando foco em cada rota", async ({
    page,
  }, info) => {
    await mockBaseApi(page);
    await page.goto("/shop");

    const trigger = page.getByRole("button", {
      name: "Abrir controles de acessibilidade",
    });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", {
      name: "Acessibilidade",
      exact: true,
    });
    await expect(panel).toBeVisible();

    await auditAccessibility(
      page,
      info,
      "painel-regressao",
      "#accessibility-controls-panel",
      true,
    );
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("mural preserva auditoria comparável com a rodada anterior", async ({
    page,
  }, info) => {
    await mockBaseApi(page);
    await page.goto("/shared-purchases");

    await expect(
      page.getByRole("heading", { name: "Encontre seu par" }),
    ).toBeVisible();
    await expect(page.getByText("Carregando reservas...")).toHaveCount(0);
    const sideGroup = page.getByRole("radiogroup", {
      name: "Qual pé você precisa?",
    });
    await expect(sideGroup).toBeVisible();
    await expect(sideGroup.getByRole("radio")).toHaveCount(3);
    const shopLink = page.getByRole("link", {
      name: "Escolha um par na loja e publique sua reserva.",
    });
    await expect(shopLink).toBeVisible();
    await shopLink.focus();
    await expect(shopLink).toBeFocused();

    await auditAccessibility(page, info, "pagina-ampliada", undefined, true);
  });
});
