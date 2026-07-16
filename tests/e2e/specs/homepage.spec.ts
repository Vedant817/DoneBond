import { expect, test } from "@playwright/test";

test("serves the DoneBond workspace landing page", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  await expect(response.text()).resolves.toContain("DoneBond shows the proof");
});
