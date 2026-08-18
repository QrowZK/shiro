import React from "react";
import { Tabs, ChatLine, Input, Button, UserChip, EmptyState } from "../ds/shiro.js";

/* Screen 5 - channels and DMs. Tabs carry unread counts and mention (Ring) state. */
export default function ChatScreen({ channels, users, messages }) {
  const [tab, setTab] = React.useState(channels[0].id);
  const [msg, setMsg] = React.useState("");
  const [lines, setLines] = React.useState(messages);
  const send = () => {
    if (!msg.trim()) return;
    setLines(l => [...l, { time: "21:07", user: { name: "Shadowfury", clan: "ZKF", country: "DE" }, text: msg }]);
    setMsg("");
  };
  const isDm = (channels.find(c => c.id === tab) || {}).dm;
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <Tabs value={tab} onChange={setTab} items={channels} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--sp-4)" }}>
          {isDm
            ? <EmptyState icon="message-square" title="Nothing in this conversation yet." body="Say something." />
            : lines.map((l, i) => <ChatLine key={i} {...l} />)}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-4)", padding: "var(--sp-4) var(--sp-5)",
          borderTop: "1px solid var(--w-12)" }}>
          <Input placeholder={"Message " + tab} value={msg} onChange={e => setMsg(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()} wrapStyle={{ flex: 1 }} />
          <Button variant="quiet" onClick={send}>Send</Button>
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 var(--sp-4)", borderBottom: "1px solid var(--w-06)" }}>
          <span className="lab">IN CHANNEL</span>
          <span style={{ font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)", color: "var(--text-low)" }}>{users.length}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--sp-2) 0" }}>
          {users.map(u => (
            <div key={u.name} style={{ height: "var(--row-compact)", display: "flex", alignItems: "center",
              padding: "0 var(--sp-4)" }}>
              <UserChip {...u} size="sm" style={{ minWidth: 0 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
