import React from "react";
import { Dialog, Button, Input, Select } from "../ds/shiro.js";
import { findMaps } from "../net/zkcatalogue.ts";

/* Opening a room. `OpenBattle` takes a whole BattleHeader, but the server
   fills in most of it; these are the five fields a host actually chooses.
   Engine is not offered - it comes from Welcome, so the room runs what
   everyone else is running and is joinable by everyone else. */
const SIZES = ["2", "4", "6", "8", "12", "16", "24", "32"];

export default function HostBattleDialog({ open, onClose, onHost, defaultTitle, maps }) {
  const [title, setTitle] = React.useState("");
  const [map, setMap] = React.useState("");
  const [size, setSize] = React.useState("16");
  const [password, setPassword] = React.useState("");
  const [found, setFound] = React.useState([]);

  /* Reset each time it opens: a dialog that remembers the last attempt is a
     dialog that hosts the wrong room when you reopen it by accident.

     The map starts empty rather than at `maps[0]`. That default was the whole
     of the "it only offers one arbitrary map" complaint - the suggestion list
     is whatever happens to be in an open battle right now, so off-peak it is
     one map, and pre-filling it made that one map look like the only choice. */
  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle || "");
    setMap("");
    setSize("16");
    setPassword("");
    setFound([]);
  }, [open, defaultTitle]);

  /* Search Zero-K's own catalogue as you type. The lobby protocol has no way to
     list maps, so without this the only names on offer are the handful the
     server has mentioned in open battles. Debounced, because this is a network
     round trip per keystroke otherwise. */
  React.useEffect(() => {
    const q = map.trim();
    if (!open || q.length < 3) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => {
      findMaps(q).then(
        hits => { if (live) setFound(hits); },
        () => { if (live) setFound([]); },   // offline is not worth an error here
      );
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, map]);

  /* What the catalogue found, then what is already in play. Deduped, and the
     search comes first because it is ranked - matchmaker maps at the top. */
  const suggestions = React.useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const name of [...found.map(f => f.name), ...(maps || [])]) {
      if (name && !seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out.slice(0, 40);
  }, [found, maps]);

  const ready = title.trim() !== "" && map.trim() !== "";
  const submit = () => {
    if (!ready) return;
    onHost({ title: title.trim(), map: map.trim(), maxPlayers: Number(size), password: password.trim() });
    onClose();
  };

  return (
    <Dialog open={open} title="Host a battle" width={440} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} onClick={submit}>Open room</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
        <Input label="Title" placeholder="Teams 8v8 - all welcome" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        {/* Free text with suggestions rather than a fixed list: a map nobody has
            played recently is still hostable, and Shiro can download it now. */}
        <Input label="Map" placeholder="Type to search" value={map} list="shiro-maps"
          onChange={e => setMap(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        <datalist id="shiro-maps">
          {suggestions.map(m => <option key={m} value={m} />)}
        </datalist>
        <Select label="Player slots" value={size} onChange={e => setSize(e.target.value)} options={SIZES} />
        <Input label="Password" placeholder="Leave empty for an open room" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      </div>
    </Dialog>
  );
}
