import { test, expect } from "@playwright/test";
import { mockBaseApi } from "../fixtures/api";

const STORAGE_KEY = "stepease-accessibility-preferences";

test("@a11y o documento declara português do Brasil", async ({ page }) => {
  await mockBaseApi(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

test("@a11y a fonte OpenDyslexic é carregada quando a preferência está ativa", async ({
  page,
}) => {
  await mockBaseApi(page);

  const fontResponses: Array<{ status: number; url: string }> = [];
  page.on("response", (response) => {
    if (response.url().includes("OpenDyslexic")) {
      fontResponses.push({ status: response.status(), url: response.url() });
    }
  });

  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        fontSize: 16,
        highContrast: false,
        lineHeight: 1.5,
        dyslexicFont: true,
        reduceMotion: false,
        grayscale: false,
        bigCursor: false,
        consent: true,
      }),
    );
  }, STORAGE_KEY);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const appliedFamily = await page.evaluate(
    () => document.documentElement.style.fontFamily,
  );
  expect(appliedFamily).toContain("OpenDyslexic");

  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts)
      .filter((face) =>
        face.family.replace(/["']/g, "").includes("OpenDyslexic"),
      )
      .map((face) => ({
        family: face.family,
        weight: face.weight,
        style: face.style,
        status: face.status,
      }));
  });

  expect(faces.length).toBeGreaterThan(0);
  expect(faces.some((face) => face.status === "loaded")).toBe(true);

  expect(fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.every((response) => response.status === 200)).toBe(true);
});

test("@a11y a fonte OpenDyslexic não é baixada sem a preferência", async ({
  page,
}) => {
  await mockBaseApi(page);

  const fontResponses: Array<{ url: string }> = [];
  page.on("response", (response) => {
    if (response.url().includes("OpenDyslexic")) {
      fontResponses.push({ url: response.url() });
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(fontResponses).toEqual([]);
});

test("@a11y prefers-contrast: more do sistema ativa o tema de alto contraste", async ({
  page,
}) => {
  await mockBaseApi(page);
  await page.emulateMedia({ contrast: "more" });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html")).toHaveClass(/high-contrast/);
});

test("@a11y sem prefers-contrast o tema de alto contraste fica desligado", async ({
  page,
}) => {
  await mockBaseApi(page);
  await page.emulateMedia({ contrast: "no-preference" });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html")).not.toHaveClass(/high-contrast/);
});
