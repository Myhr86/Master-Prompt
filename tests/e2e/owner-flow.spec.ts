import { expect, test } from "@playwright/test";

/**
 * Full eierflyt mot en ekte Supabase (lokal `supabase start` eller et
 * testprosjekt) med PUBLISH_MODE=simulated. Hoppes over uten testkonto.
 */
const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

test.describe("Eierflyt (test 1, 6, 8, 10, 14)", () => {
  test.skip(!email || !password, "Sett E2E_OWNER_EMAIL og E2E_OWNER_PASSWORD for å kjøre hele flyten");

  test("logg inn, skriv innlegg, godkjenn og simuler publisering", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-post").fill(email!);
    await page.getByLabel("Passord").fill(password!);
    await page.getByRole("button", { name: "Logg inn" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/God (morgen|dag|kveld)/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto("/innlegg");
    await page.getByRole("button", { name: "Skriv selv" }).click();
    await expect(page).toHaveURL(/\/innlegg\/[0-9a-f-]{36}\?rediger=1/);
    await page.getByLabel("Overskrift / innledning").fill("E2E-test");
    await page.getByLabel("Tekst").fill("Dette er et testinnlegg fra den automatiske testen.");
    await page.getByRole("button", { name: "Lagre endringer" }).click();
    await expect(page.getByText("Endringene er lagret.")).toBeVisible();

    await page.getByRole("button", { name: "Godkjenn" }).click();
    await expect(page.getByText(/Innlegget er godkjent/)).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Publiser nå/ }).click();
    await expect(page.getByText(/Testmodus: publiseringen ble simulert/)).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Slett" }).click();
    await expect(page).toHaveURL(/\/innlegg$/);
  });
});
