# Sora View Lite Requirements

## 1. Project summary

Sora View Lite is a local-first archive viewer for SoraVault backups. It is intended for users who saved their Sora videos, thumbnails, previews, sidecar files, and manifest files and now need a reliable offline way to browse and manage that archive.

The application should feel similar to a modern short-video archive: users can browse a feed, search videos, open videos in a lightbox, view creators and characters, use a mobile vertical video feed, generate missing local thumbnails/previews, create local favorites and collections, and inspect archive health. The app must not depend on live Sora media URLs.

Special thanks should be shown in the About section to **Sebastian Haas** for developing SoraVault, which made it possible for users to back up and preserve their Sora libraries.

---

## 2. Primary project prompt

Build a local-first SoraVault archive viewer named **Sora View Lite**.

The app should let a user select a local SoraVault archive folder, ingest locally saved videos and metadata into a local database, and browse the archive through a Sora-like web UI. It should support SQLite by default and DuckDB as an experimental local database option. It should recursively scan the selected archive folder for videos, thumbnails, previews, sidecar text files, SoraVault manifests, extracted JSON files, and remix manifests.

The app should use only local media assets. Remote URLs found inside JSON or manifest files may be preserved as historical metadata but must not be used by the UI as media sources. If thumbnails or previews are missing, the app may offer user-triggered ffmpeg-based generation jobs. These jobs must not overwrite existing assets.

The app should run as a local Node/SvelteKit server, with production launchers for Windows, Linux, and macOS. It should provide a setup wizard, import progress, diagnostics, asset health, server settings, optional LAN access guidance, and local library management tools.

---

## 3. Audience and usage model

### 3.1 Normal local user

The normal user has a local SoraVault folder with videos and perhaps sidecars or manifest files. They want to:

- Open the app locally.
- Pick the archive folder.
- Import videos and metadata.
- Browse videos quickly.
- Search prompts, creators, and characters.
- Open videos in a lightbox.
- Use mobile browsing from a phone or tablet on the same network when enabled.
- Generate missing thumbnails/previews if desired.
- Create local favorites and collections.

### 3.2 Advanced local user

The advanced user may have:

- Thousands to tens of thousands of videos.
- SoraVault manifest files.
- Extracted JSON files.
- Remix chain manifests.
- Local profile images.
- Official local thumbnails and animated previews.
- A preference for DuckDB experimentation.

### 3.3 LAN user

A LAN user may run the app on one computer and browse from other devices on the network. The app must warn users about LAN exposure and allow safer display settings such as hiding full local paths.

---

## 4. Technical stack requirements

### 4.1 Runtime

- Node.js 20.19 or newer.
- SvelteKit with adapter-node.
- Svelte 5.
- Vite production build.
- Native SQLite access through `better-sqlite3`.
- Optional DuckDB access through `@duckdb/node-api`, with fallback to `duckdb` only when the newer package cannot be imported.

### 4.2 Launchers

The default launchers should run production mode:

- `start.bat` for Windows.
- `start.sh` for Linux.
- `start.command` for macOS.

Debug launchers should run Vite development mode:

- `start-debug.bat`.
- `start-debug.sh`.
- `start-debug.command`.

Production launchers should:

1. Check for Node and npm.
2. Install dependencies if needed.
3. Build the app.
4. Start `node build/index.js`.
5. Open the browser.

Debug launchers should:

1. Check dependencies.
2. Run Vite dev server.
3. Open the browser.

### 4.3 Production build constraints

Native modules must not be bundled by Vite/Rollup. The following should be treated as runtime Node dependencies:

- `better-sqlite3`
- `@duckdb/node-api`
- `duckdb`
- DuckDB native bindings

Optional native imports should be opaque runtime imports so the production build does not attempt to parse `.node` binaries.

---

## 5. Setup wizard requirements

### 5.1 Server-side folder selection

Folder picking should be implemented server-side rather than through browser-only JavaScript or the File System Access API.

Reason: the Node server needs the real filesystem path to recursively scan files, serve videos, run ffmpeg, write generated assets beside videos, and persist stable relative paths. Browser file APIs do not reliably provide server-usable OS paths and are sandboxed by design.

### 5.2 Wizard flow

The wizard should ask:

1. Archive folder location.
2. Database engine:
   - SQLite, default.
   - DuckDB, experimental.
3. Whether the user kept SoraVault manifest files:
   - Yes.
   - No.
   - I don't know — scan anyway.

Even if the user says no or unknown, the app should still scan recursively for recognized JSON metadata files.

### 5.3 Database switching

Switching database engines should require re-ingest. The app should update the database path based on the selected engine:

- SQLite: `sora.db`
- DuckDB: `sora.duckdb`

---

## 6. Ingestion requirements

### 6.1 Ingest priorities

Metadata should be merged by priority:

1. Advanced/extracted JSON.
2. SoraVault manifest JSON.
3. Remix chain JSON.
4. Sidecar text file.
5. Filename and directory fallback.

Higher-priority metadata should overwrite weak fallback metadata such as filename-derived titles or `attachment 0`-style placeholders.

### 6.2 Supported metadata sources

The scanner should recursively detect:

- `soravault_manifest_*.json`
- JSON files with `items[]`
- JSON files with `chains[]`
- JSON files with `posts[]`
- `*.extracted.json`
- Sidecar `.txt` files
- Local profile image files
- Videos in any folder, including `downloads`

### 6.3 Supported folder patterns

The scanner should support at least:

- `sora_v2_creator/<username>/...`
- `sora_v2_creators/<username>/...`
- `sora_v2_liked/...`
- `sora_v2_profile/...`
- `sora_v2_drafts/...`
- `sora_v2_remixes/parents/<creator>/...`
- `sora_v2_remixes/downstream/<source-post-id>/...`
- `downloads/...`
- any other root subfolder containing videos

### 6.4 Video file extensions

Recognized local video extensions should include:

- `.mp4`
- `.mov`
- `.webm`
- `.m4v`

### 6.5 Local thumbnail detection

For a video named `myvideo.mp4`, recognize thumbnails such as:

- `myvideo.png`
- `myvideo.jpg`
- `myvideo.jpeg`
- `myvideo.webp`
- `myvideo.thumb.png`
- `myvideo.thumb.jpg`
- `myvideo.thumb.jpeg`
- `myvideo.thumb.webp`

### 6.6 Local preview detection

For a video named `myvideo.mp4`, recognize animated previews such as:

- `myvideo.gif`
- `myvideo.webp`
- `myvideo.gif.gif`
- `myvideo.gif.webp`
- `myvideo.preview.webp`

The UI should handle animated WebP and GIF previews as image assets where appropriate, not as video elements.

### 6.7 Filename matching and dedupe support

The ingest process should parse and normalize filenames to match renamed or deduped files. Examples that may refer to the same video:

- `gen_01k9xzces9f7vs7s674c2cff3y_2025-11-13_the_ninja_fox.mp4`
- `2025-11-13_gen_01k9xzces9f7vs7s674c2cff3y_the_ninja_fox.mp4`

Matching keys should include:

- generation ID
- task ID
- post ID
- normalized filename stem
- date
- prompt/title slug
- creator/directory name

### 6.8 Prompt parsing and character extraction

After final metadata merge, the prompt text should be scanned for character mentions in the form `@name`.

Examples:

- `@robertteddy — NEUTRAL TECHNICAL HUMAN STUDY.` should extract `robertteddy`.
- `The three little pigs (@robertteddy @markmam @lizzy) meet @leom.` should extract `robertteddy`, `markmam`, `lizzy`, and `leom`.
- `@robertoch.meadow`, `@sora_bear`, and `@star.bear.wearingahat` should be preserved with dots and underscores.

Multiple mentions in one prompt should be supported. Duplicate mentions in the same video should create only one relationship.

Explicit cameo metadata and manifest `text_facets` should also be used when present.

### 6.9 Comment and avatar ingestion

After the main video metadata pass, the ingest pipeline runs a comment phase that scans `*.extracted.json` files anywhere under the configured comments directory (defaults to the archive root, overridable via `--comments-dir`). The phase should:

1. Walk every `*.extracted.json` file recursively, skipping `profiles/`, `node_modules/`, and dot-directories.
2. For each file, read `posts[i].comments[]` (the nested form). The same comments also appear as flattened `source: "project_y"` entries in the top-level `posts[]`; these duplicates must be ignored.
3. Insert each comment into the `comments` table with `INSERT OR IGNORE` keyed on `comment_id`. Re-runs on the same file must be no-ops; previously captured history is preserved.
4. Upsert `all_profiles[]` (the canonical author registry per file) plus any per-comment authors into `creator_profiles`. Profile rows preserve `first_seen_at` from the earliest ingest.
5. Refresh `videos.comment_count` via a single set-based `UPDATE` that aggregates from `comments.parent_post_id → videos.post_id`.
6. **Avatar download is opt-in and off by default during the wizard import and CLI ingest.** When explicitly enabled (Server Configuration → Assets → "Download missing profile avatars", or `node ingest-sora.js <dir> --avatars`), a bounded-concurrency batch (default 6 workers) checks for `<archive>/profiles/<username>/<username>.profile.<ext>` for each profile in `all_profiles[]` and downloads from `profile_picture_url` only when missing. Each successful download or skip-because-already-on-disk writes the extension to `creator_profiles.avatar_ext`. Failures are logged with HTTP status and URL but do not abort the batch.
7. After the avatar batch (or independently as a reconciliation action), run a single pass over every `creator_profiles` row to update `avatar_ext` to match disk: sets it when a file appears, clears it when one is missing, leaves correct rows alone. Profile folders with no matching DB row are intentionally ignored.

CLI flags supported by `ingest-sora.js`:

- `--comments-dir <dir>` — override the directory scanned for `*.extracted.json`.
- `--no-avatars` — skip the avatar download batch.
- `--debug-avatars` — log every URL attempted plus its outcome (success or HTTP/timeout/transport failure with URL).

A standalone `test-avatar.js` helper accepts a single URL or a `--from <extracted.json> [--user <username>]` pair and probes one download in isolation, printing SAS expiry, HTTP status, content-type, content-length, and any Azure error code from response headers.

### 6.10 Import progress

The user should see progress during import, including:

- files scanned
- JSON files found
- videos found
- videos processed
- videos inserted/updated
- sidecars found
- thumbnails/previews found
- character links created
- current file
- warnings and errors
- comment files (`*.extracted.json`) found
- comments inserted (new rows only — duplicates skipped silently)
- profiles upserted
- avatars downloaded / already on disk / failed
- avatars registered in `creator_profiles.avatar_ext` / cleared (file gone)
- video comment counts refreshed

### 6.11 Import report

The app should persist and display the last import report. It should include:

- videos found
- videos processed
- inserted/updated count
- existing rows updated
- manifest/extracted/remix JSON files parsed
- sidecar files matched
- filename/directory fallback count
- videos with stats
- videos with characters
- videos with thumbnails
- videos with previews
- comment files found
- comments inserted
- avatars downloaded / on disk / failed
- avatars registered in DB / cleared
- errors/warnings
- metadata source breakdown

---

## 7. Media and asset requirements

### 7.1 Local-only media policy

The UI must never default to remote Sora media URLs. Remote URLs found in manifests may be stored as raw/historical metadata but should not be used as media sources.

### 7.2 Thumbnail generation

If local thumbnails are missing, the app may offer a user-triggered generation job.

Rules:

- Requires ffmpeg.
- Does not overwrite existing thumbnails.
- Generated thumbnail should be saved beside the video as `myvideo.jpg`.
- Use the first frame by default.
- Write to a temporary file first, then rename after ffmpeg succeeds.
- Allow cancellation.

### 7.3 Preview generation

If local previews are missing, the app may offer a user-triggered preview generation job.

Rules:

- Requires ffmpeg.
- Does not overwrite existing previews.
- Generated preview should be saved beside the video as `myvideo.preview.webp`.
- Generate about 2.5 seconds from the start of the video, with a small offset such as 0.25s to avoid black first frames.
- Use animated WebP rather than GIF for generated previews.
- Write to a temporary file first, then rename after ffmpeg succeeds.
- Allow cancellation.

### 7.4 Asset job cancellation

Asset generation should be cooperatively cancellable:

1. User clicks cancel.
2. Current job marks `cancelRequested = true`.
3. The active ffmpeg process is terminated if needed.
4. Temporary output files are deleted.
5. Completed assets remain.
6. Missing assets can be generated later.

### 7.5 ffmpeg diagnostics

The app should report whether ffmpeg was found:

- in PATH, or
- inside the app `bin` folder.

The UI should explain that users can install ffmpeg globally or place it here:

- Windows: `bin/ffmpeg.exe`
- Linux/macOS: `bin/ffmpeg`

---

## 8. Database requirements

### 8.1 Database options

The app should support:

- SQLite, recommended default.
- DuckDB, experimental local option.

### 8.2 SQLite user explanation

SQLite should be explained as the default and most tested option. It is easy to inspect, back up, copy, and move. It is usually best for a local single-user archive.

### 8.3 DuckDB user explanation

DuckDB should be explained as an experimental analytics-oriented option. It may be useful for archive-wide reports and summary rebuilds, but is not automatically faster for every page. SQLite may remain smoother for many small app-style lookups.

### 8.4 DuckDB implementation requirements

DuckDB should use:

- one process-wide connection per database file
- serialized query execution through a queue/mutex
- batch-style summary rebuilds
- clear lock error messages

Fallback to the older `duckdb` package should only occur when the newer package cannot be imported. It should not retry with the fallback package when the real error is a file lock.

### 8.5 Summary tables

Because archive data is mostly static, expensive creator/character aggregation should be precomputed into summary tables rather than recomputed on every page load.

Summary tables should be rebuilt after import and available through a manual Server Configuration action.

---

## 9. Logical database schema

The implementation may differ slightly between SQLite and DuckDB, but the logical schema should include the following tables.

### 9.1 `videos`

Stores one row per local video file.

Fields:

- `id` primary key
- `file_path` unique local path relative to/archive-resolved path
- `file_size`
- `filename`
- `generation_id`
- `task_id`
- `post_id`
- `parent_post_id`
- `root_post_id`
- `parent_generation_id`
- `parent_task_id`
- `author`
- `date`
- `duration_s`
- `width`
- `height`
- `aspect_ratio`
- `liked`
- `like_count`
- `view_count`
- `remix_count`
- `reply_count`
- `share_count`
- `comment_count`
- `prompt`
- `source`
- `source_dir`
- `thumbnail_path`
- `preview_path`
- `metadata_source`
- `has_txt`
- `local_favorite`
- `hidden`
- `reviewed`
- `local_notes`
- `ingested_at`

Notes:

- `liked` is historical Sora metadata imported from manifests/sidecars.
- `reply_count` is the public reply/comment count from Sora's API and may differ from `comment_count`.
- `comment_count` is the local count of comment rows aggregated from the `comments` table during the comment ingest phase. It is denormalized for fast `ORDER BY` and summary aggregation.
- `local_favorite` is user-created inside Sora View Lite and must be preserved across re-imports and migrations.
- `hidden` and `reviewed` are local library management flags.
- `metadata_source` should identify whether the best metadata came from advanced JSON, manifest JSON, remix JSON, sidecar text, or fallback parsing.

### 9.2 `cameos`

Stores characters used in videos.

Fields:

- `id` primary key
- `video_id` foreign key to videos
- `character_name`

Constraints:

- Unique pair of `video_id` and `character_name`.

Notes:

- This table merges explicit cameo metadata, mention facets, and prompt-derived `@mentions`.
- It represents characters used, not necessarily characters created by a creator.

### 9.3 `creator_profiles`

Stores creator/user profile metadata when available. The table is unified across creators-with-videos and comment-only authors. "Has videos" is derived at query time via `EXISTS` against the `videos` table — no stored flag.

Fields:

- `username` primary key
- `display_name`
- `description`
- `follower_count`
- `following_count`
- `post_count`
- `reply_count`
- `likes_received_count`
- `remix_count`
- `cameo_count`
- `character_count`
- `raw_json`
- `user_id` — Sora's stable user identifier from `extracted.json` payloads
- `verified` — `1` when the source flagged the user as verified
- `is_public_figure` — `1` when the source flagged the user as a public figure
- `permalink` — Sora profile permalink string
- `first_seen_at` — ISO timestamp of when this row was first ingested
- `avatar_ext` — file extension (e.g. `jpg`, `png`, `webp`, `gif`) of the locally stored avatar at `<archive>/profiles/<username>/<username>.profile.<ext>`. NULL when no avatar is on disk for this profile.

Notes:

- Local profile images are resolved from the filesystem. The expected path is `<archive>/profiles/<username>/<username>.profile.<ext>`.
- The `avatar_ext` column is the **single source of truth** for avatar presence. It is populated during the comments ingest phase: each successful download or already-on-disk hit sets the column to the file's extension, and a one-pass reconciliation at the end of the phase covers any rows the avatar batch did not touch (older imports, files dropped in by `download-profiles.js`). Stats and coverage queries hit the DB only — no filesystem scan on page load.
- Remote profile image URLs may be preserved in raw JSON but should not be rendered as image sources by the UI. The `/api/avatar/[username]` route serves the local file with cache headers.
- Comment authors who never posted videos still get rows in this table; querying `commenters_only` is a `LEFT JOIN` against `creator_summary`.

### 9.4 `character_profiles`

Stores character/cameo profile metadata when available.

Fields:

- `character_name` primary key
- `display_name`
- `owner_username`
- `description`
- `likes_received_count`
- `remix_count`
- `cameo_count`
- `raw_json`

Notes:

- Prompt-derived characters may initially have only a name.
- Richer JSON metadata may later update the same character row.

### 9.5 `collections`

Stores local user-created collections.

Fields:

- `id` primary key
- `name`
- `created_at`

### 9.6 `collection_videos`

Stores videos added to collections.

Fields:

- `collection_id`
- `video_id`
- `added_at`

Primary key:

- `collection_id`, `video_id`

### 9.7 `creator_summary`

Precomputed creator index table.

Fields:

- `author` primary key
- `video_count`
- `latest_date`
- `total_views`
- `total_likes`
- `total_remixes`
- `total_comments` — sum of `videos.comment_count` for the creator's non-hidden videos

### 9.8 `character_summary`

Precomputed character index table.

Fields:

- `character_name` primary key
- `cast_count`
- `latest_date`
- `total_views`
- `total_likes`
- `total_remixes`
- `total_comments` — sum of `videos.comment_count` for non-hidden videos this character appears in

### 9.9 `summary_meta`

Stores metadata about summary table freshness.

Fields:

- `key` primary key
- `value`

### 9.10 `comments`

Stores per-post comments captured from `*.extracted.json` files. Comments are archival — `INSERT OR IGNORE` on re-ingest preserves the earliest captured row.

Fields:

- `comment_id` primary key — Sora's hex comment identifier
- `parent_post_id` — the post this comment is attached to. May be a Sora post ID (`s_<hex>`) when the comment replies to a video post, or another `comment_id` when the comment is a reply to another comment.
- `root_post_id` — top of the thread
- `author_username` — joins to `creator_profiles.username`
- `author_user_id` — denormalized for stability; `creator_profiles` is keyed by username
- `text` — comment body
- `posted_at`, `updated_at`, `tombstoned_at` — ISO timestamps; `tombstoned_at` non-null indicates the source marked the comment as deleted
- `like_count`, `dislike_count`, `reply_count`, `recursive_reply_count`, `view_count`, `remix_count`
- `permalink`
- `source` — typically `"project_y"` for native Sora comments
- `attachments_json` — raw `video_attachments[]` array stored as JSON text; populated when comments contain image or video media
- `source_file` — the `*.extracted.json` filename that contributed this row
- `first_seen_at` — ISO timestamp of when the comment was first ingested

Notes:

- Threading is unbounded. Comments form a tree because `parent_post_id` may reference either a post ID or another comment ID. The replies UI lazy-loads children via `/api/comments/[id]/replies` keyed on this column.
- The `videos.comment_count` column denormalizes the count of comments where `parent_post_id = video.post_id`. It is refreshed at the end of every comment ingest run and on summary rebuild.

### 9.11 Recommended future operational tables

If not already implemented, the app should include or migrate toward:

#### `app_meta`

- `key`
- `value`

Used for schema version, last migration time, and maintenance metadata.

#### `app_logs`

- `id`
- `created_at`
- `level`
- `source`
- `message`
- `details_json`

Used for UI-visible logs.

#### `import_reports`

- `id`
- `started_at`
- `completed_at`
- `status`
- `report_json`

Used to persist import report history.

---

## 10. Indexing and performance requirements

Recommended indexes:

- `videos(author)`
- `videos(date)`
- `videos(generation_id)`
- `videos(post_id)`
- `videos(parent_post_id)`
- `videos(root_post_id)`
- `videos(source_dir)`
- `videos(hidden, author, date)`
- `videos(hidden, date)`
- `videos(like_count, view_count)`
- `videos(comment_count)`
- `cameos(character_name)`
- `cameos(video_id)`
- `comments(parent_post_id)`
- `comments(root_post_id)`
- `comments(author_username)`
- `comments(posted_at)`
- `collection_videos(collection_id)`
- `collection_videos(video_id)`
- `creator_summary(video_count desc, author)`
- `character_summary(cast_count desc, character_name)`

For small local archives, normal SQL search may be acceptable. For larger archives, full-text search should be considered for prompts, creators, characters, and caption text if local captions are later supported.

---

## 11. UI requirements

### 11.1 Primary pages

The app should include:

- Feed
- Search
- Creators
- Characters
- People
- Profile
- Remixes
- Favorites
- Hidden videos
- Collections
- Collection detail pages
- Most-commented videos
- Timeline
- Duplicate candidates
- Server Configuration

Some utility pages such as Timeline, Duplicate Candidates, and Most-commented may be linked from Server Configuration rather than the primary sidebar.

### 11.2 Feed

The feed should show video cards with:

- thumbnail or video fallback
- creator
- date
- stats chips when available
- local favorite/review/hidden state where relevant

Feed modes may include:

- all videos
- favorites
- most liked
- most viewed
- reviewed

### 11.3 Search

Search should support:

- prompt text
- creator username
- creator display name
- character username/name
- character display name
- date range
- minimum likes
- minimum views

### 11.4 Video cards

Video cards should:

- show available stats with icons, not verbose labels
- use tooltips for stat names
- avoid horizontal overflow
- load previews only as needed
- fall back to video hover playback if no preview exists

Stats icons:

- views: eye
- likes: heart
- remixes: remix/loop arrow
- shares: share arrow
- replies: comment bubble

Zero-value stats should be hidden.

### 11.5 Lightbox

The desktop lightbox should show:

Primary fields:

- Prompt
- Creator (with avatar resolved via `/api/avatar/<username>`, falling back to a letter initial when no local avatar exists)
- Characters
- Posted date
- Source
- Liked indicator if true
- Views / likes / remix / share / reply counts when available

Technical details should be collapsible and include:

- Post ID
- Generation ID
- Task ID
- Resolution
- Duration
- Aspect ratio
- Parent/root remix
- Metadata source
- Full local file path, if enabled by settings

Comments section (when the video has at least one comment in the local archive):

- Header reads `Comments (N)` where N is the count.
- Top-level comments sorted by like count then posted date.
- Each row shows author avatar, username, comment text, attached image/video previews when present, relative time, and like count.
- Comments with replies show a collapsed `── View N replies ⌄` toggle. Replies are lazy-loaded from `/api/comments/[id]/replies` and rendered recursively, indented under the parent.
- Author rows link to the creator page; clicking dismisses the lightbox first.

Actions should include:

- favorite/unfavorite
- reviewed/hidden where appropriate
- add to collection
- copy prompt
- copy path
- open containing folder

### 11.6 Creator pages

Creator pages should include tabs:

- Videos
- Characters used
- Stats

`Characters used` means characters used in the creator's videos, not necessarily characters created by that creator.

### 11.7 Character pages

Character pages should show:

- videos using the character
- Used by creators, limited to 25 by default with a See all option
- Appears with/co-characters, limited to 25 by default with a See all option

The video list, Used by creators, and Appears with sections should be derived from the same canonical matched video set to avoid inconsistencies.

### 11.8 People page

People combines creators and characters into one browsing surface. It exists because Sora archives contain both creators who made videos and characters/cameos that appear in videos. The People tab answers: who is represented in this archive?

People index pages should be configurable for performance:

- Minimal: fastest
- Profile: more metadata
- Rich: most metadata, slower
- Optional avatars on/off

### 11.9 Server Configuration page

Server Configuration should be tabbed into:

1. Overview
2. Import & Scan
3. Assets
4. Library Tools
5. Display & Performance
6. Data & Database
7. Access & Security
8. About

No duplicate placement of backup/export controls. Database backup and metadata exports should only appear under Data & Database.

### 11.10 About tab

The About tab should explain that Sora View Lite was built to help people preserve and browse saved Sora videos from local SoraVault archives. It should thank Sebastian Haas for developing SoraVault.

---

## 12. Mobile requirements

### 12.1 Mobile breakpoint

Below a small-screen breakpoint, such as 760px, the app should be treated as mobile.

### 12.2 Mobile navigation

Mobile should have a bottom navigation bar with:

- Feed
- People
- Favorites
- More

The More menu should include the remaining sections. It should close when a user taps a navigation item, taps outside the menu, presses Escape, or changes route.

### 12.3 Mobile feed layout

Mobile feed layout should be configurable:

- Automatic
- Grid
- Full-screen vertical feed

In Automatic mode, phones should use the full-screen vertical feed and desktop should use the grid.

### 12.4 Mobile vertical feed

The mobile vertical feed should:

- use scroll snapping
- autoplay the visible video
- pause non-visible videos
- use `muted` and `playsinline`
- keep only one video playing at a time
- avoid URL changes while swiping
- avoid browser-native video controls during swipes

### 12.5 Mobile reel controls

Mobile reel videos should not use native browser controls by default. Chrome's native rewind/pause/forward overlay should not appear while swiping.

Implementation requirements:

- omit native `controls`
- use `pointer-events: none` on reel videos where needed
- distinguish swipe from tap
- show custom lightweight controls only on a true tap
- provide custom play/pause and mute/unmute buttons

### 12.6 Mobile grid video behavior

On mobile, tapping a video card from creator, character, people, search, collection, or other grid pages should open the mobile vertical swipe viewer rather than a desktop-style left/right lightbox.

---

## 13. Server and access requirements

### 13.1 Local vs LAN access

The app should support:

- Local only: bind to `127.0.0.1`
- LAN: bind to `0.0.0.0`

The UI should explain:

- `127.0.0.1` allows access only from the current computer.
- `0.0.0.0` allows other devices on the network to connect.

### 13.2 Security warnings

When LAN mode is enabled, the app should warn that other devices on the network may be able to browse the archive. Full local file paths should be configurable and should be warned about in LAN mode.

### 13.3 Admin controls

The app should separate browsing from administrative actions in the UI. A future password/authorization layer should protect:

- Server Configuration
- database backup/export
- rescan/re-import
- asset generation
- database switching

---

## 14. Library management requirements

### 14.1 Local favorites

Users should be able to mark videos as local favorites. This is separate from imported historical Sora liked status.

### 14.2 Hidden videos

Users should be able to hide videos from normal feed browsing and view hidden videos separately.

### 14.3 Reviewed flag

Users should be able to mark videos reviewed.

### 14.4 Collections

Users should be able to:

- create collections
- add videos to collections
- view collection detail pages
- remove videos from collections
- navigate back from collection detail pages to the collections list

### 14.5 Exports and backup

Data & Database should include:

- database backup download
- CSV metadata export
- full JSON metadata export

---

## 15. Diagnostics, logs, and upgrade requirements

### 15.1 Diagnostics

The app should show:

- Node version
- platform
- current working directory
- archive path
- database engine
- database path
- ffmpeg status
- app mode/local vs LAN
- current performance settings

### 15.2 UI-visible logs

The Server Overview should show recent logs/warnings for:

- import start/completion/failure
- asset job start/completion/failure/cancellation
- database optimization
- schema migration
- ffmpeg errors
- DuckDB lock errors

### 15.3 Schema migrations

The app should track a schema version and run migrations on upgrade. Migrations must preserve:

- local favorites
- hidden/reviewed flags
- collections
- local notes
- existing video metadata

### 15.4 Upgrade instructions

The archive should include `UPGRADE.md` explaining:

1. Stop Sora View Lite.
2. Back up the database.
3. Extract the new ZIP.
4. Preserve/copy `config.json` and the database if needed.
5. Start the new version.
6. Run schema migration or re-index if prompted.

---

## 16. Non-goals and restrictions

The app should not:

- depend on remote Sora media URLs for normal browsing — once ingested, the UI must render exclusively from local files
- overwrite existing thumbnails/previews
- expose arbitrary filesystem paths through query parameters
- use remote services for normal browsing
- require a cloud account
- require a centralized server for normal local use

Tools are available to download Sora assets such as profile avatars from signed URLs found in `*.extracted.json` files. However, Sora is gone and these URLs will fail to work in the future — the SAS tokens expire on a short window (roughly seven days from capture) and cannot be regenerated. Asset download is therefore best-effort and time-bounded:

- **Avatar download is opt-in and off by default.** The wizard's Start Import never auto-downloads avatars; the CLI defaults to off (use `--avatars` to enable). Users opt in explicitly from **Server Configuration → Assets → "Download missing profile avatars"**, which dispatches a cancellable background job (`src/lib/server/avatar-job.js`) that walks `*.extracted.json`, dedupes by username, and uses the shared downloader.
- The Assets tab must include a clear warning that SAS tokens expire and most archive runs will return HTTP 403 for older captures. The job logs each failure with its URL so the user can verify expiry vs. transport issues.
- A failed download must never abort the broader ingest pipeline or the avatar batch itself. URLs and HTTP/timeout reasons are logged so the user can distinguish expired tokens from transport problems.
- The UI must continue to function correctly when no avatars are on disk; missing avatars degrade gracefully to letter initials.
- The standalone `download-profiles.js` script (manifest-format input) and the avatar background job (`*.extracted.json` input) share the same downloader (`src/lib/server/profile-fetch.js`) and the same target layout: `<archive>/profiles/<username>/<username>.profile.<ext>`.

---

## 17. Quality and acceptance criteria

A build is acceptable when:

1. Production launchers build and run the app.
2. Setup wizard can select a folder and database type.
3. Import can complete and show a clear report.
4. Feed loads videos from the selected archive.
5. Search works for prompts, creators, characters, likes, and views.
6. Lightbox opens and closes quickly on desktop.
7. Escape closes the desktop lightbox.
8. Mobile feed/reel supports vertical swiping and autoplay.
9. Mobile swiping does not show Chrome native controls.
10. Creator, character, and people pages load quickly with summary tables.
11. Character pages show consistent videos, Used by creators, and Appears with data.
12. Asset generation jobs can start, report progress, and cancel.
13. ffmpeg diagnostics are visible.
14. Database backup and metadata exports work.
15. No repeated `/api/profile-image/` empty-name 404 noise appears in logs.
16. DuckDB mode does not open the same database file concurrently from multiple route requests.
17. SQLite remains the default and most stable user path.
18. Re-running the comment ingest phase against the same `*.extracted.json` files is idempotent — no duplicate `comments` rows, no duplicate `creator_profiles` rows, and existing data is never overwritten.
19. The lightbox renders a Comments section for videos that have at least one comment in the local archive. Replies expand inline via lazy-loading.
20. The `/commented` browse view shows all videos with at least one comment in descending order of `comment_count` and supports pagination via `?page=N`.
21. The Server Configuration Overview tab shows live comment, profile, and on-disk avatar statistics, plus a top-10 most-commented videos list whose rows open the global lightbox.
22. The avatar download phase logs failed URLs with a clear reason (HTTP status, timeout, or transport error) and does not abort the rest of the ingest. Successful downloads land at `<archive>/profiles/<username>/<username>.profile.<ext>` and are skipped on subsequent runs.
23. Schema migrations are additive — existing SQLite or DuckDB databases gain `videos.comment_count`, the new `creator_profiles` columns, the new `comments` table, the `total_comments` summary columns, and the new indexes without losing rows in `videos`, `cameos`, `creator_profiles`, `character_profiles`, `collections`, or `collection_videos`.

---

## 18. Development milestones and history

### Milestone 1 — Basic local archive viewer

The first version focused on selecting a local SoraVault folder, ingesting local video paths and sidecar metadata into SQLite, and rendering a simple SvelteKit feed with video playback.

### Milestone 2 — Setup wizard and reliable ingestion

The setup flow was rebuilt to avoid fragile client-side-only behavior. Folder selection became server-side, setup became form-based, and ingest became a wizard step with progress feedback.

### Milestone 3 — Lightbox and progressive UI reliability

Video cards were changed so they could open a lightbox reliably. The lightbox evolved from server-driven URL state to a faster client-side media controller. Escape close, close buttons, backdrop behavior, autoplay, and muted playback were added.

### Milestone 4 — Manifest-aware metadata enrichment

The ingest pipeline was expanded to recursively scan SoraVault manifests, extracted JSON, remix manifests, and sidecar text files. Metadata merging was added so richer manifest data could improve titles, prompts, dates, creators, stats, remix fields, and character information.

### Milestone 5 — SQLite and DuckDB options

The setup wizard gained SQLite and DuckDB options. SQLite remained the default. DuckDB became an experimental option for users interested in archive-wide analytics and summary rebuilds.

### Milestone 6 — Local asset detection and generation

The app learned to detect local thumbnails and animated previews. ffmpeg-based thumbnail and preview generation was added as an optional user-triggered step. Generation was made safe by avoiding overwrites, using temporary files, and supporting cancellation.

### Milestone 7 — Creator, character, and people browsing

Creators, characters, and people became major navigation surfaces. Prompt `@mention` parsing was added. Explicit cameos, text facets, and prompt-derived mentions were merged into the character relationship model.

### Milestone 8 — Rich metadata and stats

Video cards and lightbox panels gained views, likes, remixes, shares, replies, technical details, file paths, metadata source labels, and richer creator/character pages.

### Milestone 9 — Library management tools

Local favorites, hidden videos, reviewed status, collections, similar videos, CSV/JSON export, database backup, duplicate candidates, and timeline tools were added.

### Milestone 10 — Server settings and diagnostics

Server Configuration became a tabbed control center with Overview, Import & Scan, Assets, Library Tools, Display & Performance, Data & Database, Access & Security, and About sections.

### Milestone 11 — Performance work

Creator, character, and people pages were optimized using summary tables, smaller initial loads, lazy loading, configurable detail levels, and optional avatars. DuckDB handling was improved with a singleton connection and serialized query execution.

### Milestone 12 — Mobile experience

Mobile bottom navigation was added. The feed gained a mobile full-screen vertical reel mode with scroll snapping, autoplay, one-video-at-a-time playback, and custom lightweight controls that avoid native Chrome video overlays during swipes.

### Milestone 13 — Stability wrap-up

The final stabilization focus was schema/version migrations, clear import reports, UI-visible logs, upgrade instructions, ffmpeg diagnostics, production launchers, and better recovery/maintenance controls.

### Milestone 14 — Comments and profile avatars

After Sora's shutdown was announced and `*.extracted.json` files became the canonical capture format for thread state, the ingest pipeline gained a comments phase. The `comments` table stores threaded comments keyed by `parent_post_id` (which may resolve to a video post or another comment, since the source data treats comments as posts). The `creator_profiles` schema was unified to absorb both creators-with-videos and comment-only authors, gaining `user_id`, `verified`, `is_public_figure`, `permalink`, and `first_seen_at`. A `videos.comment_count` column denormalizes the per-post comment count for fast sorting, and `creator_summary` / `character_summary` gained `total_comments` aggregates so the People surfaces can rank by comment activity without joins. The lightbox renders a comments section with collapsed-thread `View N replies` expanders, and a new `/commented` browse view lists videos in descending order of comment count.

In parallel, the in-ingest avatar phase replaced the standalone `download-profiles.js` for normal use (the script remains available for soravault manifests). It walks `all_profiles[]` from each `extracted.json`, checks `<archive>/profiles/<username>/<username>.profile.<ext>` for an existing file, and downloads from the signed URL only when missing. Failures are logged with their URL and reason, and a `--debug-avatars` flag prints every attempt for diagnosis. The `test-avatar.js` helper probes one URL in isolation and reports SAS expiry, HTTP status, and any Azure error code.

The Server Configuration Overview gained Comments and Profiles & avatars panels, surfacing total comments, unique commenters, thread-to-video match coverage, on-disk avatar coverage, and a top-10 most-commented list.

