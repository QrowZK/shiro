import React from "react";
import { BattleRow, Button, Input, Select, Checkbox, Badge,
  MapImage, UserChip, EmptyState, IconButton } from "../ds/shiro.js";
import { useMapResourceId } from "../hooks/useMapResourceId.js";

const DEMO_OCCUPANTS = ["hexed", "quantum", "tinman", "lorelei", "marrow", "nine"];

/* Screen 3 - the default view and the highest-traffic surface.
   Left: filter strip. Centre: the list. Right: detail for the selected battle. */
export default function BattleListScreen({ battles, onJoin, empty, onToggleEmpty, occupants, onHost, onSpectate }) {
  const [sel, setSel] = React.useState(battles[0] && battles[0].id);
  const [q, setQ] = React.useState("");
  const [mode, setMode] = React.useState("All modes");
  const [hideRunning, setHideRunning] = React.useState(false);
  const [hideLocked, setHideLocked] = React.useState(false);
  const list = (empty ? [] : battles).filter(b =>
    (mode === "All modes" || b.mode === mode) &&
    (!hideRunning || !b.running) &&
    (!hideLocked || !b.locked) &&
    (q === "" || (b.title + " " + b.founder + " " + b.map).toLowerCase().includes(q.toLowerCase())));
  const current = list.find(b => b.id === sel) || list[0];
  const mapId = useMapResourceId(current && current.map);
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 300px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-5)",
        borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
        <Button variant="primary" icon="plus" block onClick={onHost}>Host a battle</Button>
        <Input label="Filter" placeholder="Title, host, map" icon="search" value={q} onChange={e => setQ(e.target.value)} />
        <Select label="Mode" value={mode} onChange={e => setMode(e.target.value)}
          options={["All modes", "Teams", "1v1", "FFA", "Coop"]} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Checkbox label="Hide running" checked={hideRunning} onChange={e => setHideRunning(e.target.checked)} />
          <Checkbox label="Hide passworded" checked={hideLocked} onChange={e => setHideLocked(e.target.checked)} />
          <Checkbox label="Show off-peak state" checked={empty} onChange={onToggleEmpty} hint="Demo toggle" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ height: 26, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-5) 0 var(--sp-5)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab" style={{ width: 96 }}>MAP</span>
          <span className="lab" style={{ flex: 1 }}>BATTLE</span>
          <span className="lab" style={{ width: 88, textAlign: "right" }}>MODE</span>
          <span className="lab" style={{ width: 62, textAlign: "right" }}>PLAYERS</span>
          <span className="lab" style={{ width: 44, textAlign: "right" }}>SPEC</span>
          <span style={{ width: 74 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {list.length === 0
            ? <EmptyState numeral={100} title="No battles open right now."
                action={<Button variant="primary" icon="plus" onClick={onHost}>Host a battle</Button>} />
            : list.map((b, i) => (
              <BattleRow key={b.id} {...b} selected={current && current.id === b.id}
                onClick={() => setSel(b.id)} onJoin={() => onJoin(b)}
                style={{ animation: "shiro-enter var(--dur-base) var(--ease-out) " + Math.min(i, 12) * 12 + "ms both" }} />
            ))}
        </div>
      </div>

      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        {current ? (
          <>
            <MapImage map={current.map} resourceId={mapId} kind="minimap" ratio="1" caption link saturate={1} style={{ flex: "0 0 auto" }} />
            <div style={{ padding: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-5)",
              borderBottom: "1px solid var(--w-06)" }}>
              <span style={{ font: "var(--text-heading)", color: "var(--text-hi)" }}>{current.title}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
                <Badge tone="outline">{current.mode}</Badge>
                <Badge mono>{current.players}/{current.maxPlayers}</Badge>
                {current.locked && <Badge tone="outline" icon="lock">Locked</Badge>}
                {current.running && <Badge tone="danger">In progress</Badge>}
                {current.matchmaker && <Badge tone="solid">MM</Badge>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sp-3) var(--sp-5)" }}>
                <span className="lab">HOST</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{current.founder}</span>
                <span className="lab">MAP</span>
                <span style={{ font: "var(--w-medium) var(--size-tiny)/1.3 var(--font-mono)", color: "var(--text-body)",
                  overflowWrap: "anywhere" }}>{current.map}</span>
                <span className="lab">ENGINE</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.3 var(--font-mono)", color: "var(--text-faint)" }}>2025.06.21</span>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)" }}>
              <span className="lab">IN THIS ROOM</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", marginTop: "var(--sp-4)" }}>
                {(() => {
                  /* Live occupancy is derived from User.BattleID - BattleHeader
                     carries no roster, and the full player list only arrives in
                     JoinBattleSuccess once you are actually in the room. */
                  const names = occupants ? occupants(current.id) : DEMO_OCCUPANTS;
                  const shown = names.slice(0, 6);
                  const rest = Math.max(0, (occupants ? names.length : current.players) - shown.length);
                  if (!shown.length) {
                    return <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
                      color: "var(--text-faint)" }}>Nobody here yet.</span>;
                  }
                  return (
                    <>
                      {shown.map(n => <UserChip key={n} name={n} presence="room" size="sm" />)}
                      {rest > 0 && <span className="lab">+{rest} MORE</span>}
                    </>
                  );
                })()}
              </div>
            </div>
            <div style={{ padding: "var(--sp-5)", borderTop: "1px solid var(--w-12)", display: "flex", gap: "var(--sp-4)" }}>
              <Button variant="primary" size="lg" style={{ flex: 1 }} icon={current.running ? "eye" : "play"}
                onClick={() => onJoin(current)}>{current.running ? "Watch" : "Join battle"}</Button>
              <IconButton icon="eye" label="Spectate" variant="outline" size="lg"
                onClick={() => (onSpectate ? onSpectate(current) : onJoin(current))} />
            </div>
          </>
        ) : <EmptyState icon="swords" title="Nothing selected." />}
      </div>
    </div>
  );
}
