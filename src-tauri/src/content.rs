//! Acquiring games and maps with `pr-downloader`.
//!
//! A sibling of `launch.rs`, and deliberately shaped like it: everything up to
//! the spawn is pure and unit-tested, so the only part that needs a machine with
//! Zero-K on it is the process itself.
//!
//! Background and the verified CLI are in `docs/DOWNLOADS.md`. The three things
//! from that document that are easy to get wrong, and are handled here:
//!
//! 1. **Progress is carriage-return terminated**, not newline terminated. A
//!    `BufReader::lines()` reader stays silent for an entire download and then
//!    hands you one enormous line — which reads exactly like a hang. See
//!    [`split_chunks`].
//! 2. **Exit codes cannot tell "not found" from "failed".** The shipped binary
//!    does not print the line upstream's source says it does. Callers must
//!    re-check presence after a non-zero exit rather than trust the code.
//! 3. **The write path must be the Zero-K install root.** `launch.rs` points
//!    `SPRING_DATADIR` there and nowhere else, so content downloaded anywhere
//!    else is invisible to the engine.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archives;
use crate::install;
use crate::zkcontent;

/// The executable, which ships inside every engine directory next to `spring.exe`.
#[cfg(windows)]
const PR_DOWNLOADER: &str = "pr-downloader.exe";
#[cfg(not(windows))]
const PR_DOWNLOADER: &str = "pr-downloader";

/// What a name refers to, which decides the flag.
///
/// `Engine` is deliberately absent: whether pr-downloader accepts Zero-K's
/// engine version strings is unverified and doubtful, and `install::find_engine`
/// already writes a good error for a missing one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Game,
    Map,
}

impl ContentKind {
    fn flag(self) -> &'static str {
        match self {
            ContentKind::Game => "--download-game",
            ContentKind::Map => "--download-map",
        }
    }
}

/// One thing to acquire. `name` is the server's spelling, unmodified — a rapid
/// tag (`zk:stable`) and an archive name (`Adamantine Mountain 2`) both go
/// through the same flag.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ContentItem {
    pub kind: ContentKind,
    pub name: String,
}

/// Everything needed to run pr-downloader, resolved but not yet executed.
/// Mirrors `launch::SpawnPlan` field for field on purpose.
#[derive(Debug, PartialEq, Eq)]
pub struct DownloadPlan {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub args: Vec<OsString>,
}

/// Locate `pr-downloader`, which lives beside the engine binary.
pub fn find_pr_downloader(root: &Path, engine: &str) -> Result<PathBuf, String> {
    let spring = install::find_engine(root, engine)?;
    let dir = spring
        .parent()
        .ok_or_else(|| format!("engine path {} has no directory", spring.display()))?;
    let exe = dir.join(PR_DOWNLOADER);
    if exe.is_file() {
        Ok(exe)
    } else {
        Err(format!(
            "{} is missing from engine {}. It normally ships with the engine; \
             reinstalling that engine version through the official lobby restores it.",
            PR_DOWNLOADER, engine
        ))
    }
}

/// Refuse names that cannot be passed safely, in the spirit of
/// `launch::check_value`.
///
/// An archive name or rapid tag never contains a newline, a NUL, or a leading
/// `-`. Refusing rather than mangling means a protocol change surfaces as a
/// message instead of a mysteriously wrong command line.
fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("empty content name".into());
    }
    if name.contains(['\n', '\r', '\0']) {
        return Err(format!("content name contains a control character: {name:?}"));
    }
    if name.starts_with('-') {
        return Err(format!("content name would be read as a flag: {name:?}"));
    }
    Ok(())
}

/// Build the command line.
///
/// One invocation carries every item, because the `--download-*` flags are
/// repeatable. `--filesystem-writepath` comes first so the path is set before
/// anything is queued.
///
/// Note what is deliberately NOT passed:
/// - `--disable-logging` silences all stdout including `[Progress]`, and does
///   not silence the stderr noise, so it costs everything and buys nothing.
/// - `--disable-fetch-depends` would break custom games, which declare
///   `depend = { "rapid://zk:stable" }` — dependency fetching is why
///   downloading a mod also brings the base game.
pub fn download_plan(
    exe: &Path,
    root: &Path,
    items: &[ContentItem],
) -> Result<DownloadPlan, String> {
    let mut args: Vec<OsString> = vec![
        OsString::from("--filesystem-writepath"),
        OsString::from(root.as_os_str()),
    ];
    for item in items {
        check_name(&item.name)?;
        args.push(OsString::from(item.kind.flag()));
        args.push(OsString::from(&item.name));
    }
    Ok(DownloadPlan {
        exe: exe.to_path_buf(),
        // Run beside the binary, matching how launch.rs starts the engine.
        cwd: exe.parent().unwrap_or(root).to_path_buf(),
        args,
    })
}

/// Log severity, as pr-downloader labels it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Info,
    Warn,
    Debug,
    Error,
}

/// One decoded unit of pr-downloader output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Line {
    Progress { percent: u8, done: i64, total: i64 },
    Log { level: Level, message: String },
    Other(String),
}

/// Split a buffer on BOTH `\r` and `\n`, returning the complete units and the
/// remainder to carry into the next read.
///
/// This exists as its own function precisely because `[Progress]` is `\r`
/// terminated: a newline-only reader yields nothing until the download ends.
pub fn split_chunks(buf: &str) -> (Vec<&str>, &str) {
    match buf.rfind(['\r', '\n']) {
        // `\r` and `\n` are single-byte, so this is always a char boundary.
        Some(idx) => {
            let (complete, rest) = buf.split_at(idx + 1);
            let parts = complete
                .split(['\r', '\n'])
                .filter(|s| !s.trim().is_empty())
                .collect();
            (parts, rest)
        }
        None => (Vec::new(), buf),
    }
}

/// Strip pr-downloader's `path:line:func():` prefix from a log message.
fn strip_source_prefix(rest: &str) -> String {
    match rest.find("():") {
        Some(i) => rest[i + 3..].trim().to_string(),
        None => rest.trim().to_string(),
    }
}

/// Parse one already-split chunk. All the format knowledge lives here.
pub fn parse_line(s: &str) -> Line {
    let t = s.trim();

    if let Some(rest) = t.strip_prefix("[Progress]") {
        // "  2% [=====   ] 1/50"
        if let Some((pct_part, after)) = rest.split_once('%') {
            let percent = pct_part.trim().parse::<f64>().ok();
            // Skip the bar, then take "done/total".
            let counts = after.rsplit(']').next().unwrap_or("").trim();
            if let Some((done, total)) = counts.split_once('/') {
                if let (Some(p), Ok(d), Ok(tt)) = (
                    percent,
                    done.trim().parse::<i64>(),
                    total.trim().parse::<i64>(),
                ) {
                    return Line::Progress {
                        percent: p.clamp(0.0, 100.0) as u8,
                        done: d,
                        total: tt,
                    };
                }
            }
        }
        return Line::Other(t.to_string());
    }

    for (tag, level) in [
        ("[Info]", Level::Info),
        ("[Warn]", Level::Warn),
        ("[Debug]", Level::Debug),
        ("[Error]", Level::Error),
    ] {
        if let Some(rest) = t.strip_prefix(tag) {
            return Line::Log {
                level,
                message: strip_source_prefix(rest),
            };
        }
    }

    Line::Other(t.to_string())
}

/// What an exit status means, in terms a caller can act on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Ok,
    /// Exit 1. Bad arguments, item not found, or nothing queued — these are NOT
    /// distinguishable from each other, so re-check presence before reporting.
    NotFoundOrFailed,
    /// Exit 2. Something was queued but did not finish.
    Unfinished,
    NoDiskSpace,
    DependsFailed,
    /// Killed by a signal, or cancelled by us.
    Killed,
    Unknown(i32),
}

pub fn classify_exit(code: Option<i32>) -> Outcome {
    match code {
        Some(0) => Outcome::Ok,
        Some(1) => Outcome::NotFoundOrFailed,
        Some(2) => Outcome::Unfinished,
        Some(5) => Outcome::NoDiskSpace,
        Some(6) => Outcome::DependsFailed,
        Some(other) => Outcome::Unknown(other),
        None => Outcome::Killed,
    }
}

impl Outcome {
    /// A sentence to put in front of a player.
    pub fn message(self) -> String {
        match self {
            Outcome::Ok => "Content is ready.".into(),
            Outcome::NotFoundOrFailed =>
                "Could not download it. It may not exist on the servers Zero-K uses — \
                 custom games and their maps are distributed separately and cannot be \
                 fetched this way.".into(),
            Outcome::Unfinished =>
                "The download did not finish. Check the connection and try again.".into(),
            Outcome::NoDiskSpace => "Not enough free disk space for this download.".into(),
            Outcome::DependsFailed =>
                "Could not work out what else this content needs.".into(),
            Outcome::Killed => "Download cancelled.".into(),
            Outcome::Unknown(c) => format!("The downloader exited with code {c}."),
        }
    }
}

// ---------------------------------------------------------------- running --

/// Progress and lifecycle for a download job.
const CONTENT_EVENT: &str = "zks://content";

/// How much stderr to keep for a bug report. pr-downloader writes libcurl's full
/// verbose trace there, which is far too noisy to show but exactly what you want
/// attached to a failure.
const LOG_TAIL: usize = 16 * 1024;

/// The stream must be drained even when nothing is listening, or the pipe fills
/// and pr-downloader blocks forever.
const READ_BUF: usize = 8 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentStatus {
    Queued { id: String, items: Vec<ContentItem> },
    Started { id: String },
    Progress { id: String, percent: u8, done: i64, total: i64 },
    Note { id: String, level: Level, message: String },
    Finished { id: String, outcome: Outcome, message: String, log: Option<String> },
}

#[derive(Clone, Debug)]
struct Job {
    id: String,
    engine: String,
    items: Vec<ContentItem>,
}

struct ActiveJob {
    id: String,
    child: std::process::Child,
}

/// One pr-downloader at a time, with a queue rather than a rejection.
///
/// This is correctness, not tuning: two processes writing `<ZK>\pool\` and
/// `<ZK>\packages\` concurrently is unsupported, and rapid's `.sdp` writes are
/// not atomic. A second request is a legitimate user action, so it waits instead
/// of failing.
#[derive(Default)]
pub struct Content {
    active: std::sync::Arc<std::sync::Mutex<Option<ActiveJob>>>,
    queue: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<Job>>>,
}

static JOB_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_job_id() -> String {
    format!(
        "dl-{}",
        JOB_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

/// Drain one pipe, decoding as it goes.
///
/// Reads bytes rather than lines on purpose: `[Progress]` is `\r` terminated and
/// a line reader would yield nothing until the download ended.
fn pump<R: std::io::Read + Send + 'static>(
    mut stream: R,
    app: tauri::AppHandle,
    id: String,
    errors_only: bool,
    tail: std::sync::Arc<std::sync::Mutex<String>>,
) {
    std::thread::spawn(move || {
        use tauri::Emitter;
        let mut raw = [0u8; READ_BUF];
        let mut acc = String::new();
        loop {
            let n = match stream.read(&mut raw) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            acc.push_str(&String::from_utf8_lossy(&raw[..n]));

            // Take owned copies before reassigning `acc`, which the borrows point into.
            let (parts, rest) = split_chunks(&acc);
            let chunks: Vec<String> = parts.into_iter().map(str::to_string).collect();
            let carry = rest.to_string();
            acc = carry;

            for chunk in chunks {
                if errors_only {
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(&chunk);
                        t.push('\n');
                        if t.len() > LOG_TAIL {
                            let cut = t.len() - LOG_TAIL;
                            *t = t[cut..].to_string();
                        }
                    }
                }
                match parse_line(&chunk) {
                    Line::Progress { percent, done, total } if !errors_only => {
                        let _ = app.emit(
                            CONTENT_EVENT,
                            ContentStatus::Progress { id: id.clone(), percent, done, total },
                        );
                    }
                    Line::Log { level, message } => {
                        // Everything else is noise; only what a player could act
                        // on reaches the UI.
                        if matches!(level, Level::Error | Level::Warn) {
                            let _ = app.emit(
                                CONTENT_EVENT,
                                ContentStatus::Note { id: id.clone(), level, message },
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    });
}

/// Start the next queued job if nothing is running.
fn start_next(app: tauri::AppHandle, state: Content2) {
    use tauri::Emitter;

    let job = {
        let active = state.active.lock().ok();
        if active.as_ref().map(|a| a.is_some()).unwrap_or(true) {
            return; // busy, or poisoned - either way do not start another
        }
        let mut q = match state.queue.lock() {
            Ok(q) => q,
            Err(_) => return,
        };
        match q.pop_front() {
            Some(j) => j,
            None => return,
        }
    };

    let started = spawn_job(&app, &job, &state);
    if let Err(reason) = started {
        let _ = app.emit(
            CONTENT_EVENT,
            ContentStatus::Finished {
                id: job.id.clone(),
                outcome: Outcome::NotFoundOrFailed,
                message: reason,
                log: None,
            },
        );
        // A failure to start must not wedge the queue.
        start_next(app, state);
    }
}

/// What Zero-K's own content service could do for an item pr-downloader missed.
enum Fallback {
    /// Downloaded and put in place. Carries a line for the UI.
    Installed(String),
    /// The service does not have it either. Keep pr-downloader's own message.
    NotThere,
    /// It has it, but getting it went wrong. Worth saying out loud.
    Failed(String),
}

/// Try the ContentService for one item, reporting progress under the same job.
fn try_zk_content(
    app: &tauri::AppHandle,
    id: &str,
    item: &ContentItem,
    root: Option<&str>,
) -> Fallback {
    use tauri::Emitter;

    let note = |level: Level, message: String| {
        let _ = app.emit(
            CONTENT_EVENT,
            ContentStatus::Note { id: id.to_string(), level, message },
        );
    };

    let resolved = match zkcontent::resolve(&item.name) {
        Ok(Some(r)) => r,
        // A nil result: the service has never heard of it either.
        Ok(None) => return Fallback::NotThere,
        Err(e) => {
            note(Level::Warn, format!("Zero-K's content service: {e}"));
            return Fallback::NotThere;
        }
    };

    // It knows the name but does not serve the file - a real answer, and a
    // different one from "no such thing".
    let Some(url) = resolved.urls.first() else {
        return Fallback::NotThere;
    };

    let install = match install::detect_with(root) {
        Ok(i) => i,
        Err(e) => return Fallback::Failed(e),
    };
    let name = match zkcontent::file_name_for(url) {
        Ok(n) => n,
        Err(e) => return Fallback::Failed(e),
    };
    let dest = install.root.join(resolved.kind.directory()).join(&name);

    note(Level::Info, format!("Not in rapid or springfiles; trying zero-k.info for {}", item.name));

    let app_p = app.clone();
    let id_p = id.to_string();
    let mut last = u8::MAX;
    let progress = move |done: u64, total: u64| {
        let percent = if total > 0 { ((done * 100) / total).min(100) as u8 } else { 0 };
        // The engine's own downloader is chatty; one event per percent is
        // plenty and keeps the bridge quiet.
        if percent != last {
            last = percent;
            let _ = app_p.emit(
                CONTENT_EVENT,
                ContentStatus::Progress {
                    id: id_p.clone(),
                    percent,
                    done: done as i64,
                    total: total as i64,
                },
            );
        }
    };

    match zkcontent::fetch_to(url, &dest, resolved.md5.as_deref(), progress) {
        Ok(()) => Fallback::Installed(format!("Downloaded {name} from zero-k.info.")),
        Err(e) => Fallback::Failed(e),
    }
}

/// Resolve, spawn, and wire up the three threads.
fn spawn_job(app: &tauri::AppHandle, job: &Job, state: &Content2) -> Result<(), String> {
    use tauri::Emitter;

    let install = install::detect_with(state.root.as_deref())?;
    let exe = find_pr_downloader(&install.root, &job.engine)?;
    let plan = download_plan(&exe, &install.root, &job.items)?;

    // Bare pr-downloader with nothing queued exits 1, so never spawn an empty job.
    if job.items.is_empty() {
        return Err("nothing to download".into());
    }

    let mut cmd = std::process::Command::new(&plan.exe);
    cmd.current_dir(&plan.cwd)
        .args(&plan.args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Release builds are windows_subsystem="windows"; a console flashing up on
    // every download would be a visible regression.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", plan.exe.display()))?;

    let tail = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(out) = child.stdout.take() {
        pump(out, app.clone(), job.id.clone(), false, tail.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, app.clone(), job.id.clone(), true, tail.clone());
    }

    if let Ok(mut slot) = state.active.lock() {
        *slot = Some(ActiveJob { id: job.id.clone(), child });
    }
    let _ = app.emit(CONTENT_EVENT, ContentStatus::Started { id: job.id.clone() });

    // Supervisor. Polls rather than blocking on wait() so that a cancel can take
    // the lock and kill the child.
    let app_w = app.clone();
    let state_w = state.clone();
    let id = job.id.clone();
    let items_w = job.items.clone();
    let root_w = state.root.clone();
    std::thread::spawn(move || {
        let code = loop {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let mut slot = match state_w.active.lock() {
                Ok(s) => s,
                Err(_) => break None,
            };
            let Some(a) = slot.as_mut() else { break None };
            if a.id != id {
                break None; // superseded
            }
            match a.child.try_wait() {
                Ok(Some(status)) => {
                    let c = status.code();
                    *slot = None;
                    break c;
                }
                Ok(None) => continue,
                Err(_) => {
                    *slot = None;
                    break None;
                }
            }
        };

        let mut outcome = classify_exit(code);
        let mut message = outcome.message();
        let mut log = if matches!(outcome, Outcome::Ok) {
            None
        } else {
            state_w
                .tail_of(&tail)
                .filter(|s: &String| !s.trim().is_empty())
        };

        /* pr-downloader knows rapid and springfiles, and between them they do
           not have recent community maps or any custom mod. Zero-K runs its own
           service that does. Only reached when pr-downloader has actually
           failed, because it is delta-based against the rapid pool and moves
           far less data than pulling a whole archive.

           This is only correct because each job now carries a single item: the
           exit code used to be an OR over the batch, so there was no per-item
           failure to fall back from. See docs/DOWNLOADS-ZK-CONTENT.md. */
        if !matches!(outcome, Outcome::Ok | Outcome::Killed) {
            if let Some(item) = items_w.first() {
                match try_zk_content(&app_w, &id, item, root_w.as_deref()) {
                    Fallback::Installed(what) => {
                        outcome = Outcome::Ok;
                        message = what;
                        log = None;
                    }
                    Fallback::NotThere => {}
                    Fallback::Failed(why) => {
                        message = format!("{} {why}", outcome.message());
                    }
                }
            }
        }

        /* Write down what arrived, so the next preflight knows about it
           without waiting for the engine to restart and rescan. This is the
           difference between fetching a map and being able to say you have it. */
        if outcome == Outcome::Ok {
            if let Ok(install) = install::detect_with(root_w.as_deref()) {
                for item in &items_w {
                    archives::remember_downloaded(&install.root, &item.name);
                }
            }
        }

        let _ = app_w.emit(
            CONTENT_EVENT,
            ContentStatus::Finished { id: id.clone(), outcome, message, log },
        );
        start_next(app_w, state_w);
    });

    Ok(())
}

/// The shared halves of [`Content`], cheap to clone into worker threads.
#[derive(Clone)]
struct Content2 {
    active: std::sync::Arc<std::sync::Mutex<Option<ActiveJob>>>,
    queue: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<Job>>>,
    root: Option<String>,
}

impl Content2 {
    fn tail_of(&self, tail: &std::sync::Arc<std::sync::Mutex<String>>) -> Option<String> {
        tail.lock().ok().map(|t| t.clone())
    }
}

impl Content {
    fn shared(&self, root: Option<String>) -> Content2 {
        Content2 { active: self.active.clone(), queue: self.queue.clone(), root }
    }
}

/// Queue an acquisition. Progress arrives on `zks://content`.
#[tauri::command]
pub fn zks_content_fetch(
    app: tauri::AppHandle,
    content: tauri::State<'_, Content>,
    engine: String,
    items: Vec<ContentItem>,
    install_root: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;

    if items.is_empty() {
        return Err("nothing to download".into());
    }
    for item in &items {
        check_name(&item.name)?;
    }

    // Deduplicate against what is already queued or running. Joining two battles
    // on the same map, or a BattleUpdate flapping between maps, must not enqueue
    // the same download twice.
    let id = next_job_id();
    {
        let mut q = self_lock(&content.queue)?;
        let already: Vec<&ContentItem> = q.iter().flat_map(|j| j.items.iter()).collect();
        let fresh: Vec<ContentItem> = items
            .iter()
            .filter(|i| !already.iter().any(|e| e.kind == i.kind && e.name == i.name))
            .cloned()
            .collect();
        if fresh.is_empty() {
            /* Everything asked for is already queued, so hand back the id of
               the job doing it rather than a sentinel.

               This used to return the literal "already-queued", which the
               caller then used as a job id: it waited on a job that would never
               exist, and Cancel aimed at nothing. Returning the real id means a
               second caller waits for the first one's download, which is what
               "it is already happening" should mean. */
            let existing = q
                .iter()
                .find(|j| {
                    j.items
                        .iter()
                        .any(|e| items.iter().any(|i| i.kind == e.kind && i.name == e.name))
                })
                .map(|j| j.id.clone());
            return existing.ok_or_else(|| "already queued, but the job is gone".to_string());
        }
        q.push_back(Job { id: id.clone(), engine, items: fresh.clone() });
        let _ = app.emit(CONTENT_EVENT, ContentStatus::Queued { id: id.clone(), items: fresh });
    }

    start_next(app, content.shared(install_root));
    Ok(id)
}

/// Stop a running job, or drop a queued one.
///
/// pr-downloader content-addresses the pool and writes incrementally, so a kill
/// leaves a partial pool rather than a corrupt archive and the next run resumes.
/// UNVERIFIED against a real download - confirm on first use.
#[tauri::command]
pub fn zks_content_cancel(content: tauri::State<'_, Content>, id: String) -> Result<(), String> {
    {
        let mut q = self_lock(&content.queue)?;
        q.retain(|j| j.id != id);
    }
    let mut slot = content
        .active
        .lock()
        .map_err(|_| "content state is poisoned".to_string())?;
    if let Some(a) = slot.as_mut() {
        if a.id == id {
            let _ = a.child.kill();
        }
    }
    Ok(())
}

fn self_lock<T>(
    m: &std::sync::Arc<std::sync::Mutex<T>>,
) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "content state is poisoned".to_string())
}

/// What a launch would need and what is missing, without downloading anything.
/// Sibling of `zks_launch_preview`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    pub install: install::Install,
    pub engine_ok: bool,
    pub engine_error: Option<String>,
    pub downloader: Option<PathBuf>,
    pub downloader_error: Option<String>,
    pub items: Vec<ContentItem>,
    pub writable: bool,
}

#[tauri::command]
pub fn zks_content_preflight(
    engine: String,
    game: Option<String>,
    map: Option<String>,
    install_root: Option<String>,
) -> Result<Preflight, String> {
    let install = install::detect_with(install_root.as_deref())?;

    let engine_error = install::find_engine(&install.root, &engine).err();
    let (downloader, downloader_error) = match find_pr_downloader(&install.root, &engine) {
        Ok(p) => (Some(p), None),
        Err(e) => (None, Some(e)),
    };

    /* What is missing, not what is needed.
       This used to push the game and the map in unconditionally, so
       `items.len() == 0` was never true for a real battle. The caller reads
       that as "nothing is missing", so every player reported UNSYNCED to every
       room forever - which is how Zero-K's `!start` came to announce Shiro
       users as "still downloading the map" in every game they played, and delay
       each start by ten seconds. It also meant a download was queued on every
       join even with everything already installed.

       `archives::installed` reads the engine's own scan, so the names compared
       here are the same ones the server uses. Absence is read as "not known to
       be here" and still results in a download, which is the safe direction:
       at worst something already present is fetched again. */
    let installed = archives::installed(&install.root);
    let mut items = Vec::new();
    if let Some(g) = game.filter(|s| !s.trim().is_empty()) {
        if !installed.has(&g) {
            items.push(ContentItem { kind: ContentKind::Game, name: g });
        }
    }
    if let Some(m) = map.filter(|s| !s.trim().is_empty()) {
        if !installed.has(&m) {
            items.push(ContentItem { kind: ContentKind::Map, name: m });
        }
    }

    // Probe rather than assume. The install root is writable here only because
    // Steam relaxes ACLs on steamapps; a standalone elevated install is not.
    let probe = install.root.join(".shiro-write-probe");
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);

    Ok(Preflight {
        engine_ok: engine_error.is_none(),
        engine_error,
        downloader,
        downloader_error,
        items,
        writable,
        install,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn items() -> Vec<ContentItem> {
        vec![
            ContentItem { kind: ContentKind::Game, name: "zk:stable".into() },
            ContentItem { kind: ContentKind::Map, name: "Adamantine Mountain 2".into() },
        ]
    }

    // --- the command line --------------------------------------------------

    #[test]
    fn writepath_comes_first_and_is_the_install_root() {
        let plan = download_plan(
            Path::new("C:/zk/engine/win64/2025.06.21/pr-downloader.exe"),
            Path::new("C:/zk"),
            &items(),
        )
        .unwrap();
        assert_eq!(plan.args[0], OsString::from("--filesystem-writepath"));
        assert_eq!(plan.args[1], OsString::from("C:/zk"));
    }

    #[test]
    fn one_flag_per_item_with_the_right_flag_per_kind() {
        let plan = download_plan(Path::new("pr.exe"), Path::new("C:/zk"), &items()).unwrap();
        let args: Vec<String> = plan.args.iter().map(|a| a.to_string_lossy().into()).collect();
        assert_eq!(
            args,
            vec![
                "--filesystem-writepath", "C:/zk",
                "--download-game", "zk:stable",
                "--download-map", "Adamantine Mountain 2",
            ]
        );
    }

    /// Bare pr-downloader with nothing queued exits 1, so the caller must not
    /// spawn in that case. The plan still builds; it just has no download flags.
    #[test]
    fn no_items_produces_no_download_flags() {
        let plan = download_plan(Path::new("pr.exe"), Path::new("C:/zk"), &[]).unwrap();
        assert_eq!(plan.args.len(), 2);
        assert!(!plan.args.iter().any(|a| a.to_string_lossy().starts_with("--download")));
    }

    #[test]
    fn refuses_names_that_would_forge_a_different_command() {
        let bad = |n: &str| {
            download_plan(
                Path::new("pr.exe"),
                Path::new("C:/zk"),
                &[ContentItem { kind: ContentKind::Map, name: n.into() }],
            )
            .is_err()
        };
        assert!(bad("map\n--download-game"));
        assert!(bad("--download-game"));
        assert!(bad("with\0nul"));
        assert!(bad("   "));
    }

    #[test]
    fn spaces_in_names_are_fine_because_args_are_not_a_shell_string() {
        assert!(download_plan(
            Path::new("pr.exe"),
            Path::new("C:/zk"),
            &[ContentItem { kind: ContentKind::Map, name: "Adamantine Mountain 2".into() }],
        )
        .is_ok());
    }

    // --- output splitting --------------------------------------------------

    /// The trap this whole module is shaped around.
    #[test]
    fn splits_carriage_return_progress() {
        let buf = "[Progress]   2% [=    ] 1/50 \r[Progress]   4% [==   ] 2/50 \r";
        let (parts, rest) = split_chunks(buf);
        assert_eq!(parts.len(), 2);
        assert_eq!(rest, "");
        assert!(parts[0].contains("2%"));
        assert!(parts[1].contains("4%"));
    }

    #[test]
    fn carries_a_partial_chunk_over_instead_of_dropping_it() {
        let (parts, rest) = split_chunks("[Info] a():done\n[Progress]   5% [=] 3/6");
        assert_eq!(parts.len(), 1);
        assert_eq!(rest, "[Progress]   5% [=] 3/6");
    }

    #[test]
    fn a_buffer_with_no_terminator_yields_nothing_yet() {
        let (parts, rest) = split_chunks("[Progress]  1%");
        assert!(parts.is_empty());
        assert_eq!(rest, "[Progress]  1%");
    }

    #[test]
    fn handles_both_terminators_together() {
        let (parts, _) = split_chunks("a\r\nb\n");
        assert_eq!(parts, vec!["a", "b"]);
    }

    // --- line parsing ------------------------------------------------------

    #[test]
    fn parses_a_real_progress_line() {
        assert_eq!(
            parse_line("[Progress]   2% [=                             ] 1/50 "),
            Line::Progress { percent: 2, done: 1, total: 50 }
        );
    }

    #[test]
    fn parses_a_real_info_line_and_drops_the_source_prefix() {
        let s = "[Info] /build/src/tools/pr-downloader/src/FileSystem/FileSystem.cpp:203:\
                 setWritePath():Using filesystem-writepath: C:/zk";
        assert_eq!(
            parse_line(s),
            Line::Log { level: Level::Info, message: "Using filesystem-writepath: C:/zk".into() }
        );
    }

    #[test]
    fn parses_a_real_error_line() {
        let s = "[Error] /build/src/tools/pr-downloader/src/main.cpp:187:main():\
                 Error occurred while downloading: 1";
        assert_eq!(
            parse_line(s),
            Line::Log { level: Level::Error, message: "Error occurred while downloading: 1".into() }
        );
    }

    #[test]
    fn a_progress_line_it_cannot_read_is_not_mistaken_for_progress() {
        match parse_line("[Progress] garbled") {
            Line::Other(_) => {}
            other => panic!("expected Other, got {other:?}"),
        }
    }

    #[test]
    fn unknown_output_survives_as_other() {
        assert_eq!(parse_line("something else"), Line::Other("something else".into()));
    }

    // --- against real captured output ---------------------------------------
    //
    // Captured from the shipped pr-downloader.exe on 2026-08-18:
    //   pr-downloader --filesystem-writepath <ZK> --download-game "zk:stable"
    // with the content already present (exit 0, 1778 bytes of stdout).
    //
    // The bytes matter: log lines end CRLF, progress lines end with a BARE CR.
    // 14 carriage returns against 11 line feeds in that capture.
    const REAL_STDOUT: &str = concat!(
        "pr-downloader tarball (windows64)\r\n",
        "[Info] /build/src/tools/pr-downloader/src/FileSystem/FileSystem.cpp:203:",
        "setWritePath():Using filesystem-writepath: C:\\Program Files (x86)\\Steam\r\n",
        "[Progress] 100% [==============================] 1/1 \r",
        "[Progress]   0% [                              ] 0/1 \r",
        "[Progress] 100% [==============================] 1/1 \r",
        "[Info] /build/src/tools/pr-downloader/src/pr-downloader.cpp:191:",
        "DownloadSetConfig():Free disk space: 421559 MB\r\n",
    );

    #[test]
    fn real_output_splits_into_clean_chunks() {
        let (parts, rest) = split_chunks(REAL_STDOUT);
        assert_eq!(rest, "", "everything was terminated, nothing should carry over");
        let progress: Vec<&&str> =
            parts.iter().filter(|p| p.starts_with("[Progress]")).collect();
        assert_eq!(progress.len(), 3, "got {parts:?}");
    }

    /// The whole reason `split_chunks` exists. A newline-only reader merges a
    /// progress line with whatever follows it, so this must NOT be how we read.
    #[test]
    fn a_newline_only_reader_would_have_merged_them() {
        let merged = REAL_STDOUT
            .split('\n')
            .filter(|l| l.contains("[Progress]"))
            .count();
        assert_eq!(merged, 1, "all three progress updates collapse into one line");
    }

    #[test]
    fn parses_the_real_progress_lines_verbatim() {
        assert_eq!(
            parse_line("[Progress] 100% [==============================] 1/1 "),
            Line::Progress { percent: 100, done: 1, total: 1 }
        );
        assert_eq!(
            parse_line("[Progress]   0% [                              ] 0/1 "),
            Line::Progress { percent: 0, done: 0, total: 1 }
        );
    }

    /// From a real 2.5 MB map download on 2026-08-18:
    ///   pr-downloader --filesystem-writepath <ZK> --download-map "Red Comet"
    /// exit 0, 13 progress updates, red_comet.sd7 landed.
    ///
    /// The counters are BYTES here, where a rapid repo search reports FILE
    /// COUNTS (26/50). Same format, wildly different magnitudes — so nothing may
    /// assume a small total, and percent has to come from done/total.
    #[test]
    fn parses_byte_counters_from_a_real_transfer() {
        assert_eq!(
            parse_line("[Progress]   0% [=                             ] 7981/2656510 "),
            Line::Progress { percent: 0, done: 7981, total: 2_656_510 }
        );
        assert_eq!(
            parse_line("[Progress]  70% [=====================         ] 1847981/2656510 "),
            Line::Progress { percent: 70, done: 1_847_981, total: 2_656_510 }
        );
        assert_eq!(
            parse_line("[Progress] 100% [==============================] 2656510/2656510 "),
            Line::Progress { percent: 100, done: 2_656_510, total: 2_656_510 }
        );
    }

    #[test]
    fn the_version_banner_is_not_mistaken_for_a_log_line() {
        assert_eq!(
            parse_line("pr-downloader tarball (windows64)"),
            Line::Other("pr-downloader tarball (windows64)".into())
        );
    }

    // --- exit codes --------------------------------------------------------

    #[test]
    fn classifies_the_documented_exit_codes() {
        assert_eq!(classify_exit(Some(0)), Outcome::Ok);
        assert_eq!(classify_exit(Some(1)), Outcome::NotFoundOrFailed);
        assert_eq!(classify_exit(Some(2)), Outcome::Unfinished);
        assert_eq!(classify_exit(Some(5)), Outcome::NoDiskSpace);
        assert_eq!(classify_exit(Some(6)), Outcome::DependsFailed);
        assert_eq!(classify_exit(None), Outcome::Killed);
        assert_eq!(classify_exit(Some(42)), Outcome::Unknown(42));
    }

    /// Exit 1 must not be reported as "not found" on its own — the shipped
    /// binary does not emit the line upstream logs, so the caller has to
    /// re-check presence. The wording reflects that uncertainty.
    #[test]
    fn the_ambiguous_failure_does_not_claim_to_know_why() {
        let m = Outcome::NotFoundOrFailed.message();
        assert!(m.contains("may not exist"), "{m}");
    }
}
