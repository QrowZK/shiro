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
 *
 * The login it performs is against tools/e2e/fake-server.js, not zero-k.info,
 * so any password will do and the one below is a placeholder. It is read from
 * the environment because a real credential written into a file here is a real
 * credential published to everyone who can read the repo - which is exactly
 * what happened once already, and cost a password change.
 *
 *   SHIRO_E2E_PASS=whatever npm run test:e2e
 */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = process.env.SHIRO_URL || "http://localhost:1420/";
/* The name is fixture data: tools/e2e/fake-server.js keys its canned replies on
   it, and a lobby name is public anyway. The password is not fixture data and
   has no business being written down - the fake server accepts anything, so
   this default is a placeholder, and a real one belongs in the environment. */
const USER = process.env.SHIRO_E2E_USER || "Qrow";
const PASS = process.env.SHIRO_E2E_PASS || "not-a-real-password";
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
process.on("uncaughtException", err => {
  console.log("\nthe run stopped: " + err.message.split("\n")[0]);
  const where = (err.stack || "").split("\n").find(l => l.includes("live.mjs"));
  if (where) console.log("  at" + where.split("at")[1]);
  if (errors.length) {
    console.log("page errors:");
    for (const e of errors) console.log("  " + e);
  }
  process.exit(1);
});

page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/Failed to load resource/.test(t)) errors.push("CONSOLE: " + t.slice(0, 300));
});

await page.addInitScript({ path: join(HERE, "fake-server.js") });
await page.goto(URL, { waitUntil: "domcontentloaded" });

const text = () => page.locator("body").innerText();
const shot = async name => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png") }); };
const sent = () => page.evaluate(() => window.__ZKS.sent);
const sentAny = async re => (await sent()).some(l => re.test(l));
/* Assertions that look at the whole log can pass on something an earlier step
   sent. `mark()` scopes them to one step. */
const mark = async () => (await sent()).length;
const sentSince = async (from, re) => (await sent()).slice(from).some(l => re.test(l));
const clickText = async (re, opts) => page.getByRole("button", { name: re }).first().click(opts);
/* Dialogs render after the screen, so the last match is the one on top - the
   battle list keeps its own "Join" buttons alive behind the scrim. */
const clickDialog = async (re, opts) => page.getByRole("button", { name: re }).last().click(opts);
/* Several labels are uppercased by CSS, and innerText returns the transformed
   text, so every text assertion here is case-insensitive. */
const seeing = async re => new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i")
  .test(await text());
/* The design kit wraps its <select> in the <label>, so the accessible name is
   the label text *plus every option* - `getByLabel("Game")` never matches.
   Find the select by an option only it has. */
const selectWith = optionLabel => page.locator("select")
  .filter({ has: page.locator(`option:text-is("${optionLabel}")`) });
async function waitFor(label, fn, timeout = 6000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeout) return false;
    await page.waitForTimeout(150);
  }
}

console.log("registering");
await clickText(/Create an account/);
check("the account dialog opens", await waitFor("reg", () => seeing(/Create an account/)));
/* The login screen is still mounted behind the dialog, so its fields come
   first; the dialog's are the last ones. */
await page.getByLabel(/Account name/).last().fill("shiro-taken");
const pwFields = page.locator("input[type=password]");
const pwCount = await pwFields.count();
await pwFields.nth(pwCount - 2).fill("hunter2");
await pwFields.nth(pwCount - 1).fill("hunter2");
await page.waitForTimeout(200);
await clickDialog(/^Create account$/);
check("a name the server refuses is reported, not swallowed",
  await waitFor("taken", () => seeing(/name is taken/)));
await clickDialog(/^Cancel$/);
check("cancelling returns to the login screen",
  await waitFor("backtologin", () => seeing(/Steam accounts need a lobby password/)));

console.log("login");
await page.locator("input").nth(0).fill(USER);
await page.locator("input").nth(1).fill(PASS);
await page.keyboard.press("Enter");
check("login handshake reaches the battle list",
  await waitFor("battles", () => seeing(/Teams 8v8 - all welcome/)));
check("Login was sent with our name",
  await sentAny(new RegExp(`^Login \\{.*"Name":"${USER}"`)));
check("the status bar shows the server's numbers", await seeing(/100 online/));

/* Busiest first, spectators counted. The running 12-player game is the busiest
   room on this server, so it leads - and the default selection deliberately
   skips it, because "Join battle" is the point of this screen and you cannot
   join a game already under way. */
check("the busiest room leads the list",
  await waitFor("order", async () => {
    // 12 players running, versus 9 players and 2 spectators.
    const [first, second] = await page.evaluate(() => {
      const t = document.body.innerText;
      return [t.indexOf("running match"), t.indexOf("Teams 8v8")];
    });
    return first >= 0 && second >= 0 && first < second;
  }));
check("but the default selection is a room you can actually join",
  await seeing(/Join battle/) && !(await seeing(/^Watch$/)));

await shot("live-01-battles");

console.log("battle room");
await clickText(/^Join battle$/);
check("JoinBattle went out", await waitFor("join", () => sentAny(/^JoinBattle /)));
check("the roster arrives", await waitFor("roster", () => seeing(/CAI-Brutal/)));
check("spectators are separated from players", await seeing(/SPECTATORS/) && await seeing(/lorelei/));
check("mod options render", await seeing(/commshare/));
/* Having the map is something the room has to be told. CmdStart gathers
   everyone whose status is not Synced, announces them as "still downloading
   the map" to the whole room, and delays the start by ten seconds - so a
   client that never sends this is named every single game. */
/* The map link reaches the map, not a search. `?name=` is ignored by
   zero-k.info - a real map, a nonsense one and an empty one all return a
   byte-identical page - so the detail page needs the numeric ResourceID, which
   the site's own catalogue supplies. */
check("the map links to its own page rather than a search",
  await waitFor("maplink", async () => {
    const href = await page.locator('a[title^="Open "]').first().getAttribute("href");
    return href && /\/Maps\/Detail\/55646$/.test(href);
  }));

check("we tell the room we have the map",
  await waitFor("synced", () => sentAny(/^UpdateUserBattleStatus \{.*"Sync":1/)));

/* And the other half, so this is not a client that simply always claims to be
   ready: a map we do not have is reported as unsynced, which is what makes the
   server's warning name the people it is actually about. */
await page.evaluate(() => {
  window.__ZKS.missing = [{ kind: "map", name: "Nobody Has This v1" }];
});
const beforeUnsync = await mark();
await page.evaluate(() => window.__ZKS.push("BattleUpdate " + JSON.stringify({
  Header: { BattleID: 11, Map: "Nobody Has This v1" },
})));
check("and say so when we do not",
  await waitFor("unsynced", () => sentSince(beforeUnsync, /^UpdateUserBattleStatus \{.*"Sync":2/)));
await page.evaluate(() => { window.__ZKS.missing = []; });

/* Ratings carry the colour their rank icon carries, so the number in the
   roster and the badge in the official client agree. Three players, three
   different bands: 1842 yellow, 1790 amber, 1588 orange. */
const tints = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll("span")) {
    const t = el.textContent.trim();
    if (/^\d{3,4}$/.test(t) && el.style.fontVariantNumeric === "tabular-nums") {
      out[t] = getComputedStyle(el).color;
    }
  }
  return out;
});
check("ratings are tinted by rank band",
  tints["1842"] === "rgb(222, 185, 11)"
  && tints["1790"] === "rgb(209, 143, 37)"
  && tints["1588"] === "rgb(209, 98, 37)",
  JSON.stringify(tints));

/* The chat and spectator pane is draggable, and remembers where you left it -
   people who read chat want it tall, people watching the teams want it short. */
const resizer = page.getByRole("separator", { name: "Resize chat" });
const paneHeight = () => page.evaluate(() =>
  document.querySelector('[role=separator][aria-label="Resize chat"]')
    .nextElementSibling.firstElementChild.getBoundingClientRect().height);
const startHeight = await paneHeight();
await resizer.focus();
await page.keyboard.press("ArrowUp");
check("the chat pane resizes", await waitFor("taller", async () => (await paneHeight()) > startHeight));
await shot("live-05-room");
check("and the new height is remembered",
  await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shiro.settings") || "{}").roomChatHeight > 200));

/* Somebody else's room. The server would refuse a SetModOptions from us, so
   the button is offered disabled with the reason rather than hidden. */
check("options are not editable in a room we did not open",
  await page.getByRole("button", { name: "Edit" }).isDisabled());
check("the install we found is named, as an install",
  await seeing(/Zero-K installation found via Steam/));
/* The panel used to say only "Zero-K found via Steam", which in a room
   running something else read as though the room were Zero-K. */
check("the room names the game it actually runs", await seeing(/Supreme-K 3\.42/));
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
/* The server echoes a Say back to the room, and the log has to follow it down.
   Nothing exercised an incoming chat line until the fake server learned to
   echo, which is why "chat does not snap to new messages" had no test. */
check("and the echoed line lands in the log",
  await waitFor("echo", () => seeing(/gl hf/)));
for (let i = 0; i < 24; i++) {
  await composer.fill("filler " + i);
  await composer.press("Enter");
}
check("the log follows new messages to the bottom",
  await waitFor("follow", () => page.evaluate(() => {
    const els = [...document.querySelectorAll("div")]
      .filter(d => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight + 4);
    return els.length > 0 && els.every(d => d.scrollHeight - d.scrollTop - d.clientHeight <= 48);
  })));

await clickText(/^Start game$/);
check("start asks the host", await waitFor("start", () => sentAny(/^Say \{.*"!start"/)));

console.log("leaving");
await clickText(/^Leave$/);
check("LeaveBattle went out", await waitFor("leave", () => sentAny(/^LeaveBattle /)));
check("we are back on the battle list", await waitFor("back", () => seeing(/Host a battle/)));

console.log("hosting");
await clickText(/Host a battle/);
await page.getByPlaceholder("Teams 8v8 - all welcome").fill("shiro test room");
/* The map field searches Zero-K's catalogue now, so its placeholder is a
   prompt rather than an example map. */
await page.getByPlaceholder("Type to search").fill("TartarusV7");
await clickText(/Open room/);
check("OpenBattle carries the title, map and engine",
  await waitFor("open", () => sentAny(/^OpenBattle \{.*"Title":"shiro test room".*"Map":"TartarusV7".*"Engine":"2025\.06\.21"/)));
check("we land in the room we opened", await waitFor("hosted", () => seeing(/shiro test room/)));
await shot("live-03-hosted");

/* Game options. Only the founder may set them - the server refuses everyone
   else, and refuses even the founder in an autohost - so the Edit button exists
   here and nowhere else in this run. */
check("the host is offered the game options",
  await waitFor("editable", () => seeing(/MOD OPTIONS/)));
const beforeOptions = await mark();
const noElo = () => page.getByLabel("No Elo");
await clickText(/^Edit$/);
check("the options open on the game's own first section",
  await waitFor("opts", () => seeing(/Game options/)) && await seeing(/Important/));
check("every section upstream declares is offered",
  (await Promise.all(["Important", "Start", "Map", "Multipliers", "Silly", "Experimental", "Chicken"]
    .map(n => seeing(new RegExp(n))))).every(Boolean));

/* Nothing is sent until Apply: a send per keystroke would broadcast the whole
   dictionary to every player in the room on every click.

   The click is dispatched rather than performed because the design system's
   checkbox is a 0x0 input hidden behind a styled span: it is the element
   carrying the label and the change handler, but nothing Playwright will agree
   to click. */
await noElo().dispatchEvent("click");
await page.waitForTimeout(400);
await shot("live-04-modoptions");
check("editing alone sends nothing",
  !(await sentSince(beforeOptions, /^SetModOptions/)));

await clickText(/^Cancel$/);
check("cancelling sends nothing either",
  !(await sentSince(beforeOptions, /^SetModOptions/)));

await clickText(/^Edit$/);
check("cancelling kept the room's own value, not ours",
  await waitFor("reseed", async () => !(await noElo().isChecked())));
await noElo().dispatchEvent("click");
const beforeApply = await mark();
await clickText(/^Apply$/);
check("applying sends the change",
  await waitFor("sent", () => sentSince(beforeApply, /^SetModOptions \{.*"noelo":"1"/)));

/* The trap this whole module is shaped around. SetModOptions assigns the
   room's dictionary rather than merging into it, so a send that carries only
   our own controls silently drops everything else - the server's own keys
   included. Both of these were in the room before we opened the dialog. */
check("and carries the keys we never touched",
  await sentSince(beforeApply, /^SetModOptions \{.*"commshare":"1"/)
  && await sentSince(beforeApply, /^SetModOptions \{.*"multiplier":"2\.0"/));

check("the room shows the change by name", await waitFor("shown", () => seeing(/No Elo/)));

await clickText(/^Leave$/);
await waitFor("back", () => seeing(/Host a battle/));

/* A custom mode is not simply "a different game". Of the three the service
   offers, one names a game, one names a map and runs on stock Zero-K, and one
   is nothing but a modoption - so this covers a game-mode and a map-mode
   without opening a second room for the second case. */
console.log("hosting a custom game");
await clickText(/Host a battle/);
await page.getByPlaceholder("Teams 8v8 - all welcome").fill("arena room");

await selectWith("Zero Wars").selectOption({ label: "Zero Wars" });
check("a mode that is a map fills the map field for you",
  await waitFor("zwmap", async () =>
    (await page.getByPlaceholder("Type to search").inputValue()) === "ZeroWars v2.1.9"));

await selectWith("Arena Mod").selectOption({ label: "Arena Mod" });
await page.getByPlaceholder("Type to search").fill("TartarusV7");
const fromHost = await mark();
await clickText(/Open room/);
check("OpenBattle carries the mode's game, not Welcome's",
  await waitFor("arena", () => sentSince(fromHost, /^OpenBattle \{.*"Game":"Arena Mod v1\.0\.10"/)));
check("and the mode's modoptions follow once the room exists",
  await waitFor("opts", () => sentSince(fromHost, /^SetModOptions \{.*"terrarestoreonly":"1"/)));

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

console.log("profile and player search");
await page.locator("nav button").nth(4).click();
check("your own profile is the default view",
  await waitFor("prof", () => seeing(/MY PROFILE/) && seeing(/GENERAL ELO/)));
await page.getByPlaceholder("Find a player").fill("hex");
check("searching the directory finds a player who is online",
  await waitFor("hit", () => seeing(/ENTER OPENS TOP HIT/) && seeing(/hexed/)));
await page.keyboard.press("Enter");
check("and opening one turns the screen into them",
  await waitFor("viewing", () => seeing(/VIEWING/) && seeing(/Add friend/)));
/* The asymmetry the protocol forces: their record has no Planetwars rating and
   there is no way to ask for one, so the panel is absent rather than blank. */
check("another player shows no Planetwars rating, because there is none to show",
  !(await seeing(/PLANETWARS/)));
check("and says why the history is missing rather than showing an empty table",
  await seeing(/only available for your own account/));

/* What the protocol will not tell us about another player, read off their
   zero-k.info page instead. The developers were asked for an endpoint and
   declined; see docs/PROFILES-WITHOUT-ENDPOINTS.md. */
check("their zero-k.info page fills in what the protocol will not",
  await waitFor("web", () => seeing(/FROM ZERO-K\.INFO/)));
check("including awards with their counts",
  await seeing(/Complete Annihilation/) && await seeing(/812/));
check("and when they were last seen, which is the point of looking someone up",
  await seeing(/LAST SEEN/) && await seeing(/20 minutes ago/));

/* Somebody the lobby has never heard of. The directory is only who is
   connected, so without a way to look a name up the profile of an offline
   player is unreachable - which is what made the reader above pointless. */
await page.getByPlaceholder("Find a player").fill("Gholam");
check("a name the directory does not have is still offered",
  await waitFor("offer", () => seeing(/Look up Gholam/)));
await clickText(/Look up Gholam/);
check("and opens as a profile",
  await waitFor("offline", () => seeing(/VIEWING/) && seeing(/Gholam/)));
check("filled in from their page rather than left blank",
  await waitFor("offweb", () => seeing(/FROM ZERO-K\.INFO/) && seeing(/LAST SEEN/)));

/* And a name that is nobody at all says so, rather than showing an empty
   profile that reads as a player who has done nothing. */
await page.getByPlaceholder("Find a player").fill("zzzznosuchplayerzzzz");
await clickText(/Look up zzzznosuchplayerzzzz/);
check("a name that is nobody says so",
  await waitFor("nobody", () => seeing(/No zero-k\.info account under that name/)));

await clickText(/My profile/);
check("going back returns to your own", await waitFor("back2", () => seeing(/MY PROFILE/)));

console.log("friends");
await page.locator("nav button").nth(3).click();
check("the friend list is the server's", await waitFor("friends", () => seeing(/FRIENDS/) && seeing(/hexed/)));
/* Deliberately the opposite of what this used to assert. `UserProfile` is
   server-to-client only; sending it threw a RuntimeBinderException on the real
   server, so requestProfile is a no-op and the detail comes from the `User`
   record we already hold. See src/store/friends.ts. */
check("no UserProfile is sent, because the server cannot receive one",
  !(await sentAny(/^UserProfile /)));
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

console.log("commands from the website");
const siteMark = await mark();
await page.evaluate(() => window.__ZKS.push('SiteToLobbyCommand ' + JSON.stringify({
  Command: "zk://chat/channel/zk@add_friend:lorelei" })));
check("an add-friend from the site goes to the server",
  await waitFor("sitefriend", () => sentSince(siteMark, /^SetAccountRelation \{.*"TargetName":"lorelei".*"Relation":1/)));
check("and the path it carries navigates", await waitFor("sitechan", () => seeing(/#zk/)));

await page.evaluate(() => window.__ZKS.push('SiteToLobbyCommand {"Command":"@join_player:hexed"}'));
check("join_player joins whatever battle that player is in",
  await waitFor("sitejoin", () => sentSince(siteMark, /^JoinBattle \{"BattleID":11\}/)));

console.log("server notices");
await page.evaluate(() => window.__ZKS.push('Say ' + JSON.stringify({
  Place: 5, Text: "Scheduled restart in 10 minutes.", IsEmote: false, Ring: false,
  AllowRelay: true })));
check("a server message box interrupts rather than scrolling past",
  await waitFor("notice", () => seeing(/Scheduled restart in 10 minutes/)));
await clickDialog(/^OK$/);
check("and dismisses", await waitFor("dismissed", async () =>
  !(await seeing(/Scheduled restart/))));

console.log("spectating and ignoring");
await clickText(/^Leave$/);
check("back on the battle list", await waitFor("list", () => seeing(/Host a battle/)));
const specMark = await mark();
await page.getByText(/^Teams 8v8 - all welcome$/).first().click();
await page.getByRole("button", { name: /Spectate/ }).first().click();
check("spectating joins first, then sets the status",
  await waitFor("spec2", async () => (await sentSince(specMark, /^JoinBattle \{"BattleID":11/))
    && (await sentSince(specMark, /^UpdateUserBattleStatus \{.*"IsSpectator":true/))));
/* Wait for the roster: JoinBattleSuccess is a snapshot, so anything pushed
   before it lands is wiped by it. */
check("and lands in that room", await waitFor("room11", () => seeing(/CAI-Brutal/)));

await page.evaluate(() => window.__ZKS.push('IgnoreList {"Ignores":["hexed"]}'));
check("an ignored player's chat disappears", await waitFor("ign", async () => {
  const room = (await text()).split("SPECTATORS")[0];
  return !/^hi$/m.test(room);
}));

console.log("polls");
await page.evaluate(() => window.__ZKS.push('BattlePoll ' + JSON.stringify({
  Topic: "Change map to TartarusV7?", VotesToWin: 3, YesNoVote: true,
  MapSelection: false, NotifyPoll: true })));
check("an open vote is shown", await waitFor("poll", () => seeing(/Change map to TartarusV7/)));
if (SHOTS) await shot("live-poll");
await clickText(/^Yes$/);
check("voting goes to battle chat, which is how autohosts hear it",
  await waitFor("vote", () => sentAny(/^Say \{.*"Place":1.*"Text":"!y"/)));
await page.evaluate(() => window.__ZKS.push('BattlePollOutcome ' + JSON.stringify({
  Topic: "Change map", Message: "Map changed to TartarusV7", Success: true,
  YesNoVote: true, MapSelection: false })));
check("the outcome replaces the open vote", await waitFor("outcome", () => seeing(/Map changed to TartarusV7/)));

console.log("host controls");
await clickText(/Add AI/);
check("adding an AI names us as the owner",
  await waitFor("bot", () => sentAny(/^UpdateBotStatus \{.*"AiLib":"CAI".*"Owner":"Qrow"/)));
/* And names the bot. The server looks Name up in the room's bot dictionary
   without checking it first, so leaving it out threw ArgumentNullException
   server-side and added nothing - with no error the client could see. */
check("and names the bot, which the server will not do for us",
  await sentAny(/^UpdateBotStatus \{.*"Name":"CAI \(\d+\)"/));
await page.getByRole("button", { name: /Remove hexed/ }).first().click();
check("kicking sends the battle and the name",
  await waitFor("kick", () => sentAny(/^KickFromBattle \{.*"Name":"hexed"/)));
/* hexed founded this battle, so the name stays in the header no matter what -
   the roster is the thing that has to change. */
check("the roster reflects the kick", await waitFor("gone", async () =>
  (await page.getByRole("button", { name: /Remove hexed/ }).count()) === 0));

console.log("party");
await page.locator("nav button").nth(2).click();
const inviteBox = page.getByPlaceholder("Invite by name");
await inviteBox.fill("hexed");
await inviteBox.press("Enter");
check("the invite goes out", await waitFor("inv", () => sentAny(/^InviteToParty \{.*"hexed"/)));
check("the party appears once the server confirms it",
  await waitFor("party", () => seeing(/PARTY/) && seeing(/hexed/)));
await page.evaluate(() => window.__ZKS.push('OnPartyInvite ' + JSON.stringify({
  PartyID: 8, UserNames: ["lorelei", "Qrow"], TimeoutSeconds: 20 })));
check("an incoming invite interrupts", await waitFor("pinv", () => seeing(/want you in their party/)));
await clickDialog(/Join party/);
check("the response carries the party id",
  await waitFor("presp", () => sentAny(/^PartyInviteResponse \{"PartyID":8,"Accepted":true\}/)));

console.log("rejoin offer");
await page.evaluate(() => window.__ZKS.push('RejoinOption {"BattleID":13}'));
check("a running game we were in is offered back",
  await waitFor("rejoin", () => seeing(/still in a game/)));
await clickDialog(/^Rejoin$/);
check("taking it asks for connect details",
  await waitFor("rj", () => sentAny(/^RequestConnectSpring \{"BattleID":13/)));

console.log("reconnect");
await page.locator("nav button").nth(0).click();
// The kick test left us in a room; the battle list is behind it.
const leave = page.getByRole("button", { name: /^Leave$/ });
if (await leave.count()) await leave.first().click();
check("back on the battle list before dropping the socket",
  await waitFor("battles", () => seeing(/Host a battle/)));
/* The title appears in the row and again in the detail panel, so the count is
   two to begin with; what matters is that a replay does not add to it. */
const rowsBefore = await page.getByText(/^Teams 8v8 - all welcome$/).count();
await page.evaluate(() => window.__ZKS.drop("reset by peer"));
check("a dropped socket is retried without asking",
  await waitFor("dropped", () => seeing(/Reconnecting - attempt 1/)));
check("and comes back on its own", await waitFor("recon", () => seeing(/Connected/), 15000));
check("a reconnect leaves the room we are no longer in",
  await waitFor("outofroom", () => seeing(/Host a battle/)));
const rowsAfter = await page.getByText(/^Teams 8v8 - all welcome$/).count();
check("and the directory is replayed, not doubled", rowsAfter === rowsBefore,
  `before ${rowsBefore}, after ${rowsAfter}`);

console.log("settings");
await page.locator("nav button").last().click();
check("settings knows who we are and where Zero-K is",
  await waitFor("settings", () => seeing(/Zero-K installation/) && seeing(/Qrow/)));
check("the detected install is shown", await seeing(/steamapps/));
const badMark = await mark();
await page.getByPlaceholder("Leave empty to detect automatically").fill("D:/nonsense");
await page.getByRole("button", { name: /^Apply$/ }).first().click();
check("a path that is not an install says so, rather than failing at the engine",
  await waitFor("badroot", () => seeing(/is not a Zero-K installation/)));
await page.getByPlaceholder("Leave empty to detect automatically").fill("");
await page.getByRole("button", { name: /^Apply$/ }).first().click();
check("clearing the override goes back to detection",
  await waitFor("goodroot", () => seeing(/steamapps/)));
await clickText(/Check launch setup/);
check("the launch preflight resolves an engine without starting a game",
  await waitFor("preview", () => seeing(/Ready to launch/) && seeing(/spring\.exe/)));
check("and names the data dir, which is what a missing map is really about",
  await seeing(/DATA DIR/));

await page.locator("label", { hasText: "Away" }).first().click();
check("away is a status the server is told about",
  await waitFor("afk", () => sentSince(badMark, /^ChangeUserStatus \{"IsAfk":true\}/)));
await shot("live-08-settings");

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

console.log("logging out");
await page.locator("nav button").last().click();
await waitFor("settings", () => seeing(/Zero-K installation/));
await clickText(/^Log out$/);
check("logging out returns to the login screen",
  await waitFor("loggedout", () => seeing(/Steam accounts need a lobby password/)));
check("and remembers the name, which is not a secret", await waitFor("name", async () =>
  (await page.locator("input").first().inputValue()) === "Qrow"));
check("but not the password", await waitFor("pw", async () =>
  (await page.locator("input").nth(1).inputValue()) === ""));

console.log("");
console.log(`${checks - failures.length}/${checks} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
