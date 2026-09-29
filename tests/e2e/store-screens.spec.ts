import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, onboardingPage, test } from "./fixtures.ts";

/**
 * Store listing images (docs/PUBLISHING.md §4): real extension screens, captured against the mock backend
 * and set on 1280×800 canvases, plus the promo tiles. Opt-in: STORE_SCREENS_DIR=<folder> npx playwright test store-screens
 * The mock family ("Mia", "Cruz family") is fictional.
 */
const OUT = process.env.STORE_SCREENS_DIR ?? "";
test.setTimeout(120_000);

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) =>
  readFileSync(require.resolve(`${pkg}/files/${file}`)).toString("base64");

const SHIELD =
  "M32 4C24.4 8 16.4 10.2 8.5 11.2V30c0 14.6 9.8 25.4 23.5 30 13.7-4.6 23.5-15.4 23.5-30V11.2C47.6 10.2 39.6 8 32 4Z";
/** The eGuard mark (same drawing as LogoMark in apps/extension/src/ui/components.tsx). */
const logo = (size: number) => `
<svg width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="o" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4FD2FF"/><stop offset=".55" stop-color="#2394F5"/><stop offset="1" stop-color="#1560DB"/>
    </linearGradient>
    <linearGradient id="i" x1="18" y1="16" x2="46" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8BE0FF"/><stop offset="1" stop-color="#2B8EF2"/>
    </linearGradient>
  </defs>
  <path d="${SHIELD}" fill="url(#o)"/>
  <path d="${SHIELD}" fill="#fff" transform="translate(32 32) scale(.76) translate(-32 -32)"/>
  <path d="${SHIELD}" fill="url(#i)" transform="translate(32 32) scale(.6) translate(-32 -32)"/>
  <g stroke-linejoin="round" stroke-width="1.2">
    <path d="M32 22.5 40.2 27.2 32 31.9 23.8 27.2Z" fill="#C4F0FF" stroke="#C4F0FF"/>
    <path d="M23.8 27.2 32 31.9V41.3L23.8 36.6Z" fill="#1E9BF2" stroke="#1E9BF2"/>
    <path d="M40.2 27.2 32 31.9V41.3L40.2 36.6Z" fill="#0B5FD4" stroke="#0B5FD4"/>
  </g>
</svg>`;

const BASE_CSS = `
@font-face { font-family: Sora; src: url(data:font/woff2;base64,${font("@fontsource-variable/sora", "sora-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Hanken; src: url(data:font/woff2;base64,${font("@fontsource-variable/hanken-grotesk", "hanken-grotesk-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { font-family: Hanken, system-ui, sans-serif; color: #0b2348; -webkit-font-smoothing: antialiased; overflow: hidden;
  background: radial-gradient(70% 80% at 85% 10%, #d6ecff 0%, rgba(214,236,255,0) 60%),
              radial-gradient(60% 70% at 0% 100%, #e4f6ec 0%, rgba(228,246,236,0) 55%),
              linear-gradient(160deg, #f7fbff 0%, #eaf4fe 100%); }
h1 { font-family: Sora, sans-serif; font-weight: 650; letter-spacing: -0.02em; }
.brand { display: flex; align-items: center; gap: 10px; font-family: Sora; font-weight: 650; font-size: 22px; }
.sub { color: #34496a; line-height: 1.45; }
.frame { background: #fff; border-radius: 14px; box-shadow: 0 30px 70px -25px rgba(11,35,72,.35), 0 0 0 1px rgba(11,35,72,.06); overflow: hidden; }
.bar { height: 40px; display: flex; align-items: center; gap: 14px; padding: 0 14px; background: #eef3f9; border-bottom: 1px solid #dfe8f3; }
.dots { display: flex; gap: 7px; } .dots i { width: 11px; height: 11px; border-radius: 50%; display: block; }
.url { flex: 1; height: 26px; border-radius: 13px; background: #fff; display: flex; align-items: center; padding: 0 12px; font-size: 13px; color: #5a6e92; }
.shot { display: block; width: 100%; }
`;

const bar = (url: string) => `
<div class="bar">
  <div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <div class="url">${url}</div>
  ${logo(22)}
</div>`;

const img = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

/** Renders HTML at a fixed size and saves it as a JPEG (the stores reject PNGs with an alpha channel). */
async function render(context: BrowserContext, html: string, name: string, width = 1280, height = 800) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>${BASE_CSS}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (i) => i.decode()));
  });
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 95 });
  await page.close();
}

/** A headline above a browser window showing a full-width screen. */
function wideSlide(title: string, sub: string, url: string, shot: Buffer) {
  return `
<div style="padding:44px 90px 0; text-align:center">
  <h1 style="font-size:40px">${title}</h1>
  <p class="sub" style="font-size:19px; margin-top:10px">${sub}</p>
  <div class="frame" style="margin:34px auto 0; width:1100px; height:620px">
    ${bar(url)}
    <img class="shot" src="${img(shot)}">
  </div>
</div>`;
}

async function settingsSection(page: Page, id: string) {
  await page.evaluate((sectionId) => {
    const el = document.getElementById(sectionId)!;
    // The card starts 24px above its section; stop just short of the gap above it
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 44);
  }, id);
  await page.waitForTimeout(300); // sidebar highlight follows the scroll
  return page.screenshot();
}

test("store listing images", async ({ context, extensionId, worker }) => {
  test.skip(!OUT, "Set STORE_SCREENS_DIR to generate store images");

  // Stands in for a parent allowing eGuard in private windows, so the real status can reach Protected
  await worker.evaluate(() => {
    Object.defineProperty(chrome.extension, "isAllowedIncognitoAccess", {
      value: () => Promise.resolve(true),
      configurable: true,
    });
  });

  const ob = await onboardingPage(context, extensionId);
  await ob.getByRole("button", { name: "Get started" }).click();
  await ob.getByLabel("Pairing code").fill("824917");
  await ob.getByRole("button", { name: "Connect" }).click();
  await expect(ob.getByRole("heading", { name: "Review protection" })).toBeVisible();
  await ob.getByRole("button", { name: "Verify configuration" }).click();
  await expect(ob.getByText("You can close this tab.")).toBeVisible();

  // A little real activity for "today"
  const visit = async (host: string, width = 1280, height = 800) => {
    const p = await context.newPage();
    await p.setViewportSize({ width, height });
    await p.goto(`http://${host}:3299/`).catch(() => {});
    await expect(p).toHaveURL(/blocked\/index\.html/, { timeout: 10_000 });
    await expect(p.getByRole("button", { name: "Ask a parent" })).toBeVisible();
    return p;
  };
  for (const host of ["play.example", "games.play.example", "blocked.example"])
    await (await visit(host)).close();

  // 1. Popup
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(popup.getByRole("heading", { name: "Protection active" })).toBeVisible();
  const popupShot = await popup.screenshot();
  await popup.getByText("View today's activity").click();
  await popup.getByText(/blocked today/).scrollIntoViewIfNeeded();
  const activityShot = await popup.locator("details").first().screenshot();

  await render(
    context,
    `
<div style="display:flex; height:800px; padding:0 70px; align-items:center; gap:56px">
  <div style="width:430px">
    <div class="brand">${logo(34)} eGuard</div>
    <h1 style="font-size:46px; line-height:1.1; margin-top:28px">See that protection is on</h1>
    <p class="sub" style="font-size:20px; margin-top:18px">Your family's settings, verified in this browser. Status, settings and today's blocked pages at a glance.</p>
  </div>
  <div style="position:relative; flex:1; height:680px">
    <div class="frame" style="position:absolute; inset:30px 0 0 0">
      ${bar("homework.example")}
      <div style="padding:40px 44px; display:grid; gap:18px">
        <div style="height:26px; width:46%; border-radius:8px; background:#e6eef8"></div>
        <div style="height:14px; width:80%; border-radius:7px; background:#eef3f9"></div>
        <div style="height:14px; width:72%; border-radius:7px; background:#eef3f9"></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; width:52%; margin-top:10px">
          <div style="height:120px; border-radius:12px; background:#e7f4ff"></div>
          <div style="height:120px; border-radius:12px; background:#e4f6ec"></div>
        </div>
      </div>
    </div>
    <div class="frame" style="position:absolute; right:26px; top:66px; width:360px; box-shadow:0 30px 60px -18px rgba(11,35,72,.45), 0 0 0 1px rgba(11,35,72,.08)">
      <img class="shot" src="${img(popupShot)}">
    </div>
  </div>
</div>`,
    "1-popup",
  );

  // 2. Block page
  // Wide enough that the whole card, including "Ask a parent", fits the window at 1100px
  const block = await visit("play.example", 1600, 900);
  const blockShot = await block.screenshot({ clip: { x: 0, y: 40, width: 1600, height: 846 } });
  await render(
    context,
    wideSlide(
      "A calm page, not a scolding",
      "Your child sees why a website is blocked, and can ask you for access.",
      "play.example",
      blockShot,
    ),
    "2-block-page",
  );

  // 3–5. Settings
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 745 });
  await settings.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(settings.getByRole("heading", { name: "Privacy" })).toBeVisible();
  const url = "eGuard settings";
  await render(
    context,
    wideSlide(
      "Parents stay in charge",
      "Settings are chosen in the eGuard dashboard and can't be changed from your child's browser.",
      url,
      await settingsSection(settings, "protection"),
    ),
    "3-settings-protection",
  );
  await render(
    context,
    wideSlide(
      "Block whole kinds of websites",
      "Adult content, gambling, gaming and more, plus any sites you add yourself.",
      url,
      await settingsSection(settings, "categories"),
    ),
    "4-settings-categories",
  );
  await render(
    context,
    wideSlide(
      "Protection without watching",
      "No browsing history, no page content, no keystrokes. Websites are checked on the device.",
      url,
      await settingsSection(settings, "privacy"),
    ),
    "5-privacy",
  );

  // Promo tiles
  await render(
    context,
    `
<div style="height:280px; display:flex; flex-direction:column; justify-content:center; padding:0 36px">
  <div class="brand" style="font-size:30px; gap:12px">${logo(52)} eGuard</div>
  <h1 style="font-size:25px; line-height:1.2; margin-top:18px">Safer browsing for your family, kept verified</h1>
</div>`,
    "promo-small-440x280",
    440,
    280,
  );
  await render(
    context,
    `
<div style="height:560px; display:flex; align-items:center; padding:0 90px; gap:60px">
  <div style="flex:1">
    <div class="brand" style="font-size:40px; gap:14px">${logo(68)} eGuard</div>
    <h1 style="font-size:46px; line-height:1.12; margin-top:26px">Safer browsing for your family, kept verified</h1>
    <p class="sub" style="font-size:21px; margin-top:16px">Block what you choose. Never watch what they browse.</p>
  </div>
  <div class="frame" style="width:380px">
    <img class="shot" src="${img(activityShot)}">
  </div>
</div>`,
    "promo-marquee-1400x560",
    1400,
    560,
  );
});
