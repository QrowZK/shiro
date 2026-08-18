import React from "react";
import { Button, Input, Checkbox, Badge, Icon, IconButton } from "../ds/shiro.js";

/* Screen 9 was deferred in the handoff, so this is built from the same
   primitives rather than a design. It covers the three things that actually
   need to be settable - who you are, where Zero-K is, and which server - plus
   the content policy, because "why can I not download a map" is otherwise a
   support question with no answer in the app. */
function Section({ title, children, hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)",
      padding: "var(--sp-7) var(--sp-8)", borderBottom: "1px solid var(--w-06)" }}>
      <span className="lab">{title}</span>
      {hint && (
        <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "var(--sp-5)", alignItems: "baseline" }}>
      <span className="lab">{label}</span>
      <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-mono)", color: "var(--text-body)",
        overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

export default function SettingsScreen({ me, install, installError, engine, settings, onSettings,
  onRedetect, onLogout, onPreview, away, onAway, version = "0.1.0" }) {
  const [host, setHost] = React.useState((settings && settings.host) || "");
  const [port, setPort] = React.useState((settings && settings.port) ? String(settings.port) : "");
  const [root, setRoot] = React.useState((settings && settings.installRoot) || "");
  const [saved, setSaved] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const [previewError, setPreviewError] = React.useState("");

  const runPreview = async () => {
    setPreview(null);
    setPreviewError("");
    try {
      setPreview(await onPreview());
    } catch (e) {
      setPreviewError(e && e.message ? e.message : String(e));
    }
  };

  const applyServer = () => {
    if (!onSettings) return;
    const trimmed = host.trim();
    const n = Number(port);
    onSettings({
      host: trimmed || undefined,
      // An unparseable port is not a port; fall back to the default rather
      // than sending NaN at the socket.
      port: Number.isFinite(n) && n > 0 ? n : undefined,
    });
    setSaved("Applies on the next login.");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 720 }}>
        <Section title="Account">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-5)" }}>
            <span style={{ font: "var(--text-heading)", color: "var(--text-hi)" }}>{me || "Not logged in"}</span>
            {settings && settings.remember && <Badge tone="outline">Password saved</Badge>}
          </div>
          {onAway && (
            <Checkbox label="Away" checked={Boolean(away)} onChange={e => onAway(e.target.checked)}
              hint="Shows you as away to everyone; the server stops offering you matches." />
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)" }}>
            {settings && settings.remember && onSettings && (
              <Button variant="secondary" size="sm"
                onClick={() => onSettings({ password: undefined, remember: false })}>
                Forget saved password
              </Button>
            )}
            {onLogout && <Button variant="danger" size="sm" onClick={onLogout}>Log out</Button>}
          </div>
        </Section>

        <Section title="Zero-K installation"
          hint="Shiro plays through the Zero-K you already have: its engine, games and maps.">
          {install ? (
            <>
              <Row label="Found via" value={install.source} />
              <Row label="Path" value={install.root} />
              {engine && <Row label="Engine wanted" value={engine} />}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-4)" }}>
              <Icon name="alert-triangle" size={16} style={{ color: "var(--signal-warn)", marginTop: 2 }} />
              <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>
                {/* The detector says where it looked, which is the whole
                    difference between "broken" and "it is on my D: drive". */}
                {installError || "No installation found. Games cannot be launched until there is one."}
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
            <Input label="Override path" placeholder="Leave empty to detect automatically"
              value={root} onChange={e => setRoot(e.target.value)} wrapStyle={{ flex: 1 }} size="sm" />
            <Button variant="quiet" size="sm"
              onClick={() => { if (onSettings) onSettings({ installRoot: root.trim() || undefined });
                if (onRedetect) onRedetect(); }}>Apply</Button>
            {onRedetect && <Button variant="ghost" size="sm" onClick={onRedetect}>Re-detect</Button>}
          </div>
          {onPreview && (
            <>
              <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
                <Button variant="secondary" size="sm" onClick={runPreview}>Check launch setup</Button>
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
                  Resolves the engine and the script without starting a game.
                </span>
              </div>
              {previewError && (
                <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-mono)",
                  color: "var(--signal-danger)", whiteSpace: "pre-wrap" }}>{previewError}</span>
              )}
              {preview && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)",
                  padding: "var(--sp-5)", background: "var(--surface-sunken)", border: "1px solid var(--w-06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
                    <Icon name="check" size={16} style={{ color: "var(--text-mid)" }} />
                    <span style={{ font: "var(--text-ui-sm)", color: "var(--text-body)" }}>
                      Ready to launch.
                    </span>
                  </div>
                  <Row label="Engine" value={preview.exe} />
                  <Row label="Working dir" value={preview.cwd} />
                  <Row label="Data dir" value={(preview.env.find(e => e[0] === "SPRING_DATADIR") || [])[1] || "-"} />
                  <Row label="Script" value={preview.scriptPath} />
                </div>
              )}
            </>
          )}
        </Section>

        <Section title="Server"
          hint="Empty means the live server, zero-k.info:8200. Change this only to point at a local ZkLobbyServer.">
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end" }}>
            <Input label="Host" placeholder="zero-k.info" value={host} size="sm"
              onChange={e => setHost(e.target.value)} wrapStyle={{ flex: 1 }} />
            <Input label="Port" placeholder="8200" value={port} size="sm"
              onChange={e => setPort(e.target.value)} wrapStyle={{ width: 100 }} />
            <Button variant="quiet" size="sm" onClick={applyServer}>Apply</Button>
          </div>
          {saved && (
            <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)", color: "var(--text-low)" }}>
              {saved}
            </span>
          )}
        </Section>

        <Section title="Content"
          hint="Shiro does not download games, maps or engines yet. It uses what your Zero-K
                installation already has, which is why it needs one. Missing content shows up as
                a failed launch rather than a download - run the official lobby once for anything
                you are missing.">
          <a href="https://zero-k.info" target="_blank" rel="noreferrer"
            style={{ font: "var(--text-ui-sm)", color: "var(--text-hi)" }}>zero-k.info &#8599;</a>
        </Section>

        <Section title="About">
          <Row label="Version" value={version} />
          <Row label="Design system" value="Shiro 0f4b7d9c" />
        </Section>
      </div>
    </div>
  );
}
