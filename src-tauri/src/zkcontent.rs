//! Zero-K's own content service, for what pr-downloader cannot reach.
//!
//! pr-downloader resolves a name through rapid and springfiles. Between them
//! those cover the base game and most maps in circulation, and neither has
//! recent community maps or any of the custom mods. `docs/DOWNLOADS-ZK-CONTENT.md`
//! has the measurements; the short version is that Zero-K runs a WCF service
//! which does have them, and one SOAP call turns a name into a file URL.
//!
//! Three things about that service shape this module:
//!
//! * It is SOAP, and it answers on plain HTTP only - a POST to the HTTPS
//!   endpoint 404s. So the *resolution* cannot be encrypted. The download can
//!   be, and is: the returned links are `http://` but the same paths serve over
//!   `https://`, so we upgrade them and never fetch content in the clear.
//! * A name it does not know comes back as a nil result, not a fault, with
//!   HTTP 200. So does an empty name and one full of markup. There is no error
//!   to catch - absence is a shape, and [`parse_response`] returns `Ok(None)`.
//! * `links` can be empty on a resource that genuinely exists and is served
//!   elsewhere, which is a different answer from nil and is reported
//!   differently.
//!
//! The parsing half is pure and tested against responses captured verbatim from
//! the live service (`src/fixtures/downloadfile-*.xml`), including the 7 kB of
//! base64 torrent we do not want, because a blob sitting next to the fields we
//! do want is exactly what a careless scan would trip over.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const ENDPOINT: &str = "http://zero-k.info/ContentService.svc";
const SOAP_ACTION: &str = "http://tempuri.org/IContentService/DownloadFile";

/// Hosts we will take content from.
///
/// The official client merely prefers zero-k.info when ordering links; we
/// require it. We have none of its history of third-party mirrors to support,
/// and the list of links arrives over plain HTTP, so an attacker who can see
/// that exchange would otherwise get to name the download host outright.
const ALLOWED_HOST: &str = "zero-k.info";

/// Which directory a resource belongs in.
///
/// Decided by the service, never inferred from the extension: `.sd7` and `.sdz`
/// both appear on both sides.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Map,
    Mod,
}

impl ResourceKind {
    pub fn directory(self) -> &'static str {
        match self {
            ResourceKind::Map => "maps",
            ResourceKind::Mod => "games",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub kind: ResourceKind,
    /// Downloadable URLs, https, allowed host only. May be empty.
    pub urls: Vec<String>,
    /// Other internal names this one needs. May include `rapid://` entries,
    /// which are pr-downloader's job rather than ours.
    pub dependencies: Vec<String>,
    /// The archive's MD5, from `torrentFileName`.
    pub md5: Option<String>,
}

// ------------------------------------------------------------------ xml ----

/// Escape a value for an XML text node.
///
/// The name comes off the wire from the lobby server, so it is not ours to
/// trust; `Supreme-K 3.42` shows these are not tidy identifiers to begin with.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        // Last, so an escaped ampersand cannot re-form one of the above.
        .replace("&amp;", "&")
}

/// Reject anything that cannot be a sane content name before it reaches the
/// wire, on the same grounds as `content::check_name`.
fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("empty content name".into());
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(format!("content name contains a control character: {name:?}"));
    }
    Ok(())
}

pub fn build_request(internal_name: &str) -> Result<String, String> {
    check_name(internal_name)?;
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="utf-8"?>"#,
            r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>"#,
            r#"<DownloadFile xmlns="http://tempuri.org/"><internalName>{}</internalName></DownloadFile>"#,
            r#"</s:Body></s:Envelope>"#,
        ),
        xml_escape(internal_name)
    ))
}

/// Where an element's content starts, and whether the tag closed itself.
///
/// Namespace prefixes vary by response (`a:`, `b:`, none), so matching is on
/// the local name. Returns the open tag's attribute text as well, which is how
/// `i:nil` is spotted.
fn find_element<'a>(xml: &'a str, local: &str) -> Option<(usize, &'a str, bool)> {
    let bytes = xml.as_bytes();
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let start = i + off;
        let rest = &xml[start + 1..];
        if rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('!') {
            i = start + 1;
            continue;
        }
        let name_end = rest
            .find(|c: char| c == '>' || c == '/' || c.is_whitespace())
            .unwrap_or(rest.len());
        let name = &rest[..name_end];
        if name.rsplit(':').next() == Some(local) {
            let gt = match rest.find('>') {
                Some(g) => g,
                None => return None,
            };
            let attrs = &rest[name_end..gt];
            let self_closing = bytes.get(start + gt) == Some(&b'/');
            return Some((start + 1 + gt + 1, attrs, self_closing));
        }
        i = start + 1;
    }
    None
}

/// The text between an element's tags. `None` when absent or self-closing.
fn element_text<'a>(xml: &'a str, local: &str) -> Option<&'a str> {
    let (content_start, _, self_closing) = find_element(xml, local)?;
    if self_closing {
        return None;
    }
    let rest = &xml[content_start..];
    // These elements never contain a same-named child, so the first matching
    // close tag is ours.
    let mut i = 0;
    while let Some(off) = rest[i..].find("</") {
        let at = i + off;
        let after = &rest[at + 2..];
        let name_end = after.find('>')?;
        if after[..name_end].trim().rsplit(':').next() == Some(local) {
            return Some(&rest[..at]);
        }
        i = at + 2;
    }
    None
}

/// Every `<string>` inside a named container.
fn string_array(xml: &str, container: &str) -> Vec<String> {
    let Some(inner) = element_text(xml, container) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut rest = inner;
    while let Some(text) = element_text(rest, "string") {
        out.push(xml_unescape(text));
        // Step past this item.
        let Some(idx) = rest.find(text) else { break };
        rest = &rest[idx + text.len()..];
        if rest.is_empty() {
            break;
        }
    }
    out
}

/// The 32 hex digits before `.torrent`, if they are there.
fn md5_from_torrent_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".torrent")?;
    let candidate = stem.rsplit('_').next()?;
    let ok = candidate.len() == 32 && candidate.chars().all(|c| c.is_ascii_hexdigit());
    ok.then(|| candidate.to_ascii_lowercase())
}

/// True if `url` points somewhere we are willing to download from.
fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
        return false;
    };
    // Authority ends at the first '/', '?' or '#'. Strip any userinfo, which is
    // the classic way to make a URL look like it points somewhere it does not.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
    host == ALLOWED_HOST || host.ends_with(&format!(".{ALLOWED_HOST}"))
}

/// Upgrade a link to HTTPS. The service hands back `http://`; the same paths
/// serve over TLS, and there is no reason to move 90 MB of game content in the
/// clear when we do not have to.
fn to_https(url: &str) -> String {
    match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    }
}

/// Read a `DownloadFile` response.
///
/// `Ok(None)` means the service does not know the name - a nil result, which is
/// also what a malformed request produces. `Ok(Some(r))` with an empty
/// `r.urls` means it knows the name but does not serve the file.
pub fn parse_response(xml: &str) -> Result<Option<Resolved>, String> {
    if let Some(fault) = element_text(xml, "faultstring") {
        return Err(format!("the content service refused: {}", xml_unescape(fault).trim()));
    }
    let Some((_, attrs, _)) = find_element(xml, "DownloadFileResult") else {
        return Err("no DownloadFileResult in the response".into());
    };
    if attrs.contains("nil=\"true\"") {
        return Ok(None);
    }

    let kind = match element_text(xml, "resourceType").map(str::trim) {
        Some("Map") => ResourceKind::Map,
        Some("Mod") => ResourceKind::Mod,
        Some(other) => return Err(format!("unknown resourceType {other:?}")),
        None => return Err("no resourceType in the response".into()),
    };

    // rapid:// entries are instructions to use pr-downloader, not URLs, and
    // anything off-host is refused outright.
    let urls = string_array(xml, "links")
        .into_iter()
        .filter(|u| host_allowed(u))
        .map(|u| to_https(&u))
        .collect();

    Ok(Some(Resolved {
        kind,
        urls,
        dependencies: string_array(xml, "dependencies"),
        md5: element_text(xml, "torrentFileName").and_then(md5_from_torrent_name),
    }))
}

// -------------------------------------------------------------- searching ----

/// A map the service knows about.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct MapHit {
    pub name: String,
    /// Zero-K's own rating of the map. "MatchMaker" is the curated set the
    /// ladder draws from, so those are worth showing first.
    pub support: String,
}

/// Every `<InternalName>` in a FindResourceData response, with its support
/// level, best first.
///
/// The catalogue is enormous and unfiltered - a search for "wars" over mods
/// returns four hundred results going back to Star Wars TA - so the ordering
/// matters more than it looks. Maps the matchmaker will use come first.
pub fn parse_search(xml: &str) -> Result<Vec<MapHit>, String> {
    if let Some(fault) = element_text(xml, "faultstring") {
        return Err(format!("the content service refused: {}", xml_unescape(fault).trim()));
    }
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some((start, _, _)) = find_element(rest, "ResourceData") {
        let block_end = rest[start..]
            .find("</a:ResourceData>")
            .map(|i| start + i)
            .unwrap_or(rest.len());
        let block = &rest[start..block_end];
        if let Some(name) = element_text(block, "InternalName") {
            out.push(MapHit {
                name: xml_unescape(name),
                support: element_text(block, "MapSupportLevel").unwrap_or("").to_string(),
            });
        }
        rest = &rest[block_end.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
    }
    // Stable, so equal-ranked maps keep the service's own order.
    out.sort_by_key(|m| match m.support.as_str() {
        "MatchMaker" => 0,
        "Featured" => 1,
        "Supported" => 2,
        _ => 3,
    });
    Ok(out)
}

fn search_request(words: &[String], kind: &str) -> Result<String, String> {
    let mut items = String::new();
    for w in words {
        check_name(w)?;
        items.push_str(&format!("<a:string>{}</a:string>", xml_escape(w)));
    }
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="utf-8"?>"#,
            r#"<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>"#,
            r#"<FindResourceData xmlns="http://tempuri.org/">"#,
            r#"<words xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">{}</words>"#,
            r#"<type>{}</type></FindResourceData></s:Body></s:Envelope>"#,
        ),
        items, kind
    ))
}

/// Search Zero-K's map catalogue.
#[tauri::command]
pub fn zks_find_maps(query: String) -> Result<Vec<MapHit>, String> {
    let words: Vec<String> =
        query.split_whitespace().map(str::to_string).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let body = search_request(&words, "Map")?;
    let res = client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{}\"", "http://tempuri.org/IContentService/FindResourceData"))
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    parse_search(&res.text().map_err(|e| format!("unreadable response: {e}"))?)
}

// ------------------------------------------------------------- filenames ----

/// The file name a URL implies, refused if it could escape the target folder.
pub fn file_name_for(url: &str) -> Result<String, String> {
    let path = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    let name = path.rsplit('/').next().unwrap_or("");
    if name.is_empty() {
        return Err(format!("no file name in {url}"));
    }
    // A name is a name. Anything that could climb out of maps/ or games/, or
    // name a drive, is a bug or an attack and is not worth distinguishing.
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err(format!("refusing an unsafe file name: {name:?}"));
    }
    if !name.ends_with(".sd7") && !name.ends_with(".sdz") {
        return Err(format!("not a Spring archive: {name:?}"));
    }
    Ok(name.to_string())
}

// ----------------------------------------------------------------- http ----

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("shiro")
        .timeout(None) // a 90 MB map on a slow line is not a hung request
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Ask the service where a name lives.
pub fn resolve(internal_name: &str) -> Result<Option<Resolved>, String> {
    let body = build_request(internal_name)?;
    let res = client()?
        .post(ENDPOINT)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{SOAP_ACTION}\""))
        .body(body)
        .send()
        .map_err(|e| format!("could not reach the Zero-K content service: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the content service answered {}", res.status()));
    }
    let text = res.text().map_err(|e| format!("unreadable response: {e}"))?;
    parse_response(&text)
}

/// Download `url` to `dest`, resuming a previous attempt where possible.
///
/// Writes to `<dest>.part` and renames on success, so a half-finished archive
/// is never visible to the engine as an installed one.
pub fn fetch_to(
    url: &str,
    dest: &Path,
    expect_md5: Option<&str>,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    if !host_allowed(url) {
        return Err(format!("refusing to download from {url}"));
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }

    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut req = client()?.get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let mut res = req.send().map_err(|e| format!("download failed: {e}"))?;

    // Resume only if the server actually agreed to; a 200 to a Range request
    // means it is sending the whole file and appending would corrupt it.
    let resuming = have > 0 && res.status().as_u16() == 206;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0) + if resuming { have } else { 0 };

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(!resuming)
        .open(&part)
        .map_err(|e| format!("could not open {}: {e}", part.display()))?;
    if resuming {
        file.seek(SeekFrom::End(0))
            .map_err(|e| format!("could not seek {}: {e}", part.display()))?;
    }

    let mut done = if resuming { have } else { 0 };
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = res.read(&mut buf).map_err(|e| format!("download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("could not write {}: {e}", part.display()))?;
        done += n as u64;
        on_progress(done, total);
    }
    file.flush().map_err(|e| format!("could not flush {}: {e}", part.display()))?;
    drop(file);

    if let Some(want) = expect_md5 {
        let got = md5_of(&part)?;
        if !got.eq_ignore_ascii_case(want) {
            let _ = std::fs::remove_file(&part);
            return Err(format!(
                "the download did not match its checksum (wanted {want}, got {got}); discarded"
            ));
        }
    }

    std::fs::rename(&part, dest)
        .map_err(|e| format!("could not put {} in place: {e}", dest.display()))
}

fn md5_of(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut ctx = md5::Context::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("could not read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        ctx.consume(&buf[..n]);
    }
    Ok(format!("{:x}", ctx.compute()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured verbatim from the live service; see the module comment.
    const MAP: &str = include_str!("fixtures/downloadfile-map.xml");
    const MOD: &str = include_str!("fixtures/downloadfile-mod.xml");
    const NO_LINKS: &str = include_str!("fixtures/downloadfile-nolinks.xml");
    const UNKNOWN: &str = include_str!("fixtures/downloadfile-unknown.xml");

    #[test]
    fn a_map_resolves_to_one_https_url() {
        let r = parse_response(MAP).unwrap().expect("a result");
        assert_eq!(r.kind, ResourceKind::Map);
        assert_eq!(r.urls, ["https://zero-k.info/content/maps/HideandSeek2.2.3.sd7"]);
        assert_eq!(r.md5.as_deref(), Some("96a198564a13de79926b29f824d45622"));
        assert!(r.dependencies.is_empty());
    }

    /// The service hands back `http://`. Downloading game content in the clear
    /// when the same path serves over TLS would be a choice, not a constraint.
    #[test]
    fn links_are_upgraded_to_https() {
        for fixture in [MAP, MOD] {
            for url in parse_response(fixture).unwrap().unwrap().urls {
                assert!(url.starts_with("https://"), "{url}");
            }
        }
    }

    /// `links` is not a list of URLs. A rapid entry is an instruction to use
    /// pr-downloader, and passing it to an HTTP client would be nonsense.
    #[test]
    fn rapid_entries_are_not_treated_as_urls() {
        let r = parse_response(MOD).unwrap().expect("a result");
        assert_eq!(r.kind, ResourceKind::Mod);
        assert_eq!(r.urls, ["https://zero-k.info/content/games/supreme3.42.sdz"]);
    }

    /// Absence has two shapes and they mean different things.
    #[test]
    fn an_unknown_name_is_none_but_a_served_elsewhere_one_is_not() {
        assert_eq!(parse_response(UNKNOWN).unwrap(), None);
        let red = parse_response(NO_LINKS).unwrap().expect("Red Comet exists");
        assert!(red.urls.is_empty(), "it just is not served from here");
        assert_eq!(red.md5.as_deref(), Some("2be4f8b3709359902c056fdb2e67af44"));
    }

    const SEARCH: &str = include_str!("fixtures/findresource-maps.xml");
    const SEARCH_NONE: &str = include_str!("fixtures/findresource-none.xml");

    #[test]
    fn a_search_returns_the_names_the_server_would_accept() {
        let hits = parse_search(SEARCH).unwrap();
        assert!(hits.len() >= 8, "got {}", hits.len());
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"Comet Catcher Redux v3.1"), "{names:?}");
        // The map name, not a file name - this is what goes in BattleHeader.Map.
        assert!(names.iter().all(|n| !n.ends_with(".sd7") && !n.ends_with(".sdz")));
    }

    /// The catalogue is unfiltered and huge, so the order is the feature.
    #[test]
    fn matchmaker_maps_come_first() {
        let hits = parse_search(SEARCH).unwrap();
        let first_other = hits.iter().position(|h| h.support != "MatchMaker");
        let last_mm = hits.iter().rposition(|h| h.support == "MatchMaker");
        if let (Some(f), Some(l)) = (first_other, last_mm) {
            assert!(l < f, "a MatchMaker map sorted below a non-MatchMaker one");
        }
    }

    #[test]
    fn a_search_with_no_hits_is_empty_rather_than_an_error() {
        assert_eq!(parse_search(SEARCH_NONE).unwrap(), Vec::new());
    }

    #[test]
    fn a_blank_search_never_reaches_the_wire() {
        assert_eq!(zks_find_maps("   ".into()).unwrap(), Vec::new());
    }

    #[test]
    fn search_words_are_escaped_like_any_other_name() {
        let r = search_request(&["a & b".into()], "Map").unwrap();
        assert!(r.contains("a &amp; b"), "{r}");
        assert!(search_request(&["bad
word".into()], "Map").is_err());
    }

    #[test]
    fn a_fault_is_an_error_rather_than_an_absence() {
        let xml = "<s:Envelope><s:Body><s:Fault><faultstring>no</faultstring>\
                   </s:Fault></s:Body></s:Envelope>";
        assert!(parse_response(xml).is_err());
    }

    // --- the request -------------------------------------------------------

    #[test]
    fn the_name_is_escaped_on_the_way_out() {
        let r = build_request("Fish & <Chips> \"2\"").unwrap();
        assert!(r.contains("Fish &amp; &lt;Chips&gt; &quot;2&quot;"), "{r}");
        assert!(!r.contains("<Chips>"));
    }

    #[test]
    fn a_name_that_could_not_be_content_never_reaches_the_wire() {
        assert!(build_request("").is_err());
        assert!(build_request("   ").is_err());
        assert!(build_request("bad\nname").is_err());
    }

    #[test]
    fn round_trips_a_name_with_markup_in_it() {
        // The escaping has to survive our own parser, not just look right.
        let escaped = xml_escape("a & b < c");
        assert_eq!(xml_unescape(&escaped), "a & b < c");
        // An escaped ampersand must not re-form another entity.
        assert_eq!(xml_unescape(&xml_escape("&lt;")), "&lt;");
    }

    // --- hosts and names ---------------------------------------------------

    #[test]
    fn only_zero_k_hosts_are_accepted() {
        assert!(host_allowed("https://zero-k.info/content/maps/x.sd7"));
        assert!(host_allowed("http://files.zero-k.info/x.sd7"));
        assert!(!host_allowed("https://evil.example/x.sd7"));
        // The classic disguises.
        assert!(!host_allowed("https://zero-k.info.evil.example/x.sd7"));
        assert!(!host_allowed("https://evil.example/?zero-k.info"));
        assert!(!host_allowed("https://zero-k.info@evil.example/x.sd7"));
        assert!(!host_allowed("ftp://zero-k.info/x.sd7"));
    }

    #[test]
    fn a_file_name_cannot_climb_out_of_its_folder() {
        assert_eq!(
            file_name_for("https://zero-k.info/content/maps/HideandSeek2.2.3.sd7").unwrap(),
            "HideandSeek2.2.3.sd7"
        );
        assert_eq!(
            file_name_for("https://zero-k.info/content/games/supreme3.42.sdz?v=2").unwrap(),
            "supreme3.42.sdz"
        );
        assert!(file_name_for("https://zero-k.info/a/..%2Fx.sd7").is_err());
        assert!(file_name_for("https://zero-k.info/a/").is_err());
        assert!(file_name_for("https://zero-k.info/a/thing.exe").is_err());
    }

    #[test]
    fn maps_and_mods_land_in_different_places() {
        assert_eq!(ResourceKind::Map.directory(), "maps");
        assert_eq!(ResourceKind::Mod.directory(), "games");
    }

    #[test]
    fn the_checksum_is_only_taken_when_it_looks_like_one() {
        assert_eq!(
            md5_from_torrent_name("Hide_and_Seek_2.2.3_96a198564a13de79926b29f824d45622.torrent")
                .as_deref(),
            Some("96a198564a13de79926b29f824d45622")
        );
        assert_eq!(md5_from_torrent_name("no-md5-here.torrent"), None);
        assert_eq!(md5_from_torrent_name("Map_deadbeef.torrent"), None);
        assert_eq!(md5_from_torrent_name("something.else"), None);
    }

    /// Against the live service. Ignored by default so the suite stays offline
    /// and deterministic:
    ///
    ///     cargo test zkcontent::tests::live -- --ignored --nocapture
    #[test]
    #[ignore = "hits zero-k.info"]
    fn live_resolves_what_pr_downloader_cannot() {
        let map = resolve("Hide and Seek 2.2.3").unwrap().expect("the service knows it");
        assert_eq!(map.kind, ResourceKind::Map);
        assert!(map.urls[0].starts_with("https://zero-k.info/"), "{:?}", map.urls);
        assert!(map.md5.is_some());
        println!("  map  -> {} (md5 {:?})", map.urls[0], map.md5);

        let m = resolve("Supreme-K 3.42").unwrap().expect("a custom mod too");
        assert_eq!(m.kind, ResourceKind::Mod);
        println!("  mod  -> {:?} deps {:?}", m.urls, m.dependencies);

        assert_eq!(resolve("This Map Does Not Exist 9.9.9").unwrap(), None);
        println!("  unknown -> None, as expected");
    }

    /// The torrent element is 7 kB of base64 sitting between the fields we
    /// want. A scan that is not anchored on element names wanders into it.
    #[test]
    fn the_base64_torrent_does_not_confuse_the_scan() {
        assert!(MAP.len() > 8000, "fixture should still carry the blob");
        let r = parse_response(MAP).unwrap().unwrap();
        assert_eq!(r.urls.len(), 1);
        assert!(!r.urls[0].contains("torrent"));
    }
}
