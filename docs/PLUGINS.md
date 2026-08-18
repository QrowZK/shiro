# Plugins — design and scope

Status: **scoped, not built.** Nothing in this document has been implemented.

The ask, verbatim: *"plugins should add or disable functionality from the client
or link into the game itself."*

That is two features with almost nothing in common, and this document keeps them
apart throughout:

- **Client plugins** (§1–§9) — third-party code that extends or removes Shiro's
  own behaviour and UI. This is a web-platform and Tauri-security problem.
- **Game-side integration** (§10) — reaching into Zero-K itself. This is a
  filesystem problem, a Spring/Recoil-conventions problem, and — mostly — a
  community-politics problem.

Claims marked *verified* were checked on this machine on 2026-08-18 against the
sources named in §13. Claims marked **unverified** are exactly that. Where I
formed an opinion without evidence I say so rather than dressing it up.

---

## 0. The short version

Five things came out of the research that change what this feature should be.

1. **The CSP forbids every dynamic-code plugin mechanism, and that includes
   WebAssembly.** I served a probe page under the *exact* packaged policy from
   `src-tauri/tauri.conf.json:26` and measured it (§2). `eval`, `new Function`,
   `WebAssembly.compile`, `blob:` imports and `data:` imports are all blocked.
   WASM needing a CSP relaxation surprised me and it kills the "WASM is the safe
   sandboxed option" story before it starts.

   The one thing that *does* work is boring: **a real `.js` file served from a
   second local origin, with that origin added to `script-src`.** Also measured,
   also §2.

2. **Tauri's capability system does not gate Shiro's own commands today, and
   cannot be made to gate plugins even if we add an app ACL.** Verified from
   `tauri` 2.11.5 source (§7.2). Capabilities are scoped to *windows and
   webviews*, not to callers. A plugin sharing the main webview inherits every
   permission the app has, by construction. The brief's framing — "a plugin
   wanting filesystem or process access is a capability question" — is, I think,
   wrong in an important way: it is a capability question only if the plugin
   lives in its own webview.

3. **A plugin in the main origin can steal the user's password and open an
   arbitrary TCP socket, and the CSP does not slow it down at all.** The saved
   password sits in `localStorage` in plaintext (`src/store/settings.ts:52-60`),
   and `zks_connect` will dial any host:port with no allowlist
   (`src-tauri/src/relay.rs:85`). `connect-src 'self' ipc: http://ipc.localhost`
   governs `fetch`/`WebSocket` and is completely bypassed by the Rust relay.
   §7.1 lists the full damage. This is not a reason to abandon plugins. It is a
   reason to state the trust model out loud instead of implying one that does
   not exist.

4. **"Disable functionality" is a refactor, not a plugin feature.** You cannot
   switch off a part of the client that is not a part. `src/App.jsx` is a
   548-line component with a hardcoded `if/else` view chain and eight static
   screen imports; `NAV` is a literal array in `src/screens/AppShell.jsx:6-12`;
   every feature store calls `registerSlice(...)` at module load and throws away
   the unsubscribe function it is handed. §5 breaks "disable" into three tiers
   with wildly different costs.

5. **"Link into the game" has one good reading and several bad ones.**
   `<ZK writedir>\LuaUI\Widgets\*.lua` is a real hook and is *already enabled* on
   this machine (`useLocalWidgetsFirst = true`). But the obvious-looking channel
   — stuffing data into `script.txt` — is not available to us, because **Shiro
   never hosts**: we write an eight-line connect script and the host sends the
   real one. §10 lists the readings I rejected and why.

**Recommendation in one line:** ship trusted, local-only, same-origin ES-module
plugins with a small declared extension surface; say plainly in the UI that a
plugin can do anything you can do; do not build a registry; and do not ship
game-side widget management until a Zero-K developer has said it is acceptable.

---

## 1. The two features, separated

| | Client plugins | Game-side integration |
|---|---|---|
| Runs where | Shiro's webview (or a child webview) | inside `spring.exe`, as Lua |
| Language | JavaScript / TypeScript | Lua 5.1 (Spring's dialect) |
| Written by | the plugin author | the plugin author, but *loaded by the engine*, not by us |
| Our job | load it, give it an API, contain the damage | put a file in the right folder, edit a config table, get out of the way |
| Blocked by | the CSP, the trust model | community consent and anti-cheat norms |
| Can be built now | yes | technically yes, politically no (§10.6) |

They share nothing but the word "plugin" and, possibly, a manifest format. A
single plugin package *could* carry both a `main.js` and a `widgets/*.lua`, and
§10.4 assumes it does — but the two halves are independently useful and should
be scheduled independently.

---

## 2. What the CSP actually permits — measured, not assumed

The packaged policy, verbatim from `src-tauri/tauri.conf.json:26`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data: https://zero-k.info;
connect-src 'self' ipc: http://ipc.localhost; object-src 'none';
frame-src 'none'; base-uri 'self'
```

I did not reason about this. I served a probe page with that exact header and
ran the operations a plugin loader might use. Method in §13; reproduce it in ten
minutes.

### 2.1 Results under the policy as shipped (verified)

| Operation | Result |
|---|---|
| `eval("1+1")` | **blocked** — `EvalError`, `'unsafe-eval' is not an allowed source` |
| `new Function("…")` | **blocked** — same |
| `new WebAssembly.Module(bytes)` | **blocked** — `CompileError`, *"Compiling or instantiating WebAssembly module violates the following Content Security policy directive"* |
| `WebAssembly.compile(bytes)` | **blocked** — same |
| `WebAssembly.validate(bytes)` | allowed (it does not compile) |
| `import(blobURL)` | **blocked** |
| `import("data:text/javascript,…")` | **blocked** — CSP violation logged against `script-src 'self'` |
| `import("./sameorigin.js")` | **allowed** |
| `import("http://plugin.localhost/foo.js")` | **blocked** — CSP violation logged against `script-src 'self'`, *not* a network error |

That last row matters: I confirmed from the console that the failure was the
policy, not DNS. The `TypeError: Failed to fetch dynamically imported module`
that JavaScript sees is misleading; the real message is in the console.

**The WASM result is the headline.** Chromium requires `'wasm-unsafe-eval'` (or
`'unsafe-eval'`) in `script-src` to compile a module, and `script-src 'self'`
supplies neither. A WASM plugin system therefore does *not* dodge the CSP — it
needs a directive added, exactly like a JS one, and it buys a far worse
developer experience for it (§3.3).

### 2.2 Results with one origin added (verified)

I re-ran with `script-src 'self' http://plugin.localhost:1472` and
`frame-src http://plugin.localhost:1472`, everything else unchanged:

| Operation | Result |
|---|---|
| `import("http://plugin.localhost:1472/mod.js")` | **allowed**, module evaluated |
| iframe from that origin | **loads** |
| inside that frame: `localStorage.getItem("shiro.settings")` | `null` — separate storage partition |
| inside that frame: `"__TAURI_INTERNALS__" in window` | `false` |
| inside that frame: `parent.location.href` | `SecurityError` |
| inside that frame: `eval("1+1")` | `EvalError` — the frame gets its own CSP, which we serve |

So the shape of the whole design falls out of two rows of a table. A second
local origin is enough to load plugin code; putting that origin in a *frame*
rather than the main document is enough to isolate it — and, crucially, the
frame does not get Tauri's IPC bridge, which I also confirmed from source (§7.3).

### 2.3 What this rules out, plainly

- **Plugins as source strings** compiled at runtime. Dead. Would need
  `'unsafe-eval'`, which re-enables string-to-code for *everything* in the app —
  including anything a future XSS finds. Not worth it for a feature.
- **Plugins loaded over the network.** Dead unless a remote origin joins
  `script-src`, which is strictly worse than `'unsafe-eval'`: it makes the app's
  integrity depend on a web server staying uncompromised. §9.
- **WASM as a "safe by default" answer.** Dead as stated; it needs
  `'wasm-unsafe-eval'` (§3.3).
- **Tauri's isolation pattern** as a mitigation. It works by injecting an
  iframe, and `frame-src 'none'` forbids frames outright. Adopting it means
  changing the CSP anyway. (I did not evaluate it further — it protects against
  a compromised frontend calling IPC, which is close to our threat, but it
  intercepts *all* IPC rather than per-caller. **Unverified** whether it can
  distinguish plugin callers; I suspect not, for the same reason capabilities
  cannot.)

### 2.4 What changing the CSP costs us

Adding one local origin to `script-src` and `frame-src` is a genuinely small
concession: it does not enable string evaluation, it does not reach the network,
and the origin resolves to a handler we write. It is a much smaller change than
`'unsafe-eval'` and not comparable to a remote host.

Two operational notes:

- On Windows a Tauri custom scheme is served at `http://<scheme>.localhost`; on
  Linux and macOS it is `<scheme>://localhost`. Both spellings must appear in
  the CSP. This is exactly what Tauri documents for its own asset protocol —
  `node_modules/@tauri-apps/api/core.js:206-207` says so verbatim — and the
  repo's own `connect-src 'self' ipc: http://ipc.localhost` is the same pattern
  already in use.
- `npm run serve:csp` (`tools/e2e/serve-csp.mjs`) reads the policy straight out
  of `tauri.conf.json`, so any CSP change is regression-tested by the existing
  e2e suite for free. Whatever we do here, do it in `tauri.conf.json` and let
  that script catch it. The one thing it cannot check is the `ipc:` scheme, and
  it will not be able to check the plugin scheme either — that only exists
  inside Tauri.

---

## 3. What a plugin *is* — four candidate answers

### 3.1 Option A — build-time modules

Plugins are TypeScript files in the repo, compiled into the bundle, toggled by a
setting.

Zero CSP change, zero new trust surface, full type checking, and the extension
points still have to be built. But nobody can install one without rebuilding the
app, so this is not plugins — it is a feature-flag system.

**Worth naming because it is a real option for the first milestone.** If the
honest goal is "make the client modular" rather than "let strangers ship code",
this delivers the modularity at a fraction of the cost and can be upgraded to
Option B later without rework, because the extension points are the same. §5's
decomposition work is required for it regardless.

### 3.2 Option B — an ES module from a plugin origin — **recommended**

A plugin is a directory under the app data dir:

```
%APPDATA%\info.zero-k.shiro\plugins\<id>\
    plugin.json      manifest: id, name, version, entry, apiVersion, contributes[]
    main.js          a plain ES module, no build step required
    ...              css, images, and (§10) widgets/*.lua
```

Rust registers a `plugin` URI scheme (`Builder::register_uri_scheme_protocol` /
`register_asynchronous_uri_scheme_protocol`, present in `tauri` 2.11.5 at
`src/app.rs:2130` and `:2198`). The handler maps
`http://plugin.localhost/<id>/<path>` to that directory, with the usual
containment checks: canonicalise, refuse anything that escapes the plugin root,
refuse symlinks, serve only an extension allowlist, and set `Content-Type:
text/javascript` explicitly so the module loads.

The frontend then does `await import(\`http://plugin.localhost/${id}/main.js\`)`
and calls the module's default export with a host API object.

Why this and not the others:

- It is the only option that works with a one-origin CSP change (§2.2, measured).
- Plugin authors write plain ES modules. No bundler, no toolchain, no WASM
  target. `import` of a relative path inside the plugin works because the
  plugin's own files are same-origin *to each other*.
- The loader is ~150 lines of Rust and ~200 of TypeScript.
- It upgrades to a sandbox (§7.4) by changing where the module is loaded, not by
  changing what a plugin is.

Three things about it that are worth knowing before committing:

- **All plugins share one origin.** A Tauri scheme maps to one subdomain, so
  `http://plugin.localhost/a/` and `/b/` are the same origin. Plugins are not
  isolated from each other and share `localStorage` on that origin. Per-plugin
  origins would need a fixed pool of pre-registered schemes (`plugin0`,
  `plugin1`, …), which is ugly enough that I would not do it.
- **Unverified:** whether Tauri overrides the `Content-Security-Policy` header
  our protocol handler sets on its responses. This matters only for the frame
  variant (§7.4), where we want to serve the plugin frame a *stricter* policy
  than the main document's. Check before relying on it.
- **Unverified:** whether WebView2 caches custom-protocol responses across a
  reload. If it does, "reload plugins" needs a cache-busting query parameter.

### 3.3 Option C — WASM

A plugin is a `.wasm` module with a defined import/export interface.

Superficially attractive: memory-safe, no DOM access by default, easy to
resource-limit. All of that is true and none of it survives contact with §2.1.

- **It needs a CSP change too.** `'wasm-unsafe-eval'` in `script-src`. Verified
  blocked without it. So the "WASM avoids touching the CSP" argument is false.
- **No DOM access is a cost, not a benefit, for a UI plugin.** Every UI plugin
  needs a JS glue layer, and that glue layer runs in the main origin with full
  privileges — so the security win evaporates unless the glue is itself
  restricted to a declarative vocabulary, at which point Option D is simpler.
- **The toolchain excludes the audience.** Zero-K widget authors write Lua. The
  overlap between "wants to write a lobby plugin" and "will set up a Rust or
  AssemblyScript build" is small.

`'wasm-unsafe-eval'` is genuinely narrower than `'unsafe-eval'` — it does not
re-enable string-to-JS. If a future feature needs WASM for its own sake (an
in-app replay parser, say), adding that one keyword is defensible. It is just
not a plugin architecture.

### 3.4 Option D — declarative manifest, no code at all

A plugin is a JSON manifest describing reactions from a fixed vocabulary: "when
`Say` matches this regex in this channel, show a notification"; "add a nav entry
that opens this URL in the browser"; "hide the Planet Wars button"; "colour
users in this list".

No script execution, so no CSP change, no trust problem, no sandbox, and no
update-integrity problem worth the name. Malicious input is bounded by the
vocabulary.

It is also, obviously, much less powerful, and the failure mode is a slow
accretion of vocabulary until it is a bad programming language.

**I do not recommend it as the design, but I do recommend it as the shape of the
`contributes` block inside Option B's manifest.** Everything a plugin declares
statically — nav entries, settings sections, which panels it wants, which
commands it listens to — should live in `plugin.json` and be readable *before*
any code runs. That gives the Plugins screen something honest to show the user
at install time, and it lets the host skip loading a plugin's code entirely
until one of its surfaces is actually reached.

### 3.5 Decision table

| | A: build-time | B: ES module | C: WASM | D: declarative |
|---|---|---|---|---|
| CSP change needed | none | one local origin | `'wasm-unsafe-eval'` | none |
| Installable by a user | no | yes | yes | yes |
| Can build UI | yes | yes | only via JS glue | fixed vocabulary |
| Author toolchain | our repo | none | Rust/AS + build | text editor |
| Trust required | ours | **total** | total (via glue) | none |
| Loader cost | ~1 d | ~3 d | ~5 d | ~2 d |

---

## 4. Extension points, against this codebase

Concrete, with the file that has to change. Cheap means "the seam exists".

### 4.1 Inbound message interception — **cheap, the seam already exists**

`src/store/slices.ts` is the closest thing to a plugin API in the repo today.
Every feature store registers a `(messages: Message[]) => void` at module load
(`chat.ts:511`, `room.ts:295`, `game.ts:169`, `matchmaker.ts:182`,
`party.ts:126`, `friends.ts:108`, `history.ts:194`, `site.ts:97`), and
`src/net/session.ts:44` calls `fanout()` once per animation frame with the same
batch the core store gets.

A plugin subscription is literally `registerSlice`. It already returns an
unsubscribe function (`slices.ts:24-27`) and it already isolates a throwing
subscriber (`slices.ts:30-38`) — which is the exact failure-isolation precedent
§6.5 needs.

Two things to add rather than change:

- **Filtering.** Handing plugins every message including `Say` in DMs is a
  privacy decision, not a convenience one. Prefer `onMessage(cmd, handler)` over
  a raw firehose, so the manifest can declare which of the 76 commands
  (`src/protocol/registry.ts`) a plugin sees and the Plugins screen can show it.
- **Ordering and mutation.** `fanout` iterates a `Set` in insertion order and
  ignores return values. Keep it that way: plugins observe, they do not mutate
  the batch. A plugin that can rewrite an inbound message can make the roster
  lie, and debugging that is nobody's idea of a good time.

### 4.2 Outbound interception — **medium, the seam does not exist**

There is no single outbound choke point. `src/net/session.ts:55` (`send`) is the
typed one, but `login` (`:158`), `register` (`:205`) and `say` (`:247`) each call
`sendLine` directly, and `sendLine` itself (`src/net/connection.ts:19`) is
importable by anyone.

Introducing a real choke point is a small, self-contained refactor and is worth
doing on its own merits. But note that a *veto* hook ("a plugin can cancel an
outgoing command") is a different and much larger commitment: it makes every
protocol interaction conditional on third-party code, and the failure mode is a
lobby that silently does not join battles.

Recommendation: **observation only** in v1. `onSend(cmd, data)` for logging and
UI, no cancellation.

### 4.3 Nav entries — **cheap**

`NAV` is a literal array at `src/screens/AppShell.jsx:6-12`, consumed by
`NavRail` at `:38`. Making it a parameter and concatenating plugin entries is an
hour. The icon is the constraint, not the array: `src/ds/icons.js` names the 31
lucide icons the bundle keeps and `npm test` fails if that list drifts
(`npm run check:icons`). A plugin cannot pick an arbitrary lucide name.

Options: restrict plugins to the existing 31 icons, or let a plugin ship an SVG
served from its own origin (`img-src` would need the plugin origin adding, a
third directive). I would start with the 31.

### 4.4 UI slots — **invasive**

There are no slots. Every screen is a self-contained component taking props from
`App.jsx`, and `App.jsx` is a 548-line `if/else` chain (`:331-434`). Adding
`<Slot id="battle-room.sidebar" />` to `BattleRoomScreen.jsx` (272 lines) is easy
per site; agreeing on which sites, and keeping them stable across the redesigns
this UI will still get, is the expensive part.

Start with the smallest set that is obviously useful and unlikely to move:

| Slot | Where | Why it survives a redesign |
|---|---|---|
| `statusbar.right` | `AppShell.jsx:76` | already a row of small indicators |
| `settings.section` | `SettingsScreen.jsx` | a settings screen is a list of sections by definition |
| `nav.entry` + a full-screen view | `AppShell.jsx:6-12` | the rail is the app's spine |
| `battleroom.aside` | `BattleRoomScreen.jsx` | the densest screen; the one people will want to annotate |

Everything a plugin renders into a slot must be React elements built from the
host's React, not the plugin's — pass `React` and the design system in through
the host API rather than letting the plugin bundle its own copies. Two Reacts in
one page is a class of bug nobody should have to debug in a game lobby.

### 4.5 Settings sections — **cheap**

`SettingsScreen.jsx` is 178 lines of primitives with no design behind it (README
"Status"). Adding a "Plugins" section and per-plugin sub-sections is
uncontroversial precisely because there is no design to violate.

### 4.6 Launch hooks — **medium, and the phase machine is moving**

`src/store/game.ts` drives the launch off the *arrival* of `ConnectSpring`
(`:71`), never off the button. Anything a plugin does here sits between that
arrival and `launch()`. Useful hooks: `beforeLaunch(connect)` (last chance to
write a widget, §10), `onGameExited(code)`.

Caveat: `docs/DOWNLOADS.md §2.3` proposes inserting `preflight` and `downloading`
phases into exactly this state machine, and there is uncommitted work in the
tree touching `store/game.ts` right now. **Do not design plugin launch hooks
until that phase machine settles.**

A blocking `beforeLaunch` is tempting and dangerous: a plugin that hangs there
makes the client miss a match start. If it exists at all it needs a hard timeout
measured in a couple of seconds, after which the launch proceeds and the plugin
is reported as misbehaving.

### 4.7 Summary

| Point | Cost | Notes |
|---|---|---|
| inbound messages | cheap | `slices.ts` already does it |
| store reads | cheap | zustand stores are already exported |
| settings section | cheap | no design to break |
| nav entry | cheap | icon set is the real constraint |
| status-bar item | cheap | |
| outbound observation | medium | needs one choke point |
| launch hooks | medium | blocked on the phase-machine work |
| UI slots in screens | invasive | needs slot points and a stable contract |
| replacing a core screen | invasive | needs §5 |
| disabling core features | invasive | needs §5 |

---

## 5. Disabling functionality — the hard half

Adding is easy because you can bolt things on. Disabling requires that the thing
you want to remove *is a thing*, and mostly it is not. Three tiers, escalating.

### Tier 1 — hide it

Remove the nav entry, refuse the route. The store still loads, still subscribes
to `fanout`, still holds state.

Honest description: cosmetic. Perfectly adequate for "I never use Planet Wars,
get it off my rail". Requires `NAV` to be data (§4.3) and `App.jsx`'s view chain
to consult a feature registry. **~1 day.**

### Tier 2 — stop processing it

Additionally unregister the feature's slice so it stops consuming messages, and
reset its store.

The mechanism already exists and is already being discarded: `registerSlice`
returns an unsubscribe (`slices.ts:23-28`) and **all eight call sites ignore the
return value**. Each store keeping its handle and exposing a `disable()` is a
one-line change per store.

This tier is where "disable" starts to mean something — a disabled chat store
stops accumulating scrollback, a disabled history store stops building
debriefings. **~2 days**, most of it in tests proving that re-enabling
resubscribes cleanly and that a store which missed messages while disabled
recovers on the next reconnect (`session.ts:91-94` already resets the directory
on reconnect, which does most of that work).

### Tier 3 — never load it

The feature's module is never imported, so its code is not in memory and ideally
not in the bundle.

This is the expensive one and it is a real refactor of `App.jsx`:

- Eight screens are statically imported at `App.jsx:6-17`. They would become
  dynamic imports behind a registry.
- The `if/else` view chain (`:331-434`) becomes a lookup.
- Roughly 40 `useX(s => s.y)` selector calls at the top of `App()` are
  unconditional hook calls; they cannot become conditional without violating the
  rules of hooks. Each feature's props have to move into that feature's own
  component.
- Feature stores create themselves at module load, so "not imported" is the only
  way to not run them.

**~4 days**, and it is the only tier that reduces bundle size. It is also, not
coincidentally, the refactor that makes Option A (§3.1) work and makes UI slots
tractable. If plugins are going to happen at all, this is the work that pays for
itself elsewhere.

### 5.1 What a plugin may disable

Distinguish three cases, because they carry different support costs:

1. **Disabling itself / another plugin.** Fine. Plugin manager territory.
2. **Disabling a core feature the user does not want.** Fine, with the caveat
   below.
3. **A plugin silently disabling core so it can replace it.** This is where the
   support burden lands. A user reports "chat is broken" and it is a plugin.

Mitigations, all cheap and all worth doing:

- The manifest must **declare** every core feature it disables. Show the list at
  install time and in the Plugins screen. Nothing is disabled that is not
  declared.
- The Plugins screen shows, per disabled core feature, *which* plugin disabled
  it — so the answer to "where did chat go" is one click away.
- **Safe mode**: a startup path that loads no plugins. Reachable from a command
  line flag *and* from the UI, and entered automatically if the previous run
  failed during plugin load. This is the single highest-value item in the whole
  feature for anyone who will have to support it.

---

## 6. Lifecycle

### 6.1 Discovery

Scan `%APPDATA%\info.zero-k.shiro\plugins\*\plugin.json` at startup, in Rust.
Return the parsed manifests to the frontend; do not load code yet. A manifest
that fails to parse is reported in the Plugins screen and skipped — never
throws, never blocks startup.

Reserve a second location for plugins shipped with the app (a `bundled/` dir in
resources) so a first-party example plugin can exist without an install step.

### 6.2 Load

For each enabled plugin, in manifest-declared order (default: id order —
alphabetical is arbitrary but it is *stable*, and stable beats clever):

```
import(`http://plugin.localhost/${id}/${entry}`)
  -> module.default({ api })    // activate
```

Each import and each `activate()` is individually try/caught. A plugin that
throws is marked `failed` with the error, its registrations are rolled back, and
the app continues. This is exactly the discipline `slices.ts:30-38` already
applies to store slices and `src/ErrorBoundary.jsx` applies to rendering.

The host API object handed to `activate` is per-plugin, so every registration
can be attributed and rolled back:

```ts
interface PluginApi {
  id: string;
  onMessage(cmd: CommandName, fn: (m: Message) => void): Unregister;
  addNavEntry(entry: NavEntry): Unregister;
  addSettingsSection(node: () => ReactNode): Unregister;
  addSlot(slot: SlotId, node: () => ReactNode): Unregister;
  storage: { get(k): unknown; set(k, v): void };   // namespaced, not localStorage
  log(...args: unknown[]): void;                    // prefixed, shown in the UI
  ds: typeof import("../ds/shiro.js");              // frozen re-export, §8
  react: typeof React;
}
```

`activate` returning a `deactivate` function is the clean way to handle
teardown; the host must also work when it does not, by unwinding the
registrations it handed out.

### 6.3 Enable / disable

Persisted per plugin id. `src/store/settings.ts` writes a single JSON blob to
`localStorage` under `shiro.settings` and is the obvious home, but see §7.1 —
that key also holds the saved password, and a plugin sharing the origin can read
it. Plugin enablement should go in a **separate** key at minimum, and ideally
this is the moment the saved password moves out of `localStorage` entirely.

Disable must be immediate and must not require a restart: call `deactivate`,
unwind registrations, drop the module reference. The module itself stays in the
webview's module map — ES modules are not unloadable — so "disabled" means "no
longer registered", not "no longer resident". Say so in the UI if anyone asks.

Enabling a previously-loaded-then-disabled plugin re-imports the same URL and
gets the cached module, so `activate` must be safe to call twice. Document that.

### 6.4 Update and uninstall

- **Update**: replace the directory, then reload plugins. Because ES modules are
  cached by URL, an in-place update needs either a full webview reload or a
  version-stamped URL (`main.js?v=1.2.0` from the manifest). Prefer the version
  stamp; a webview reload tears down the TS state while the Rust socket lives
  on, which `docs/ARCHITECTURE.md §4` already flags as a re-login.
- **Uninstall**: deactivate, then delete the directory from Rust. Offer to keep
  the plugin's namespaced storage, because uninstall-to-fix-something is common
  and losing config to it is infuriating.
- **No auto-update in v1.** Auto-updating third-party code inside a signed
  binary is a much bigger promise than it looks (§7.5, §9).

### 6.5 When a plugin throws

| Where | What happens | Precedent |
|---|---|---|
| import / `activate` | marked failed, registrations rolled back, app fine | new |
| a message handler | caught per-call, logged, plugin flagged after N throws | `slices.ts:30-38` |
| rendering a slot | slot's own `ErrorBoundary`, renders nothing, plugin flagged | `ErrorBoundary.jsx` |
| an async promise | `unhandledrejection` listener attributes by stack — **best effort, will sometimes misattribute** | new |
| an infinite loop | **nothing stops it.** The webview is single-threaded. | — |

That last row is not fixable in-origin. It is one of the better arguments for
the frame sandbox (§7.4), where a wedged plugin frame can be destroyed.

"Flagged after N throws" should mean *disabled with an explanation*, not
silently ignored. A plugin throwing on every batch at 60 Hz will otherwise fill
the console and mask real errors.

---

## 7. Security and trust — the crux

### 7.1 What a malicious plugin can do under the recommended design

Under Option B as described, a plugin runs in the main webview's JavaScript
context. Being on a different *origin* for module-loading purposes does not
change that: once the module is imported into the main document, it shares that
document's globals, DOM and IPC bridge.

So, concretely, with file references:

1. **Read the user's password.** `src/store/settings.ts:52-60` writes
   `{name, remember, host, port, installRoot, password}` to `localStorage` under
   `shiro.settings`, and the module comment (`:10-14`) is explicit that it stores
   the *plain password*, not the hash. `localStorage.getItem("shiro.settings")`
   is one line. I demonstrated the read in the probe (§2.2) against exactly that
   key shape.
2. **Exfiltrate it, bypassing `connect-src` completely.**
   `invoke("zks_connect", {host, port})` reaches
   `src-tauri/src/relay.rs:72-88`, which does `TcpStream::connect((host, port))`
   with **no allowlist of any kind**. `invoke("zks_send", {line})` then writes
   arbitrary bytes to it. The CSP's `connect-src 'self' ipc:
   http://ipc.localhost` constrains `fetch`/`XHR`/`WebSocket` and is simply not
   in the path. A plugin has an unrestricted outbound TCP socket.
3. **Act as the user on the lobby server.** Any of the 76 commands in
   `src/protocol/registry.ts`: `Say` (spam, scams, getting the account banned),
   `SetAccountRelation`, `UserReport`, `LeaveBattle`, `Register`.
4. **Run an arbitrary executable.** This one deserves care.
   `zks_locate_install` (`launch.rs:182`) accepts a caller-supplied `root` and
   validates it only with `install::looks_like_zk_root` — `engine/` exists *and*
   one of `games/`, `pool/`, `packages/` exists (`install.rs:27-30`). It then
   *remembers* that root (`launch.rs:185-187`). A subsequent
   `zks_launch_spring` resolves `engine/win64/<version>/spring.exe` under it
   (`install.rs:183-190`) and spawns it (`launch.rs:253-259`). A directory the
   attacker prepared — any binary renamed `spring.exe`, an empty `games/` — is
   accepted. **This is not a bug today**, because only our own code calls these.
   It becomes arbitrary code execution the moment third-party JS shares the
   origin, and it is the clearest example of why "we already have these commands"
   is not the same as "these commands are safe to expose".
5. **Write into the Zero-K install.** The in-flight `zks_write_engine_settings`
   (`src/net/engineSettings.ts:51`, `src-tauri/src/engine_settings.rs`) patches
   `springsettings.cfg`. Whatever §10 adds for widgets extends this.
6. **Phish.** Replace the login screen's DOM, or patch `App.jsx`'s handlers
   through the shared React, and collect credentials directly. There is no
   integrity check on the rendered UI.
7. **Lie about anything.** Rewrite roster, Elo, chat. §4.1 recommends
   observe-only message handling for this reason, but a plugin with DOM access
   does not need the message path to lie.

**Under this design, a plugin is fully trusted code, equivalent to running an
arbitrary program as the user.** That is the honest statement and it belongs in
the UI, not just in this document.

### 7.2 Tauri capabilities do not help — and this is a finding, not an opinion

The brief's framing is that filesystem or process access is "a capability
question". Reading the source, I do not think it is, and the reason is worth
recording.

`src-tauri/capabilities/default.json` lists `core:default` plus four window
permissions, scoped to `windows: ["main"]`. Shiro's own seven commands
(`zks_connect`, `zks_send`, `zks_disconnect`, `zks_password_hash`,
`zks_locate_install`, `zks_launch_spring`, `zks_launch_preview`, plus the two
new engine-settings ones) appear nowhere.

From `tauri` 2.11.5, `src/webview/mod.rs:1818-1826`, comment verbatim in the
source:

```rust
// Check ACL on plugin commands, when the app defined its ACL manifest,
// or when the request comes from a non-local (remote) origin.
if (plugin_command.is_some() || has_app_acl_manifest || !is_local)
  && request.cmd != FETCH_CHANNEL_DATA_COMMAND
  && invoke.acl.is_none()
{ /* reject */ }
```

An app command (no `plugin:` prefix), from a local origin, in an app with no
app-level ACL manifest, skips the check entirely. Shiro has no app ACL manifest,
so **every `zks_*` command is callable by any script in the webview today.**
(The mirror of this is in `tauri-macros` 2.6.3, `src/command/handler.rs:104-105`:
*"All application commands are allowed if we don't have an application ACL"*.)

We could add one — Tauri v2 supports app-level permissions in
`src-tauri/permissions/*.toml` referenced from a capability. It would not solve
this problem. **Capabilities are scoped to windows and webviews, not to
callers.** A plugin sharing the main webview is indistinguishable, at the ACL
layer, from `App.jsx`. Adding an app ACL is still worth doing as
defence-in-depth and documentation of intent — but not as a plugin sandbox.

The only way to make capabilities meaningful for plugins is to put plugins in a
**different webview**, which is §7.4.

### 7.3 The one real sandbox primitive we have

Tauri injects its IPC bootstrap into the **main frame only**. From `tauri`
2.11.5, `src/manager/webview.rs:159-163`, every bootstrap script is wrapped in
`main_frame_script()` with `for_main_frame_only: true`, including
`invoke_initialization_script` (`:182`).

I confirmed the consequence empirically (§2.2): a cross-origin iframe reports
`"__TAURI_INTERNALS__" in window === false`, cannot read the host's
`localStorage`, throws `SecurityError` on `parent.location`, and is governed by
whatever CSP we serve it (my test frame could not `eval`).

So a plugin frame genuinely cannot invoke Tauri commands. It has to ask the host
to, over `postMessage` — and that is a chokepoint we control and can gate per
plugin.

### 7.4 The sandbox option, honestly costed

Plugins load into a hidden iframe at the plugin origin. Their UI contributions
render into that frame (or are described declaratively and rendered by the
host). All host API calls are `postMessage` RPC, mediated by a broker in the
main document that checks the plugin's declared permissions before touching
`invoke`.

What it buys: no password access, no direct `invoke`, no DOM tampering, no
design-system tampering, and a wedged plugin can be killed by destroying the
frame — which is the only answer to §6.5's infinite-loop row.

What it costs:

- Every API becomes async and serializable. UI contributions can no longer be
  React elements passed by reference.
- Either plugin UI renders inside the frame (and you inherit the layout,
  z-index, focus and scroll problems of embedding a frame in a dense desktop UI)
  or it becomes a declarative description the host renders (§3.4's vocabulary,
  with all its limits).
- `frame-src` must open up; `frame-ancestors` should be set on the plugin
  responses; the plugin frame needs its own CSP served by our handler
  (**unverified** that Tauri does not override it — §3.2).
- A permission model, permission prompts, and the UX around them — the part of
  every plugin system that is never finished.
- **~5 engineer-days on top of the unsandboxed loader**, and it makes the plugin
  API meaningfully worse to write against.

### 7.5 Code signing and SmartScreen

`docs/ARCHITECTURE.md §11` commits to Authenticode signing, and is right that for
*"a third-party game client that asks for your account password"* an unsigned
installer is not a cosmetic problem.

Executing third-party code inside that signed binary has three consequences:

1. **The signature stops meaning what people think it means.** It attests that
   Shiro's binary is ours and unmodified. It says nothing about the plugin that
   just read the user's password. If a plugin is used for a mass credential
   theft, the incident will be reported as "the signed Shiro client stole
   passwords". That reputational cost lands on the certificate.
2. **Reputation is per-binary and behavioural.** ARCHITECTURE §11 notes OV
   certificates accumulate SmartScreen reputation over download volume. A signed
   binary that starts loading arbitrary local scripts and spawning processes is
   the behaviour profile of a loader. **Unverified** whether this actually
   affects SmartScreen or AV heuristics in practice — I could not test it and I
   would not guess. But the Rust binary already opens sockets and spawns child
   processes, which ARCHITECTURE §11 flags as an AV false-positive risk on its
   own; plugins do not improve that.
3. **The updater is a separate key.** Tauri's updater signs artifacts with
   minisign, independent of Authenticode (ARCHITECTURE §11). If plugins ever get
   auto-update, that is a *third* trust root, and it is one we would be
   operating. §9.

### 7.6 The recommended position

**Plugins are trusted code. Say it, in the UI, at install time.**

Install is a deliberate act: the user puts a folder in a directory, or clicks
through a dialog that says, in plain words, *"A plugin can do anything you can
do in Shiro, including reading your saved password and sending messages as you.
Only install plugins from people you trust."* No security theatre, no permission
checkboxes that do not check anything.

Alongside that, four things that cost almost nothing and are worth doing anyway:

- **Move the saved password out of `localStorage`.** It should not be sitting in
  a web storage API in a client that is about to run other people's JavaScript.
  Rust-side storage behind a command, or the OS credential store. This is
  arguably worth doing regardless of whether plugins ever ship.
- **Add an app-level ACL** so `zks_*` commands are explicitly allowlisted rather
  than allowed by the absence of a manifest (§7.2). It does not sandbox
  plugins; it makes the intent auditable and stops a future capability change
  silently widening the surface.
- **Validate `zks_locate_install`'s override harder** (§7.1 item 4) — at minimum
  refuse a root that is not under a plausible install location, and verify the
  engine binary's signature or a known hash before spawning. Independently
  worthwhile.
- **Safe mode** (§5.1).

If, later, the community actually ships plugins and one of them misbehaves, §7.4
is the escalation and it is designed for from day one by keeping every host API
call serializable.

---

## 8. Not breaking the design system

`src/ds/shiro.js` is generated from the Claude Design bundle, must not be
hand-edited, and carries three hand-applied patches that must be re-applied
after any re-sync (README "Vendor patches"). One of them exists because a
document-wide `lucide.createIcons()` blanked the window.

Relevant facts:

- The bundle installs itself as a **global**: `window.ShiroDesignSystem_0f4b7d`
  (`shiro.js:65`), and also sets `window.React` (`:14`) and `window.lucide`
  (`:60`).
- Its icon shim mutates the DOM in place and keys off `data-lucide-drawn`
  (`:35-56`).

So a same-origin plugin can trivially break the design system — reassign
`window.lucide.createIcons` to lucide's real one and you reproduce the
window-blanking `removeChild` crash the patch exists to prevent.

What to do:

1. **Hand plugins a frozen re-export**, not the global:
   `Object.freeze({...components})` on the `api.ds` property. This stops
   accidents, which are the common case. It does not stop a hostile plugin,
   which can reach the global directly — under §7.6's trust model that is
   accepted and stated.
2. **Never let a plugin's CSS be global.** Plugin stylesheets, if allowed at
   all, should be scoped. Note `style-src 'unsafe-inline'` is already required
   because the DS styles every element with a `style` attribute (README
   "Content security policy"), so plugins inherit that permission and can style
   anything — another reason UI contributions are better constrained to slots.
3. **Version the DS surface in the manifest** (`apiVersion`). The design system
   is re-synced from an external project; when a component's props change,
   plugins break, and a declared API version is how the Plugins screen says
   *"this plugin was written for API 1 and Shiro is on API 2"* instead of
   throwing.
4. **Add a smoke test** that a plugin cannot be loaded before the DS is
   initialised — the module-load-order bug this would cause is exactly the kind
   that shows up as a blank window from an installer.

---

## 9. Distribution

### 9.1 Where plugins come from

Three levels, and I would ship only the first.

1. **A folder.** The Plugins screen has an "Open plugins folder" button; the
   user drops a directory in and hits reload. Zero infrastructure. Distribution
   is a Zip on the Zero-K forums, which is exactly how Spring widgets have been
   distributed for fifteen years and what this audience already knows how to do.
2. **Install-from-URL.** A dialog takes a URL, Rust downloads and unpacks it.
   Needs the download pipeline `docs/DOWNLOADS.md` is already designing for
   content, plus archive extraction, plus a hard decision about what a `.zip`
   from the internet is allowed to write. Adds a real attack surface (a
   malicious link in chat becomes an install prompt) for a modest convenience.
3. **A registry.** An index we host, listing plugins with versions and hashes.

### 9.2 Are we implicitly signing up to run a registry?

Only if we build one, and I do not think we should — at least not in the first
year.

Running a registry means: hosting and paying for it, moderating submissions,
having a takedown process for the first malicious plugin, having an answer when
someone's plugin is removed, and — since §7.6 says plugins are trusted code —
being seen to *vouch* for what is listed. A "curated" list implies review; an
uncurated list on our domain still implies endorsement to most users.

There is also a jurisdictional angle: Shiro is a third-party client for someone
else's game. Distributing third-party code that modifies the game (§10) under
our name is a different relationship with the Zero-K developers than
distributing a lobby client.

**Recommendation:** no registry. A documented folder, a manifest format, and a
wiki page or forum thread the community maintains. Revisit only if plugins
actually take off — which is a nice problem to have and a bad one to pre-solve.

### 9.3 If a registry ever happens

Minimum bar: content-addressed artifacts, hashes in the index, index signed with
a key that is *not* the Authenticode key and *not* the Tauri updater's minisign
key, and a documented revocation path. That is a third trust root to operate
(§7.5) and it is the real cost, not the hosting.

---

## 10. Game-side integration

### 10.1 What "link into the game itself" could mean

Zero-K runs on Spring/Recoil. Its in-game UI is Lua widgets, and
`docs/DESIGN_HANDOFF.md:70` describes the *existing lobby* as being built with
that same in-engine widget toolkit — so "a Shiro plugin that ships a Lua widget"
is a coherent reading of the ask, and it is the one I ended up at.

I considered six readings. Four are not available to us.

### 10.2 Readings I rejected

**Rejected — inject data via `script.txt`.** This looks like the obvious channel
and I initially thought it was the answer. The install's last-game script
(`C:\Program Files (x86)\Steam\steamapps\common\Zero-K\_script.txt`, 28 KB) is
full of lobby-supplied payloads: `[modoptions]` carrying `sendspringiedata`,
`servertype=ZKLS`, base64 `commandertypes`; per-player custom keys carrying
`elo`, `clan`, `avatar`, `badges`, `level`. Widgets read these via
`Spring.GetModOptions()` and player custom keys, and Zero-K even ships a helper
(`Spring.Utilities.CustomKeyToUsefulTable`).

**But that is the host's script, not ours.** `docs/ARCHITECTURE.md §6` is
explicit that we never host: `src-tauri/src/launch.rs:57-72` writes exactly five
keys — `HostIP`, `HostPort`, `IsHost=0`, `MyPlayerName`, `MyPasswd` — and a unit
test (`launch.rs:286-288`) asserts `IsHost=0`. The rich script above is
generated by the ZKLS autohost server-side and delivered over the network. We
cannot add to it, and `docs/ARCHITECTURE.md §9` and the design handoff both
state we cannot change the server.

(**Unverified:** whether extra keys placed in our *local* connect script survive
the host's setup script. Even if they did I would not build on it —
`check_value` in `launch.rs:44-54` deliberately rejects script-delimiter
characters precisely so nothing can forge a different script, and widening that
to admit plugin data reopens the hole it was written to close.)

**Rejected — talk to the running engine over Zero-K's wrapper socket.** The
install contains `chobby_wrapper_port.txt` (`51903` on this machine) and LuaMenu
widgets call `WG.WrapperLoopback.*`. LuaSocket is enabled in the engine
(`infolog.txt`: `LuaSocket Support: enabled`). But that is a private channel
between Zero-K's own C# wrapper (`Zero-K.exe`) and its own menu; the protocol is
undocumented and we did not decompile it. Speaking someone else's private
loopback protocol is the kind of thing that breaks silently on their next
release. **Unverified** what actually listens there.

**Rejected — the engine's autohost interface.** Spring exposes a UDP autohost
channel (`AutohostInterface` appears in the engine's log sections). It is for the
process that *hosts* the game. We are a client. Same reason as the script.

**Rejected — a Shiro-supplied in-game overlay.** Out of scope, enormous, and the
whole point of this project is that the lobby is *not* in the engine
(`DESIGN_HANDOFF.md:70`).

### 10.3 What is genuinely reachable — verified

All paths below verified on this machine; the install is in Spring's *portable
mode*, so the data dir and the write dir are the same folder:

```
[DataDirLocater::FindWriteableDataDir] using writeable data-directory
"C:\Program Files (x86)\Steam\steamapps\common\Zero-K\"
```
— `<ZK>\infolog.txt` line 4.

**1. Local LuaUI widgets. This is the hook.** Game content is sealed in archives
(`<ZK>\games\zk-stable.sdz`, 650 MB), but Zero-K's widget handler
(`luaui/cawidgets.lua`, read out of that archive) scans a directory:

```lua
local WIDGET_DIRNAME = LUAUI_DIRNAME .. 'Widgets/'
local widgetFiles = VFS.DirList(WIDGET_DIRNAME, "*.lua", VFSMODE)
```

and picks its VFS mode from config:

```lua
VFSMODE = localWidgetsFirst and VFS.RAW_FIRST
VFSMODE = VFSMODE or localWidgets and VFS.ZIP_FIRST
VFSMODE = VFSMODE or VFS.ZIP
```

On this machine `<ZK>\LuaUI\Config\ZK_data.lua:387-390` says:

```lua
["Local Widgets Config"] = {
    useLocalWidgets = true,
    useLocalWidgetsFirst = true,
},
```

So `VFSMODE == VFS.RAW_FIRST`: the engine scans the raw write dir *before* the
archive, and a raw file can override a packaged widget of the same name.

`<ZK>\LuaUI\Widgets\` **does not exist yet** on this machine. Creating it and
dropping a `.lua` file in is, on the evidence, all that is required.

**Two caveats, both important.** First, this was read from source, not observed
— nobody ran the game to watch a raw widget load. Second, there is a server-side
kill switch: a `disable_local_widgets` modoption disables raw loading (bypassed
when spectating or watching a replay). **Unverified** whether Zero-K's official
autohosts set it; if they do, this whole avenue works only in single-player,
spectating and replays.

**2. Widget enable/disable state.** Plain Lua `return {...}` tables in the write
dir, trivially parsed and written:

- `<ZK>\LuaUI\Config\ZK_order.lua` — header `-- Widget Order List (0 disables a
  widget)`; entries like `AdvPlayersList = 0,` (off) and `AllyCursors = 40,`
  (on, with load order).
- `<ZK>\LuaUI\Config\ZK_data.lua` — per-widget persisted data, 472 lines.
- `<ZK>\LuaUI\Configs\zk_keys.lua` — keybinds.
- Both config files have `.bak` siblings that Zero-K maintains itself
  (`CheckLUAFileAndBackup` in `cawidgets.lua`).

So Shiro can not only install a widget, it can enable it and set its load order
without the user hunting through the in-game widget list.

**3. `springsettings.cfg`.** `<ZK>\springsettings.cfg`, 2607 bytes, writable,
and the engine confirms it is the live config source in `infolog.txt`. **This is
already being built** — there is uncommitted work in the tree
(`src-tauri/src/engine_settings.rs`, `src/net/engineSettings.ts`) that reads and
patches it in place. Plugins wanting engine settings should go through those
commands, not reinvent them.

**4. `infolog.txt` as a read-back channel.** `<ZK>\infolog.txt` (139 KB, live),
plus `infolog_full.txt` and a `<ZK>\log\` directory. The engine appends
frame-stamped lines as the game runs:

```
[f=-000001] Loaded widget:  Transport AI  <unit_transport_ai.lua>
[NetProto::InitClient] connecting to IP ... port 8466 using name Qrow
```

Anything a widget writes with `Spring.Echo` lands here. So **a widget can push
data back to a tailing lobby with no extra plumbing at all** — which closes the
loop without needing a socket, a named pipe, or the wrapper. Rust tails the
file, the lobby reacts.

This is genuinely nice, and it is also the fragile half: the format is a log,
not an API, and it will change. Any parser must fail soft and treat an
unrecognised line as nothing happened.

### 10.4 A concrete design, if it goes ahead

A plugin's directory may contain `widgets/*.lua`. On enable, Rust:

1. resolves the install with the existing `install::detect_with`
   (`src-tauri/src/install.rs:123`), honouring the settings override — no new
   install-detection code;
2. probes the write dir for writability *before* doing anything
   (`docs/DOWNLOADS.md §1.3` found the Steam install writable here because Steam
   relaxes ACLs on `steamapps`, and explicitly warns this does not generalise —
   a standalone install under `Program Files` will not be);
3. creates `<ZK>\LuaUI\Widgets\` if absent;
4. copies the file with a namespaced name — `shiro_<pluginid>_<name>.lua` — so
   ownership is never ambiguous and an override of a stock Zero-K widget can
   never happen by accident;
5. patches `ZK_order.lua` to enable it, backing up first as Zero-K itself does;
6. on disable or uninstall, removes **only** files matching the `shiro_` prefix
   and its own `ZK_order.lua` entries.

New Rust commands, siblings of the existing ones: `zks_widgets_list`,
`zks_widget_install`, `zks_widget_remove`. Same conventions as `launch.rs` —
pure path/plan logic separated from the filesystem effects so it unit-tests
without a Zero-K install, which is exactly how `launch.rs` and `install.rs` are
already written.

Capabilities note: this needs **no** Tauri filesystem plugin and **no**
capability change. It is our own Rust code writing a path we resolved — the same
shape as `launch.rs` writing `connect_script.txt` and `engine_settings.rs`
patching `springsettings.cfg`. The capability question the brief raises would
only arise if we reached for `@tauri-apps/plugin-fs` and let the frontend drive
paths, which we should not do.

### 10.5 What this does *not* give you

- **No communication with a game already running.** The widget is loaded at
  engine start. Mid-game, the only channels are `infolog.txt` (out) and nothing
  (in).
- **No data from the lobby into the widget**, for the §10.2 reason. A widget can
  read a config file we wrote before launch — that is the workaround, and it is
  a static one.
- **No control over whether the widget loads.** The modoption kill switch, the
  user's own widget list, and Zero-K's next release all outrank us.

### 10.6 The reason this should not ship first

Zero-K is a competitive RTS. A third-party lobby client that installs and enables
arbitrary Lua into the game's UI layer is, functionally, a mod loader for a
multiplayer game — and the first person to ship a "helpful" widget that reads
more of the game state than it should will make Shiro the client that ships
cheats.

`docs/ARCHITECTURE.md §9` already lists community reception as a risk and says
*"talk to ZK devs early"*. This is the item that most needs that conversation,
and a five-minute answer from them ("we don't care, local widgets are already on
by default" or "absolutely not") is worth more than any amount of design here.

Note the tension: local widgets are *already enabled by default* on this
install, so the capability exists with or without us. Our contribution is making
it one click instead of a folder and a wiki page — which is a real change in
who does it, even if it is not a change in what is possible.

**Recommendation:** build client plugins first. Design the manifest so
`widgets/*.lua` has a place. Do not implement the installer until a Zero-K
developer has said yes, and if they say yes, make the Plugins screen show
loudly which plugins touch the game.

---

## 11. Scope and estimate

Engineer-days, for someone who has read this document. They assume the existing
`launch.rs` / `slices.ts` / `net/*.ts` conventions are followed rather than
rethought, and they exclude the §5 Tier-3 refactor unless listed.

### MVP — "a plugin can watch the protocol and add a screen"

Trusted, same-origin, local folder only. Delivers §4.1, §4.3, §4.5 and §5 Tier 1.

| Work | Days |
|---|---|
| Rust: manifest scan, plugin URI scheme handler, path containment, extension allowlist + unit tests | 2 |
| CSP change (both scheme spellings), verified under `npm run serve:csp` and once inside Tauri | 0.5 |
| TS: plugin registry, host API object, load/activate/deactivate, per-plugin registration unwinding, error isolation | 2 |
| Extension points: `onMessage` filtered by command, nav entry + routed view, settings section | 2 |
| Plugins screen: list, enable/disable, failure reasons, "open folder", the trust warning | 1.5 |
| Safe mode (flag + UI + auto-enter after a failed load) | 0.5 |
| e2e: a plugin that registers a nav entry; one that throws on activate; one that throws per batch and gets flagged | 1 |
| A worked example plugin + `docs/PLUGIN_API.md` | 1 |
| **Total** | **10.5** |

### Full client plugins

| Work | Days |
|---|---|
| MVP | 10.5 |
| §5 Tier 2 — slices keep their unsubscribe, stores gain `disable()`, tests | 2 |
| §5 Tier 3 — `App.jsx` decomposed into a feature registry, dynamic screen imports | 4 |
| UI slots (the four in §4.4) + a stable slot contract | 2 |
| Outbound `send` choke point + `onSend` observation | 1 |
| Launch hooks — **after** the phase-machine work in `store/game.ts` settles | 1 |
| Update / uninstall / version-stamped module URLs / namespaced storage | 2 |
| Move the saved password out of `localStorage`; add an app-level ACL; harden `zks_locate_install` (§7.6) | 2 |
| **Total** | **24.5** |

Roughly five weeks. Note that 6 of those days (Tier 2 + Tier 3) are a refactor
worth doing whether or not plugins ship.

### Optional: the frame sandbox (§7.4)

| Work | Days |
|---|---|
| Frame host, `postMessage` RPC broker, serializable API surface | 3 |
| Declarative UI contributions (the host renders, the plugin describes) | 2 |
| Permission model, manifest declarations, install-time prompts | 2 |
| Rework the example plugin and the docs | 1 |
| **Total** | **8** |

### Game-side integration (§10)

Gated on §10.6. Not schedulable until that conversation happens.

| Work | Days |
|---|---|
| `zks_widgets_list` / `_install` / `_remove` + `ZK_order.lua` read/patch/backup + unit tests | 2.5 |
| Writability preflight and the failure copy for a non-writable install | 0.5 |
| `infolog.txt` tail + fail-soft parser + `zks://infolog` events | 1.5 |
| Plugins screen: show which plugins touch the game, and what they installed | 1 |
| First real run: confirm a raw widget actually loads, and check `disable_local_widgets` on a real ZK autohost | 1 |
| **Total** | **6.5** |

That last row is not padding. Two of the load-bearing claims in §10.3 are read
from source rather than observed, and one of them (the kill switch) could make
the feature multiplayer-useless.

### Deliberately not in scope

- **A plugin registry** (§9.2). No.
- **Auto-updating plugins.** A third trust root for a feature nobody has asked
  for yet.
- **Cancellable outbound commands** (§4.2). Observation only.
- **Mutable inbound messages** (§4.1). Observation only.
- **An in-game overlay** (§10.2).
- **Plugin-to-plugin APIs.** Let plugins find each other through the host
  registry if they must; do not design a dependency system before there are two
  plugins.

---

## 12. Open questions, ordered by the cost of getting them wrong

1. **Is "plugins are trusted code" acceptable to the owner?** (§7.6) Everything
   downstream — the loader, the API shape, the estimates, whether §7.4's eight
   days are in the plan — depends on this one answer. If the answer is "no,
   plugins must be sandboxed", the API becomes serializable-only and should be
   designed that way from the first line of code, because retrofitting it is
   most of a rewrite.
2. **Will the Zero-K developers accept a lobby that installs Lua widgets?**
   (§10.6) Blocks all of §10. Ask before building.
3. **Do Zero-K's official autohosts set `disable_local_widgets`?** (§10.3) If
   they do, game-side integration works only in single-player, spectating and
   replays, and the feature is a fraction of what it appears to be. Cheap to
   check: read the modoptions in a real multiplayer `_script.txt`.
4. **Is `<writedir>\LuaUI\Widgets\foo.lua` actually loaded?** (§10.3) Read from
   `cawidgets.lua`, not observed. One local game settles it.
5. **Does Tauri override the CSP header our protocol handler sets?** (§3.2,
   §7.4) Determines whether a plugin frame can be given a stricter policy than
   the main document, which is half of the sandbox story.
6. **Which UI slots?** (§4.4) Cheap to get wrong once, expensive to get wrong
   twice — every slot is a compatibility promise, and this UI will be redesigned.
   Start with fewer than feel right.
7. **Does WebView2 cache custom-protocol responses across reload?** (§3.2)
   Determines whether "reload plugins" works or needs cache-busting. Minor, but
   it will waste an afternoon if unknown.
8. **Does a signed binary that loads local scripts and spawns processes draw
   more SmartScreen or AV attention?** (§7.5) I could not test this and would
   not guess. Probably minor; findable only by shipping.

---

## 13. Sources, and how to reproduce the CSP measurements

### Reproducing §2

I wrote a probe page in a scratch directory (nothing in this repo) and served it
with the packaged policy read from `src-tauri/tauri.conf.json`, the same way
`tools/e2e/serve-csp.mjs` does. Then I loaded it in a Chromium browser on this
machine and read the results and the console violations.

```
index.html   -> <script src="probe.js">
probe.js     -> try/catch around eval, new Function, new WebAssembly.Module,
                WebAssembly.compile, WebAssembly.validate, and dynamic import()
                of: a blob: URL, a data: URL, a same-origin file, and a file on
                http://plugin.localhost
serve.mjs    -> node:http, sets Content-Security-Policy to the exact string from
                tauri.conf.json:26
```

For §2.2, the same page served with `script-src 'self' http://plugin.localhost:PORT`
and `frame-src http://plugin.localhost:PORT`, with the module and an iframe
loaded from `http://plugin.localhost:PORT` (Chromium resolves `*.localhost` to
loopback, which is the same mechanism Tauri's custom schemes use on Windows).
The frame reported its origin, `localStorage.getItem("shiro.settings")`,
`"__TAURI_INTERNALS__" in window`, `parent.location.href` and `eval` back over
`postMessage`.

**Caveat:** this was a Chromium browser, not WebView2. The README already argues
these are the same rules ("WebView2 is Chromium, so the rules are the same
ones") and `serve-csp.mjs` is built on that assumption, so I am relying on the
same premise the repo already relies on. The one thing neither can check is
Tauri's own `ipc:` scheme, and now also the plugin scheme.

### Repo files read

`README.md`; `docs/ARCHITECTURE.md` §4, §6, §7, §9, §11; `docs/DOWNLOADS.md`;
`docs/DESIGN_HANDOFF.md` §3–§5; `src/store/slices.ts`, `settings.ts`, `game.ts`;
`src/net/session.ts`, `connection.ts`, `launch.ts`, `engineSettings.ts`;
`src/App.jsx`, `src/ErrorBoundary.jsx`, `src/screens/AppShell.jsx`;
`src/ds/shiro.js` (header and export tail); `src/protocol/registry.ts`;
`src-tauri/tauri.conf.json`, `capabilities/default.json`, `Cargo.toml`;
`src-tauri/src/lib.rs`, `launch.rs`, `install.rs`, `relay.rs`;
`tools/e2e/serve-csp.mjs`; `vite.config.js`; `package.json`.

### Tauri sources

From the local cargo registry, versions as resolved by this repo's `Cargo.toml`
(`tauri = "2"`):

- `tauri-2.11.5/src/webview/mod.rs:1818-1826` — the ACL check that app commands
  skip when there is no app manifest (§7.2).
- `tauri-2.11.5/src/manager/webview.rs:159-163, 182` —
  `for_main_frame_only: true` on the IPC bootstrap (§7.3).
- `tauri-2.11.5/src/app.rs:2130, 2198` — `register_uri_scheme_protocol` /
  `register_asynchronous_uri_scheme_protocol` (§3.2).
- `tauri-2.11.5/src/webview/mod.rs:1698-1730` — `is_local_url`, including the
  comment that on Windows custom protocols are `http://<protocol-name>/...`.
- `tauri-macros-2.6.3/src/command/handler.rs:104-105` — *"All application
  commands are allowed if we don't have an application ACL"* (§7.2).
- `tauri-utils-2.9.3/src/config.rs:2588-2595` (`AssetProtocolConfig`),
  `:2924` and `html.rs:150-156` (`dangerous_disable_asset_csp_modification` —
  Tauri only rewrites the CSP to add nonces/hashes for inline script and style
  in the *bundled* HTML, which does not affect plugin loading).
- `node_modules/@tauri-apps/api/core.js:206-207` — the documented requirement to
  list both `asset:` and `http://asset.localhost` in the CSP; the same applies
  to any custom scheme.

### Zero-K install

`C:\Program Files (x86)\Steam\steamapps\common\Zero-K`, engine `2025.06.21`,
running in Spring portable mode (data dir == write dir, confirmed at
`infolog.txt` line 4). Read: `infolog.txt`, `_script.txt`, `springsettings.cfg`,
`LuaUI\Config\ZK_data.lua`, `LuaUI\Config\ZK_order.lua`,
`chobby_wrapper_port.txt`, `steam_engine.txt`, and `luaui/cawidgets.lua`
extracted (to stdout only) from `games\zk-stable.sdz`.

**Nothing in the Zero-K install was modified.** No game was launched, no
connection was made to `zero-k.info:8200`, and no build was run.
