# Design brief: the loading screen

For design. One new surface, and an unusual one — it is not a screen in Shiro.
It is drawn by the game engine, in Lua, over OpenGL, in the seconds between
pressing Start and the match appearing. Everybody sees it every single game.

A working version ships today. This describes what can be drawn there, what
cannot, and what we would like back.

---

## 1. Why we can have this at all

Zero-K draws its loading screen from `luaintro/main.lua` inside its own game
archive. That archive cannot be modified — its checksum is what keeps a client
in sync with the server — but it does not have to be, because the first thing
Zero-K's own script does is:

```lua
VFS.DEF_MODE = VFS.RAW_FIRST
```

The raw data directory is searched **before** any archive. Shiro writes
`<datadir>/LuaIntro/Addons/main.lua`, the engine finds it first, and it replaces
Zero-K's addon of the same name. Nothing is patched and the game's checksum is
untouched.

The capitals in that path are the engine's: its addon handler scans
`LuaIntro/Addons/`, and a raw file is found only under the exact name asked
for. Windows does not mind the difference; Linux does, and a lowercase
`addons/` is how this screen came to be invisible there.

Two consequences design should know:

- **Only for installs Shiro made.** A Steam install belongs to the player;
  Shiro does not write files into it. So this is a Shiro-local-install feature,
  on by default there, with a switch in Settings.
- **It can be turned off**, and off stays off. Whatever we design has to be
  something a person is allowed to decline.

## 2. The medium, which is the real constraint

This is not HTML. There is no layout engine, no flexbox, no CSS, and no text
wrapping unless we write it. Every frame is drawn by hand in immediate-mode
OpenGL from Lua.

**Two coordinate spaces**, and the addon switches between them:

| space | how | use for |
|---|---|---|
| normalised | the default: `0,0` bottom-left to `1,1` top-right | rectangles, bars, images |
| pixels | `gl.Scale(1/vsx, 1/vsy, 1)` first | text, which is sized in pixels |

Note `0,0` is the **bottom** left. Y goes up, not down.

**What is available to draw with:**

- `gl.Color(r, g, b, a)` — floats `0..1`, not hex. Specify colours as hex and we
  will convert.
- `gl.Rect(x1, y1, x2, y2)` and `gl.BeginEnd(GL.QUADS, …)` for gradients.
- `gl.LoadFont(file, size, outlineWidth, outlineWeight)` then
  `font:Print(text, x, y, size, flags)`. Flags are a string: `o` outline,
  `s` shadow, `c` centred, `r` right, `a` ascender-aligned. Combine them —
  `"oc"` is outlined and centred.
- **Images work.** `gl.Texture(":n:LuaIntro/Images/name.png")` then
  `gl.TexRect(…)`. Zero-K ships its own bar frame that way. Because of
  `RAW_FIRST`, we can ship PNGs beside the addon — so illustration, texture and
  a logo mark are all on the table. PNG with alpha; power-of-two dimensions are
  safest.
- Fonts: the engine's own (`FreeSansBold.otf`) is guaranteed. A custom face
  would have to ship as a file, and has not been tried.

**What to avoid:** the addon is drawn every frame *while the engine is loading*,
on a machine that is busy. Keep the frame cheap — load fonts and textures once,
not per draw. No animation that depends on a steady frame rate, because there
is not one.

## 3. What we can put on the screen

**Confirmed available** — the current screen uses these:

- `Game.gameName` — e.g. `Zero-K v1.14.8.0`
- the current load step as text — `Loading LuaRules`, `Parsing Map
  Information`, and so on
- progress, `0..1`

**Probably available, not yet exercised:** `Game.mapName`. The engine carries
the string; nobody has drawn it yet. Five minutes to confirm.

**Not available from the engine:** who is in the match, team colours, the room
name, anybody's rank. None of that exists in the engine's loading context — it
lives in the lobby.

**But obtainable if design wants it.** Shiro writes the start script and owns
the directory, so it could write a small Lua file with the match details next to
the addon, for the screen to read. That is a real option, not a fantasy — it
costs an afternoon. If the design wants a player list, or the two teams facing
off, say so and we will do it. Do not silently assume it, though: what ships
today has the three things above and nothing else.

## 4. Progress is honest but lumpy

The engine reports progress coarsely and then stops reporting for long
stretches — pathing in particular. Zero-K handles this by bracketing each phase
between a floor and a ceiling, and we kept that:

| phase | bar sits between |
|---|---|
| Parsing Map Information | 0–20% |
| Loading Weapon Definitions | 10–50% |
| pathing | 30–60% |
| Loading LuaRules | 40–80% |
| Loading LuaUI | 70–95% |
| Loading Skirmish AIs | 90–99% |

**A design that needs smooth, linear progress will look broken.** The bar jumps
and then sits still. Anything time-based — a spinner, a slow ambient drift —
keeps moving when the bar does not, and is worth considering for that reason.

Total duration: a few seconds on a warm cache, up to a minute or so the first
time a big map loads. Design for both — something that only reads well over
forty seconds is wrong, and so is something that needs the full minute to finish
an animation.

## 5. What is there now

Deliberately plain, as a proof the mechanism works rather than a design:

- the map, dimmed by a 55% near-black scrim
- `SHIRO` centred at 60% height, 7.5% of viewport height, white
- the game name under it at 2.4%
- a hairline track from 20% to 80% width at 14.6% height, 0.55% tall, with a
  near-white fill
- the current load step at 17.5% height, and the percentage at 11.8%

All type is the engine's FreeSansBold, outlined and centred. No images.

## 6. What we would like back

- **A layout at 16:9**, plus a note on what moves at 21:9 and 4:3. The engine
  gives us the viewport size, so responsive is possible, but it has to be
  specified — there is no reflow.
- **Colours as hex**, including the scrim opacity. We convert.
- **Type sizes as fractions of viewport height**, not points — that is how the
  screen scales.
- **Any images as PNG with alpha**, at the size they will be drawn or larger.
- **A decision on the map.** Show it dimmed as now, replace it entirely, or
  frame it as an element? It is the one piece of real content on the screen.
- **A decision on the skins.** Shiro has four (Paper, Vellum, Graphite, Slate).
  This surface currently ignores them. It sits over a game, in the dark, so
  matching Paper may be wrong — but four load screens is also a real option.
- **Whether it should say anything.** A tip, the map name, the objective? Or
  stay quiet, which is a legitimate answer for a screen seen several times an
  evening.

## 7. Where it lives

- The addon: `src-tauri/src/loadscreen/main.lua`, compiled into the binary.
- Placement and the on/off switch: `src-tauri/src/loadscreen.rs`.
- Settings shows the switch only when there is a Shiro-managed install.
