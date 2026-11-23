import { expect, test, type Page } from "@playwright/test";
import { auditAccessibility } from "../helpers/accessibility-audit";
import {
  authenticate,
  clientUser,
  mockAuthenticatedApi,
  mockBaseApi,
  sellerUser,
} from "../fixtures/api";

async function prepare(
  page: Page,
  user: typeof clientUser | typeof sellerUser = clientUser,
) {
  await mockBaseApi(page);
  await authenticate(page, user);
  await mockAuthenticatedApi(page);
}

const routeArchetypes = [
  { route: "/customer/dashboard", user: clientUser },
  { route: "/customer/edit-profile", user: clientUser },
  { route: "/addresses", user: clientUser },
  { route: "/shipping", user: clientUser },
  { route: "/checkout", user: clientUser },
  { route: "/seller/dashboard", user: sellerUser },
  { route: "/seller/edit-profile", user: sellerUser },
  { route: "/seller/add-product", user: sellerUser },
] as const;

for (const { route, user } of routeArchetypes) {
  test(`@a11y área autenticada ${route}`, async ({ page }, testInfo) => {
    await prepare(page, user);
    await page.goto(route);

    await expect(page.locator("#main-content, main").first()).toBeVisible();

    await auditAccessibility(page, testInfo, "area-autenticada");
  });
}

test("@a11y painel dinâmico de preferências autenticadas", async ({
  page,
}, testInfo) => {
  await prepare(page);
  await page.goto("/customer/dashboard");

  await page
    .getByRole("button", { name: /abrir controles de acessibilidade/i })
    .click();
  await auditAccessibility(
    page,
    testInfo,
    "painel-autenticado",
    "#accessibility-controls-panel",
  );
});

test("@a11y diálogo de cadastro de produto autenticado", async ({
  page,
}, testInfo) => {
  await prepare(page, sellerUser);
  await page.goto("/seller/add-product");

  await expect(
    page.getByRole("dialog", { name: /tipo de produto/i }),
  ).toBeVisible();

  await auditAccessibility(
    page,
    testInfo,
    "cadastro-produto-dialogo",
    '[role="dialog"]',
  );
});
