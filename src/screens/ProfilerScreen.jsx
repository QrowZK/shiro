import React from "react";
import { Button, Badge, Icon } from "../ds/shiro.js";

/* "Will this run." A stepped check over what the engine already reported about
   the machine, and a settings preset with the reason attached.

   The duck is drawn rather than rendered - the Dirtbag walk cycle is a sprite
   sheet off the game's own model, and there is no duck model to render. An
   inline SVG gets the same job done, follows the skin through currentColor,
   and has the three end poses the result needs. */

const label = {
  font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-faint)",
};

const STEPS = [
  "Finding Zero-K",
  "Reading the engine's log",
  "Checking the graphics",
  "Choosing a preset",
];

/**
 * The duck.
 *
 * `mood` is "working" while the check runs, then one of ok / warn / fail. The
 * body is one path so the bob applies to the whole bird; only the brow and the
 * beak change between moods, which is enough - a duck with a raised eyebrow
 * reads as unimpressed without redrawing it.
 */
export function Duck({ mood = "working", size = 96 }) {
  // The brow is the whole personality: level when pleased, angled when not.
  const brow = { ok: "M40 15q4 -2 8 0", warn: "M40 13l8 3", fail: "M40 16l8 -3" }[mood]
    || "M40 15q4 -2 8 0";
  const beak = {
    ok: "var(--signal-ok, #d8a12a)",
    warn: "var(--signal-warn, #d8a12a)",
    fail: "var(--signal-danger, var(--signal-warn, #d8a12a))",
    working: "#d8a12a",
  }[mood];

  return (
    <svg width={size} height={size} viewBox="0 0 72 72" role="img"
      aria-label={`Duck, ${mood}`}
      style={{ color: "var(--text-mid)", flex: "0 0 auto" }}>
      <g className={mood === "working" ? "shiro-duck-bob" : undefined}
        fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round">
        {/* tail, body, and the breast curving up into the neck */}
        <path d="M12 46q-4 -3 -1 -7" />
        <path d="M11 39q2 -9 13 -11 12 -2 17 4" />
        <path d="M11 39q1 10 13 11h12q9 0 12 -6" />
        {/* neck and head, one stroke so it reads as a bird rather than parts */}
        <path d="M41 32q-3 -6 0 -10 3 -5 9 -5 7 0 9 6 2 6 -3 9" />
        {/* wing */}
        <path d="M24 40q6 -4 13 -1" />
        {/* brow */}
        <path d={brow} strokeWidth="2" />
      </g>
      {/* beak, and the eye on top of the head shape */}
      <path d="M59 21h10l-5 5z" fill={beak} stroke="none" />
      <circle cx="52" cy="21" r="1.7" fill="currentColor" />
      {/* the water it sits on */}
      <path d="M6 52h60" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        opacity="0.35" fill="none" />
      <g className={mood === "working" ? "shiro-duck-paddle" : undefined}
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5">
        <path d="M22 55q4 -2 8 0" />
      </g>
    </svg>
  );
}

/* One line of the run: a step, its state, and what it found.
 *
 * Steps resolve one at a time and stay on screen with their result, so the whole
 * run is readable once it finishes. Following the design kit: the result glyph
 * is the only chroma, and a pass is plain ink rather than green - a green tick
 * on every passing line makes them shout louder than the one line that matters.
 */
const MARK = {
  pending: { glyph: null, colour: "var(--text-faint)" },
  running: { glyph: "loader", colour: "var(--text-mid)" },
  ok: { glyph: "check", colour: "var(--text-hi)" },
  warn: { glyph: "alert-triangle", colour: "var(--signal-warn)" },
  fail: { glyph: "alert-triangle", colour: "var(--signal-danger)" },
};

function StepRow({ index, label, state = "pending", detail }) {
  const m = MARK[state] || MARK.pending;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-5)",
      padding: "var(--sp-4) 0", boxShadow: "var(--rule-inset)",
      opacity: state === "pending" ? 0.55 : 1,
      transition: "opacity var(--dur-base) var(--ease-out)" }}>
      <span style={{ width: 18, flex: "0 0 auto",
        font: "var(--w-regular) var(--size-micro)/18px var(--font-mono)",
        color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
        {String(index).padStart(2, "0")}
      </span>
      <span style={{ width: 16, height: 18, flex: "0 0 auto", display: "inline-flex",
        alignItems: "center", color: m.colour }}>
        {m.glyph && <Icon name={m.glyph} size={14} />}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{label}</span>
        {detail && (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.45 var(--font-mono)",
            color: state === "fail" ? "var(--signal-danger)"
              : state === "warn" ? "var(--signal-warn)" : "var(--text-low)",
            overflowWrap: "anywhere" }}>{detail}</span>
        )}
      </div>
    </div>
  );
}

function Fact({ name, value }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "var(--sp-5)",
      alignItems: "baseline" }}>
      <span className="lab">{name}</span>
      <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
        color: "var(--text-body)", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

export default function ProfilerScreen({ report, state = "idle", error, onRun, onBack }) {
  const running = state === "running";
  const p = report?.profile;
  const v = report?.verdict;

  const worst = !v ? null
    : v.findings.some(f => f.level === "fail") ? "fail"
      : v.findings.some(f => f.level === "warn") ? "warn" : "ok";
  const mood = running ? "working" : (worst || "working");

  /* Each step's state and the line it found. The graphics step carries the
     worst finding, because that is the step people are actually asking about. */
  const steps = STEPS.map((label, i) => {
    if (running) return { label, state: i === 0 ? "running" : "pending" };
    if (!report) return { label, state: "pending" };
    if (i === 0) return { label, state: "ok", detail: p?.seen ? "Found" : undefined };
    if (i === 1) {
      return p?.seen
        ? { label, state: "ok", detail: "infolog.txt" }
        : { label, state: "warn", detail: "No log yet - the game has not been run here" };
    }
    if (i === 2) {
      const bad = v?.findings.find(f => f.level === "fail")
        || v?.findings.find(f => f.level === "warn");
      return { label, state: bad ? (bad.level === "fail" ? "fail" : "warn") : "ok",
        detail: bad ? bad.title : p?.glRenderer };
    }
    return { label, state: v?.preset ? "ok" : "warn",
      detail: v?.preset ? `Suggested: ${v.preset}` : "Nothing to base one on" };
  });

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
        {onBack && <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>Apps</Button>}
        <span className="lab">SYSTEM PROFILER</span>
      </div>

      <div style={{ display: "flex", gap: "var(--sp-7)", padding: "var(--sp-7)",
        alignItems: "flex-start" }}>
        <Duck mood={mood} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          gap: "var(--sp-5)" }}>
          <div>
            <span style={{ font: "var(--w-bold) var(--size-xl)/1.1 var(--font-core)",
              color: "var(--text-hi)" }}>
              {running ? "Checking…" : report ? "Here is what I found" : "Will Zero-K run here?"}
            </span>
          </div>

          <div>{steps.map((s, i) => (
            <StepRow key={s.label} index={i + 1} label={s.label}
              state={s.state} detail={s.detail} />
          ))}</div>

          {!report && !running && (
            <Button variant="primary" size="lg" onClick={onRun}
              style={{ alignSelf: "flex-start" }}>Run the check</Button>
          )}
          {error && (
            <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>{error}</span>
          )}
        </div>
      </div>

      {report && (
        <>
          {/* The findings, worst first - the thing that stops the game running
              is the thing to read, not the core count. */}
          <div style={{ borderTop: "1px solid var(--w-06)", padding: "var(--sp-6) var(--sp-7)",
            display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
            {[...v.findings]
              .sort((a, b) => ({ fail: 0, warn: 1, ok: 2 }[a.level] - { fail: 0, warn: 1, ok: 2 }[b.level]))
              .map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "var(--sp-4)" }}>
                  <Icon size={16} style={{ marginTop: 2,
                    color: f.level === "fail" ? "var(--signal-warn)"
                      : f.level === "warn" ? "var(--signal-warn)" : "var(--text-mid)" }}
                    name={f.level === "ok" ? "check" : "alert-triangle"} />
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                    <span style={{ font: "var(--w-medium) var(--size-small)/1.2 var(--font-core)",
                      color: "var(--text-hi)" }}>{f.title}</span>
                    <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)",
                      lineHeight: 1.5 }}>{f.detail}</span>
                  </div>
                </div>
              ))}
          </div>

          {p?.seen && (
            <div style={{ borderTop: "1px solid var(--w-06)", padding: "var(--sp-6) var(--sp-7)",
              display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span style={label}>What the engine saw</span>
              <Fact name="Processor" value={p.physicalCores == null ? null
                : `${p.physicalCores} cores / ${p.logicalCores ?? "?"} threads`} />
              <Fact name="Graphics" value={p.glRenderer} />
              <Fact name="Vendor" value={p.glVendor} />
              <Fact name="Video memory" value={p.vramTotalMb == null ? null
                : `${p.vramTotalMb} MB${p.vramFreeMb ? `, ${p.vramFreeMb} MB free` : ""}`} />
              <Fact name="OpenGL" value={p.glVersion} />
              <Fact name="Window" value={p.window} />
              <Fact name="SDL" value={p.sdlVersion} />
            </div>
          )}

          {v?.preset && (
            <div style={{ borderTop: "1px solid var(--w-06)", padding: "var(--sp-6) var(--sp-7)",
              display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
              <span style={label}>Suggested</span>
              <Badge tone="solid">{v.preset}</Badge>
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", flex: 1 }}>
                {v.reason}
              </span>
            </div>
          )}

          <div style={{ padding: "var(--sp-6) var(--sp-7)" }}>
            <Button variant="secondary" size="sm" onClick={onRun}>Check again</Button>
          </div>
        </>
      )}
    </div>
  );
}
