import { expect, test } from "@playwright/test";

test("serves the DoneBond workspace landing page", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  await expect(response.text()).resolves.toContain(
    "Agents can say a task is done. DoneBond makes them prove it."
  );
});

test("renders the wallet-gated project flow without horizontal overflow", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: /Connect the wallet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test("shows a safe public-proof not-found state", async ({ page }) => {
  await page.goto("/proof/not-a-valid-public-id");
  await expect(page.getByRole("heading", { name: "Proof unavailable" })).toBeVisible();
  await expect(page.getByText(/was not found/i)).toBeVisible();
});
