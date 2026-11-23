import { expect, test } from "@playwright/test";
import {
  authenticate,
  clientUser,
  mockAuthenticatedApi,
  mockBaseApi,
} from "../fixtures/api";
import { auditAccessibility, tabTo } from "../helpers/accessibility-audit";

test("@a11y @keyboard @evaluation conversa, rascunho e envio por teclado com API controlada", async ({
  page,
}, testInfo) => {
  await mockBaseApi(page);
  await authenticate(page, clientUser);
  await mockAuthenticatedApi(page);
  const peer = { id: 2, name: "Loja de avaliação", type: "seller" };
  const date = "2026-10-24T12:00:00Z";
  const message = {
    id: 1,
    conversation_id: 91,
    sender_id: 2,
    body: "Mensagem para avaliação",
    message_type: "text",
    created_at: date,
    sender: peer,
  };
  const conversation = {
    id: 91,
    seller_id: 2,
    buyer_id: 1,
    seller_user_id: 2,
    peer,
    unread_count: 1,
    created_at: date,
    updated_at: date,
    last_message_at: date,
    last_message: message,
  };
  let submissions = 0;
  await page.route("**/api/chat/conversations", (route) =>
    route.fulfill({ json: [conversation] }),
  );
  await page.route("**/api/chat/conversations/91/read", (route) =>
    route.fulfill({ json: { last_read_message_id: 1 } }),
  );
  await page.route("**/api/chat/conversations/91/messages", (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      return route.fulfill({
        json: {
          ...message,
          id: 2,
          sender_id: 1,
          body: route.request().postDataJSON().body,
          sender: { id: 1, name: clientUser.name, type: "client" },
        },
      });
    }
    return route.fulfill({ json: [message] });
  });
  await page.goto("/customer/dashboard?tab=messages");

  const open = page.getByRole("button", { name: /Loja de avaliação/ });
  await expect(open).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Sua mensagem" }),
  ).not.toBeVisible();
  await tabTo(page, open);
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(message.body, { exact: true }).last(),
  ).toBeVisible();
  const draft = page.getByRole("textbox", { name: "Sua mensagem" });
  await tabTo(page, draft);
  await page.keyboard.type("Rascunho de avaliação");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Segunda linha");
  await expect(draft).toHaveValue("Rascunho de avaliação\nSegunda linha");
  const probe = await draft.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return {
      centerVisible: element.contains(document.elementFromPoint(x, y)),
      focused: element === document.activeElement,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      limitation:
        "Geometria do centro não comprova perceptibilidade do indicador nem atendimento integral de 2.4.11.",
    };
  });
  await testInfo.attach("focus-geometry", {
    body: JSON.stringify(probe, null, 2),
    contentType: "application/json",
  });
  expect(probe.focused).toBeTruthy();
  expect(probe.centerVisible).toBeTruthy();

  await auditAccessibility(page, testInfo, "conversa-rascunho");
  await page.keyboard.press("Enter");
  await expect(draft).toHaveValue("");
  expect(submissions).toBe(1);

  await auditAccessibility(page, testInfo, "conversa-envio-controlado");
});
