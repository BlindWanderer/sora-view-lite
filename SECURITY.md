# Security policy

If you think you've found a security issue in Sora View Lite — anything
that could expose data outside your local archive, run arbitrary code,
overwrite files outside the archive root, leak credentials or session
state, or otherwise misbehave — please **open a GitHub Issue** describing
what you found and (ideally) how to reproduce it.

If the issue feels sensitive enough that even a public issue would be a
problem (e.g. an unpatched remote-code-execution path), please mark the
issue title as **`[security] please contact me privately`** and we'll
move the discussion off-list.

## Scope

Sora View Lite is local-first. The app runs entirely on your machine and
makes no remote calls during normal browsing. The only network
interactions are:

- The optional **Refresh Sora Assets** pipeline (Server → Assets), which
  fetches HTML from `sora.chatgpt.com` and downloads assets from
  Sora-controlled CDN hosts (`videos.openai.com`, `cdn.openai.com`).
- The optional **Download Bookmarked Sora Video** flow, same target hosts.
- The **LAN access** mode (opt-in), which binds the local web server to
  `0.0.0.0` on your network instead of `127.0.0.1`.

Issues we particularly care about:

- Path traversal in any code path that takes data from a Sora payload
  and writes to disk.
- SSRF in any download path that takes a URL from a payload.
- Cross-site scripting in any rendered surface that includes user-
  supplied content.
- Privilege escalation when running in LAN access mode.

Issues that are explicitly **out of scope**:

- Vulnerabilities in upstream Sora content (we don't control sora.chatgpt.com).
- Issues that require an attacker to already have local code execution on
  your machine.

## Versions

The latest released minor version is the only one that receives fixes.
There are no long-term-support branches.
