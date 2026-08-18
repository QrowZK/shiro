/**
 * Drives the live (Tauri) code paths against tools/e2e/fake-server.js.
 *
 * These paths are the ones a plain `npm run dev` never reaches, so without this
 * the store wiring is only verified by unit tests.
 *
 *   npm run dev            # in another shell
 *   npm run test:e2e
 *
 * It drives a browser you already have rather than downloading one - hence
 * playwright-core and a channel - because the app ships against WebView2 and
 * every machine that can build it has Edge. Override with CHROMIUM_PATH.
 *
 * Exits non-zero on the first failed check or any uncaught page error.
 */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
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

/* An explicit binary wins; otherwise try the browsers a dev machine has, in
   the order they are likely to be there. */
async function launch() {
  if (process.env.CHROMIUM_PATH) {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  }
  const tried = [];
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      tried.push(`${channel}: ${String(e.message).split("\n")[0]}`);
    }
  }
  console.error("No browser found. Set CHROMIUM_PATH, or install Edge or Chrome.");
  for (const t of tried) console.error("  " + t);
  process.exit(2);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push("CONSOLE: " + t);
});

await page.addInitScript({ path: join(HERE, "fake-server.js") });
await page.goto(URL, { waitUntil: "domcontentloaded" });

const text = () => page.locator("body").innerText();
const shot = async name => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png") }); };
const sent = () => page.evaluate(() => window.__ZKS.sent);
const sentAny = async re => (await sent()).some(l => re.test(l));
const clickText = async (re, opts) => page.getByRole("button", { name: re }).first().click(opts);
/* Dialogs render after the screen, so the last match is the one on top - the
   battle list keeps its own "Join" buttons alive behind the scrim. */
const clickDialog = async (re, opts) => page.getByRole("button", { name: re }).last().click(opts);
/* Several labels are uppercased by CSS, and innerText returns the transformed
   text, so every text assertion here is case-insensitive. */
const seeing = async re => new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i")
  .test(await text());
async function waitFor(label, fn, timeout = 6000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(150);
  }
}

console.log("login");
await page.locator("input").nth(0).fill("Qrow");
await page.locator("input").nth(1).fill("mariotoad");
await page.keyboard.press("Enter");
check("login handshake reaches the battle list",
  await waitFor("battles", () => seeing(/Teams 8v8 - all welcome/)));
check("Login was sent with our name", await sentAny(/^Login \{.*"Name":"Qrow"/));
check("the status bar shows the server's numbers", await seeing(/100 online/));
await shot("live-01-battles");

console.log("battle room");
await clickText(/^Join battle$/);
check("JoinBattle went out", await waitFor("join", () => sentAny(/^JoinBattle /)));
check("the roster arrives", await waitFor("roster", () => seeing(/CAI-Brutal/)));
check("spectators are separated from players", await seeing(/SPECTATORS/) && await seeing(/lorelei/));
check("mod options render", await seeing(/commshare/));
check("the install we found is named", await seeing(/Zero-K found via Steam/));
check("room chat renders the sender as a chip, not a string",
  await seeing(/hexed/) && !(await seeing(/\{"0":/)));
await shot("live-02-room");

console.log("room actions");
await clickText(/Join team 2/);
check("changing team sends UpdateUserBattleStatus",
  await waitFor("team", () => sentAny(/^UpdateUserBattleStatus \{.*"AllyNumber":1/)));
await clickText(/^Spectate$/);
check("spectating sends UpdateUserBattleStatus",
  await waitFor("spec", () => sentAny(/^UpdateUserBattleStatus \{.*"IsSpectator":true/)));

const composer = page.getByPlaceholder("Message the room");
await composer.fill("gl hf");
await composer.press("Enter");
check("room chat sends as a battle Say",
  await waitFor("say", () => sentAny(/^Say \{.*"Place":1.*"Text":"gl hf"/)));

await clickText(/^Start game$/);
check("start asks the host", await waitFor("start", () => sentAny(/^Say \{.*"!start"/)));

console.log("leaving");
await clickText(/^Leave$/);
check("LeaveBattle went out", await waitFor("leave", () => sentAny(/^LeaveBattle /)));
check("we are back on the battle list", await waitFor("back", () => seeing(/Host a battle/)));

console.log("hosting");
await clickText(/Host a battle/);
await page.getByPlaceholder("Teams 8v8 - all welcome").fill("shiro test room");
await page.getByPlaceholder("Comet Catcher Redux").fill("TartarusV7");
await clickText(/Open room/);
check("OpenBattle carries the title, map and engine",
  await waitFor("open", () => sentAny(/^OpenBattle \{.*"Title":"shiro test room".*"Map":"TartarusV7".*"Engine":"2025\.06\.21"/)));
check("we land in the room we opened", await waitFor("hosted", () => seeing(/shiro test room/)));
await shot("live-03-hosted");
await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

console.log("passworded battles");
await page.getByText(/^private - do not join$/).first().click();
await clickText(/^Join battle$/);
check("a locked battle asks for the password first",
  await waitFor("prompt", () => seeing(/This battle is locked/)));
await page.locator("input").last().fill("hunter2");
await clickDialog(/^Join$/);
check("the password is sent with the join",
  await waitFor("pwjoin", () => sentAny(/^JoinBattle \{.*"Password":"hunter2"/)));
await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

console.log("chat");
await page.locator("nav button").nth(1).click();
check("the joined channel is a tab", await waitFor("chan", () => seeing(/#zk/)));
check("channel backlog renders", await seeing(/anyone up for teams/));
check("the topic is shown", await seeing(/Welcome to Zero-K/));
const chanBox = page.getByPlaceholder(/^Message #zk/);
await chanBox.fill("hello from shiro");
await chanBox.press("Enter");
check("channel chat sends to the channel",
  await waitFor("csay", () => sentAny(/^Say \{.*"Place":0.*"Target":"zk".*"hello from shiro"/)));
await shot("live-04-chat");

console.log("matchmaker");
await page.locator("nav button").nth(2).click();
check("the server's queues are listed", await waitFor("queues", () => seeing(/Teams/) && seeing(/1v1/)));
await page.getByText(/^Teams$/).last().click();
await clickText(/^Join queue$/);
check("joining sends the queue names",
  await waitFor("mmq", () => sentAny(/^MatchMakerQueueRequest \{.*"Teams"/)));
check("the screen switches to searching", await waitFor("searching", () => seeing(/Searching/)));

await page.evaluate(() => window.__ZKS.push('AreYouReady {"MinimumWinChance":0.4,"QuickPlay":false,"SecondsRemaining":30}'));
check("the ready check interrupts", await waitFor("ready", () => seeing(/Match found\. Ready\?/)));
await clickText(/^Ready$/);
check("the response goes out", await waitFor("resp", () => sentAny(/^AreYouReadyResponse \{"Ready":true\}/)));
check("acceptance progress is shown", await waitFor("acc", () => seeing(/of 4 accepted/)));
await shot("live-05-ready");
await page.evaluate(() => window.__ZKS.push('AreYouReadyResult {"IsBattleStarting":true,"AreYouBanned":false}'));
check("the dialog closes when the match starts",
  await waitFor("closed", async () => !(await seeing(/Match found/))));

console.log("friends");
await page.locator("nav button").nth(3).click();
check("the friend list is the server's", await waitFor("friends", () => seeing(/FRIENDS/) && seeing(/hexed/)));
check("a profile is requested for the selection",
  await waitFor("prof", () => sentAny(/^UserProfile \{.*"Name":"hexed"/)));
check("real ratings replace the derived placeholders",
  await waitFor("ratings", () => seeing(/PLANETWARS/)));
await shot("live-06-friends");

console.log("launching a game");
await page.locator("nav button").nth(0).click();
await page.getByText(/^running match$/).first().click();
await clickText(/^Watch$/);
await waitFor("joined running", () => seeing(/CAI-Brutal/));
await clickText(/^Join game$/);
check("connect details are requested",
  await waitFor("rcs", () => sentAny(/^RequestConnectSpring /)));
const launched = await waitFor("launch", () => page.evaluate(() => Boolean(window.__ZKS.launched)));
check("the engine is launched from ConnectSpring", launched);
if (launched) {
  const req = await page.evaluate(() => window.__ZKS.launched);
  check("the launch carries our name and the script password",
    req.myPlayerName === "Qrow" && req.scriptPassword === "sp-9f2c" && req.port === 8452,
    JSON.stringify(req));
}
check("the room reports the game as running", await waitFor("running", () => seeing(/Game running/)));

console.log("debriefing");
await page.evaluate(() => window.__ZKS.push(JSON.stringify({
  DebriefingUsers: {
    Qrow: { AccountID: 1, AllyNumber: 0, Awards: [], EloChange: 18, NewElo: 1860, NewRank: 4,
      IsInVictoryTeam: true, IsLevelUp: false, IsRankup: false, IsRankdown: false,
      PrevRankElo: 1750, NextRankElo: 1900, XpChange: 640, NewXp: 12480,
      PrevLevelXp: 9000, NextLevelXp: 16000 },
    hexed: { AccountID: 2, AllyNumber: 1, Awards: [], EloChange: -18, NewElo: 1772, NewRank: 3,
      IsInVictoryTeam: false, IsLevelUp: false, IsRankup: false, IsRankdown: false },
  },
  ServerBattleID: 55, RatingCategory: "Team", Url: "https://zero-k.info/Battles/Detail/55",
}).replace(/^/, "BattleDebriefing ")));
check("a finished match pulls you to the debriefing",
  await waitFor("debrief", () => seeing(/Victory/)));
check("both sides are listed", await seeing(/hexed/) && await seeing(/Qrow/));
await shot("live-07-debrief");

console.log("");
console.log(`${checks - failures.length}/${checks} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
