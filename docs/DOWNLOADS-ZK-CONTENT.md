# Downloading the content pr-downloader cannot reach

> **Built.** `src-tauri/src/zkcontent.rs`, wired into `content.rs` as the
> fallback. Verified end to end through the built app against a throwaway
> install root: `Hide and Seek 2.2.3` downloaded in 41 seconds, 90,857,347
> bytes, MD5 `96a1985...` matching what the service advertised, `.part` renamed
> into place, and `Red Comet` still coming down through pr-downloader with its
> `.md5.gz` sidecar so the first tier is untouched. The estimate below said two
> days; it took rather less, because the spike had already removed the risk.

Scope for the second half of content acquisition. `docs/DOWNLOADS.md` covers
pr-downloader and ends at §1.6 with an open question; this answers it and
designs the fallback.

Everything in §1 was measured against the live service on 2026-08-19, not read
off a source tree. Commands are reproducible from the repo.

---

## 0. The short version

Zero-K runs its own content service, and it has the things springfiles and rapid
do not. One SOAP call turns a name into a plain HTTPS file URL.

```
POST http://zero-k.info/ContentService.svc
SOAPAction: "http://tempuri.org/IContentService/DownloadFile"
  <DownloadFile xmlns="http://tempuri.org/">
    <internalName>Hide and Seek 2.2.3</internalName>
  </DownloadFile>

-> resourceType    Map
   links[0]        http://zero-k.info/content/maps/HideandSeek2.2.3.sd7
   torrentFileName Hide_and_Seek_2.2.3_96a198564a13de79926b29f824d45622.torrent
```

That URL serves a real 90,857,347-byte 7z archive, with `Content-Length`, over
**HTTPS** as well as HTTP. The `96a1...` in the torrent name is the archive's
MD5, so the download can be verified.

This is not a large piece of work. The resolution is one HTTP POST and a regex;
the download is a GET to a file. The care goes into where files land, dependency
resolution, and not trusting a plain-HTTP channel more than it deserves.

**It closes the gap completely for the cases we have tested**: the map that
started this (`Hide and Seek 2.2.3`) and a custom mod (`Supreme-K 3.42`) both
resolve, and neither is reachable any other way.

---

## 1. What was measured

### 1.1 The service is real, and only on HTTP

| request | result |
|---|---|
| `GET https://zero-k.info/ContentService.svc?wsdl` | 200, but the WCF **help page** (3,044 B of HTML) |
| `GET http://zero-k.info/ContentService.svc?wsdl` | 200, **14,642 B of WSDL** |
| `POST https://zero-k.info/ContentService.svc` | **404** |
| `POST http://zero-k.info/ContentService.svc` | 200, a SOAP response |

So resolution must go over plain HTTP. The file download must not - see §5.

### 1.2 The contract

`targetNamespace` is `http://tempuri.org/`. Fourteen operations; the one that
matters is `DownloadFile`, SOAPAction
`http://tempuri.org/IContentService/DownloadFile`.

Request is a single string:

```xml
<xs:element minOccurs="0" name="internalName" nillable="true" type="xs:string"/>
```

`DownloadFileResponse` (namespace
`http://schemas.datacontract.org/2004/07/PlasmaShared`):

A name the service does not know returns `DownloadFileResult` **nil** - 316
bytes, no SOAP fault, HTTP 200. Verified with a nonsense name, an empty string
and `<script>x</script>`; all three gave byte-identical shapes, so an injection
attempt is indistinguishable from a typo and neither produces an error to
handle specially.

| field | type | what it is |
|---|---|---|
| `links` | `ArrayOfstring` | where to get it. May be empty. May contain `rapid://` |
| `dependencies` | `ArrayOfstring` | other internal names this needs |
| `resourceType` | `Map` \| `Mod` | which directory it belongs in |
| `torrent` | base64 | a .torrent we do not want |
| `torrentFileName` | string | `<name>_<md5>.torrent` - the MD5 is the useful part |

The other thirteen operations are worth knowing about but are not this task:
`GetEngineList`, `GetDefaultEngine`, `FindResourceData`, `GetResourceData`,
`GetResourceList`, `GetScriptMissionData`, `NotifyMissionRun`,
`RegisterResource`, `SubmitMissionScore`, `GetDefaultMissions`,
`GetPublicCommunityInfo`, `GetFeaturedCustomGameModes`, `GetSpringBattleInfo`.

### 1.3 Three names, three different answers

| internal name | resourceType | links |
|---|---|---|
| `Hide and Seek 2.2.3` | Map | `http://zero-k.info/content/maps/HideandSeek2.2.3.sd7` |
| `Supreme-K 3.42` | Mod | `rapid://zk:stable`, then `http://zero-k.info/content/games/supreme3.42.sdz` |
| `Red Comet` | Map | **none** |

Three lessons, and each one is a branch in the design:

1. A map that pr-downloader cannot find resolves here. This is the whole point.
2. `links` is not homogeneous. `rapid://` entries are instructions to use
   pr-downloader, not URLs to fetch. Filter to `http`/`https`.
3. `links` can be **empty** on a perfectly real resource. `Red Comet` is
   installed on this machine and pr-downloader fetches it happily. Empty means
   "not served from here", not "does not exist" - so an empty list after a
   pr-downloader miss is a genuine dead end and must be reported as one.

The official client agrees on the ordering, in
`Shared/PlasmaDownloader/Torrents/TorrentDownloader.cs`:

```csharp
e.links.OrderByDescending(x => x.Contains("zero-k.info")).FirstOrDefault()
```

### 1.4 The file is a file

```
HTTP/1.1 200 OK
Content-Length: 90857347
Content-Type: application/octet-stream
```

First six bytes `37 7a bc af 27 1c` - the 7z magic, so it is a genuine `.sd7`.
`Content-Length` is present, which gives an honest progress bar; a range request
for the first megabyte was served, so **resume works**.

The same URL over `https://` returns the same `Content-Length`.

---

## 2. Where it sits

Resolution order per item, first hit wins:

1. **pr-downloader** - rapid, then springfiles. Already built. Handles
   `zk:stable`, the default `Zero-K vX.Y.Z`, and most maps in circulation. It
   is delta-based against the rapid pool, so it moves far less data than a
   whole-archive download and must stay first.
2. **ContentService** - this document. Everything else.
3. **Fail**, with the name and both reasons.

Nothing about step 1 changes. The recent fix that gives each item its own
pr-downloader process (see ARCHITECTURE §7) is what makes step 2 possible at
all: before it, a batch reported success and there was no failure to fall back
from.

---

## 3. Design

### 3.1 Rust, `src-tauri/src/zkcontent.rs` (new)

Kept out of `content.rs`, which is about driving a child process; this is an
HTTP client and shares nothing with it but the destination directory.

```rust
pub struct Resolved {
    pub kind: ResourceKind,       // Map | Mod
    pub urls: Vec<String>,        // http(s) only, zero-k.info first
    pub dependencies: Vec<String>,
    pub md5: Option<String>,      // parsed out of torrentFileName
}

/// One SOAP POST. Pure string handling on the way in and out.
pub fn build_request(internal_name: &str) -> String;
pub fn parse_response(xml: &str) -> Result<Resolved, String>;

/// The side-effecting half.
pub async fn resolve(internal_name: &str) -> Result<Resolved, String>;
pub async fn fetch_to(url: &str, dest: &Path, on_progress: impl Fn(u64, u64)) -> Result<(), String>;
```

`build_request` and `parse_response` are pure and get the tests - the same split
`content.rs` already uses, where the plan builder is tested and the spawn is
not. Fixtures: the three responses in §1.3, captured verbatim.

**XML escaping is not optional.** `internalName` is attacker-influenced in the
sense that it comes off the wire from the lobby server, and `Supreme-K 3.42` is
already a name with punctuation in it. Escape `& < > " '` on the way in, and
reject control characters the same way `check_name` in `content.rs` does.

### 3.2 Where the file lands

`resourceType` decides the directory - `Map` → `<ZK>/maps/`, `Mod` →
`<ZK>/games/` - and nothing else does. Do not infer it from the extension: both
`.sd7` and `.sdz` appear on both sides.

The filename comes from the **URL basename**, not from `torrentFileName`. The
torrent name is a mangled form (`Hide_and_Seek_2.2.3_<md5>.torrent`) whose
relationship to the real archive name is not something to guess at; the URL
already ends in `HideandSeek2.2.3.sd7`.

Write to `<dest>.part` and rename on success, so an interrupted download never
looks like an installed archive to the engine. This is the same failure the
whole task exists to fix, one layer down.

### 3.3 Dependencies

`dependencies` is a list of internal names, and `Supreme-K 3.42` shows the shape:
its dependency is `rapid://zk:stable`, which is step 1's job. So resolve
recursively, routing each dependency back through the top of §2. Cap the depth
(3 is generous) and keep a visited set - a cycle here would be an infinite
download loop.

### 3.4 Integrity

Verify the MD5 from `torrentFileName` after the download. It is not a strong
guarantee (see §5) but it catches truncation and corruption, which are the
likely failures on a 90 MB file.

If it does not match, delete the `.part` and report it. Do not install the file
and hope.

### 3.5 Progress and cancellation

`Content-Length` is present, so progress is real rather than a spinner. Reuse
the existing `ContentStatus` event shape so the downloads screen and the launch
phase need no changes - they already render percent from a job id.

Resume with `Range: bytes=<len>-` when a `.part` is present and the server
returns 206. It served a range request in testing, but check the status code
rather than assuming, and start over on anything but 206.

---

## 4. What this does not solve

- **Engine downloads.** `GetEngineList` and `GetDefaultEngine` exist on the same
  service and are not covered here. Shiro uses whatever engine the install
  already has.
- **Anything with no links and no rapid entry.** There is no third source.
- **Speed.** This pulls whole archives; rapid pulls deltas against a pool. A
  90 MB map is a 90 MB download every time, where rapid would often move a
  fraction of that. Another reason step 1 stays first.

---

## 5. Security, stated plainly

**Resolution happens over plain HTTP and cannot be moved to HTTPS** - the
endpoint 404s there. Anyone able to intercept that request can choose which URL
Shiro downloads a game archive from, and can rewrite the MD5 in the same
response, so the integrity check does not defend against a network attacker. It
defends against corruption.

What we can do, and should:

- **Upgrade the download to HTTPS.** The returned links are `http://`; the same
  paths serve over `https://` with an identical `Content-Length`. Rewrite the
  scheme and only fall back to HTTP if HTTPS fails, recording that it did.
- **Pin the host.** Accept `zero-k.info` and its subdomains, and refuse to
  download from a link pointing anywhere else. The official client merely
  *prefers* zero-k.info; we can require it, because we do not have its history
  of third-party mirrors to support.
- **Never execute what we fetch.** These are data archives read by the engine.
  Nothing here should ever be run, and the destination directories must stay
  `maps/` and `games/`. Reject any path component in the derived filename -
  `..`, separators, a drive letter - before joining it to the root.

This is not worse than the official client, which does the same over the same
channel. It is worth writing down rather than discovering later, and worth
raising with the ZK developers: an HTTPS route for `ContentService.svc` would
remove the whole issue and is probably a routing rule on their side.

---

## 6. Work breakdown

| | |
|---|---|
| `zkcontent.rs`: request builder, response parser, fixtures, tests | half a day |
| Download with progress, resume, `.part`, MD5 | half a day |
| Wire into the resolution order; dependency recursion | half a day |
| Failure paths, the UI copy for "not available anywhere" | quarter day |
| End-to-end against the real service, including a 90 MB map | quarter day |

Two days, and the risk is low because the unknown - whether the service answers
at all, and in what shape - is the part already settled above.

The one thing to confirm before starting: an HTTP client in the Rust
dependencies. `tauri-plugin-http` is likely already available; otherwise
`reqwest` with `rustls` rather than native TLS, to keep the Linux CI build free
of an OpenSSL dependency.

---

## 7. Open questions

1. **Is there a non-SOAP route?** The WSDL is the only documented interface and
   SOAP is fine - the envelope is twelve lines - but a JSON endpoint would be
   less to maintain. Worth one question to the ZK developers.
2. **Can `ContentService.svc` serve HTTPS?** See §5. Same conversation.
3. ~~What does an unknown name return?~~ **Answered.** A 316-byte response
   with `DownloadFileResult` nil - no fault, no `resourceType`, no `links` -
   for an unknown name, an empty name, and a name full of markup alike. So the
   not-found path is "the result element is nil", and it is the same path as a
   malformed request. HTTP status is 200 either way and tells you nothing.

   Note what this means for §1.3: a nil result and an empty `links` array on a
   real resource (`Red Comet`) are **different responses**, and only the second
   is worth reporting as "exists but not served from here".
