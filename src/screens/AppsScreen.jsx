import React from "react";
import { Button, Badge, EmptyState, Icon } from "../ds/shiro.js";

/* The app launcher. Four entries, shipped with Shiro, no search and no
   accounts - see docs/APPS.md for why this is a launcher rather than a store.

   The design problem here is the states, not the list: an app can be built in,
   installed, not installed, or unavailable because there is nothing published
   yet, and the last of those has to look deliberate rather than broken. */

const label = {
  font: "var(--text-label)", letterSpacing: "var(--track-label)",
  textTransform: "uppercase", color: "var(--text-faint)",
};

/** What this row can do, worked out once so the row and the panel agree. */
export function appState(app, status) {
  if (app.unavailable) return "unavailable";
  if (app.kind === "builtin") return "builtin";
  return status?.installed ? "installed" : "available";
}

/* The row, following the design kit's rule for this screen: an unavailable row
   is NOT dimmed. Dimming the whole row is what makes a deliberately-blocked
   entry read as broken, and Springen shipped in that state. So the name stays
   at full ink in every state, the reason is stated in words in the meta column,
   and only the action slot changes - it holds a badge naming the blocker
   instead of a button. */

const META = {
  builtin: () => "Part of Shiro",
  available: app => app.version ? `Version ${app.version}` : "Not installed",
  installing: () => "Downloading and checking",
  installed: (app, status) => status?.installedVersion || app.version || "Installed",
  unavailable: app => app.unavailable,
};

const ACTION = { builtin: "Open", available: "Install", installed: "Launch" };

function Row({ app, status, state, selected, onSelect, onAct, busy }) {
  const [hover, setHover] = React.useState(false);
  const shown = busy ? "installing" : state;
  const verb = ACTION[shown];
  const meta = META[shown]?.(app, status);

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)", minWidth: 0,
        background: selected ? "var(--surface-selected)"
          : hover ? "var(--surface-hover)" : "transparent",
        boxShadow: "var(--rule-inset)", transition: "var(--transition-hover)",
      }}>
      {selected && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
        background: "var(--ink-000)" }} />}

      {/* The selectable part is a real button rather than a clickable div: this
          row is how somebody reaches an app, and a div is unreachable by
          keyboard. The action beside it is a sibling, because a button inside a
          button is invalid and the browser makes the inner one dead. */}
      <button type="button" onClick={onSelect}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
          gap: "var(--sp-5)", background: "transparent", border: 0, padding: 0,
          cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}>
      <span style={{ width: 28, height: 28, flex: "0 0 auto", display: "inline-flex",
        alignItems: "center", justifyContent: "center", border: "1px solid var(--w-12)",
        color: "var(--text-mid)" }}>
        <Icon name={app.kind === "builtin" ? "settings" : "package"} size={16} />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
          color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis" }}>{app.name}</span>
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-core)",
          color: "var(--text-low)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{app.summary}</span>
      </div>

      <span style={{ width: 220, flex: "0 0 auto", textAlign: "right",
        font: "var(--w-regular) var(--size-tiny)/1.35 var(--font-mono)",
        color: shown === "unavailable" ? "var(--text-mid)" : "var(--text-low)",
        overflowWrap: "anywhere" }}>{meta}</span>
      </button>

      <span style={{ width: 120, flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
        {verb && (
          <Button size="sm" variant={shown === "available" ? "secondary" : "primary"}
            onClick={() => onAct(app)}>{verb}</Button>
        )}
        {shown === "installing" && (
          <span style={{ font: "var(--text-label)", letterSpacing: "var(--track-label)",
            textTransform: "uppercase", color: "var(--text-faint)" }}>Installing</span>
        )}
        {/* Named, so the row says what is wrong rather than looking wrong. */}
        {shown === "unavailable" && <Badge tone="outline">Unavailable</Badge>}
      </span>
    </div>
  );
}

export default function AppsScreen({ apps = [], statuses = [], onOpen, onLaunch, onInstall, installing, error }) {
  const [sel, setSel] = React.useState(undefined);
  const byId = React.useMemo(
    () => Object.fromEntries(statuses.map(s => [s.id, s])), [statuses]);

  const current = apps.find(a => a.id === sel) || apps[0];
  const status = current ? byId[current.id] : undefined;
  const state = current ? appState(current, status) : undefined;

  const open = app => {
    const s = byId[app.id];
    if (appState(app, s) === "builtin") onOpen?.(app.id);
    else onLaunch?.(app.id);
  };

  if (!apps.length) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState icon="package" title="Apps need the desktop app."
          body="The launcher installs and runs programs, which a browser tab cannot do." />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px",
      minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ height: 44, flex: "0 0 auto", display: "flex", alignItems: "center",
          padding: "0 var(--sp-6)", borderBottom: "1px solid var(--w-12)" }}>
          <span className="lab">APPS</span>
          <span style={{ flex: 1 }} />
          <span style={label}>{apps.length} available</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {apps.map(a => (
            <Row key={a.id} app={a} status={byId[a.id]}
              state={appState(a, byId[a.id])}
              selected={current && current.id === a.id}
              busy={installing === a.id}
              onSelect={() => setSel(a.id)}
              onAct={x => (appState(x, byId[x.id]) === "available"
                ? onInstall?.(x.id) : open(x))} />
          ))}
        </div>
      </div>

      {/* Detail. Downloading and running somebody else's program is a thing a
          person should be able to look at before agreeing to it, so the source
          is on screen rather than implied. */}
      <div style={{ borderLeft: "1px solid var(--w-12)", background: "var(--surface-panel)",
        padding: "var(--sp-6)", display: "flex", flexDirection: "column",
        gap: "var(--sp-5)", overflowY: "auto" }}>
        {current && (
          <>
            <div>
              <span style={{ font: "var(--w-bold) var(--size-xl)/1.1 var(--font-core)",
                color: "var(--text-hi)" }}>{current.name}</span>
            </div>
            <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", lineHeight: 1.5 }}>
              {current.description}
            </span>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <span style={label}>Source</span>
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                color: "var(--text-body)", overflowWrap: "anywhere" }}>{current.source}</span>
            </div>

            {status?.path && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <span style={label}>Installed at</span>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)",
                  color: "var(--text-low)", overflowWrap: "anywhere" }}>{status.path}</span>
              </div>
            )}

            {/* Greyed with the reason, rather than a button that fails. */}
            {state === "unavailable" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <span style={label}>Not available</span>
                <span style={{ font: "var(--text-ui-sm)", color: "var(--text-mid)" }}>
                  {current.unavailable}
                </span>
              </div>
            )}

            {error && (
              <span style={{ font: "var(--text-ui-sm)", color: "var(--signal-warn)" }}>
                {error}
              </span>
            )}

            <span style={{ flex: 1 }} />
            {(state === "builtin" || state === "installed") && (
              <Button variant="primary" size="lg" onClick={() => open(current)}>
                {state === "builtin" ? "Open" : "Launch"}
              </Button>
            )}
            {state === "available" && (
              <Button variant="primary" size="lg" disabled={installing === current.id}
                onClick={() => onInstall?.(current.id)}>
                {installing === current.id ? "Installing…" : "Install"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
