import { expect, test } from "@playwright/test";

test.describe("Tilgang uten innlogging (test 2)", () => {
  for (const path of ["/", "/innlegg", "/generer", "/kalender", "/produkter", "/bilder", "/analyse", "/innstillinger", "/facebook/velg-side", "/innlegg/00000000-0000-4000-8000-000000000000"]) {
    test(`${path} sender til innlogging`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Velkommen tilbake" })).toBeVisible();
    });
  }

  test("API-ruter avviser uautoriserte kall", async ({ request }) => {
    expect((await request.get("/api/cron/publish")).status()).toBe(401);
    expect((await request.get("/api/cron/publish", { headers: { authorization: "Bearer feil" } })).status()).toBe(401);
    expect((await request.get("/api/cron/insights")).status()).toBe(401);
    expect((await request.post("/api/facebook/login", { headers: { origin: "https://ondsinnet.example" } })).status()).toBe(401);
    // Selv med feil opprinnelse startes ingen innlogging hos Facebook.
    const r = await request.post("/api/facebook/login", { headers: { origin: "https://ondsinnet.example" }, maxRedirects: 0 });
    expect(r.headers()["location"] ?? "").not.toContain("facebook.com");
    expect((await request.get("/api/facebook/callback?code=x&state=y")).status()).toBe(401);
  });

  test("sikkerhetshoder er satt", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

test.describe("Innloggingssiden", () => {
  test("er på norsk og fungerer på mobil uten horisontal rulling (test 14)", async ({ page }, info) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "nb");
    await expect(page.getByLabel("E-post")).toBeVisible();
    await expect(page.getByLabel("Passord")).toBeVisible();
    const btn = page.getByRole("button", { name: "Logg inn" });
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44); // berøringsvennlig
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/login-${info.project.name}.png`, fullPage: true });
  });

  test("ukjent e-post gir generell feilmelding uten å avsløre kontoer", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-post").fill("ukjent@example.com");
    await page.getByLabel("Passord").fill("passord123");
    await page.getByRole("button", { name: "Logg inn" }).click();
    // Uten database: "midlertidig utilgjengelig". Med database: "Feil e-post eller passord."
    await expect(page.getByRole("alert").filter({ hasText: /Feil e-post eller passord|midlertidig utilgjengelig/ })).toBeVisible();
  });
});
