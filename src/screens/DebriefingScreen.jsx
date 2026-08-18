import React from "react";
import { Meter, Badge, Tag, Button, RatingDelta, UserChip, MapImage, EmptyState } from "../ds/shiro.js";
import { openExternal } from "../net/external.ts";

/* Screen 7 - the richest payload in the protocol, arriving at the emotional
   peak of the session. Display type states the result; everything else is mono. */
export function ResultRow({ p }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
      height: "var(--row-default)", padding: "0 var(--sp-4)", boxShadow: "var(--rule-inset)" }}>
      <UserChip {...p.user} size="sm" style={{ flex: 1, minWidth: 0 }} />
      <span style={{ width: 46, textAlign: "right", font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
        color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{p.elo}</span>
      <span style={{ width: 40, textAlign: "right" }}><RatingDelta value={p.change} size="sm" /></span>
    </div>
  );
}

export default function DebriefingScreen({ d, onBack }) {
  /* There is no request for past battles - the server pushes one debriefing
     after a match you played in - so an empty screen is the normal state for
     most of a session, not an error. See store/history.ts. */
  if (!d) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="trophy" title="No matches yet this session."
          body="Play a game and the result lands here - ratings, awards and the link to the full record."
          action={<Button variant="primary" onClick={onBack}>Find a battle</Button>} />
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-8)", padding: "var(--sp-9) var(--sp-8) var(--sp-8)",
          borderBottom: "1px solid var(--w-12)" }}>
          <span style={{ font: "var(--text-display)", letterSpacing: "var(--track-display)",
            color: "var(--text-hi)" }}>{d.result}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: 6 }}>
            <span className="lab">{d.mode} - {d.category}</span>
            <span style={{ font: "var(--w-medium) var(--size-small)/1 var(--font-mono)", color: "var(--text-mid)" }}>{d.duration}</span>
          </div>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onBack}>Back to battles</Button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--w-12)" }}>
          <div style={{ borderRight: "1px solid var(--w-06)" }}>
            <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-4)",
              borderBottom: "1px solid var(--w-06)", background: "var(--w-04)" }}>
              <span className="lab">{d.teamLabel || "YOUR TEAM - WON"}</span>
            </div>
            {d.team.map((p, i) => <ResultRow key={i} p={p} />)}
          </div>
          <div>
            <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-4)",
              borderBottom: "1px solid var(--w-06)" }}>
              <span className="lab">{d.opponentsLabel || "OPPONENTS"}</span>
            </div>
            {d.opponents.map((p, i) => <ResultRow key={i} p={p} />)}
          </div>
        </div>

        <div style={{ padding: "var(--sp-6) var(--sp-8)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <span className="lab">AWARDS</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }}>
            {d.awards.length
              ? d.awards.map(a => <Tag key={a.name} value={a.value}>{a.name}</Tag>)
              : <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-faint)" }}>
                  No awards in this match.
                </span>}
          </div>
          {d.message && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
              {d.message}
            </span>
          )}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <MapImage map={d.map} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
        <div style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-8)",
          flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* A debriefing for a match you only watched carries no progression
              of your own - the panels stand down rather than render zeroes. */}
          {d.elo && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">RATING</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-5)" }}>
                <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>{d.elo.next}</span>
                <RatingDelta value={d.elo.change} size="md" />
              </div>
              {d.elo.rankup && <Badge tone="solid" icon="chevron-up">Rank up - {d.elo.rank}</Badge>}
              {d.elo.nextRankElo > d.elo.prevRankElo && (
                <Meter label={"Next rank"} right={d.elo.next + " / " + d.elo.nextRankElo}
                  value={d.elo.next - d.elo.prevRankElo} max={d.elo.nextRankElo - d.elo.prevRankElo} />
              )}
            </div>
          )}
          {d.xp && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <span className="lab">EXPERIENCE</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-5)" }}>
                <span style={{ font: "var(--w-bold) var(--size-xl)/1 var(--font-mono)", color: "var(--text-hi)",
                  fontVariantNumeric: "tabular-nums" }}>L{d.xp.level != null ? d.xp.level : "?"}</span>
                <RatingDelta value={d.xp.change} size="sm" />
              </div>
              {d.xp.nextLevelXp > d.xp.prevLevelXp && (
                <Meter label="Next level" right={d.xp.next + " / " + d.xp.nextLevelXp}
                  value={d.xp.next - d.xp.prevLevelXp} max={d.xp.nextLevelXp - d.xp.prevLevelXp} />
              )}
            </div>
          )}
        </div>
        <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)", display: "flex", gap: "var(--sp-4)" }}>
          <Button variant="primary" size="lg" style={{ flex: 1 }} icon="rotate-ccw" onClick={onBack}>Play again</Button>
          {d.url && (
            <Button variant="secondary" size="lg" icon="external-link" title="Open the full record on zero-k.info"
              onClick={() => openExternal(d.url)}>Details</Button>
          )}
        </div>
      </div>
    </div>
  );
}
