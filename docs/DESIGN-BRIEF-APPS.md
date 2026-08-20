# Design brief: Apps, Profiler, Springen, Splaunch

For design. Four new surfaces. Functionality is being built in parallel; this
describes what is on screen and what states it has to survive, so mockups can
happen without waiting for the code.

Existing conventions this must sit inside: one window, a left icon rail with the
screens on it, a status bar along the bottom, and the design system in
`src/ds/shiro.js` (Button, Badge, Tag, Panel, Meter, Tabs, PlayerRow, Dialog,
EmptyState). Type is mono for numbers, core for prose. Skins: Paper (default),
Vellum, Graphite, Slate - so nothing may depend on a light background.

---

## 1. Apps — the launcher

**One new entry in the left rail.** A list of apps Shiro can install and run.
This is not a marketplace: there are four entries, hand-curated, shipped with
Shiro. No search, no categories, no ratings, no accounts.

### The row

Each app is a row. Everything a person needs to decide is on it:

- name, one-line description
- size, and version if installed
- **state**, which is the whole design problem - see below
- one primary action, whose label *is* the state's verb

### The states, all of which happen

| state | what it says | primary action |
|---|---|---|
| not installed | size to download | **Install** |
| downloading | percent, and what it is fetching right now | **Cancel** |
| verifying | "checking the download" | none, briefly |
| installed | version | **Launch** |
| update available | installed version → new version | **Update**, with Launch still there |
| running | "running" | **Stop**, or nothing |
| unavailable | *why* - no release yet, needs Zero-K, wrong platform | none, greyed with the reason |
| failed | what failed, in a sentence | **Retry** |

The last two matter more than they look. Springen has no published build yet, so
"unavailable, no release published" is a state that will be on screen on day
one. A row that just looks broken is the failure mode to avoid.

### Detail

Selecting a row opens a panel beside it (same shape as the battle list's detail
pane): longer description, what it needs, where it comes from - the actual
domain, visible - and the install path once installed. Downloading and running
somebody else's program is a thing a person should be able to look at before
agreeing to it.

### Empty and offline

There is no empty state - the catalogue ships with the app. Offline, rows that
are installed stay launchable and rows that are not say so.

---

## 2. Profiler — "will this run"

**A stepped check with a result.** The point is a person who is about to play
for the first time, or who is getting 12 fps and does not know why.

### The run

Steps, shown in order, each resolving to a tick, a warning or a cross:

1. Find the Zero-K installation
2. Find the engine it will run
3. Read the machine (CPU, GPU, VRAM, driver, OpenGL)
4. Check the graphics against what the game needs
5. Recommend a settings preset

Steps complete one at a time and stay on screen with their result. This is a
short operation; the animation exists to make it legible, not to fill time.

### The duck

**A custom duck animation, in the spirit of the Dirtbag loading animation** -
same treatment, a small sprite loop with real frames rather than a spinner. It
sits with the steps while they run and reacts at the end: pleased on a pass,
unimpressed on a warning, alarmed on a failure. Three end poses, one loop.

Design should feel free here. The rest of this client is deliberately austere;
this is the one screen where a joke is allowed, because the moment it appears is
usually a person having a bad time.

### The result

The numbers, plainly, in mono:

```
CPU        10 physical / 16 logical cores
GPU        NVIDIA GeForce RTX 4060 Laptop GPU
VRAM       8188 MB total, 5910 MB free
OpenGL     4.6 (Compat)
Renderer   hardware
```

Then a verdict and a recommended preset, with the reason attached: "8 GB VRAM
and OpenGL 4.6 - High is comfortable." The preset names are the six the settings
screen already uses.

### The two failures worth designing for

- **Software or Mesa renderer.** The single best predictor of an unplayable
  game. Needs to be loud and needs to say what to do.
- **OpenGL too old.** The game will not start. Say that, not "warning".

### The cold case

All of the above is read from the engine's own log, which means **it does not
exist until the game has been run once**. A first-run state is required: what
the profiler can say before there is anything to read, and how it asks for a
run. Do not design this as an error - it is the normal state for a new
installation.

---

## 3. Springen — an app, not a screen

A map generator. It is a row in §1 and nothing else: install, launch, update.
It opens in its own window; Shiro does not host it.

Two things design needs to allow for:

- **It has no published build yet.** Its row will sit in the "unavailable" state
  until that changes, so that state needs to look deliberate.
- **Later, a second entry point**: generating a map without opening Springen at
  all, from the host dialog - "make me a mirrored 12x12". That is a dialog, not
  a screen, and it is not in this brief. Do not design it away.

---

## 4. Splaunch — the scenario tool

The largest of the four. A tool for making Zero-K scenarios: place units and
features on a map, give them orders, set objectives, press play.

**What it produces is a start script**, not a file format - the modern Zero-K
campaign expresses a whole mission as options on a start script, read by a
gadget that already ships with the game. The consequence for design: **Test is
not a preview, it is the real game**. Pressing it launches Zero-K into the
scenario. There is no fidelity gap to apologise for, and no second renderer to
build.

### The screen

Three regions, and the middle one is the product:

- **Left: a palette.** Units and features, searchable, grouped. Zero-K has
  hundreds of unit types; this is a search field first and a grid second.
- **Centre: the map.** The heightmap, top-down, with what has been placed on it.
  Click to place, drag to move, select to edit. This is where all the work
  happens and it should get all the space.
- **Right: what is selected.** A unit's team, facing, health, orders. Nothing
  when nothing is selected - and that empty state is common, so it should say
  what to do rather than sit blank.

Above: the map's name and size. Below or in the header: **Test**, and the save
state.

### The map

Rendered from the map's own heightmap - real terrain, not a placeholder. Two
things must be visible at a glance because they are what make a scenario break:

- **water**, because a land unit placed in it is a mistake the tool should not
  let you make quietly
- **slope**, because a factory on a cliff cannot be built

A start-position marker per team. Metal spots if we can get them.

### Placing things

Click a unit in the palette, click the map, it is there. Drag to move. Facing by
handle or by a control on the right. Multi-select and delete.

Teams are colours, and the colours are the game's own - a scenario author thinks
in "the red team", so the tool must too.

### Objectives and triggers, v1

Deliberately small. A list, each entry a sentence:

- "Player must destroy all enemy units"
- "Player must survive 5 minutes"
- "Player must reach this point" - with the point placed on the map

Add, remove, reorder. **Not a visual node graph.** If the sentences stop being
enough, that is a later conversation, and the wrong answer to have designed
early.

### Saving and sharing

A scenario is a file on disk. Save, open, and a recent list. Sharing is "send
somebody the file" - there is no publishing endpoint that is known to still
work, so nothing in the design may imply an upload button until that is
answered.

### The states that will actually happen

- **No map chosen yet.** The first thing on opening. A map picker, not a blank
  canvas.
- **Map not downloaded.** Shiro can fetch it; the tool should offer that inline
  rather than sending someone to another screen.
- **Nothing placed yet.** The common starting state - should invite the first
  click.
- **Test while the game is already running.** Refuse, and say why.
- **Invalid scenario.** No player team, a unit underwater, no objectives. These
  want to be visible before Test, not after - a count in the header that opens a
  list, not a modal that blocks.

---

## What design most needs to decide

1. **The app row's state treatment** in §1 - eight states, one row, and the
   greyed-with-a-reason ones must not read as broken.
2. **The duck** in §2. Three end poses and a loop.
3. **The map view** in §4 - how water, slope and team colour coexist without
   turning into noise, on four skins including two dark ones.
4. **The selection panel's empty state** in §4, because it is on screen more
   than any other state in the tool.
