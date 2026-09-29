import { expect, onboardingPage, test } from "./fixtures.ts";

/** Design-review screenshots. Opt-in: SCREENS_DIR=<folder> npx playwright test screens */
const OUT = process.env.SCREENS_DIR ?? "";

test("capture screens", async ({ context, extensionId, openPopup }) => {
  test.skip(!OUT, "Set SCREENS_DIR to capture design-review screenshots");
  const ob = await onboardingPage(context, extensionId);
  await ob.setViewportSize({ width: 1100, height: 900 });
  await expect(ob.getByRole("heading", { name: "Let's protect this browser" })).toBeVisible();
  await ob.screenshot({ path: `${OUT}/onboarding-1-welcome.png`, fullPage: true });

  let popup = await openPopup();
  await expect(popup.getByRole("heading", { name: "Protection configuration required" })).toBeVisible();
  await popup.screenshot({ path: `${OUT}/popup-not-connected.png`, fullPage: true });
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.screenshot({ path: `${OUT}/popup-not-connected-dark.png`, fullPage: true });

  await ob.getByRole("button", { name: "Get started" }).click();
  await ob.getByLabel("Pairing code").fill("000000");
  await ob.getByRole("button", { name: "Connect" }).click();
  await expect(ob.getByRole("alert")).toBeVisible();
  await ob.screenshot({ path: `${OUT}/onboarding-2-connect-error.png`, fullPage: true });
  await ob.getByLabel("Pairing code").fill("824917");
  await ob.getByRole("button", { name: "Connect" }).click();
  await expect(ob.getByRole("heading", { name: "Review protection" })).toBeVisible();
  await ob.screenshot({ path: `${OUT}/onboarding-3-review.png`, fullPage: true });
  await ob.getByRole("button", { name: "Verify configuration" }).click();
  await expect(ob.getByText("You can close this tab.")).toBeVisible();
  await ob.screenshot({ path: `${OUT}/onboarding-4-verify.png`, fullPage: true });

  popup = await openPopup();
  await expect(popup.getByText("Version 1", { exact: true })).toBeVisible();
  await popup.screenshot({ path: `${OUT}/popup-paired.png`, fullPage: true });
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.screenshot({ path: `${OUT}/popup-paired-dark.png`, fullPage: true });

  const options = await context.newPage();
  await options.setViewportSize({ width: 1100, height: 900 });
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(options.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await options.screenshot({ path: `${OUT}/options.png`, fullPage: true });
});

test("capture block page screens", async ({ context, extensionId, backend }) => {
  test.skip(!OUT, "Set SCREENS_DIR to capture design-review screenshots");
  backend.state.policyPatch = { unknownSitesPolicy: "WARN" };
  const ob = await onboardingPage(context, extensionId);
  await ob.getByRole("button", { name: "Get started" }).click();
  await ob.getByLabel("Pairing code").fill("824917");
  await ob.getByRole("button", { name: "Connect" }).click();
  await expect(ob.getByRole("heading", { name: "Review protection" })).toBeVisible();
  const open = async (host: string) => {
    const p = await context.newPage();
    await p.setViewportSize({ width: 1100, height: 820 });
    await p.goto(`http://${host}:3299/`).catch(() => {});
    await expect(p).toHaveURL(/blocked\/index\.html/, { timeout: 10_000 });
    return p;
  };
  const b = await open("play.example");
  await expect(b.getByRole("button", { name: "Ask a parent" })).toBeVisible();
  await b.screenshot({ path: `${OUT}/block-category.png`, fullPage: true });
  await b.getByRole("button", { name: "Ask a parent" }).click();
  await b.getByLabel(/Why do you need it/).fill("Playing with my cousin");
  await b.getByRole("button", { name: "Send to a parent" }).click();
  await expect(b.getByText(/You asked a parent/)).toBeVisible();
  await b.screenshot({ path: `${OUT}/block-requested.png`, fullPage: true });
  const w = await open("news.example");
  await expect(w.getByRole("button", { name: "Continue to site" })).toBeVisible();
  await w.emulateMedia({ colorScheme: "dark" });
  await w.waitForTimeout(300);
  await w.screenshot({ path: `${OUT}/block-warn-dark.png`, fullPage: true });
});
