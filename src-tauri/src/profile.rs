//! What the machine is, according to the engine that has to run on it.
//!
//! No native hardware probing. Zero-K's own `infolog.txt` already reports the
//! processor, the graphics card, the video memory and the OpenGL context - and
//! it reports what *the engine* saw, which is the answer that decides whether
//! the game runs well. A separate probe would disagree with it on exactly the
//! machines most likely to have trouble: laptops with two graphics cards.
//!
//! `src/net/gameSettings.ts` already reads this file for a single boolean.
//! Everything here was sitting in the same file, unread.
//!
//! The cost of reading the engine's log is that there has to be one: a fresh
//! installation has never run the game. That is a normal state, not an error,
//! and `Profile::seen` is how the UI knows to ask for a run rather than
//! reporting a fault.

use serde::Serialize;

/// The hardware the engine reported, as far as we could read it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// False when there was no log to read - a machine that has never played.
    pub seen: bool,
    pub physical_cores: Option<u32>,
    pub logical_cores: Option<u32>,
    pub gl_vendor: Option<String>,
    pub gl_renderer: Option<String>,
    pub gl_version: Option<String>,
    pub vram_total_mb: Option<u32>,
    pub vram_free_mb: Option<u32>,
    pub sdl_version: Option<String>,
    /// "8x anti-aliasing and 24-bit depth-buffer", as the engine put it.
    pub window: Option<String>,
}

/// A line's value after `label`, trimmed. The engine writes
/// `\tGL vendor   : NVIDIA Corporation` with a timestamp in front of it.
fn after(line: &str, label: &str) -> Option<String> {
    let at = line.find(label)? + label.len();
    let rest = line[at..].trim_start();
    let rest = rest.strip_prefix(':').unwrap_or(rest).trim();
    (!rest.is_empty()).then(|| rest.to_string())
}

fn number_after(line: &str, label: &str) -> Option<u32> {
    let v = after(line, label)?;
    let digits: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Read a Zero-K `infolog.txt`.
///
/// Every field is optional: the engine's log format is not a contract, and a
/// missing line should cost one row of the report rather than the report.
pub fn parse_infolog(log: &str) -> Profile {
    let mut p = Profile { seen: true, ..Default::default() };

    for line in log.lines() {
        if p.physical_cores.is_none() {
            p.physical_cores = number_after(line, "Physical CPU Cores");
        }
        if p.logical_cores.is_none() {
            p.logical_cores = number_after(line, "Logical CPU Cores");
        }
        if p.gl_vendor.is_none() {
            p.gl_vendor = after(line, "GL vendor");
        }
        if p.gl_renderer.is_none() {
            p.gl_renderer = after(line, "GL renderer");
        }
        if p.sdl_version.is_none() {
            p.sdl_version = after(line, "SDL version");
        }
        if p.gl_version.is_none() {
            p.gl_version = after(line, "Initialized OpenGL Context");
        }
        if p.vram_total_mb.is_none() {
            // "GPU memory  : 8188MB (total) / 5910MB (available)"
            if let Some(v) = after(line, "GPU memory") {
                let nums: Vec<u32> = v
                    .split("MB")
                    .filter_map(|part| {
                        let d: String = part
                            .chars()
                            .filter(|c| c.is_ascii_digit())
                            .collect();
                        d.parse().ok()
                    })
                    .collect();
                p.vram_total_mb = nums.first().copied();
                p.vram_free_mb = nums.get(1).copied();
            }
        }
        if p.window.is_none() && line.contains("anti-aliasing") {
            if let Some(at) = line.find("using ") {
                let rest = &line[at + "using ".len()..];
                let text = rest.split(" for main window").next().unwrap_or(rest);
                p.window = Some(text.trim().to_string());
            }
        }
    }
    p
}

/// How serious a finding is. The UI shows these as tick, warning, cross.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Ok,
    Warn,
    Fail,
}

/// One thing worth telling somebody about their machine.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub level: Level,
    pub title: String,
    pub detail: String,
}

/// The six presets the settings screen already offers, lowest to highest.
const PRESETS: [&str; 6] = ["Compat.", "Lowest", "Low", "Medium", "High", "Ultra"];

/// What the profile means, and which preset to start from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub findings: Vec<Finding>,
    /// None when there is nothing to base a recommendation on.
    pub preset: Option<String>,
    pub reason: Option<String>,
}

/// True for renderers that are not a graphics card.
///
/// This is the single best predictor of "the game is unplayably slow", and it
/// is worth being loud about, because the person seeing it usually believes
/// they have a working graphics card - and they do; the engine just is not
/// using it.
fn is_software_renderer(renderer: &str) -> bool {
    let r = renderer.to_ascii_lowercase();
    ["llvmpipe", "softpipe", "swrast", "software", "gdi generic", "microsoft basic"]
        .iter()
        .any(|bad| r.contains(bad))
}

/// The major.minor at the front of "4.6 (Compat)".
fn gl_major_minor(version: &str) -> Option<(u32, u32)> {
    let head: String = version
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let (a, b) = head.split_once('.')?;
    Some((a.parse().ok()?, b.parse().ok()?))
}

pub fn assess(p: &Profile) -> Verdict {
    let mut findings = Vec::new();

    if !p.seen {
        findings.push(Finding {
            level: Level::Warn,
            title: "Zero-K has not been run yet".into(),
            detail: "This report reads the log the game writes when it starts, so \
there is nothing to read until it has run once. Start a game and come back."
                .into(),
        });
        return Verdict { findings, preset: None, reason: None };
    }

    match (&p.gl_renderer, &p.gl_vendor) {
        (Some(r), _) if is_software_renderer(r) => findings.push(Finding {
            level: Level::Fail,
            title: "The game is not using your graphics card".into(),
            detail: format!(
                "It rendered with {r}, which is software. This is the usual reason \
for an unplayable frame rate. Check your graphics drivers, and on a laptop check \
that Zero-K is set to use the dedicated card."
            ),
        }),
        (Some(r), Some(v)) => findings.push(Finding {
            level: Level::Ok,
            title: "Graphics card".into(),
            detail: format!("{r} ({v})"),
        }),
        _ => findings.push(Finding {
            level: Level::Warn,
            title: "No graphics card reported".into(),
            detail: "The log did not name a renderer, so the rest of this is a guess.".into(),
        }),
    }

    // Zero-K wants a modern context. A machine reporting 2.1 will not start it,
    // and saying so beats a crash with no explanation.
    if let Some(v) = &p.gl_version {
        match gl_major_minor(v) {
            Some((major, minor)) if (major, minor) < (3, 0) => findings.push(Finding {
                level: Level::Fail,
                title: "OpenGL is too old".into(),
                detail: format!("The engine got OpenGL {v}. Zero-K needs 3.0 or newer."),
            }),
            Some(_) => findings.push(Finding {
                level: Level::Ok,
                title: "OpenGL".into(),
                detail: v.clone(),
            }),
            None => {}
        }
    }

    if let Some(total) = p.vram_total_mb {
        let level = if total < 1024 { Level::Warn } else { Level::Ok };
        findings.push(Finding {
            level,
            title: "Video memory".into(),
            detail: match p.vram_free_mb {
                Some(free) => format!("{total} MB, {free} MB free"),
                None => format!("{total} MB"),
            },
        });
    }

    if let Some(cores) = p.physical_cores {
        findings.push(Finding {
            level: if cores < 4 { Level::Warn } else { Level::Ok },
            title: "Processor".into(),
            detail: match p.logical_cores {
                Some(l) => format!("{cores} cores, {l} threads"),
                None => format!("{cores} cores"),
            },
        });
    }

    // The preset. Ours, not upstream's - Zero-K has no hardware mapping - so it
    // is offered as a starting point with its reasoning attached rather than as
    // a verdict.
    let broken = findings.iter().any(|f| f.level == Level::Fail);
    let (preset, reason) = if broken {
        (Some(PRESETS[0].to_string()), Some(
            "Something above will stop the game running properly, so start at the \
lowest settings and fix that first."
                .to_string(),
        ))
    } else {
        match p.vram_total_mb {
            Some(v) if v >= 6000 => (Some(PRESETS[4].to_string()),
                Some(format!("{v} MB of video memory is comfortable at High."))),
            Some(v) if v >= 3000 => (Some(PRESETS[3].to_string()),
                Some(format!("{v} MB of video memory suits Medium."))),
            Some(v) if v >= 1500 => (Some(PRESETS[2].to_string()),
                Some(format!("{v} MB of video memory suits Low."))),
            Some(v) => (Some(PRESETS[1].to_string()),
                Some(format!("{v} MB of video memory is tight; start at Lowest."))),
            None => (None, None),
        }
    };

    Verdict { findings, preset, reason }
}

/// Read and assess in one call, so the screen makes one request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub profile: Profile,
    pub verdict: Verdict,
}

#[tauri::command]
pub fn zkp_profile(infolog: Option<String>) -> Report {
    let profile = match infolog {
        Some(text) if !text.trim().is_empty() => parse_infolog(&text),
        _ => Profile::default(),
    };
    let verdict = assess(&profile);
    Report { profile, verdict }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lines copied verbatim from a real infolog on this machine.
    const REAL: &str = "\
[t=00:00:00.023378] DetectCores: cpu mask ffff
[t=00:00:00.024102]      Physical CPU Cores: 10
[t=00:00:00.024104]       Logical CPU Cores: 16
[t=00:00:00.681817] [GR::CreateSDLWindow] using 8x anti-aliasing and 24-bit depth-buffer (PF=\"SDL_PIXELFORMAT_RGB888\") for main window
[t=00:00:00.771983] \tSDL version : 2.0.18 (linked) / 2.0.18 (compiled)
[t=00:00:00.772007] \tGL vendor   : NVIDIA Corporation
[t=00:00:00.772009] \tGL renderer : NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2
[t=00:00:00.772017] \tGPU memory  : 8188MB (total) / 5910MB (available)
[t=00:00:00.772038] \tInitialized OpenGL Context: 4.6 (Compat)
";

    #[test]
    fn a_real_log_reads() {
        let p = parse_infolog(REAL);
        assert!(p.seen);
        assert_eq!(p.physical_cores, Some(10));
        assert_eq!(p.logical_cores, Some(16));
        assert_eq!(p.gl_vendor.as_deref(), Some("NVIDIA Corporation"));
        assert_eq!(p.gl_renderer.as_deref(), Some("NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2"));
        assert_eq!(p.vram_total_mb, Some(8188));
        assert_eq!(p.vram_free_mb, Some(5910));
        assert_eq!(p.gl_version.as_deref(), Some("4.6 (Compat)"));
        assert_eq!(p.window.as_deref(), Some("8x anti-aliasing and 24-bit depth-buffer (PF=\"SDL_PIXELFORMAT_RGB888\")"));
    }

    #[test]
    fn a_machine_that_has_never_played_is_not_a_fault() {
        // The normal state of a fresh install, and the UI must not show it as
        // an error - it should ask for a run.
        let v = assess(&Profile::default());
        assert_eq!(v.preset, None);
        assert_eq!(v.findings[0].level, Level::Warn);
        assert!(v.findings[0].title.contains("not been run"));
    }

    #[test]
    fn a_software_renderer_is_the_loudest_finding() {
        let mut p = parse_infolog(REAL);
        p.gl_renderer = Some("llvmpipe (LLVM 15.0.6, 256 bits)".into());
        let v = assess(&p);
        assert!(v.findings.iter().any(|f| f.level == Level::Fail));
        // And it must not then recommend High just because the VRAM looks fine.
        assert_eq!(v.preset.as_deref(), Some("Compat."));
    }

    #[test]
    fn an_old_opengl_is_a_failure_rather_than_a_warning() {
        let mut p = parse_infolog(REAL);
        p.gl_version = Some("2.1 (Compat)".into());
        let v = assess(&p);
        assert!(v.findings.iter().any(|f| f.level == Level::Fail && f.title.contains("OpenGL")));
    }

    #[test]
    fn the_recommendation_follows_the_video_memory() {
        let mut p = parse_infolog(REAL);
        assert_eq!(assess(&p).preset.as_deref(), Some("High"));
        p.vram_total_mb = Some(4096);
        assert_eq!(assess(&p).preset.as_deref(), Some("Medium"));
        p.vram_total_mb = Some(2048);
        assert_eq!(assess(&p).preset.as_deref(), Some("Low"));
        p.vram_total_mb = Some(512);
        assert_eq!(assess(&p).preset.as_deref(), Some("Lowest"));
    }

    #[test]
    fn every_recommendation_names_a_preset_the_settings_screen_has() {
        let mut p = parse_infolog(REAL);
        for vram in [256, 1600, 3200, 8188] {
            p.vram_total_mb = Some(vram);
            let v = assess(&p);
            let name = v.preset.expect("a preset");
            assert!(PRESETS.contains(&name.as_str()), "{name} is not a preset");
            assert!(v.reason.is_some(), "a recommendation without a reason");
        }
    }

    #[test]
    fn a_log_missing_lines_costs_a_row_not_the_report() {
        let p = parse_infolog("[t=00:00:00.024102]      Physical CPU Cores: 4\n");
        assert!(p.seen);
        assert_eq!(p.physical_cores, Some(4));
        assert_eq!(p.gl_renderer, None);
        // Still produces something, and says what it could not see.
        let v = assess(&p);
        assert!(v.findings.iter().any(|f| f.title.contains("No graphics card")));
    }
}
