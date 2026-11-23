import { expect, test } from "@playwright/test";
import {
  authenticate,
  clientUser,
  mockAuthenticatedApi,
  mockBaseApi,
} from "../fixtures/api";
import { auditAccessibility, tabTo } from "../helpers/accessibility-audit";

test("@a11y @keyboard @evaluation notificações abertas e retorno de foco", async ({
  page,
}, testInfo) => {
  await mockBaseApi(page);
  await authenticate(page, clientUser);
  await mockAuthenticatedApi(page);
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: [
        {
          id: 901,
          title: "Aviso de avaliação",
          message: "Exemplo controlado de atualização de pedido.",
          created_at: "2026-10-24T12:00:00Z",
          read: false,
          type: "system",
          link: null,
        },
      ],
    }),
  );

  await page.goto("/customer/dashboard");

  const trigger = page.getByRole("button", {
    name: "Notificações, 1 não lidas",
  });
  await expect(trigger).toBeVisible();
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "Notificações", exact: true });
  await expect(
    panel.getByText("Aviso de avaliação", { exact: true }),
  ).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await auditAccessibility(
    page,
    testInfo,
    "notificacoes-abertas",
    undefined,
    true,
  );
  await tabTo(
    page,
    panel.getByRole("button", { name: "Marcar todas como lidas" }),
  );
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
