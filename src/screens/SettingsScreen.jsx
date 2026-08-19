import React from "react";
import { Button, Input, Select, Checkbox, Badge, Icon, IconButton } from "../ds/shiro.js";
import {
  ENGINE_FIELDS, readEngineSettings, writeEngineSettings,
  loadGameSettings, saveGameSettings,
} from "../net/engineSettings.ts";
import { applyPreset, resolveRef, changedSettingNames } from "../net/gameSettings.ts";
import { SETTINGS_TABS } from "../protocol/settings.ts";
import { SKINS } from "../store/settings.ts";

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

/* Status, hints and errors all read the same size; only the colour changes. */
function Note({ children, tone }) {
  return (
    <span style={{ font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
      color: tone === "danger" ? "var(--signal-danger)" : "var(--text-low)" }}>
      {children}
    </span>
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

/* Zero-K's own settings menu, ported.
 *
 * These are the game's settings, not the lobby's: the engine reads them out of
 * the Zero-K data dir when a match starts, and until Shiro wrote them a game
 * booted with whatever the last client left behind - most visibly at the wrong
 * interface scale.
 *
 * The menu itself is generated from upstream (src/protocol/settings.ts) so the
 * options, their groupings and the values behind them are the official
 * client's, not a re-interpretation. Three rules hold the whole thing together:
 *
 *   - It opens showing what the files on disk actually say, worked out by
 *     running the menu backwards. Anything that matches no option is labelled
 *     Custom rather than shown as a default it is not set to.
 *   - Apply writes only what changed, so a Custom setting - or any of the ~110
 *     keys this menu does not model - is never rewritten.
 *   - Presets set the same settings upstream's do, and are just a shortcut for
 *     moving several dropdowns at once; nothing is written until Apply.
 */
function GameSettingsSection({ installRoot, disabled }) {
  const [loaded, setLoaded] = React.useState(null);   // what disk said
  const [chosen, setChosen] = React.useState(null);   // what the user has picked
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [tab, setTab] = React.useState(SETTINGS_TABS[0].name);

  React.useEffect(() => {
    let live = true;
    setLoaded(null);
    loadGameSettings(installRoot).then(
      l => { if (live) { setLoaded(l); setChosen(l.chosen); } },
      e => { if (live) setError(String(e)); },
    );
    return () => { live = false; };
  }, [installRoot]);

  const dirty = loaded && chosen
    ? changedSettingNames(loaded.chosen, chosen)
    : [];

  const save = async () => {
    setStatus("");
    setError("");
    try {
      await saveGameSettings(loaded.chosen, chosen, loaded.env, installRoot);
      // The new baseline: what we just wrote is now what disk says.
      setLoaded({ ...loaded, chosen });
      setStatus("Written. Takes effect the next time a game starts.");
    } catch (e) {
      setError(String(e));
    }
  };

  const hint = "Zero-K reads these when a match starts. Only what you change is "
    + "written; everything else in the file is left exactly as it was.";

  if (error && !loaded) {
    return (
      <Section title="In-game settings" hint={hint}>
        <Note tone="danger">{error}</Note>
      </Section>
    );
  }
  if (!loaded || !chosen) {
    return (
      <Section title="In-game settings" hint={hint}>
        <Note>Reading the Zero-K settings...</Note>
      </Section>
    );
  }

  const active = SETTINGS_TABS.find(t => t.name === tab) || SETTINGS_TABS[0];

  return (
    <Section title="In-game settings" hint={hint}>
      <div style={{ display: "flex", gap: "var(--sp-3)" }}>
        {SETTINGS_TABS.map(t => (
          <Button key={t.name} size="sm" variant={t.name === tab ? "quiet" : "ghost"}
            onClick={() => setTab(t.name)}>{t.name}</Button>
        ))}
      </div>

      {/* Upstream's presets. They move several settings at once and are worth
          nothing until Apply, same as any other change here. */}
      {active.presets.length > 0 && (
        <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="lab">Preset</span>
          {active.presets.map(p => (
            <Button key={p.name} size="sm" variant="ghost" disabled={disabled}
              onClick={() => setChosen(c => applyPreset(c, p, loaded.env))}>{p.name}</Button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)" }}>
        {active.settings.map(setting => (
          <SettingControl key={setting.name} setting={setting} disabled={disabled}
            env={loaded.env} value={chosen[setting.name]}
            custom={loaded.custom.includes(setting.name)
              && chosen[setting.name] === loaded.chosen[setting.name]}
            onChange={v => setChosen(c => ({ ...c, [setting.name]: v }))} />
        ))}
      </div>

      <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="quiet" size="sm" onClick={save}
          disabled={disabled || dirty.length === 0}>Apply</Button>
        <Button variant="ghost" size="sm" disabled={disabled || dirty.length === 0}
          onClick={() => setChosen(loaded.chosen)}>Revert</Button>
        {dirty.length > 0 && <Note>{dirty.length} changed</Note>}
        {status && <Note>{status}</Note>}
        {error && <Note tone="danger">{error}</Note>}
      </div>
    </Section>
  );
}

/** One dropdown or number box, under the name the official client gives it. */
function SettingControl({ setting, value, onChange, disabled, env, custom }) {
  if (setting.kind === "unsupported") return null;

  if (setting.kind === "number") {
    const bound = b => (b && typeof b === "object" ? resolveRef(b.ref, env) : b);
    const min = bound(setting.min);
    const max = bound(setting.max);
    return (
      <Input label={setting.humanName} size="sm" type="number" disabled={disabled}
        min={min != null ? Math.round(min) : undefined}
        max={max != null ? Math.round(max) : undefined}
        value={value != null ? String(value) : ""}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
    );
  }

  const options = (setting.options || []).map(o => o.name);
  return (
    <Select label={custom ? `${setting.humanName} (custom)` : setting.humanName}
      size="sm" disabled={disabled}
      // A value the file produced but no option carries would otherwise select
      // the first entry silently, which is a lie about what the game is set to.
      options={custom ? ["Custom", ...options] : options}
      value={custom ? "Custom" : (value != null ? String(value) : "")}
      onChange={e => onChange(e.target.value)} />
  );
}

/* The engine keys Zero-K's menu has no control for. Resolution is upstream's
   "Display Mode", which also drives Chobby's own window and so has no Shiro
   equivalent; the keys behind it are still worth reaching. */
function EngineSection({ installRoot, disabled }) {
  const [values, setValues] = React.useState(null);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");

  React.useEffect(() => {
    let live = true;
    readEngineSettings(installRoot)
      .then(s => { if (live) setValues(s); })
      .catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [installRoot]);

  const save = async () => {
    setStatus("");
    setError("");
    const changes = {};
    for (const f of ENGINE_FIELDS) {
      const v = (values && values[f.key]) || "";
      if (v !== "") changes[f.key] = String(v);
    }
    try {
      await writeEngineSettings(changes, installRoot);
      setStatus("Written to springsettings.cfg.");
    } catch (e) {
      setError(String(e));
    }
  };

  const hint = "Font and resolution, which Zero-K's own menu sets through a "
    + "display mode control that Shiro has no equivalent for.";

  if (error && !values) {
    return <Section title="Advanced" hint={hint}><Note tone="danger">{error}</Note></Section>;
  }

  return (
    <Section title="Advanced" hint={hint}>
      {values === null ? (
        <Note>Reading springsettings.cfg...</Note>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)" }}>
            {ENGINE_FIELDS.map(f => (
              <Input key={f.key} label={f.label} size="sm" type="number"
                min={f.min} max={f.max} disabled={disabled}
                value={values[f.key] != null ? values[f.key] : ""}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center" }}>
            <Button variant="quiet" size="sm" onClick={save} disabled={disabled}>Apply</Button>
            {status && <Note>{status}</Note>}
            {error && <Note tone="danger">{error}</Note>}
          </div>
        </>
      )}
    </Section>
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
  const skin = (settings && settings.skin) || "paper";

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

        {/* No Apply button: the skin is an attribute on <html> and the
            stylesheet is already loaded, so switching is a repaint. Anything
            that needed confirming would be a layout change, and skins do not
            make those. */}
        <Section title="Appearance"
          hint="Skins recolour the surfaces, the ink and the hairlines. None of them move
                anything - the density is the design, and it stays where it is.">
          <Select label="Skin" size="sm" wrapStyle={{ width: 220 }}
            options={SKINS.map(s => ({ value: s.id, label: s.name }))}
            value={skin}
            onChange={e => onSettings && onSettings({ skin: e.target.value })} />
          <Note>{(SKINS.find(s => s.id === skin) || SKINS[0]).note}</Note>
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

        <Section title="After a match"
          hint="Spectators are never taken to the results - there is no rating change or
                award to show them - so this only affects matches you played.">
          <Checkbox label="Open the results screen when a match ends"
            checked={Boolean(settings && settings.autoOpenDebriefing)}
            onChange={e => onSettings && onSettings({ autoOpenDebriefing: e.target.checked })} />
        </Section>

        <GameSettingsSection installRoot={settings && settings.installRoot} disabled={!install} />

        <EngineSection installRoot={settings && settings.installRoot} disabled={!install} />

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
