import React from "react";
import {
  Button, Badge, Input, Select, Tabs, Dialog, MapImage, Icon, IconButton, EmptyState,
} from "../ds/shiro.js";

/* Splaunch. Place units on a map, set objectives, press Test.
 *
 * Test is not a preview: a scenario compiles to a Spring start script and
 * launches the real game into it. See docs/SCENARIO-EDITOR.md, and
 * src-tauri/src/scenario.rs for the writer.
 *
 * Layout follows the design kit - palette, map, and a right pane that tabs
 * between the selection and the objectives - with one deliberate omission. The
 * kit draws water and slope over the map, which is the right answer and the
 * thing that stops somebody putting a tank in the sea. We have no heightmap
 * yet, so drawing them would mean drawing them somewhere invented. The screen
 * says the terrain is unchecked instead; springen-smf reads heightmaps out of
 * an .sd7 and is the way in. */

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
];

/** Map pixels to elmos. Spring maps are `size * 512` elmos on a side. */
export function toElmos(fraction, mapSizeElmos) {
  return Math.round(Math.max(0, Math.min(1, fraction)) * mapSizeElmos);
}

function Palette({ query, setQuery, brush, setBrush }) {
  const q = query.trim().toLowerCase();
  const groups = UNITS
    .map(g => ({ ...g, items: g.items.filter(u => !q || u.includes(q) || g.group.toLowerCase().includes(q)) }))
    .filter(g => g.items.length);

  return (
    <div style={{ width: 224, flex: "0 0 auto", display: "flex", flexDirection: "column",
      minHeight: 0, borderRight: "1px solid var(--w-12)", background: "var(--surface-sunken)" }}>
      <div style={{ padding: "var(--sp-5)", borderBottom: "1px solid var(--w-06)" }}>
        <Input label="Palette" icon="search" placeholder="Unit" value={query}
          onChange={e => setQuery(e.target.value)} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-5)" }}>
        {groups.map(g => (
          <div key={g.group} style={{ marginBottom: "var(--sp-6)" }}>
            <span style={label}>{g.group}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)",
              gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
              {g.items.map(u => (
                <button key={u} type="button" onClick={() => setBrush(u)}
                  style={{ padding: "var(--sp-3)", cursor: "pointer", textAlign: "left",
                    background: brush === u ? "var(--surface-inverse)" : "transparent",
                    color: brush === u ? "var(--text-inverse)" : "var(--text-body)",
                    border: "1px solid " + (brush === u ? "var(--surface-inverse)" : "var(--w-12)"),
                    font: "var(--w-medium) var(--size-tiny)/1.2 var(--font-mono)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u}
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <EmptyState icon="search" title="Nothing matches that."
            body="Try a shorter word - the list is short for now." />
        )}
      </div>
    </div>
  );
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
  const [paletteQuery, setPaletteQuery] = React.useState("");
  const [team, setTeam] = React.useState(0);
  const [objectives, setObjectives] = React.useState(["Destroy all enemy units"]);
  const [objective, setObjective] = React.useState("");
  const [tab, setTab] = React.useState("selection");
  const [issuesOpen, setIssuesOpen] = React.useState(false);
  const [blockedOpen, setBlockedOpen] = React.useState(false);
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
    if (!units.length) out.push("Nothing has been placed yet.");
    if (!units.some(u => u.team === 0)) out.push("No unit belongs to the player's team.");
    if (!units.some(u => u.team !== 0)) out.push("There is no opposition, so the game ends at once.");
    if (!objectives.length) out.push("The scenario has no objectives, so it cannot be won.");
    return out;
  }, [units, objectives]);

  const place = e => {
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return;
    const fx = (e.clientX - box.left) / box.width;
    const fz = (e.clientY - box.top) / box.height;
    const key = `u${Date.now()}`;
    setUnits(u => [...u, { unit: brush, team, x: toElmos(fx, MAP_ELMOS), z: toElmos(fz, MAP_ELMOS), key }]);
    setSel(key);
    setTab("selection");
  };

  const test = () => {
    if (running) { setBlockedOpen(true); return; }
    if (problems.length) { setIssuesOpen(true); return; }
    onTest?.(scenario);
  };

  const shownMaps = maps.filter(m =>
    !mapQuery.trim() || m.toLowerCase().includes(mapQuery.trim().toLowerCase()));

  /* A map picker, not a blank canvas: with no map there is nothing to aim at. */
  if (!map) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: "var(--sp-5)", padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          {onBack && <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>Apps</Button>}
          <span style={label}>SPLAUNCH — NEW SCENARIO</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-7)" }}>
          <div style={{ maxWidth: 420, marginBottom: "var(--sp-6)" }}>
            <Input label="Choose a map" icon="search" placeholder="Search maps"
              value={mapQuery} onChange={e => setMapQuery(e.target.value)} />
          </div>
          {shownMaps.length === 0 ? (
            <EmptyState icon="map" title="No maps known yet."
              body="Maps appear once you have been in a room, or once the catalogue has loaded." />
          ) : (
            <div style={{ display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "var(--sp-5)" }}>
              {shownMaps.slice(0, 24).map(m => (
                <button key={m} type="button" onClick={() => setMap(m)} aria-label={m}
                  style={{ cursor: "pointer", background: "transparent", border: 0,
                    padding: 0, textAlign: "left", color: "inherit", font: "inherit" }}>
                  <MapImage map={m} kind="minimap" ratio="1" caption />
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
        <span style={{ font: "var(--w-semibold) var(--size-base)/1 var(--font-core)",
          color: "var(--text-hi)" }}>{scenario.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-mono)",
          color: "var(--text-faint)" }}>{map}</span>
        <Button variant="ghost" size="sm"
          onClick={() => { setMap(""); setUnits([]); setSel(null); }}>Change map</Button>
        <span style={{ flex: 1 }} />
        {problems.length > 0 && (
          <button type="button" onClick={() => setIssuesOpen(true)}
            style={{ background: "none", border: "1px solid var(--signal-danger)", cursor: "pointer",
              height: 20, padding: "0 var(--sp-3)", color: "var(--signal-danger)",
              font: "var(--w-semibold) var(--size-micro)/1 var(--font-core)",
              letterSpacing: "var(--track-label)", textTransform: "uppercase" }}>
            {problems.length} problem{problems.length > 1 ? "s" : ""}
          </button>
        )}
        <Button variant="primary" size="sm" icon="play" onClick={test}>Test</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Palette query={paletteQuery} setQuery={setPaletteQuery} brush={brush} setBrush={setBrush} />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex",
            alignItems: "center", justifyContent: "center", padding: "var(--sp-5)" }}>
            <div ref={boardRef} onClick={place}
              style={{ position: "relative", width: "min(100%, 68vh)", aspectRatio: "1",
                cursor: "crosshair", border: "1px solid var(--w-20)" }}>
              <MapImage map={map} kind="minimap" ratio="1" saturate={0.7}
                style={{ position: "absolute", inset: 0 }} />
              {units.map(u => (
                <button key={u.key} type="button" title={`${u.unit} (${u.x}, ${u.z})`}
                  onClick={e => { e.stopPropagation(); setSel(u.key); setTab("selection"); }}
                  style={{
                    position: "absolute",
                    left: `${(u.x / MAP_ELMOS) * 100}%`,
                    top: `${(u.z / MAP_ELMOS) * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: sel === u.key ? 14 : 11, height: sel === u.key ? 14 : 11,
                    padding: 0, cursor: "pointer", border: 0,
                    background: TEAM_COLOURS[u.team]?.css || "#888",
                    boxShadow: sel === u.key
                      ? "0 0 0 1px #000, 0 0 0 3px #fff"
                      : "0 0 0 1px rgba(0,0,0,.6)",
                  }} />
              ))}
            </div>
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center",
            gap: "var(--sp-5)", padding: "var(--sp-4) var(--sp-5)",
            borderTop: "1px solid var(--w-12)" }}>
            <Select size="sm" wrapStyle={{ width: 160 }} value={String(team)}
              onChange={e => setTeam(Number(e.target.value))}
              options={teams.map(t => ({ value: String(t.id),
                label: `${TEAM_COLOURS[t.id].name}${t.ai ? " (AI)" : " (you)"}` }))} />
            <span style={{ font: "var(--w-regular) var(--size-micro)/1 var(--font-core)",
              color: "var(--text-low)", textTransform: "uppercase",
              letterSpacing: "var(--track-label)" }}>Click to place {brush}</span>
            <span style={{ flex: 1 }} />
            <span style={label}>{units.length} placed</span>
          </div>
        </div>

        <div style={{ width: 300, flex: "0 0 auto", borderLeft: "1px solid var(--w-12)",
          background: "var(--surface-panel)", display: "flex", flexDirection: "column",
          minHeight: 0 }}>
          <Tabs value={tab} onChange={setTab} items={[
            { id: "selection", label: "Selection" },
            { id: "objectives", label: "Objectives", unread: objectives.length || undefined },
          ]} />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {tab === "selection" ? (
              selected ? (
                <div style={{ padding: "var(--sp-6) var(--sp-5)", display: "flex",
                  flexDirection: "column", gap: "var(--sp-5)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <span style={{ width: 10, height: 10,
                      background: TEAM_COLOURS[selected.team]?.css }} />
                    <span style={{ font: "var(--text-heading)", color: "var(--text-hi)" }}>
                      {selected.unit}
                    </span>
                    <span style={{ flex: 1 }} />
                    <IconButton icon="x" label="Delete" size="sm" onClick={() => {
                      setUnits(u => u.filter(x => x.key !== selected.key)); setSel(null);
                    }} />
                  </div>
                  <Select label="Team" value={String(selected.team)}
                    onChange={e => setUnits(u => u.map(x =>
                      x.key === selected.key ? { ...x, team: Number(e.target.value) } : x))}
                    options={teams.map(t => ({ value: String(t.id), label: TEAM_COLOURS[t.id].name }))} />
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr",
                    gap: "var(--sp-3) var(--sp-5)", alignItems: "baseline" }}>
                    <span style={label}>Position</span>
                    <span style={{ font: "var(--w-regular) var(--size-tiny)/1 var(--font-mono)",
                      color: "var(--text-body)" }}>{selected.x}, {selected.z} elmos</span>
                  </div>
                </div>
              ) : (
                /* On screen more than any other state in the tool, so it says
                   what to do rather than sitting blank. */
                <EmptyState icon="target" title="Nothing selected."
                  body="Pick a unit on the left, then click the map to place it. Click a placed unit to edit it."
                  style={{ padding: "var(--sp-8) var(--sp-6)" }} />
              )
            ) : (
              <div style={{ padding: "var(--sp-5)", display: "flex", flexDirection: "column",
                gap: "var(--sp-4)" }}>
                {objectives.map((o, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start",
                    gap: "var(--sp-4)", padding: "var(--sp-4)", background: "var(--surface-base)",
                    border: "1px solid var(--w-12)" }}>
                    <span style={{ font: "var(--w-regular) var(--size-micro)/1.4 var(--font-mono)",
                      color: "var(--text-faint)" }}>{i + 1}</span>
                    <span style={{ flex: 1, font: "var(--text-ui-sm)", color: "var(--text-body)" }}>{o}</span>
                    <IconButton icon="x" label="Remove" size="sm"
                      onClick={() => setObjectives(v => v.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {objectives.length === 0 && (
                  <EmptyState icon="target" title="No objectives yet."
                    body="A scenario with no objective cannot be won." />
                )}
                <Input size="sm" placeholder="Add an objective" value={objective}
                  onChange={e => setObjective(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && objective.trim()) {
                      setObjectives(v => [...v, objective.trim()]);
                      setObjective("");
                    }
                  }} />
                <span style={{ font: "var(--w-regular) var(--size-micro)/1.5 var(--font-core)",
                  color: "var(--text-faint)" }}>
                  Each objective is a sentence, and the list is the whole model. Not a node graph.
                </span>
              </div>
            )}
          </div>

          <div style={{ flex: "0 0 auto", padding: "var(--sp-5)",
            borderTop: "1px solid var(--w-06)", display: "flex",
            flexDirection: "column", gap: "var(--sp-2)" }}>
            <span style={label}>Terrain</span>
            <span style={{ font: "var(--w-regular) var(--size-micro)/1.5 var(--font-core)",
              color: "var(--text-faint)" }}>
              Positions are placed against the minimap, so nothing here knows yet
              where the water is or how steep the ground gets. Check when you test.
            </span>
          </div>
        </div>
      </div>

      <Dialog open={issuesOpen} title="Before you test" width={440}
        onClose={() => setIssuesOpen(false)}
        footer={<Button variant="primary" onClick={() => setIssuesOpen(false)}>Back to the map</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {problems.map(t => (
            <div key={t} style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start" }}>
              <Icon name="alert-triangle" size={14}
                style={{ color: "var(--signal-danger)", marginTop: 2 }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)",
                lineHeight: 1.5 }}>{t}</span>
            </div>
          ))}
          {testError && (
            <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>{testError}</span>
          )}
        </div>
      </Dialog>

      <Dialog open={blockedOpen} title="Cannot test" width={400}
        onClose={() => setBlockedOpen(false)}
        footer={<Button variant="primary" onClick={() => setBlockedOpen(false)}>Close</Button>}>
        <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.55 }}>
          Zero-K is already running. Testing starts a new game, and the engine will
          only run one at a time. Quit the running match first.
        </span>
      </Dialog>
    </div>
  );
}
