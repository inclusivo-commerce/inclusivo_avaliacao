import { test, expect } from "@playwright/test";
import { auditAccessibility } from "../helpers/accessibility-audit";
import { mockBaseApi } from "../fixtures/api";

const publicRoutes = ["/", "/login", "/shop", "/pre-register"];

for (const route of publicRoutes) {
  test(`@a11y a página ${route} não deve ter violações WCAG automatizáveis`, async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    await auditAccessibility(page, testInfo, "pagina-publica");
  });
}

test("@a11y skip link leva ao conteúdo principal na loja", async ({ page }) => {
  await mockBaseApi(page);
  await page.goto("/shop");

  const skipLink = page.getByRole("link", {
    name: /ir para o conteúdo principal/i,
  });
  await expect(skipLink).toBeAttached();
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  await skipLink.click();
  await expect(page.locator("#main-content")).toBeFocused();
});
