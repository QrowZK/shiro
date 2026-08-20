//! Splaunch: Zero-K scenarios, and the start script they compile to.
//!
//! `docs/SCENARIO-EDITOR.md` has the research. The finding this module is built
//! on: **a Zero-K scenario's most portable form is a start script, not a file
//! format.** The engine reads `script.txt`; units, teams, AIs and modoptions are
//! all expressible there against unmodified Zero-K, with no archive to build and
//! no server to publish to.
//!
//! The consequence is that "Test" is not a preview. It writes a script and
//! launches the real game into it, so there is no second renderer to build and
//! no fidelity gap to apologise for.
//!
//! Why this is not `launch.rs::connect_script`: that writes eight flat lines for
//! joining a hosted battle, and its `check_value` rejects `{`, `}` and `;`
//! outright - correctly, because a name containing a delimiter would silently
//! produce a different script. A scenario needs those characters structurally.
//! Widening that check would weaken the join path to serve this one, so this is
//! a separate writer that escapes rather than refuses.

use serde::{Deserialize, Serialize};

/// One unit placed on the map.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placed {
    /// Zero-K's unit name, e.g. `armcom`. Not validated here - the engine is
    /// the authority on what exists, and guessing would go stale.
    pub unit: String,
    pub team: u32,
    /// Map position in elmos.
    pub x: f32,
    pub z: f32,
}

/// A team in the scenario. Team 0 is the player unless `ai` says otherwise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: u32,
    pub ally: u32,
    /// None for the human player; otherwise the AI's short name.
    pub ai: Option<String>,
    /// "1 0 0". Left to the caller so the editor and the game agree on colours.
    pub colour: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub name: String,
    pub map: String,
    pub game: String,
    pub teams: Vec<Team>,
    pub units: Vec<Placed>,
    /// Free-text objectives. v1 keeps these as sentences rather than a trigger
    /// graph - see the doc. They travel in the script so a future gadget can
    /// read them, and are shown to the player meanwhile.
    pub objectives: Vec<String>,
}

/// Anything a script value cannot contain.
///
/// Unlike `launch.rs`, this escapes rather than refuses: a scenario name is the
/// author's to choose, and losing their apostrophe is better than refusing to
/// launch. Delimiters are the exception - they change the script's shape, so
/// they are removed rather than represented.
fn escape(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, ';' | '{' | '}' | '\n' | '\r'))
        .collect()
}

fn key(out: &mut String, indent: &str, k: &str, v: impl std::fmt::Display) {
    out.push_str(&format!("{indent}{k}={v};\n"));
}

/// What is wrong with this scenario, in sentences a person can act on.
///
/// Returned rather than thrown so the editor can show a count before Test is
/// pressed: an invalid scenario should be visible while it is being made, not
/// after it fails to start.
pub fn problems(s: &Scenario) -> Vec<String> {
    let mut out = Vec::new();
    if s.map.trim().is_empty() {
        out.push("No map chosen.".into());
    }
    if s.teams.is_empty() {
        out.push("No teams.".into());
    }
    if !s.teams.iter().any(|t| t.ai.is_none()) {
        out.push("No player team - somebody has to be you.".into());
    }
    let allies: std::collections::HashSet<u32> = s.teams.iter().map(|t| t.ally).collect();
    if allies.len() < 2 && !s.teams.is_empty() {
        out.push("Every team is on the same side, so the game ends immediately.".into());
    }
    for u in &s.units {
        if !s.teams.iter().any(|t| t.id == u.team) {
            out.push(format!("A {} belongs to team {}, which does not exist.", u.unit, u.team));
            break;
        }
    }
    if s.units.is_empty() {
        out.push("Nothing placed yet.".into());
    }
    out
}

/// Compile to a Spring start script.
///
/// The shape is taken from a real one: `_missionScript.txt` inside Zero-K's own
/// `User Interface Tutorial r22.sdz`, which is what the old mission editor
/// emitted and what the engine still reads.
pub fn write_script(s: &Scenario, player: &str) -> Result<String, String> {
    if let Some(first) = problems(s).first() {
        return Err(first.clone());
    }

    let mut out = String::new();
    out.push_str("[GAME]\n{\n");
    key(&mut out, "\t", "Mapname", escape(&s.map));
    key(&mut out, "\t", "GameType", escape(&s.game));
    key(&mut out, "\t", "MyPlayerName", escape(player));
    // Local, hosted by us, nobody to wait for.
    key(&mut out, "\t", "IsHost", 1);
    key(&mut out, "\t", "OnlyLocal", 1);
    key(&mut out, "\t", "StartPosType", 2);
    key(&mut out, "\t", "GameStartDelay", 0);
    key(&mut out, "\t", "NumRestrictions", 0);

    out.push_str("\t[MODOPTIONS]\n\t{\n");
    // Nothing a scenario does should count towards anybody's rating.
    key(&mut out, "\t\t", "noelo", 1);
    out.push_str("\t}\n");

    // The human. One player, always index 0, on the first non-AI team.
    let human = s.teams.iter().find(|t| t.ai.is_none()).map(|t| t.id).unwrap_or(0);
    out.push_str("\t[PLAYER0]\n\t{\n");
    key(&mut out, "\t\t", "Name", escape(player));
    key(&mut out, "\t\t", "Team", human);
    out.push_str("\t}\n");

    for (i, t) in s.teams.iter().filter(|t| t.ai.is_some()).enumerate() {
        out.push_str(&format!("\t[AI{i}]\n\t{{\n"));
        key(&mut out, "\t\t", "Name", format!("AI {}", t.id));
        key(&mut out, "\t\t", "ShortName", escape(t.ai.as_deref().unwrap_or("NullAI")));
        key(&mut out, "\t\t", "Team", t.id);
        key(&mut out, "\t\t", "Host", 0);
        out.push_str("\t}\n");
    }

    for t in &s.teams {
        out.push_str(&format!("\t[TEAM{}]\n\t{{\n", t.id));
        key(&mut out, "\t\t", "TeamLeader", 0);
        key(&mut out, "\t\t", "AllyTeam", t.ally);
        key(&mut out, "\t\t", "RGBColor", escape(&t.colour));
        out.push_str("\t}\n");
    }

    let mut allies: Vec<u32> = s.teams.iter().map(|t| t.ally).collect();
    allies.sort_unstable();
    allies.dedup();
    for a in allies {
        out.push_str(&format!("\t[ALLYTEAM{a}]\n\t{{\n"));
        key(&mut out, "\t\t", "NumAllies", 0);
        out.push_str("\t}\n");
    }

    out.push_str("}\n");
    Ok(out)
}

/// The placed units, as the payload a gadget would read.
///
/// Kept beside the script rather than inside it: what reads this does not exist
/// yet, and inventing a modoption name that Zero-K does not define would be a
/// guess dressed as an integration. Written next to the script so the work is
/// not lost when it does.
pub fn write_units(s: &Scenario) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": s.name,
        "map": s.map,
        "units": s.units,
        "objectives": s.objectives,
    }))
    .unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Scenario {
        Scenario {
            name: "Test".into(),
            map: "Comet Catcher Redux".into(),
            game: "Zero-K v1.14.8.0".into(),
            teams: vec![
                Team { id: 0, ally: 0, ai: None, colour: "0 0 1".into() },
                Team { id: 1, ally: 1, ai: Some("NullAI".into()), colour: "1 0 0".into() },
            ],
            units: vec![Placed { unit: "armcom".into(), team: 0, x: 512.0, z: 512.0 }],
            objectives: vec!["Destroy the enemy commander".into()],
        }
    }

    #[test]
    fn a_scenario_compiles_to_a_script_the_engine_shape_matches() {
        let s = write_script(&sample(), "Qrow").unwrap();
        assert!(s.starts_with("[GAME]\n{\n"));
        assert!(s.contains("Mapname=Comet Catcher Redux;"));
        assert!(s.contains("OnlyLocal=1;"));
        assert!(s.contains("[PLAYER0]"));
        assert!(s.contains("[AI0]"));
        assert!(s.contains("ShortName=NullAI;"));
        assert!(s.contains("[TEAM0]") && s.contains("[TEAM1]"));
        assert!(s.contains("[ALLYTEAM0]") && s.contains("[ALLYTEAM1]"));
        assert!(s.trim_end().ends_with('}'));
    }

    #[test]
    fn braces_are_balanced() {
        // The engine's parser is not forgiving, and an unbalanced script fails
        // with a message about the wrong line.
        let s = write_script(&sample(), "Qrow").unwrap();
        assert_eq!(s.matches('{').count(), s.matches('}').count());
    }

    #[test]
    fn a_name_that_would_break_the_script_is_escaped_not_refused() {
        /* The join path refuses these, because a server-issued name never
           contains one. A scenario author's name is their own, and losing a
           semicolon beats refusing to launch. */
        let mut sc = sample();
        sc.map = "Weird; }Map{".into();
        let s = write_script(&sc, "Qrow").unwrap();
        assert!(s.contains("Mapname=Weird Map;"));
        assert_eq!(s.matches('{').count(), s.matches('}').count());
    }

    #[test]
    fn a_scenario_with_no_player_does_not_compile() {
        let mut sc = sample();
        sc.teams[0].ai = Some("NullAI".into());
        let err = write_script(&sc, "Qrow").unwrap_err();
        assert!(err.contains("player team"), "{err}");
    }

    #[test]
    fn problems_are_sentences_rather_than_codes() {
        let empty = Scenario {
            name: "".into(), map: "".into(), game: "".into(),
            teams: vec![], units: vec![], objectives: vec![],
        };
        let p = problems(&empty);
        assert!(p.len() >= 3);
        for line in &p {
            assert!(line.ends_with('.'), "{line:?} is not a sentence");
        }
    }

    #[test]
    fn one_sided_scenarios_are_caught_before_launch() {
        // Two teams on the same allyteam ends the moment it starts, which is a
        // confusing way to find out you made a mistake.
        let mut sc = sample();
        sc.teams[1].ally = 0;
        assert!(problems(&sc).iter().any(|p| p.contains("same side")));
    }

    #[test]
    fn a_unit_on_a_team_that_does_not_exist_is_caught() {
        let mut sc = sample();
        sc.units[0].team = 7;
        assert!(problems(&sc).iter().any(|p| p.contains("does not exist")));
    }

    /// Zero-K's own mission script, lifted out of
    /// `games/User Interface Tutorial r22.sdz`. This is what the engine is
    /// known to accept, so it is the thing to be measured against.
    const REAL: &str = include_str!("fixtures/mission-script.txt");

    /// Every `[SECTION]` name, in order.
    fn sections(script: &str) -> Vec<String> {
        script
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with('[') && l.ends_with(']'))
            .map(|l| l.trim_matches(['[', ']']).to_string())
            .collect()
    }

    /// Every `Key=` at any depth, lowercased.
    fn keys(script: &str) -> std::collections::HashSet<String> {
        script
            .lines()
            .filter_map(|l| l.trim().split_once('='))
            .map(|(k, _)| k.trim().to_ascii_lowercase())
            .collect()
    }

    #[test]
    fn our_script_has_the_sections_the_engine_expects() {
        /* The single biggest unknown in docs/SCENARIO-EDITOR.md is whether a
           script we write actually launches. Nothing here launches anything -
           that still wants doing by hand - but a script missing a section the
           engine's own one has would fail for a reason we can find now rather
           than at the whistle. */
        let ours = write_script(&sample(), "Qrow").unwrap();
        let theirs = sections(REAL);
        let mine = sections(&ours);

        for want in ["GAME", "MODOPTIONS", "PLAYER0", "AI0", "TEAM0", "TEAM1", "ALLYTEAM0"] {
            assert!(theirs.iter().any(|s| s == want), "the real script has no [{want}]");
            assert!(mine.iter().any(|s| s == want), "ours has no [{want}]");
        }
    }

    #[test]
    fn our_script_sets_the_keys_the_engine_reads() {
        let ours = write_script(&sample(), "Qrow").unwrap();
        let theirs = keys(REAL);
        let mine = keys(&ours);

        /* Not every key - the real one carries mission-specific extras we have
           no business emitting. These are the ones that decide whether a local
           game starts at all, and every one of them is in theirs too. */
        for want in ["mapname", "gametype", "myplayername", "ishost", "onlylocal",
                     "gamestartdelay", "name", "team", "shortname", "allyteam"] {
            assert!(theirs.contains(want), "the real script does not set {want}");
            assert!(mine.contains(want), "ours does not set {want}");
        }
    }

    #[test]
    fn our_script_parses_the_way_theirs_does() {
        /* Balanced braces, and every value terminated by a `;` before the next
           assignment or the end of its section.

           Deliberately not a per-line rule: the real script puts four pairs on
           one line and closes the section on the same one -
           `StartRectTop=0;		StartRectBottom=0; ... }` - which is the engine
           telling us that newlines are not part of its grammar at all. Ours is
           formatted for a human to read, and that is free. */
        let ours = write_script(&sample(), "Qrow").unwrap();
        for script in [REAL, ours.as_str()] {
            assert_eq!(script.matches('{').count(), script.matches('}').count());
            let bytes = script.as_bytes();
            for (i, _) in script.match_indices('=') {
                let rest = &bytes[i + 1..];
                let end = rest
                    .iter()
                    .position(|c| matches!(c, b';' | b'}' | b'='))
                    .expect("a value with no terminator");
                assert_eq!(
                    rest[end], b';',
                    "unterminated value at {:?}",
                    &script[i.saturating_sub(24)..(i + 8).min(script.len())]
                );
            }
        }
    }

    #[test]
    fn the_unit_payload_round_trips() {
        let json = write_units(&sample());
        let back: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(back["units"][0]["unit"], "armcom");
        assert_eq!(back["objectives"][0], "Destroy the enemy commander");
    }
}

// --------------------------------------------------------------- commands ---

/// Where a scenario's script and payload are written before launching.
fn scenario_paths() -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join("shiro");
    (dir.join("scenario_script.txt"), dir.join("scenario_units.json"))
}

/// Compile without launching, so the editor can show the script.
#[tauri::command]
pub fn zksc_script(scenario: Scenario, player: String) -> Result<String, String> {
    write_script(&scenario, &player)
}

/// What is wrong with it, for the count in the header.
#[tauri::command]
pub fn zksc_problems(scenario: Scenario) -> Vec<String> {
    problems(&scenario)
}

/// Compile and launch the real game into it.
#[tauri::command]
pub fn zksc_test(
    app: tauri::AppHandle,
    game: tauri::State<'_, crate::launch::Game>,
    scenario: Scenario,
    player: String,
    engine: String,
) -> Result<u32, String> {
    let script = write_script(&scenario, &player)?;
    let (script_path, units_path) = scenario_paths();
    if let Some(dir) = script_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    std::fs::write(&script_path, script)
        .map_err(|e| format!("could not write the script: {e}"))?;
    std::fs::write(&units_path, write_units(&scenario))
        .map_err(|e| format!("could not write the units: {e}"))?;

    crate::launch::launch_script(app, game, &script_path, &engine)
}

