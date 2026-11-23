import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expireReservation,
  type RealCase,
} from "../fixtures/real-accessibility";
import { auditAccessibility, tabTo } from "../helpers/accessibility-audit";

test.describe("@a11y @expanded @real-api backend isolado real", () => {
  async function sessionHeaders(page: Page) {
    return {
      Authorization: "Bearer cookie-session",
      "X-Session-Transport": "cookie",
      Origin: new URL(page.url()).origin,
    };
  }

  async function login(page: Page, account: RealCase["accounts"]["buyer"]) {
    await page.goto("/login");

    await page
      .getByRole("textbox", { name: "E-mail (obrigatório)", exact: true })
      .fill(account.email);
    await page
      .getByLabel("Senha (obrigatória)", { exact: true })
      .fill(account.password);
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/login" &&
        r.request().method() === "POST",
    );
    await tabTo(
      page,
      page.getByRole("button", { name: "Entrar", exact: true }),
    );
    await page.keyboard.press("Enter");
    const authenticated = await response;
    expect(
      authenticated.status(),
      "Autenticação deve ser confirmada pela API real",
    ).toBe(200);
    expect((await authenticated.json()).user.email).toBe(account.email);
    const seller = account.email.startsWith("seller-");
    await expect(page).toHaveURL(seller ? /\/seller\/dashboard/ : /\/shop$/);
    if (!seller) await page.goto("/customer/dashboard");
    await expect(page.locator("main").first()).toBeVisible();
  }

  test("comprador autentica pela interface e inclui produto no carrinho", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.buyer);

    await auditAccessibility(page, info, "comprador-real", undefined, true);

    await page.goto(`/product/${realCase.products.available.id}`);
    await expect(
      page.getByRole("heading", {
        name: realCase.products.available.name,
        exact: true,
      }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (r) =>
        /\/api\/cart\/items/.test(r.url()) && r.request().method() === "POST",
    );
    await tabTo(
      page,
      page.getByRole("button", { name: "Adicionar ao carrinho", exact: true }),
    );
    await page.keyboard.press("Enter");
    expect((await response).status()).toBe(201);
    const cart = await page.request.get("/api/cart/", {
      headers: await sessionHeaders(page),
    });
    expect(cart.ok()).toBeTruthy();
    expect(
      (await cart.json()).items.some(
        (item: { product_id: number }) =>
          item.product_id === realCase.products.available.id,
      ),
    ).toBeTruthy();
    info.annotations.push({
      type: "verification",
      description:
        "Login real confirmado, adição HTTP 201 e produto confirmado no carrinho persistido.",
    });

    await auditAccessibility(
      page,
      info,
      "carrinho-gravado-real",
      undefined,
      true,
    );
  });

  test("vendedor autentica e visualiza seu anúncio persistido", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.seller);
    await page.goto(`/product/${realCase.products.available.id}`);

    await expect(
      page.getByRole("link", { name: "Editar anúncio", exact: true }),
    ).toBeVisible();

    await auditAccessibility(
      page,
      info,
      "vendedor-produto-real",
      undefined,
      true,
    );
  });

  test("sessão expirada é rejeitada pelo servidor e volta ao login", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.buyer);
    await page.context().addCookies([
      {
        name: "stepease_session",
        value: realCase.expiredToken,
        domain: new URL(page.url()).hostname,
        path: "/",
      },
    ]);
    const rejected = await page.request.get("/api/users/me", {
      headers: await sessionHeaders(page),
    });
    expect(rejected.status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    expect
      .soft(
        await page.evaluate(
          () => localStorage.getItem("access_token") === null,
        ),
        "A sessão expirada não deve permanecer no armazenamento local",
      )
      .toBe(true);
    info.annotations.push({
      type: "verification",
      description:
        "Token expirado rejeitado com HTTP 401 e rota protegida redirecionada ao login.",
    });

    await auditAccessibility(
      page,
      info,
      "sessao-expirada-real",
      undefined,
      true,
    );
  });

  test("estoque zerado bloqueia compra na interface e no servidor", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.buyer);
    await page.goto(`/product/${realCase.products.unavailable.id}`);

    await expect(
      page.getByRole("button", { name: "Comprar agora", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Adicionar ao carrinho", exact: true }),
    ).toBeDisabled();

    const response = await page.request.post("/api/cart/items", {
      headers: await sessionHeaders(page),
      data: { product_id: realCase.products.unavailable.id, quantity: 1 },
    });
    expect(response.status()).toBe(400);

    await auditAccessibility(page, info, "sem-estoque-real", undefined, true);
  });

  test("reserva expira no servidor e mostra prazo encerrado", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.buyer);
    await expireReservation(realCase.key);

    const response = await page.request.get("/api/shared-purchases/me", {
      headers: await sessionHeaders(page),
    });
    expect(response.ok()).toBeTruthy();
    expect(
      (await response.json()).find(
        (r: { id: number }) => r.id === realCase.reservationId,
      ).status,
    ).toBe("expired");

    await page.goto("/customer/dashboard?tab=shared-purchases");

    await expect(
      page.getByText("Prazo encerrado", { exact: true }),
    ).toBeVisible();

    await auditAccessibility(
      page,
      info,
      "reserva-expirada-real",
      undefined,
      true,
    );
  });

  test("publicação de reserva pela interface persiste no banco real", async ({
    page,
    realCase,
  }, info) => {
    await login(page, realCase.accounts.buyer);
    await page.goto(`/product/${realCase.products.available.id}`);

    await tabTo(page, page.getByRole("button", { name: /Escolher meu pé/ }));
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await auditAccessibility(
      page,
      info,
      "modal-reserva-real",
      '[role="dialog"]',
      true,
    );

    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/shared-purchases" &&
        r.request().method() === "POST",
    );
    await tabTo(page, dialog.getByRole("button", { name: "Publicar reserva" }));
    await page.keyboard.press("Enter");
    expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/shared-purchases\?highlight=/);
    await expect(
      page.getByText(realCase.products.available.name, { exact: true }).first(),
    ).toBeVisible();
    info.annotations.push({
      type: "verification",
      description:
        "Publicação HTTP 201 confirmada; produto presente no mural real.",
    });

    await auditAccessibility(
      page,
      info,
      "reserva-publicada-real",
      undefined,
      true,
    );
  });
});
