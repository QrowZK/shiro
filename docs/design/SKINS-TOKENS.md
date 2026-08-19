# Skins, as the design specifies them

Transcribed from the "Shiro Skins" design project so the implementation has a
checked-in source rather than a URL. Four skins; Paper is the canonical light
system already in src/styles/tokens/ and needs no override block.

The design's own framing: each skin is a scope override of **the semantic
colour layer only**. Same ramp shape, same hairline weights, same components -
structure, density and the chroma rules are untouched. Faction values brighten
on the dark skins so they still read as identity marks.

Note what is NOT in any block below: `--ink-000` and `--white`. Every skin
overrides the semantic tokens that are *defined from* those two, never the two
themselves. Anything in the app reaching for `--ink-000` or `--white` directly
therefore does not follow a skin at all - which is task #20.


## Vellum (`vellum`)

Warm paper, brown-black ink. Softer for 25-minute sessions.

```css
[data-skin="vellum"] {
  --surface-void:#faf7f0;
  --surface-base:#faf7f0;
  --surface-raised:#faf7f0;
  --surface-panel:#eee9dd;
  --surface-sunken:#f5f1e8;
  --surface-hover:rgba(50,38,16,.045);
  --surface-active:rgba(50,38,16,.10);
  --surface-selected:#e2dccb;
  --surface-inverse:#14100a;
  --scrim:rgba(250,247,240,.86);
  --text-hi:#14100a;
  --text-body:#2f2820;
  --text-mid:#5c5445;
  --text-low:#8d8471;
  --text-faint:#a9a08c;
  --text-inverse:#faf7f0;
  --text-link:#14100a;
  --w-04:rgba(50,38,16,0.04);
  --w-06:rgba(50,38,16,0.07);
  --w-08:rgba(50,38,16,0.1);
  --w-12:rgba(50,38,16,0.15);
  --w-20:rgba(50,38,16,0.24);
  --w-32:rgba(50,38,16,0.35);
  --w-56:rgba(50,38,16,0.56);
  --w-72:rgba(50,38,16,0.72);
  --border-hair:1px solid rgba(50,38,16,0.07);
  --border-line:1px solid rgba(50,38,16,0.15);
  --border-strong:1px solid rgba(50,38,16,0.24);
  --border-focus:1px solid #14100a;
  --rule-inset:inset 0 -1px 0 rgba(50,38,16,0.07);
  --focus-ring:0 0 0 1px #faf7f0,0 0 0 2px #14100a;
  --elev-menu:0 1px 0 rgba(50,38,16,0.15),0 6px 16px rgba(50,38,16,.18);
  --elev-dialog:0 1px 0 rgba(50,38,16,0.24),0 18px 48px rgba(50,38,16,.18);
  --faction-machines:#b21212;
  --faction-hegemony:#3f5fa8;
  --faction-rising:#5f7d10;
  --signal-danger:#b21212;
  --signal-warn:#8a6a00;
  --signal-ok:#14100a;
  --signal-info:#5c5445;
  --presence-online:#14100a;
  --presence-away:#8d8471;
  --presence-room:#5c5445;
  --presence-ingame:#b21212;
  --presence-offline:#e2dccb;
  --presence-bot:#5c5445;
}
```

## Graphite (`graphite`)

Neutral inversion. Map art stops being the only dark thing.

```css
[data-skin="graphite"] {
  --surface-void:#0d0d0d;
  --surface-base:#0d0d0d;
  --surface-raised:#0d0d0d;
  --surface-panel:#161616;
  --surface-sunken:#111111;
  --surface-hover:rgba(255,255,255,.05);
  --surface-active:rgba(255,255,255,.10);
  --surface-selected:#202020;
  --surface-inverse:#ffffff;
  --scrim:rgba(0,0,0,.82);
  --text-hi:#ffffff;
  --text-body:#d6d6d6;
  --text-mid:#9e9e9e;
  --text-low:#7e7e7e;
  --text-faint:#5e5e5e;
  --text-inverse:#0d0d0d;
  --text-link:#ffffff;
  --w-04:rgba(255,255,255,0.04);
  --w-06:rgba(255,255,255,0.07);
  --w-08:rgba(255,255,255,0.1);
  --w-12:rgba(255,255,255,0.15);
  --w-20:rgba(255,255,255,0.24);
  --w-32:rgba(255,255,255,0.35);
  --w-56:rgba(255,255,255,0.56);
  --w-72:rgba(255,255,255,0.72);
  --border-hair:1px solid rgba(255,255,255,0.07);
  --border-line:1px solid rgba(255,255,255,0.15);
  --border-strong:1px solid rgba(255,255,255,0.24);
  --border-focus:1px solid #ffffff;
  --rule-inset:inset 0 -1px 0 rgba(255,255,255,0.07);
  --focus-ring:0 0 0 1px #0d0d0d,0 0 0 2px #ffffff;
  --elev-menu:0 1px 0 rgba(255,255,255,0.15),0 6px 16px rgba(0,0,0,.6);
  --elev-dialog:0 1px 0 rgba(255,255,255,0.24),0 18px 48px rgba(0,0,0,.6);
  --faction-machines:#e51616;
  --faction-hegemony:#7292d3;
  --faction-rising:#a7d224;
  --signal-danger:#e04040;
  --signal-warn:#d0a020;
  --signal-ok:#ffffff;
  --signal-info:#9e9e9e;
  --presence-online:#ffffff;
  --presence-away:#7e7e7e;
  --presence-room:#9e9e9e;
  --presence-ingame:#e04040;
  --presence-offline:#202020;
  --presence-bot:#9e9e9e;
}
```

## Slate (`slate`)

Cool dark, blue-tinted greys. Closest to the game's own palette.

```css
[data-skin="slate"] {
  --surface-void:#0b0e13;
  --surface-base:#0b0e13;
  --surface-raised:#0b0e13;
  --surface-panel:#151b25;
  --surface-sunken:#0f131a;
  --surface-hover:rgba(196,216,255,.055);
  --surface-active:rgba(196,216,255,.11);
  --surface-selected:#1f2733;
  --surface-inverse:#f5f8fc;
  --scrim:rgba(11,14,19,.84);
  --text-hi:#f5f8fc;
  --text-body:#d3dae4;
  --text-mid:#9ba6b4;
  --text-low:#77828f;
  --text-faint:#576270;
  --text-inverse:#0b0e13;
  --text-link:#f5f8fc;
  --w-04:rgba(196,216,255,0.04);
  --w-06:rgba(196,216,255,0.07);
  --w-08:rgba(196,216,255,0.1);
  --w-12:rgba(196,216,255,0.15);
  --w-20:rgba(196,216,255,0.24);
  --w-32:rgba(196,216,255,0.35);
  --w-56:rgba(196,216,255,0.56);
  --w-72:rgba(196,216,255,0.72);
  --border-hair:1px solid rgba(196,216,255,0.07);
  --border-line:1px solid rgba(196,216,255,0.15);
  --border-strong:1px solid rgba(196,216,255,0.24);
  --border-focus:1px solid #f5f8fc;
  --rule-inset:inset 0 -1px 0 rgba(196,216,255,0.07);
  --focus-ring:0 0 0 1px #0b0e13,0 0 0 2px #f5f8fc;
  --elev-menu:0 1px 0 rgba(196,216,255,0.15),0 6px 16px rgba(0,0,0,.6);
  --elev-dialog:0 1px 0 rgba(196,216,255,0.24),0 18px 48px rgba(0,0,0,.6);
  --faction-machines:#e2503e;
  --faction-hegemony:#7292d3;
  --faction-rising:#a7d224;
  --signal-danger:#e2503e;
  --signal-warn:#d8b04a;
  --signal-ok:#f5f8fc;
  --signal-info:#9ba6b4;
  --presence-online:#f5f8fc;
  --presence-away:#77828f;
  --presence-room:#9ba6b4;
  --presence-ingame:#e2503e;
  --presence-offline:#1f2733;
  --presence-bot:#9ba6b4;
}
```
