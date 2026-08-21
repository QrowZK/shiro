/**
 * Drives the browser demo - the path a plain `npm run dev` shows, with no
 * Tauri and no server behind it.
 *
 * Worth its own runner because the live suite injects a fake Tauri and so never
 * touches this branch: the demo room once crashed on a live-only field, the
 * demo Start button once did nothing, and neither showed up in a green
 * test:e2e. The click-through is a documented supported mode.
 *
 *   npm run dev            # in another shell
 *   npm run test:demo
 *
 * Exits non-zero on the first failed check or any uncaught page error.
 */
import { chromium } from "playwright-core";

const URL = process.env.SHIRO_URL || "http://localhost:1420/";
const SHOTS = process.env.SHIRO_SHOTS;

const failures = [];
const errors = [];
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) console.log("  ok   " + name);
  else { console.log("  FAIL " + name + (detail ? " - " + detail : "")); failures.push(name); }
}

async function launch() {
  if (process.env.CHROMIUM_PATH) {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  }
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try { return await chromium.launch({ channel }); } catch { /* try the next */ }
  }
  console.error("No browser found. Set CHROMIUM_PATH, or install Edge or Chrome.");
  process.exit(2);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
process.on("uncaughtException", err => {
  console.log("\nthe run stopped: " + err.message.split("\n")[0]);
  for (const e of errors) console.log("  " + e);
  process.exit(1);
});
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push("CONSOLE: " + t.slice(0, 300));
});

const text = () => page.locator("body").innerText();
const seeing = async re => new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i")
  .test(await text());
const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const clickText = (re, opts) => page.getByRole("button", { name: re }).first().click(opts);
async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(150);
  }
}

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);

console.log("login");
check("the demo says it is the demo", await seeing(/demo click-through/));
await page.locator("input").nth(0).fill("Shadowfury");
await page.locator("input").nth(1).fill("anything");
await page.keyboard.press("Enter");
check("any credentials get in", await waitFor(() => seeing(/Teams 8v8/)));
await shot("demo-01-battles");

console.log("battle room");
await clickText(/^Join room$/);
check("the demo room opens rather than throwing",
  await waitFor(() => seeing(/ROOM CHAT/)));
check("and it is the demo room", await seeing(/Shadowfury/));
await shot("demo-02-room");

console.log("the click-through ends where it should");
await clickText(/^Start game$/);
check("Start runs the fake launch", await waitFor(() => seeing(/Launching/)));
check("and lands on the debriefing", await waitFor(() => seeing(/Victory|Defeat/), 6000));
await shot("demo-03-debrief");

console.log("every screen");
const nav = page.locator("nav button");
const n = await nav.count();
for (let i = 0; i < n; i++) {
  await nav.nth(i).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(350);
}
check("no screen threw on the way round", errors.length === 0, errors[0]);
await shot("demo-04-final");

console.log("");
console.log(`${checks - failures.length}/${checks} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
