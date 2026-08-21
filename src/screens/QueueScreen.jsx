import React from "react";
import { Button, Meter, UserChip, EmptyState, Input, IconButton, Switch } from "../ds/shiro.js";

/* Screen 6 - matchmaker queue. The ready-check itself is a Dialog rendered by
   App as a shell overlay, because it can interrupt any screen.

   With no `queues` prop this renders the demo set from the click-through. */
export const QUEUES = [
  { id: "1v1", label: "1v1", waiting: 6, avg: "0:48" },
  { id: "teams", label: "Teams", waiting: 21, avg: "1:12" },
  { id: "coop", label: "Coop vs AI", waiting: 3, avg: "2:30" }
];

/** mm:ss since an ISO-8601 instant. */
function elapsed(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* A queue is a switch because that is what it is: you are in it or you are not,
   and you may be in several at once. `MatchMakerQueueRequest` carries the whole
   set rather than a join or a leave, so every flip can go out as it happens.

   The list this replaces staged a selection behind a Join button, which could
   not show the several-at-once shape and, once you were queued, offered nothing
   but leaving all of them - the staged selection kept accepting clicks that
   were never sent anywhere. */
export default function QueueScreen({ queued, onQueue, onFake, queues, joined, elo,
  joinedTime, bannedSeconds, party, onInvite, onLeaveParty }) {
  const live = Boolean(queues);
  const list = queues || QUEUES;
  /* Live there is one copy of this and the server owns it: the store mirrors
     our request the moment we make it, and a party member can put us in a queue
     without us touching anything. The demo has no server to be the authority. */
  const [demoQueues, setDemoQueues] = React.useState([]);
  const inQueues = live ? (joined || []) : demoQueues;
  const [now, setNow] = React.useState(() => Date.now());

  /* The demo's ready check drops you out of the queue when you decline it, and
     the switches have to follow that down rather than keep claiming you are in. */
  React.useEffect(() => { if (!live && !queued) setDemoQueues([]); }, [live, queued]);

  const inQueue = inQueues.length > 0;
  React.useEffect(() => {
    if (!inQueue) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inQueue]);

  const [inviting, setInviting] = React.useState("");
  const request = names => {
    if (!live) setDemoQueues(names);
    onQueue(names);
  };
  const toggle = id =>
    request(inQueues.includes(id) ? inQueues.filter(x => x !== id) : [...inQueues, id]);
  /* The set is held as ids because that is what the request wants, but a
     summary should read as the rows do. */
  const labelOf = id => (list.find(q => q.id === id) || {}).label || id;
  const invite = () => {
    const name = inviting.trim();
    if (!name || !onInvite) return;
    onInvite(name);
    setInviting("");
  };
  const waited = elapsed(joinedTime, now);

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 26, display: "flex", alignItems: "center", padding: "0 var(--sp-5)",
          borderBottom: "1px solid var(--w-12)" }}><span className="lab">QUEUES</span></div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {list.length === 0
            ? <EmptyState icon="target" title="The server has not offered any queues."
                body="MatchMakerSetup arrives shortly after login." />
            : list.map(q => {
              const on = inQueues.includes(q.id);
              return (
                <button key={q.id} type="button" role="switch" aria-checked={on} aria-label={q.label}
                  onClick={() => toggle(q.id)}
                  style={{ width: "100%", height: "var(--row-tall)", display: "flex", alignItems: "center",
                    gap: "var(--sp-5)", padding: "0 var(--sp-5)", cursor: "pointer", textAlign: "left",
                    border: 0, font: "inherit", color: "inherit",
                    background: on ? "var(--surface-selected)" : "transparent", boxShadow: "var(--rule-inset)" }}>
                  {/* The whole row is the control, so the switch is only its
                      indicator: with no onChange the click carries on through to
                      the button and the target stays the width of the list. */}
                  <Switch checked={on} />
                  <span style={{ font: "var(--text-heading)", color: on ? "var(--text-hi)" : "var(--text-body)",
                    flex: 1 }}>{q.label}</span>
                  <span className="lab">WAITING</span>
                  <span style={{ width: 34, textAlign: "right", font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
                    color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>{q.waiting}</span>
                  <span className="lab">{q.avg != null ? "AVG WAIT" : "IN GAME"}</span>
                  <span style={{ width: 48, textAlign: "right", font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
                    color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}>{q.avg != null ? q.avg : q.ingame}</span>
                </button>
              );
            })}
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <span className="lab">YOUR MATCHMAKER RATING</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {elo != null ? elo : 1766}
          </span>
        </div>
        {bannedSeconds ? (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--signal-danger)" }}>
            Banned from the matchmaker for another {bannedSeconds}s.
          </span>
        ) : null}
        {inQueue ? (
          <>
            <Meter indeterminate label={waited ? "Searching - " + waited : "Searching"}
              right={inQueues.map(labelOf).join(" / ")} />
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
              You can keep browsing battles while you wait. Shiro will interrupt when a match is found.
            </span>
            <Button variant="secondary" block onClick={() => request([])}>Leave all queues</Button>
            {onFake && <Button variant="ghost" size="sm" block onClick={onFake}>Simulate match found</Button>}
          </>
        ) : (
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
            Switch on as many queues as you like. You can be in several at once.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="lab">PARTY</span>
            {onLeaveParty && party && party.length > 0 && (
              <IconButton icon="log-out" size="sm" label="Leave party" onClick={onLeaveParty} />
            )}
          </div>
          {party && party.length > 0
            ? party.map(p => <UserChip key={p.name} {...p} size="sm" />)
            : null}
          {onInvite && (
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <Input placeholder="Invite by name" size="sm" value={inviting} wrapStyle={{ flex: 1 }}
                onChange={e => setInviting(e.target.value)}
                onKeyDown={e => e.key === "Enter" && invite()} />
              <Button variant="quiet" size="sm" onClick={invite}>Invite</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
