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
/* Full rooms and the marks beside a name are derived from the fixtures the
   same way the live path derives them, so the demo shows the real thing. */
const badgeSaying = label => page.evaluate(l => [...document.querySelectorAll("span")]
  .some(el => el.textContent.trim() === l), label);
check("a full room is marked full", await badgeSaying("FULL"));
check("and one over its cap says by how much", await badgeSaying("FULL +2"));
await shot("demo-01-battles");

console.log("battle room");
await clickText(/^Join room$/);
check("the demo room opens rather than throwing",
  await waitFor(() => seeing(/ROOM CHAT/)));
check("and it is the demo room", await seeing(/Shadowfury/));
check("the room names whoever is still downloading",
  await seeing(/Waiting on lorelei, vexatiousmachinist/));
/* The room is the one screen you always reach having just seen its map in
   the list, so it is the one screen whose picture is always already in hand
   - and the only screen the minimap was reported black on. Present is not
   the same as visible here: the picture is drawn transparent until it is
   known to have arrived, so ask what is on screen, not what is in the DOM. */
check("the room's minimap is visible, not a black panel", await waitFor(() =>
  page.evaluate(() => {
    const i = [...document.querySelectorAll("img")].find(x => /minimap/.test(x.src));
    return !!i && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1";
  })));
await shot("demo-02-room");

/* The picker is the one place the browser has nothing to read: the AI list
   comes off the install, and there is no install here. It has to offer Zero-K's
   own AIs anyway - an empty picker would be worse than the single hardcoded CAI
   this replaced - and it has to say the list is a guess. */
console.log("the AI picker with no install behind it");
await clickText(/Add AI/);
check("the picker opens in the demo too", await waitFor(() => seeing(/Add an AI to team/)));
check("with Zero-K's own AIs in it", await seeing(/CAI/) && await seeing(/Chicken/));
check("and says the list is built in rather than read",
  await seeing(/built-in list/));
await page.getByRole("button", { name: /^Cancel$/ }).last().click();
check("and closes again", await waitFor(async () => !(await seeing(/Add an AI to team/))));

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
