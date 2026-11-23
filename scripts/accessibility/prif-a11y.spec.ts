import { expect, test } from "@playwright/test";
import { auditAccessibility } from "../helpers/accessibility-audit";
import { mockBaseApi } from "../fixtures/api";

test.describe("@a11y PRIF — produto e compra compartilhada", () => {
  test("expõe uma árvore acessível para a seleção de lateralidade", async ({
    page,
  }, testInfo) => {
    await mockBaseApi(page);
    await page.goto("/product/1");

    await page.getByRole("button", { name: /Escolher meu pé/ }).click();

    await expect(page.getByRole("radiogroup", { name: "Pé desejado" }))
      .toMatchAriaSnapshot(`
      - radiogroup "Pé desejado":
        - radio "Pé esquerdo Tamanho 39" [checked]
        - radio "Pé direito Tamanho 39"
    `);

    await auditAccessibility(page, testInfo, "lateralidade", '[role="dialog"]');
  });

  test("mantém reflow sem rolagem horizontal com movimento reduzido", async ({
    page,
  }) => {
    await mockBaseApi(page);
    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/product/1");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1,
    );
    await expect(
      page.getByRole("button", { name: "Comprar agora" }),
    ).toBeVisible();
  });
});
