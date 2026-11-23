import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockBaseApi } from "../fixtures/api";

const forms = [
  {
    route: "/register/customer",
    title: "Cadastro de cliente",
    sections: ["Dados do comprador", "Contato e entrega"],
  },
  {
    route: "/register/seller",
    title: "Cadastro de vendedor",
    sections: ["Dados comerciais", "Responsável e contato"],
  },
];

for (const { route, title, sections } of forms) {
  test(`${title}: navegação por títulos e contraste do texto`, async ({
    page,
  }) => {
    await mockBaseApi(page);
    await page.goto(route);

    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(main.getByRole("heading", { level: 2 })).toHaveText([
      ...sections,
      "Segurança da conta",
      "Termos e comunicações",
    ]);

    for (const submit of [false, true]) {
      if (submit) {
        await main.getByRole("button", { name: /Criar conta de/ }).click();
        await expect(
          main.getByText("Revise os campos destacados"),
        ).toBeVisible();
      }
      const audit = await new AxeBuilder({ page })
        .withRules(["heading-order", "color-contrast-enhanced"])
        .analyze();
      expect(
        audit.violations.flatMap((rule) =>
          rule.nodes.map((node) => node.failureSummary),
        ),
      ).toEqual([]);
    }
  });
}
