# Changelog

## 1.1.0 — 2026-05-11

Sora View Lite is a local-first viewer for SoraVault archives. Sora is no
longer reachable, but this release packages everything needed to keep
browsing what you saved — and, where possible, to refresh what's missing.

### What this release does

- **Browses your archive locally.** Feed, Search, Creators, Characters,
  People (cameos), Remixes, Favorites, Collections, Profile — every page
  reads from local files. Indexes any `.mp4` placed inside one of the
  recognized SoraVault folder names: `sora_v2_creators`, `sora_v2_liked`,
  `sora_v2_profile`, `sora_v2_drafts`, `sora_v2_remixes`, `downloads`,
  `sora_downloads`, `mirror_browse`.

- **Plays videos with comments.** Original Sora comments (the first
  SSR-page worth, ~6–10 per post) show up alongside the video in the
  lightbox.

- **Three themes.** Dark, Light, and **Sora** — a starfield background
  with translucent navy chrome that mirrors the post-shutdown mobile UI.
  Toggle cycles sun / cloud / moon.

- **Mobile UI.** Five-element bottom nav with a prominent center Search
  FAB. Translucent chrome in Sora theme.

- **Refresh Sora Assets pipeline.** Five steps that re-fetch each post's
  server-rendered HTML from `sora.chatgpt.com` with JavaScript disabled
  (the only known way to bypass the sunset redirect — original research
  by this project) and pull fresh signed asset URLs from the embedded
  RSC payload. Then downloads official thumbnails, GIF previews, and
  profile avatars into your existing creator-folder layout.

- **Download Bookmarked Sora Video.** Paste any `/p/` URL to grab one
  post on demand — video, thumbnail, GIF, every reachable profile
  avatar, and its comments. If the post is already in your DB you get a
  clickable watch-now card instead, plus a "fill missing assets" button
  if anything's absent on disk.

- **Thumbnails — official or ffmpeg.** Pull the authentic Sora image via
  the Refresh pipeline, or generate locally from each video's first
  frame with ffmpeg. Both work, same on-disk filename.

- **Power-user CLI.** Every refresh step has an `npm run sora:*`
  shortcut. Plus a dependency-free `cli/do-all.js` for processing saved
  HTML on any machine with Node 18+.

- **LAN access** with QR codes so a phone on the same network can browse
  the archive.

- **Two database engines.** SQLite by default; switch to DuckDB under
  Server → Data & Database for very large archives or analytics queries.

- **Security hardening.** Path-traversal and SSRF guards on every
  payload-derived value used in a write path or download URL. Asset
  fetches are restricted to known Sora CDN hostnames.

- **One-click installers.** `start.bat` / `.command` / `.sh` for the
  app, `install-playwright.bat` / `.command` / `.sh` for the optional
  Chromium-based refresh pipeline.

- **Privacy.** No accounts, no telemetry, no remote calls beyond the
  optional refresh / bookmark-download flows that talk to Sora's CDN.

See [README.md](README.md) for the full tour, screenshots, install
instructions, folder layout, and CLI reference.
