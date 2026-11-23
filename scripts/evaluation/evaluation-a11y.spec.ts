import { productDetailsName } from "../helpers/locators";
import { expect, test } from "@playwright/test";
import { auditAccessibility, tabTo } from "../helpers/accessibility-audit";
import {
  authenticate,
  clientUser,
  mockAuthenticatedApi,
  mockBaseApi,
  products,
  sellerUser,
} from "../fixtures/api";

for (const route of [
  "/about",
  "/accessibility",
  "/register/customer",
  "/register/seller",
  "/forgot-password",
  "/reset-password",
  "/shared-purchases",
  "/product/1",
]) {
  test(`@a11y @evaluation página pública e semântica ${route}`, async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto(route);

    await expect(page.locator("h1").first()).toBeVisible();
    if (route === "/product/1")
      await expect(
        page.getByRole("heading", { name: products[0].name, exact: true }),
      ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");

    await auditAccessibility(page, testInfo, "pagina-ampliada");
    await expect(
      page.locator("main"),
      "Amostra deve possuir região principal semântica",
    ).toHaveCount(1);
  });
}

for (const [route, user] of [
  ["/customer/dashboard?tab=messages", clientUser],
  ["/customer/dashboard?tab=shared-purchases", clientUser],
  ["/seller/dashboard?tab=orders", sellerUser],
  ["/seller/dashboard?tab=messages", sellerUser],
] as const) {
  test(`@a11y @evaluation estado autenticado ${route}`, async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await authenticate(page, user);
    await mockAuthenticatedApi(page);
    await page.goto(route);

    await expect(page.locator("main").first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(route.split("?")[0]));
    if (route.includes("messages"))
      await expect(
        page.getByRole("heading", { name: "Mensagens", exact: true }),
      ).toBeVisible();
    await auditAccessibility(page, testInfo, "estado-autenticado");
  });
}

test("@a11y @keyboard @evaluation filtros de lateralidade com Tab, Espaço e setas", async ({
  page,
}, testInfo) => {
  await mockBaseApi(page);
  await page.route("**/api/product/", (route) =>
    route.fulfill({
      json: [
        ...products,
        {
          ...products[0],
          id: 2,
          name: "Individual esquerdo",
          foot_type: "left",
        },
        {
          ...products[0],
          id: 3,
          name: "Individual direito",
          foot_type: "right",
        },
      ],
    }),
  );
  await page.goto("/shop");

  await expect(
    page.getByRole("link", { name: productDetailsName("Individual esquerdo") }),
  ).toBeVisible();
  const toggle = page
    .getByRole("button", { name: /Mostrar filtros|Abrir filtros|Filtros/i })
    .first();
  if (!(await page.locator("#shop-filters").isVisible())) {
    await tabTo(page, toggle);
    await page.keyboard.press("Enter");
  }
  const group = page.getByRole("group", { name: "Tipo de calçado" });
  const all = group.getByRole("radio", { name: "Todos", exact: true });
  await tabTo(page, all);
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "Pé esquerdo" })).toBeChecked();
  await expect(
    page.getByRole("link", { name: productDetailsName("Individual esquerdo") }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: productDetailsName(products[0].name) }),
  ).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "Pé direito" })).toBeChecked();
  await expect(
    page.getByRole("link", { name: productDetailsName("Individual direito") }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(
    group.getByRole("radio", { name: "Par completo" }),
  ).toBeChecked();
  await expect(
    page.getByRole("link", { name: productDetailsName(products[0].name) }),
  ).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(
    group.getByRole("radio", { name: "Par completo" }),
  ).not.toBeFocused();

  await auditAccessibility(page, testInfo, "filtro-par-completo");
});

test("@a11y @evaluation catálogo indisponível e recuperação anunciados", async ({
  page,
}, testInfo) => {
  await mockBaseApi(page);
  let failed = true;
  await page.route("**/api/product/", (route) =>
    route.fulfill(
      failed
        ? {
            status: 503,
            json: { detail: "indisponível no cenário controlado" },
          }
        : { json: products },
    ),
  );
  await page.goto("/shop");

  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(
    "Não foi possível carregar a loja",
  );

  await auditAccessibility(page, testInfo, "catalogo-erro");
  failed = false;
  const retry = page.getByRole("button", { name: "Tentar novamente" });
  await tabTo(page, retry);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", { name: productDetailsName(products[0].name) }),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    0,
  );

  await auditAccessibility(page, testInfo, "catalogo-recuperado");
});

for (const route of ["/login", "/shop", "/shared-purchases"]) {
  test(`@a11y @live @evaluation backend real somente leitura ${route}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.A11Y_LIVE !== "1",
      "Backend real requer execução explícita pelo audit:a11y.",
    );
    const catalogResponse = await page.request
      .get("/api/product/", { timeout: 5_000 })
      .catch(() => null);
    test.skip(
      !catalogResponse?.ok(),
      "Backend do catálogo indisponível; o cenário @live exige backend real.",
    );
    await page.route("**/api/**", async (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.request().method()))
        return request.abort("blockedbyclient");
      return request.continue();
    });
    await page.goto(route);

    await expect(page.locator("main").first()).toBeVisible();
    if (route === "/shop") {
      const response = await page.request.get("/api/product/");
      expect(
        response.ok(),
        "Backend do catálogo precisa estar disponível",
      ).toBeTruthy();
      const catalog = await response.json();
      expect(Array.isArray(catalog)).toBeTruthy();
      expect(
        catalog.length,
        "Não avaliar como catálogo carregado se o banco estiver vazio",
      ).toBeGreaterThan(0);
      await expect(
        page
          .getByRole("link", {
            name: /^Ver detalhes(?: e comprar)?(?: de |: )/,
          })
          .first(),
      ).toBeVisible();
    }
    if (route === "/shared-purchases") {
      await expect(page.getByText("Carregando reservas...")).toHaveCount(0);
      await expect(
        page.getByRole("alert").filter({ hasText: /\S/ }),
      ).toHaveCount(0);
    }
    await auditAccessibility(page, testInfo, "backend-real");
  });
}
