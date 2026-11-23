import { expect, test, type Locator } from "@playwright/test";
import {
  authenticate,
  mockAuthenticatedApi,
  mockBaseApi,
  products,
  sellerUser,
} from "../fixtures/api";
import { expectFocusVisible, tabTo } from "../helpers/accessibility-audit";

async function expectPaintedFocus(target: Locator) {
  await expectFocusVisible(target);
  await expect
    .poll(() =>
      target.evaluate((element) => {
        for (
          let current: Element | null = element;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (Number(style.opacity) < 0.99 || style.visibility !== "visible")
            return false;
        }
        return true;
      }),
    )
    .toBe(true);
}

test.describe("@a11y @keyboard @expanded @regression operação e foco", () => {
  for (const mode of ["grade", "lista"] as const) {
    test(`favoritos e comparação visíveis por teclado em ${mode}`, async ({
      page,
    }) => {
      await mockBaseApi(page);
      await mockAuthenticatedApi(page);
      await authenticate(page);
      const product = { ...products[0], stock: mode === "lista" ? 0 : 3 };
      await page.route("**/api/product/", (route) =>
        route.fulfill({ json: [product] }),
      );
      await page.route("**/api/favorites/1", (route) =>
        route.fulfill({
          json: { id: 10, product_id: 1, product },
        }),
      );
      await page.goto("/shop");

      await page.mouse.move(0, 0);
      if (mode === "lista") {
        await tabTo(
          page,
          page.getByRole("button", { name: "Visualizar em lista" }),
        );
        await page.keyboard.press("Enter");
      }
      const favorite = page.getByRole("button", {
        name: "Favoritar Tênis Aurora",
        exact: true,
      });
      await tabTo(page, favorite);
      await expectPaintedFocus(favorite);
      await page.keyboard.press("Space");
      const removeFavorite = page.getByRole("button", {
        name: "Remover Tênis Aurora dos favoritos",
        exact: true,
      });
      await expect(removeFavorite).toHaveAttribute("aria-pressed", "true");
      await expectPaintedFocus(removeFavorite);
      await page.keyboard.press("Enter");
      await expect(favorite).toHaveAttribute("aria-pressed", "false");
      const compare = page.getByRole("button", {
        name: "Comparar Tênis Aurora, anúncio 1",
        exact: true,
      });
      await tabTo(page, compare);
      await expectPaintedFocus(compare);
      await page.keyboard.press("Enter");
      await expect(
        page
          .getByRole("region", { name: "Comparação de produtos" })
          .getByRole("status"),
      ).toContainText("1 de 3 produtos selecionados para comparação");
      const removeComparison = page.locator("#compare-product-1");
      await expect(removeComparison).toHaveAccessibleName(
        "Remover Tênis Aurora, anúncio 1, da comparação",
      );
      await expect(removeComparison).toHaveAttribute("aria-pressed", "true");
      await expectPaintedFocus(removeComparison);
      await page.keyboard.press("Enter");
      await expect(compare).toHaveAttribute("aria-pressed", "false");
      await expect(
        page
          .getByRole("region", { name: "Comparação de produtos" })
          .getByRole("list"),
      ).toHaveCount(0);
    });
  }

  test("galeria troca imagem por Tab e Espaço", async ({ page }) => {
    await mockBaseApi(page);
    await page.route("**/api/product/1", (route) =>
      route.fulfill({
        json: {
          ...products[0],
          images: ["/placeholder.svg?angle=1", "/placeholder.svg?angle=2"],
        },
      }),
    );
    await page.goto("/product/1");

    await page.mouse.move(0, 0);
    const second = page.getByRole("button", {
      name: "Selecionar imagem 2",
      exact: true,
    });
    await tabTo(page, second);
    await expectPaintedFocus(second);
    await page.keyboard.press("Space");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('img[loading="eager"]')).toHaveAttribute(
      "src",
      "/placeholder.svg?angle=2",
    );
  });

  test("editor abre seletor e remove imagem sem perder o foco", async ({
    page,
  }) => {
    await mockBaseApi(page);
    await mockAuthenticatedApi(page);
    await authenticate(page, sellerUser);
    await page.goto("/seller/edit-product/1");

    await page.mouse.move(0, 0);
    await tabTo(
      page,
      page.getByRole("button", { name: "Fotos & mídia", exact: true }),
    );
    await page.keyboard.press("Enter");
    const choose = page.getByRole("button", {
      name: "Escolher imagem",
      exact: true,
    });
    await tabTo(page, choose);
    await expectPaintedFocus(choose);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      choose.press("Enter"),
    ]);
    await chooser.setFiles([]);
    await tabTo(
      page,
      page.getByRole("button", {
        name: "Remover imagem do produto",
        exact: true,
      }),
    );
    const remove = page.getByRole("button", {
      name: "Remover imagem do produto",
      exact: true,
    });
    await expectPaintedFocus(remove);
    await page.keyboard.press("Space");
    await expect(remove).toHaveCount(0);
    await expectPaintedFocus(choose);
  });
});
