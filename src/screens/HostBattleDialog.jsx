import React from "react";
import { Dialog, Button, Input, Select } from "../ds/shiro.js";

/* Opening a room. `OpenBattle` takes a whole BattleHeader, but the server
   fills in most of it; these are the five fields a host actually chooses.
   Engine and game are not offered - they come from Welcome, so the room runs
   what everyone else is running and is joinable by everyone else. */
const SIZES = ["2", "4", "6", "8", "12", "16", "24", "32"];

export default function HostBattleDialog({ open, onClose, onHost, defaultTitle, maps }) {
  const [title, setTitle] = React.useState("");
  const [map, setMap] = React.useState("");
  const [size, setSize] = React.useState("16");
  const [password, setPassword] = React.useState("");

  /* Reset each time it opens: a dialog that remembers the last attempt is a
     dialog that hosts the wrong room when you reopen it by accident. */
  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle || "");
    setMap((maps && maps[0]) || "");
    setSize("16");
    setPassword("");
  }, [open, defaultTitle, maps]);

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
        {/* Maps are whatever the server has seen in open battles this session -
            there is no "list all maps" command in the protocol. Free text, so a
            map that has not come up yet is still hostable. */}
        <Input label="Map" placeholder="Comet Catcher Redux" value={map} list="shiro-maps"
          onChange={e => setMap(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          hint={maps && maps.length ? maps.length + " maps seen this session" : undefined} />
        <datalist id="shiro-maps">
          {(maps || []).map(m => <option key={m} value={m} />)}
        </datalist>
        <Select label="Player slots" value={size} onChange={e => setSize(e.target.value)} options={SIZES} />
        <Input label="Password" placeholder="Leave empty for an open room" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      </div>
    </Dialog>
  );
}
