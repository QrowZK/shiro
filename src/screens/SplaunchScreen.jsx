import React from "react";
import { Button, Badge, Input, Select, MapImage, EmptyState } from "../ds/shiro.js";

/* Splaunch. Place units on a map, set objectives, press Test.
 *
 * Test is not a preview: a scenario compiles to a Spring start script and
 * launches the real game into it. See docs/SCENARIO-EDITOR.md, and
 * src-tauri/src/scenario.rs for the writer.
 *
 * The map is drawn as the minimap zero-k.info already serves, which is what
 * makes this a prototype rather than the tool: it gives real terrain to aim at
 * but no heightmap, so nothing here can yet tell you that you have put a tank
 * in the sea. That is the next thing to add, and springen-smf already reads
 * heightmaps out of an .sd7. */

const label = {
  font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-faint)",
};

/* A working set of Zero-K units, by role. Deliberately short and hand-written:
   the authoritative list lives in zk-stable.sdz, which is a rapid package this
   client cannot read yet, and a long guessed list would be worse than a short
   true one. */
export const UNITS = [
  { group: "Commanders", items: ["armcom", "commsupport", "commrecon"] },
  { group: "Bots", items: ["armpw", "armrock", "armwar", "armzeus", "armsnipe"] },
  { group: "Vehicles", items: ["armflash", "armrecl", "corgator", "correap"] },
  { group: "Aircraft", items: ["armkam", "blastwing", "armbrawl"] },
  { group: "Defences", items: ["armllt", "corllt", "armdeva", "corhlt"] },
  { group: "Economy", items: ["armmex", "armsolar", "armwin", "armestor"] },
];

/** The game's own team colours, so an author thinking "red team" gets red. */
export const TEAM_COLOURS = [
  { rgb: "0 0 1", css: "#3b6cf5", name: "Blue" },
  { rgb: "1 0 0", css: "#e0403a", name: "Red" },
  { rgb: "0 1 0", css: "#3fbf4a", name: "Green" },
  { rgb: "1 1 0", css: "#e8c81e", name: "Yellow" },
];

/** Map pixels to elmos. Spring maps are `size * 512` elmos on a side. */
export function toElmos(fraction, mapSizeElmos) {
  return Math.round(Math.max(0, Math.min(1, fraction)) * mapSizeElmos);
}

export default function SplaunchScreen({
  maps = [], engine, player = "Player", game = "",
  onTest, onBack, testError, running,
}) {
  const [map, setMap] = React.useState("");
  const [mapQuery, setMapQuery] = React.useState("");
  const [units, setUnits] = React.useState([]);
  const [sel, setSel] = React.useState(null);
  const [brush, setBrush] = React.useState("armcom");
  const [team, setTeam] = React.useState(0);
  const [objectives, setObjectives] = React.useState(["Destroy all enemy units"]);
  const [objective, setObjective] = React.useState("");
  const boardRef = React.useRef(null);

  // 8x8 is the common Zero-K size; the real value comes from the map's own
  // header, which needs the archive - so this is stated rather than implied.
  const MAP_ELMOS = 8 * 512;

  const teams = React.useMemo(() => ([
    { id: 0, ally: 0, ai: null, colour: TEAM_COLOURS[0].rgb },
    { id: 1, ally: 1, ai: "NullAI", colour: TEAM_COLOURS[1].rgb },
  ]), []);

  const scenario = React.useMemo(() => ({
    name: map ? `${map} scenario` : "Untitled",
    map, game, teams, units, objectives,
  }), [map, game, teams, units, objectives]);

  const problems = React.useMemo(() => {
    const out = [];
    if (!map) out.push("No map chosen.");
    if (!units.length) out.push("Nothing placed yet.");
    if (!units.some(u => u.team === 0)) out.push("The player team has no units.");
    if (!units.some(u => u.team !== 0)) out.push("There is no opposition.");
    return out;
  }, [map, units]);

  const place = e => {
    if (!map) return;
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return;
    const fx = (e.clientX - box.left) / box.width;
    const fz = (e.clientY - box.top) / box.height;
    setUnits(u => [...u, {
      unit: brush, team,
      x: toElmos(fx, MAP_ELMOS), z: toElmos(fz, MAP_ELMOS),
      key: `${Date.now()}-${u.length}`,
    }]);
  };

  const shown = maps.filter(m =>
    !mapQuery.trim() || m.toLowerCase().includes(mapQuery.trim().toLowerCase()));

  if (!map) {
    // A map picker, not a blank canvas: with no map there is nothing to aim at.
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 44, display: "flex", alignItems: "center", gap: "var(--sp-5)",
          padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          {onBack && <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>Apps</Button>}
          <span className="lab">SPLAUNCH</span>
        </div>
        <div style={{ padding: "var(--sp-7)", display: "flex", flexDirection: "column",
          gap: "var(--sp-5)", maxWidth: 520 }}>
          <span style={{ font: "var(--w-bold) var(--size-xl)/1.1 var(--font-core)",
            color: "var(--text-hi)" }}>Pick a map</span>
          <Input placeholder="Search maps" value={mapQuery} icon="search"
            onChange={e => setMapQuery(e.target.value)} />
          {shown.length === 0 ? (
            <EmptyState icon="map" title="No maps known yet."
              body="Maps appear once the catalogue has loaded, or once you have been in a room." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {shown.slice(0, 40).map(m => (
                <button key={m} type="button" onClick={() => setMap(m)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)",
                    padding: "var(--sp-3) var(--sp-4)", cursor: "pointer", textAlign: "left",
                    background: "transparent", border: 0, boxShadow: "var(--rule-inset)",
                    color: "inherit", font: "inherit" }}>
                  <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{m}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const selected = units.find(u => u.key === sel);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
        gap: "var(--sp-5)", padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
        {onBack && <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>Apps</Button>}
        <span className="lab">SPLAUNCH</span>
        <span style={{ font: "var(--text-ui)", color: "var(--text-hi)" }}>{map}</span>
        <Button variant="ghost" size="sm" onClick={() => { setMap(""); setUnits([]); setSel(null); }}>
          Change map
        </Button>
        <span style={{ flex: 1 }} />
        {problems.length > 0 && (
          <Badge tone="outline">{problems.length} to fix</Badge>
        )}
        <Button variant="primary" size="sm" disabled={problems.length > 0 || running}
          onClick={() => onTest?.(scenario)}>
          {running ? "Game running" : "Test"}
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: "200px minmax(0,1fr) 260px" }}>
        {/* Palette */}
        <div style={{ borderRight: "1px solid var(--w-12)", overflowY: "auto",
          padding: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            <span style={label}>Placing for</span>
            <Select size="sm" value={String(team)} onChange={e => setTeam(Number(e.target.value))}
              options={teams.map(t => ({
                value: String(t.id),
                label: `${TEAM_COLOURS[t.id]?.name || `Team ${t.id}`}${t.ai ? " (AI)" : " (you)"}`,
              }))} />
          </div>
          {UNITS.map(g => (
            <div key={g.group} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span style={label}>{g.group}</span>
              {g.items.map(u => (
                <button key={u} type="button" onClick={() => setBrush(u)}
                  style={{ textAlign: "left", padding: "var(--sp-2) var(--sp-3)", cursor: "pointer",
                    border: 0, background: brush === u ? "var(--w-12)" : "transparent",
                    font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                    color: brush === u ? "var(--text-hi)" : "var(--text-body)" }}>
                  {u}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* The map. Click to place. */}
        <div style={{ position: "relative", minWidth: 0, display: "flex",
          alignItems: "center", justifyContent: "center", padding: "var(--sp-5)" }}>
          <div ref={boardRef} onClick={place}
            style={{ position: "relative", width: "min(100%, 70vh)", aspectRatio: "1",
              cursor: "crosshair", border: "1px solid var(--w-20)" }}>
            <MapImage map={map} kind="minimap" ratio="1" saturate={0.8}
              style={{ position: "absolute", inset: 0 }} />
            {units.map(u => (
              <button key={u.key} type="button"
                title={`${u.unit} (${u.x}, ${u.z})`}
                onClick={e => { e.stopPropagation(); setSel(u.key); }}
                style={{
                  position: "absolute",
                  left: `${(u.x / MAP_ELMOS) * 100}%`,
                  top: `${(u.z / MAP_ELMOS) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 14, height: 14, borderRadius: "50%", cursor: "pointer", padding: 0,
                  background: TEAM_COLOURS[u.team]?.css || "#888",
                  border: sel === u.key ? "2px solid var(--text-hi)" : "1px solid rgba(0,0,0,0.5)",
                }} />
            ))}
          </div>
        </div>

        {/* What is selected, and the objectives. */}
        <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
          padding: "var(--sp-5)", overflowY: "auto", display: "flex",
          flexDirection: "column", gap: "var(--sp-6)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span style={label}>Selection</span>
            {selected ? (
              <>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-hi)" }}>{selected.unit}</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-low)" }}>{selected.x}, {selected.z} elmos</span>
                <Button size="sm" variant="ghost" onClick={() => {
                  setUnits(u => u.filter(x => x.key !== selected.key)); setSel(null);
                }}>Remove</Button>
              </>
            ) : (
              /* On screen more than any other state in the tool, so it says
                 what to do rather than sitting blank. */
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)", lineHeight: 1.5 }}>
                Pick a unit on the left, then click the map to place it. Click a
                placed unit to select it.
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <span style={label}>Objectives</span>
            {objectives.map((o, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", flex: 1 }}>{o}</span>
                <Button size="sm" variant="ghost"
                  onClick={() => setObjectives(v => v.filter((_, j) => j !== i))}>-</Button>
              </div>
            ))}
            <Input size="sm" placeholder="Add an objective" value={objective}
              onChange={e => setObjective(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && objective.trim()) {
                  setObjectives(v => [...v, objective.trim()]);
                  setObjective("");
                }
              }} />
          </div>

          {problems.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span style={label}>Before you can test</span>
              {problems.map(p => (
                <span key={p} style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)" }}>{p}</span>
              ))}
            </div>
          )}
          {testError && (
            <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>{testError}</span>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <span style={label}>Note</span>
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-faint)", lineHeight: 1.5 }}>
              Positions are placed against the minimap, so nothing here knows yet
              where the water is. Check the terrain when you test.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
