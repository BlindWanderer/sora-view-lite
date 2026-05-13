<script>
  export let data;
  export let form;

  const formatter = new Intl.NumberFormat();
  function fmt(value) { return formatter.format(Number(value || 0)); }
  function pct(job) {
    if (!job?.total) return 0;
    return Math.min(100, Math.round((Number(job.processed || 0) / Number(job.total || 1)) * 100));
  }

  // Mirror of the server-side extractPostIdFromUrl in bookmark-job.js so the
  // bookmark form can validate input before submitting. Kept tiny on purpose
  // — both sides agree on the same regex.
  function isValidSoraPostUrl(s) {
    if (!s) return false;
    const t = String(s).trim();
    if (!t.includes('/p/')) return false;
    return /\/p\/s_[A-Za-z0-9]+/.test(t);
  }
  let bookmarkInput = '';
  $: bookmarkUrlValid = isValidSoraPostUrl(bookmarkInput);
  $: bookmarkShowHint = bookmarkInput.trim().length > 0 && !bookmarkUrlValid;

  // Relative time for the "last full refresh" banner. Plain English so the user
  // can scan it at a glance: "2 hours ago", "yesterday", "3 days ago".
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function relTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diff = (then - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60)        return rtf.format(Math.round(diff), 'second');
    if (abs < 3600)      return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86_400)    return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 604_800)   return rtf.format(Math.round(diff / 86_400), 'day');
    if (abs < 2_592_000) return rtf.format(Math.round(diff / 604_800), 'week');
    return rtf.format(Math.round(diff / 2_592_000), 'month');
  }
  function fmtDuration(ms) {
    if (!ms || !Number.isFinite(ms)) return '';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sr = s % 60;
    if (m < 60) return sr ? `${m}m ${sr}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const mr = m % 60;
    return mr ? `${h}h ${mr}m` : `${h}h`;
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'import', label: 'Import & Scan' },
    { id: 'assets', label: 'Assets' },
    { id: 'library', label: 'Library Tools' },
    { id: 'display', label: 'Display & Performance' },
    { id: 'data', label: 'Data & Database' },
    { id: 'access', label: 'Access & Security' },
    { id: 'about', label: 'About' }
  ];
  $: activeTab = data.tab || 'overview';
</script>

<svelte:head>
  <title>Server Configuration — Sora View Lite</title>
  {#if data.assetJob?.running || data.avatarJob?.running || data.refreshJob?.running || data.bookmarkJob?.running}
    <meta http-equiv="refresh" content="2" />
  {/if}
</svelte:head>

<div class="settings-page">
  <header class="page-header settings-header">
    <div>
      <h1 class="page-title">Server Configuration</h1>
      <p class="subtitle">Manage archive scans, generated assets, performance, data exports, and access settings.</p>
    </div>
  </header>

  <nav class="server-tabs" aria-label="Server configuration tabs">
    {#each tabs as tab}
      <a class:active={activeTab === tab.id} href={`/server?tab=${tab.id}`}>{tab.label}</a>
    {/each}
  </nav>

  {#if form?.error}
    <div class="error-box">{form.error}</div>
  {/if}

  {#if form?.summaryRebuilt}
    <div class="success-box">Person summary tables rebuilt. Creator, Character, and People pages will use the refreshed summaries.</div>
  {/if}

  {#if form?.optimized}
    <div class="success-box">Database optimized in {fmt(form.optimized.elapsedMs)} ms. Rebuilt {fmt(form.optimized.summary?.creators)} creator summaries and {fmt(form.optimized.summary?.characters)} character summaries.</div>
  {/if}

  {#if form?.mentionAnalysis}
    <div class="success-box">
      Prompt analysis complete: scanned {fmt(form.mentionAnalysis.scanned)} videos, found mentions in {fmt(form.mentionAnalysis.videosWithMentions)} videos, found {fmt(form.mentionAnalysis.uniqueMentions)} unique characters, and attempted {fmt(form.mentionAnalysis.linksAttempted)} character links.
    </div>
  {/if}

  {#if activeTab === 'overview'}
    <section class="panel">
      <h2>Current setup</h2>
      <div class="kv"><span>Archive</span><code>{data.config.archivePath}</code></div>
      <div class="kv"><span>Database</span><code>{data.config.dbPath}</code></div>
      <div class="kv"><span>Engine</span><code>{data.config.dbEngine || 'sqlite'}</code></div>
      <div class="kv"><span>Manifest answer</span><code>{data.config.manifestMode || 'unknown'}</code></div>
      <div class="kv"><span>Access mode</span><code>{data.config.serverAccessMode || 'local'}</code></div>
    </section>

    <section class="panel">
      <h2>Archive snapshot</h2>
      {#if data.archiveStats}
        <div class="metrics">
          <div><strong>{fmt(data.archiveStats.total)}</strong><span>total videos</span></div>
          <div><strong>{fmt(data.archiveStats.creators)}</strong><span>creators</span></div>
          <div><strong>{fmt(data.archiveStats.chars)}</strong><span>characters</span></div>
          <div><strong>{fmt(data.archiveStats.favorites)}</strong><span>local favorites</span></div>
          <div><strong>{fmt(data.archiveStats.hidden)}</strong><span>hidden videos</span></div>
          <div><strong>{fmt(data.archiveStats.reviewed)}</strong><span>reviewed videos</span></div>
        </div>
      {:else}
        <p>Archive statistics will appear after import.</p>
      {/if}
    </section>

    {#if data.commentStats}
      <section class="panel">
        <h2>Comments</h2>
        <div class="metrics">
          <div><strong>{fmt(data.commentStats.total)}</strong><span>total comments</span></div>
          <div><strong>{fmt(data.commentStats.uniqueAuthors)}</strong><span>unique commenters</span></div>
          <div><strong>{fmt(data.commentStats.distinctPosts)}</strong><span>threads (posts with comments)</span></div>
          <div><strong>{fmt(data.commentStats.linkedVideos)}</strong><span>local videos with comments</span></div>
          <div><strong>{fmt(data.commentStats.withReplies)}</strong><span>comments that have replies</span></div>
          <div><strong>{fmt(data.commentStats.withAttachments)}</strong><span>comments with media</span></div>
          <div><strong>{fmt(data.commentStats.tombstoned)}</strong><span>tombstoned (deleted)</span></div>
          <div><strong>{fmt(data.commentStats.sourceFiles)}</strong><span>source extracted.json files</span></div>
        </div>
        <div class="kv-grid">
          {#if data.commentStats.distinctPosts}
            {@const threadMatch = Math.round((data.commentStats.linkedVideos / data.commentStats.distinctPosts) * 100)}
            <div class="kv"><span>Threads matched to videos</span><code>{threadMatch}% ({fmt(data.commentStats.linkedVideos)} of {fmt(data.commentStats.distinctPosts)})</code></div>
          {/if}
          {#if data.archiveStats?.total && data.commentStats.linkedVideos}
            {@const vidCoverage = Math.round((data.commentStats.linkedVideos / data.archiveStats.total) * 100)}
            <div class="kv"><span>Videos with comments</span><code>{vidCoverage}% ({fmt(data.commentStats.linkedVideos)} of {fmt(data.archiveStats.total)})</code></div>
          {/if}
          {#if data.commentStats.linkedVideos > 0}
            {@const avgPerVideo = (data.commentStats.total / data.commentStats.linkedVideos).toFixed(1)}
            <div class="kv"><span>Average per commented video</span><code>{avgPerVideo} comments</code></div>
          {/if}
          {#if data.commentStats.topAuthor}
            <div class="kv"><span>Most prolific commenter</span><code>@{data.commentStats.topAuthor} · {fmt(data.commentStats.topAuthorCount)} comments</code></div>
          {/if}
          {#if data.commentStats.topThreadPostId}
            <div class="kv"><span>Largest thread</span><code>{data.commentStats.topThreadPostId} · {fmt(data.commentStats.topThreadCount)} comments</code></div>
          {/if}
        </div>

        {#if data.mostCommented?.length}
          <h3 class="subhead">Top 10 most-commented videos</h3>
          <div class="commented-list">
            {#each data.mostCommented as video}
              <button
                type="button"
                class="commented-row"
                data-sora-video-card
                data-video-id={video.id}
                data-video-json={JSON.stringify(video)}
                aria-label={video.prompt || video.filename}
              >
                <span class="commented-count">{fmt(video.comment_count)}</span>
                <span class="commented-meta">
                  <strong>{video.author || 'Unknown'}</strong>
                  {#if video.prompt}<span class="commented-prompt">{video.prompt}</span>{/if}
                </span>
                {#if video.like_count}<span class="commented-aux">♥ {fmt(video.like_count)}</span>{/if}
              </button>
            {/each}
          </div>
          <a class="tool-link inline" href="/commented">View all videos with comments</a>
        {/if}
      </section>
    {:else}
      <section class="panel">
        <h2>Comments</h2>
        <p>No comments table yet. Re-run ingest to populate from <code>*.extracted.json</code> files.</p>
      </section>
    {/if}

    <section class="panel">
      <h2>Profiles &amp; avatars</h2>
      {#if data.profileStats}
        <div class="metrics">
          <div><strong>{fmt(data.profileStats.total)}</strong><span>total profiles</span></div>
          <div><strong>{fmt(data.profileStats.withVideos)}</strong><span>with local videos</span></div>
          <div><strong>{fmt(data.profileStats.commentersOnly)}</strong><span>commenters only (no videos)</span></div>
          <div><strong>{fmt(data.profileStats.verified)}</strong><span>verified</span></div>
          <div><strong>{fmt(data.profileStats.withDescription)}</strong><span>with bio/description</span></div>
          <div><strong>{fmt(data.profileStats.withUserId)}</strong><span>with sora user_id</span></div>
        </div>
        {#if data.profileStats.mostFollowed}
          <div class="kv"><span>Most followed</span><code>@{data.profileStats.mostFollowed} · {fmt(data.profileStats.mostFollowedCount)} followers</code></div>
        {/if}
      {/if}

      {#if data.avatarStats}
        <h3 class="subhead">Avatar registry (from DB)</h3>
        <div class="metrics">
          <div><strong>{fmt(data.avatarStats.withAvatar)}</strong><span>profiles with avatar</span></div>
          <div><strong>{fmt(data.avatarStats.missing)}</strong><span>profiles missing avatar</span></div>
          {#each Object.entries(data.avatarStats.byExt || {}) as [ext, count]}
            <div><strong>{fmt(count)}</strong><span>.{ext} files</span></div>
          {/each}
        </div>
        {#if data.avatarStats.profiles}
          {@const coverage = Math.round((data.avatarStats.withAvatar / data.avatarStats.profiles) * 100)}
          <div class="kv"><span>Coverage</span><code>{coverage}% of {fmt(data.avatarStats.profiles)} known profiles</code></div>
        {/if}
        <p class="note">Avatar download is opt-in — go to <a href="/server?tab=assets">Assets → Profile avatars</a> to fetch missing avatars or reconcile the registry against disk.</p>
      {:else if data.config?.archivePath}
        <p class="note">No avatar registry yet. Run an import first; profiles get tracked in <code>creator_profiles</code>.</p>
      {/if}
    </section>

    <section class="panel">
      <h2>Runtime diagnostics</h2>
      <div class="kv"><span>Node</span><code>{data.diagnostics.node}</code></div>
      <div class="kv"><span>Platform</span><code>{data.diagnostics.platform}</code></div>
      <div class="kv"><span>Working dir</span><code>{data.diagnostics.cwd}</code></div>
      <div class="kv"><span>ffmpeg</span><code>{data.diagnostics.ffmpeg.found ? `found (${data.diagnostics.ffmpeg.path})` : 'not found'}</code></div>
    </section>
  {/if}

  {#if activeTab === 'import'}
    <section class="panel">
      <h2>Index controls</h2>
      <p>Rescan reuses the current archive folder and database engine. It updates existing rows and adds new videos.</p>
      <form method="POST" action="?/rescan">
        <button class="primary-btn" type="submit" disabled={data.assetJob?.running}>Rescan / re-index archive</button>
      </form>
    </section>

    <section class="panel">
      <h2>Metadata maintenance</h2>
      <p>Use these when metadata looks stale, character mentions are missing, or creator/character counts look wrong.</p>
      <div class="job-buttons">
        <form method="POST" action="?/analyzeCharacterMentions">
          <button class="secondary-btn" type="submit" disabled={data.assetJob?.running}>Analyze prompts for character mentions</button>
          <small>Scans prompt text for handles such as <code>@robertteddy</code>.</small>
        </form>
        <form method="POST" action="?/rebuildPersonSummaries">
          <button class="secondary-btn" type="submit">Rebuild person summary tables</button>
          <small>Refreshes fast creator/character index tables.</small>
        </form>
      </div>
    </section>

    <section class="panel">
      <h2>Import report</h2>
      {#if data.job?.done || data.job?.running}
        <div class="metrics">
          <div><strong>{fmt(data.job.found)}</strong><span>videos found</span></div>
          <div><strong>{fmt(data.job.processed)}</strong><span>processed</span></div>
          <div><strong>{fmt(data.job.inserted)}</strong><span>inserted/updated</span></div>
          <div><strong>{fmt(data.job.manifestsFound)}</strong><span>JSON metadata files</span></div>
          <div><strong>{fmt(data.job.thumbnailsFound)}</strong><span>thumbnails found</span></div>
          <div><strong>{fmt(data.job.previewsFound)}</strong><span>previews found</span></div>
          <div><strong>{fmt(data.job.cameosInserted)}</strong><span>character links</span></div>
          <div><strong>{fmt(data.job.errors)}</strong><span>errors</span></div>
        </div>
      {:else}
        <p>No import job is currently active in this app session. Re-run import to see a live/final report here.</p>
      {/if}
    </section>

    <section class="panel">
      <h2>Metadata quality</h2>
      {#if data.archiveStats}
        <div class="metrics">
          <div><strong>{fmt(data.archiveStats.with_manifest)}</strong><span>manifest/extracted metadata</span></div>
          <div><strong>{fmt(data.archiveStats.with_sidecar)}</strong><span>sidecar metadata</span></div>
          <div><strong>{fmt(data.archiveStats.with_fallback)}</strong><span>filename fallback only</span></div>
          <div><strong>{fmt(data.archiveStats.with_prompt)}</strong><span>videos with prompt text</span></div>
          <div><strong>{fmt(data.archiveStats.with_cameos)}</strong><span>videos with characters</span></div>
          <div><strong>{fmt(data.archiveStats.explicit_profiles)}</strong><span>creator profiles from JSON</span></div>
        </div>
      {/if}
    </section>
  {/if}

  {#if activeTab === 'assets'}
    <section class="panel">
      <h2>Asset health</h2>
      {#if data.assetError}
        <div class="error-box">{data.assetError}</div>
      {:else if data.assetHealth}
        <div class="metrics">
          <div><strong>{fmt(data.assetHealth.total)}</strong><span>videos indexed</span></div>
          <div><strong>{fmt(data.assetHealth.withThumb)}</strong><span>with thumbnails</span></div>
          <div><strong>{fmt(data.assetHealth.missingThumb)}</strong><span>missing thumbnails</span></div>
          <div><strong>{fmt(data.assetHealth.withPreview)}</strong><span>with previews</span></div>
          <div><strong>{fmt(data.assetHealth.missingPreview)}</strong><span>missing previews</span></div>
          <div><strong>{fmt(data.assetHealth.creators)}</strong><span>creators</span></div>
        </div>
      {/if}
    </section>

    <section class="panel warning-panel">
      <h2>Generate local assets</h2>
      <p>These jobs use <strong>ffmpeg</strong>. Install ffmpeg in your system PATH, or place <code>ffmpeg.exe</code> on Windows / <code>ffmpeg</code> on Linux/macOS inside this application's <code>bin</code> folder.</p>
      <p>Generation will not overwrite existing thumbnails or previews. Existing files are detected first and linked back into the database.</p>
      <div class="job-buttons">
        <form method="POST" action="?/generateThumbnails">
          <button class="secondary-btn" type="submit" disabled={data.assetJob?.running || !data.assetHealth?.missingThumb}>Generate missing thumbnails</button>
          <small>Creates <code>myvideo.jpg</code> from the first frame.</small>
        </form>
        <form method="POST" action="?/generatePreviews">
          <button class="secondary-btn" type="submit" disabled={data.assetJob?.running || !data.assetHealth?.missingPreview}>Generate animated previews</button>
          <small>Creates <code>myvideo.preview.webp</code> from the first 2.5 seconds.</small>
        </form>
      </div>
    </section>

    {#if data.assetJob?.running || data.assetJob?.done}
      <section class="panel">
        <h2>Asset job status</h2>
        <div class="kv"><span>Type</span><code>{data.assetJob.type || 'none'}</code></div>
        <div class="kv"><span>Phase</span><code>{data.assetJob.phase}</code></div>
        {#if data.assetJob.running}
          <form method="POST" action="?/cancelAssetJob" class="cancel-job-form">
            <button class="danger-btn" type="submit">Cancel current asset job</button>
            <small>Stops after the current file boundary. If ffmpeg is running, Sora View will attempt to terminate it and remove partial output.</small>
          </form>
        {:else if data.assetJob.cancelled}
          <div class="warning-box">Asset generation was cancelled. Already generated files were kept; unfinished temporary files were removed.</div>
        {/if}
        <div class="progress-track"><div style={`width:${pct(data.assetJob)}%`}></div></div>
        <div class="metrics">
          <div><strong>{fmt(data.assetJob.processed)}</strong><span>processed</span></div>
          <div><strong>{fmt(data.assetJob.total)}</strong><span>total</span></div>
          <div><strong>{fmt(data.assetJob.generated)}</strong><span>generated</span></div>
          <div><strong>{fmt(data.assetJob.skipped)}</strong><span>existing linked/skipped</span></div>
          <div><strong>{fmt(data.assetJob.failed)}</strong><span>failed</span></div>
        </div>
        {#if data.assetJob.currentFile}<div class="kv"><span>Current file</span><code>{data.assetJob.currentFile}</code></div>{/if}
        {#if data.assetJob.error}<div class="error-box">{data.assetJob.error}</div>{/if}
      </section>
    {/if}

    <section class="panel">
      <h2>Profile avatars</h2>
      {#if data.avatarStats}
        <div class="metrics">
          <div><strong>{fmt(data.avatarStats.profiles)}</strong><span>known profiles</span></div>
          <div><strong>{fmt(data.avatarStats.withAvatar)}</strong><span>with local avatar</span></div>
          <div><strong>{fmt(data.avatarStats.missing)}</strong><span>missing avatar</span></div>
          {#each Object.entries(data.avatarStats.byExt || {}) as [ext, count]}
            <div><strong>{fmt(count)}</strong><span>.{ext} files</span></div>
          {/each}
        </div>
        {#if data.avatarStats.profiles}
          {@const coverage = Math.round((data.avatarStats.withAvatar / data.avatarStats.profiles) * 100)}
          <div class="kv"><span>Coverage</span><code>{coverage}% of {fmt(data.avatarStats.profiles)} known profiles have a local avatar</code></div>
        {/if}
        <form method="POST" action="?/reconcileAvatars" class="reconcile-form">
          <button class="secondary-btn narrow-btn" type="submit" disabled={data.avatarJob?.running}>Reconcile avatar registry</button>
          <small>Walks <code>creator_profiles</code> and updates <code>avatar_ext</code> from disk. Use this if you dropped avatar files in manually.</small>
        </form>
        {#if form?.avatarReconcile}
          <div class="success-box">
            Reconciled {fmt(form.avatarReconcile.checked)} profiles —
            {fmt(form.avatarReconcile.set)} new/changed,
            {fmt(form.avatarReconcile.cleared)} cleared,
            {fmt(form.avatarReconcile.unchanged)} unchanged.
          </div>
        {/if}
      {:else}
        <p>No avatar registry yet. Run an import first; profiles get tracked in <code>creator_profiles</code>.</p>
      {/if}
    </section>

    <section class="panel">
      <h2>Download Bookmarked Sora Video</h2>
      <p>Paste one Sora post URL (must contain <code>/p/</code>) to check whether it's already in your archive — if not, download the page, video, thumbnail, GIF, author avatar, and ingest the comments. Single-shot version of the Refresh pipeline. Requires Playwright.</p>

      <form method="POST" action="?/bookmarkCheck&tab=assets" class="bookmark-form">
        <input
          type="url"
          name="url"
          bind:value={bookmarkInput}
          placeholder="https://sora.chatgpt.com/p/s_…"
          required
          autocomplete="off"
          spellcheck="false"
          class="bookmark-input"
          class:invalid={bookmarkShowHint}
          disabled={data.bookmarkJob?.running}
        />
        <button class="primary-btn" type="submit" disabled={data.bookmarkJob?.running || !bookmarkUrlValid}>Check &amp; Download</button>
      </form>
      {#if bookmarkShowHint}
        <small class="bookmark-input-hint">Needs to be a Sora post URL containing <code>/p/s_…</code>. Profile URLs and other paths are not supported.</small>
      {/if}

      {#if form?.bookmarkError}
        <div class="error-box">{form.bookmarkError}</div>
      {/if}

      {#if data.bookmarkJob?.running || data.bookmarkJob?.done}
        {@const J = data.bookmarkJob}
        <div class="kv"><span>Bookmark</span><code>{J.url || '?'}</code></div>
        {#if J.pageTitle}<div class="kv"><span>Page title</span><code>{J.pageTitle}</code></div>{/if}
        {#if J.creator}<div class="kv"><span>Creator</span><code>@{J.creator}</code></div>{/if}

        <!-- Per-step checklist (download flow only — the lookup-only state has no steps) -->
        {#if J.steps}
          <ol class="bookmark-steps">
            {#each [
              ['validate',  '0. URL validated'],
              ['dbcheck',   '1. DB lookup'],
              ['fetch',     '2-3. Fetch HTML'],
              ['extract',   '4. Extract JSON'],
              ['video',     '5. Download video'],
              ['thumbnail', '6. Download thumbnail'],
              ['gif',       '7. Download GIF preview'],
              ['avatar',    '7b. Download avatars (post + commenters)'],
              ['ingest',    '8. Ingest into database'],
            ] as [key, label]}
              {@const s = J.steps[key]}
              <li class:done={s?.state === 'done'} class:running={s?.state === 'running'} class:pending={s?.state === 'pending'}>
                <span class="bookmark-step-marker">{s?.state === 'done' ? '✓' : s?.state === 'running' ? '…' : '·'}</span>
                <span class="bookmark-step-label">{label}</span>
                {#if s?.message}<span class="bookmark-step-message">{s.message}</span>{/if}
              </li>
            {/each}
          </ol>
        {/if}

        {#if J.running}
          <form method="POST" action="?/cancelBookmarkJob&tab=assets" class="cancel-job-form">
            <button class="danger-btn" type="submit">Cancel</button>
          </form>
        {:else if J.error}
          <div class="error-box">{J.error}</div>
          <form method="POST" action="?/clearBookmark&tab=assets"><button class="secondary-btn narrow-btn" type="submit">Reset</button></form>
        {:else if J.lookupOnly}
          <!-- Lookup-only result: post is already in the DB, no download was started. -->
          <div class="success-box">
            <strong>Already in your database.</strong> Found {J.savedRecords?.length || 0} video record(s) for <code>{J.postId}</code> by <strong>@{J.creator}</strong>.
          </div>
        {:else if J.ok}
          <div class="success-box">
            Done. Downloaded {fmt(J.counts?.videos || 0)} video(s),
            {fmt(J.counts?.thumbnails || 0)} thumbnail(s),
            {fmt(J.counts?.gifs || 0)} GIF(s);
            ingested {fmt(J.counts?.comments || 0)} comment(s).
          </div>
        {/if}

        <!-- Watch-now cards (both lookup-only and finished-job paths surface savedRecords) -->
        {#if !J.running && J.savedRecords?.length}
          <div class="kv"><span>Watch now</span><span>Click a card to open in the lightbox.</span></div>
          <div class="bookmark-records">
            {#each J.savedRecords as v}
              <button
                type="button"
                class="bookmark-record"
                data-sora-video-card
                data-video-id={v.id}
                data-video-json={JSON.stringify(v)}
                aria-label={v.prompt || v.filename}
              >
                <strong>{v.filename}</strong>
                <small>
                  {v.date || 'no date'} ·
                  video {v.videoOnDisk ? '✓' : '✗'} ·
                  thumb {v.thumbOnDisk ? '✓' : '✗'} ·
                  preview {v.previewOnDisk ? '✓' : '✗'} ·
                  {v.comment_count ?? 0} comments
                </small>
                {#if v.prompt}<small class="bookmark-prompt">{v.prompt.slice(0, 200)}{v.prompt.length > 200 ? '…' : ''}</small>{/if}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Top-up trigger (only meaningful for the lookup-only path with missing assets) -->
        {#if J.lookupOnly && J.missing && (J.missing.video || J.missing.thumbnail || J.missing.preview || J.missing.avatar)}
          <div class="kv"><span>Missing</span><code>
            {J.missing.video ? 'video ' : ''}{J.missing.thumbnail ? 'thumbnail ' : ''}{J.missing.preview ? 'gif ' : ''}{J.missing.avatar ? `avatar (@${J.creator})` : ''}
          </code></div>
          <form method="POST" action="?/bookmarkTopUp&tab=assets">
            <input type="hidden" name="url" value={J.url} />
            <button class="secondary-btn narrow-btn" type="submit">Try to fill missing assets</button>
            <small>Re-fetches the post page so we get fresh signed URLs, then attempts only the missing items.</small>
          </form>
        {:else if J.lookupOnly}
          <div class="kv"><span>Status</span><code>All four asset types present on disk. Nothing to do.</code></div>
        {/if}

        {#if J.messages?.length}
          <div class="job-log">
            <strong>Recent messages</strong>
            {#each J.messages.slice(-10) as message}
              <div class:bad={message.level === 'error'} class:warn={message.level === 'warn'}>{message.text}</div>
            {/each}
          </div>
        {/if}

        <!-- Reset button so the user can dismiss the previous result and start fresh -->
        {#if !J.running}
          <form method="POST" action="?/clearBookmark&tab=assets" class="bookmark-reset-form">
            <button class="secondary-btn narrow-btn" type="submit">Reset (clear above)</button>
            <small>Clears this result so the next URL you paste starts from a clean slate.</small>
          </form>
        {/if}
      {/if}
    </section>

    <section class="panel warning-panel">
      <h2>Refresh Sora assets</h2>
      <div class="warning-box avatars-warning">
        <strong>⚠ Sora is gone.</strong> Asset URLs in <code>*.extracted.json</code> are signed Azure URLs (SAS tokens) that expire roughly seven days after capture. This pipeline re-fetches the SSR HTML from <code>sora.chatgpt.com/p/&lt;id&gt;</code> with JavaScript disabled (the only known way to bypass the sunset redirect) so the embedded RSC payload can yield fresh URLs. <strong>This may stop working at any time</strong> if the upstream pages are removed.
      </div>
      <p>Drop SoraVault manifest files into <code>{data.config.archivePath}/_refresh/manifests/</code>, then run the full pipeline below or each step individually. As a side effect this is also the only known way to refresh <strong>original comments</strong> — the first SSR page (~6–10 comments per post) gets re-extracted alongside everything else.</p>

      {#if data.refreshLastRun}
        <div class="last-run">
          <div class="last-run-head">
            <span class="last-run-label">Last full refresh</span>
            <span class="last-run-when">{relTime(data.refreshLastRun.completed_at)}{data.refreshLastRun.duration_ms ? ` · ran for ${fmtDuration(data.refreshLastRun.duration_ms)}` : ''}</span>
          </div>
          <div class="last-run-body">
            {#if data.refreshLastRun.steps?.['extract-permalinks']?.ran}
              <span><code>{fmt(data.refreshLastRun.steps['extract-permalinks'].totalLinks || 0)}</code> links</span>
            {/if}
            {#if data.refreshLastRun.steps?.['dedupe-filter']?.ran}
              <span><code>{fmt(data.refreshLastRun.steps['dedupe-filter'].kept || 0)}</code> URLs</span>
            {/if}
            {#if data.refreshLastRun.steps?.['fetch-html']?.ran}
              <span><code>{fmt((data.refreshLastRun.steps['fetch-html'].fetchedNew || 0) + (data.refreshLastRun.steps['fetch-html'].refreshed || 0))}</code> HTML</span>
            {/if}
            {#if data.refreshLastRun.steps?.['extract-html']?.ran}
              <span><code>{fmt(data.refreshLastRun.steps['extract-html'].totalPosts || 0)}</code> posts</span>
              <span><code>{fmt(data.refreshLastRun.steps['extract-html'].totalComments || 0)}</code> comments</span>
            {/if}
            {#if data.refreshLastRun.steps?.['download-assets']?.ran}
              {@const a = data.refreshLastRun.steps['download-assets']}
              {#if a.avatars}<span><code>{fmt(a.avatars.downloaded || 0)}</code> avatars</span>{/if}
              {#if a.thumbnails}<span><code>{fmt(a.thumbnails.downloaded || 0)}</code> thumbs</span>{/if}
              {#if a.gifs}<span><code>{fmt(a.gifs.downloaded || 0)}</code> GIFs</span>{/if}
            {/if}
          </div>
        </div>
      {/if}

      <form method="POST" action="?/refreshRunAll" class="run-all-form">
        <fieldset class="asset-types">
          <legend>Include in run</legend>
          <label class="asset-type">
            <input type="checkbox" name="want_avatars" checked />
            <div><strong>Profile avatars</strong></div>
          </label>
          <label class="asset-type">
            <input type="checkbox" name="want_thumbnails" checked />
            <div><strong>Official thumbnails</strong></div>
          </label>
          <label class="asset-type">
            <input type="checkbox" name="want_gifs" checked />
            <div><strong>GIF previews</strong></div>
          </label>
        </fieldset>
        <button class="primary-btn run-all-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running || data.assetJob?.running}>Run full refresh pipeline</button>
        <small>Steps 1 → 2 → 3 → 4 → 5 in sequence. Empty stages auto-skip; Playwright must be ready before step 3 runs. CLI: <code>npm run sora:refresh-all -- --types avatars,thumbnails,gifs</code></small>
      </form>

      {#if data.refreshInventory}
        <div class="metrics">
          <div><strong>{fmt(data.refreshInventory.manifestCount)}</strong><span>manifests in <code>_refresh/manifests/</code></span></div>
          <div><strong>{fmt(data.refreshInventory.linkFileCount)}</strong><span><code>*.links.txt</code> in <code>_refresh/links/</code></span></div>
          <div><strong>{data.refreshInventory.cleanLinks.exists ? fmt(data.refreshInventory.cleanLinks.lines) : '—'}</strong><span>URLs in <code>clean-links.txt</code></span></div>
        </div>
      {/if}

      <h3 class="manual-steps-heading">Manually run each step in the pipeline</h3>

      <ol class="pipeline-steps">
        <li>
          <div class="step-head"><span class="step-num">1</span><strong>Extract permalinks from manifests</strong></div>
          <p class="note">Reads every <code>*.json</code> in <code>_refresh/manifests/</code> and writes <code>&lt;basename&gt;.links.txt</code> per manifest into <code>_refresh/links/</code>. Handles creator/liked v1, v2, and remix manifest formats.</p>
          <form method="POST" action="?/refreshExtractPermalinks">
            <button class="secondary-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running}>Run step 1</button>
            <small>CLI: <code>npm run sora:extract-links</code></small>
          </form>
        </li>

        <li>
          <div class="step-head"><span class="step-num">2</span><strong>Dedupe + filter to <code>/p/</code> URLs</strong></div>
          <p class="note">Combines every <code>*.links.txt</code>, removes duplicates, and keeps only post URLs. Comment / profile / non-<code>/p/</code> URLs are dropped (only post pages embed the RSC payload). Output: <code>_refresh/links/clean-links.txt</code>.</p>
          <form method="POST" action="?/refreshDedupeLinks">
            <button class="secondary-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running}>Run step 2</button>
            <small>CLI: <code>npm run sora:dedupe</code></small>
          </form>
        </li>

        <li>
          <div class="step-head"><span class="step-num">3</span><strong>Fetch fresh HTML</strong></div>
          <p class="note">Uses Playwright to load each post page with JavaScript disabled so the SSR HTML is preserved. Files newer than 7 days are skipped; older files are re-fetched and the old version is moved to <code>_refresh/archive/&lt;date&gt;/</code> only on success — a 403, sunset page, or invalid response leaves the original untouched.</p>
          {#if data.refreshInventory}
            <div class="kv"><span>HTML cached</span><code>{fmt(data.refreshInventory.html.count)} files ({fmt(data.refreshInventory.html.stale)} older than 7 days)</code></div>
          {/if}
          {#if data.playwrightStatus?.ok}
            <div class="ready-pill">✓ Playwright ready{data.playwrightStatus.version ? ` (v${data.playwrightStatus.version})` : ''}</div>
            <form method="POST" action="?/refreshFetchHtml">
              <button class="secondary-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running || !data.refreshInventory?.cleanLinks?.exists}>Run step 3</button>
              {#if !data.refreshInventory?.cleanLinks?.exists}
                <small>Run steps 1 and 2 first to produce <code>clean-links.txt</code>.</small>
              {:else}
                <small>CLI: <code>npm run sora:fetch</code></small>
              {/if}
            </form>
          {:else}
            <div class="install-card">
              <strong>Playwright is not installed yet.</strong>
              {#if data.playwrightStatus?.reason === 'missing-package'}
                <p class="note">It's an optional peer dependency to keep the base install lean. 
                  Run this in the project root (where use used the start file), 
                  then reload this page:</p>
                <pre class="copy-cmd">npm install playwright
npx playwright install chromium</pre>
              {:else if data.playwrightStatus?.reason === 'missing-browser'}
                <p class="note">The Playwright package is installed but Chromium isn't downloaded yet. Run this and reload:</p>
                <pre class="copy-cmd">npx playwright install chromium</pre>
              {:else}
                <p class="note">Playwright failed to launch on this machine. Check the error below and consult the Playwright docs.</p>
                {#if data.playwrightStatus?.error}<pre class="copy-cmd">{data.playwrightStatus.error}</pre>{/if}
              {/if}
            </div>
          {/if}
        </li>

        <li>
          <div class="step-head"><span class="step-num">4</span><strong>Extract metadata from HTML</strong></div>
          <p class="note">Walks the RSC payload in each saved HTML file and writes <code>&lt;slug&gt;.extracted.json</code> with fresh signed URLs for video, thumbnail, GIF preview, and profile pictures, plus the SSR-hydrated comments page. Same age policy as step 3 — files newer than 7 days are skipped; older ones are re-extracted with the original archived only on success.</p>
          {#if data.refreshInventory}
            <div class="kv"><span>Extracted JSON</span><code>{fmt(data.refreshInventory.extracted.count)} files ({fmt(data.refreshInventory.extracted.stale)} older than 7 days)</code></div>
          {/if}
          <form method="POST" action="?/refreshExtractHtml">
            <button class="secondary-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running || !data.refreshInventory?.html?.count}>Run step 4</button>
            {#if !data.refreshInventory?.html?.count}
              <small>Run step 3 first to produce HTML files in <code>_refresh/html/</code>.</small>
            {:else}
              <small>CLI: <code>npm run sora:extract</code></small>
            {/if}
          </form>
        </li>

        <li>
          <div class="step-head"><span class="step-num">5</span><strong>Download official assets</strong></div>
          <p class="note">Walks every <code>*.extracted.json</code> in your archive and downloads each selected asset type using the URLs in those files. Files already on disk are skipped — binaries are "final" once downloaded, so the 7-day age policy from steps 3–4 does not apply here. To pull fresh copies, delete the file and re-run.</p>
          {#if data.refreshInventory}
            <div class="metrics">
              <div><strong>{fmt(data.avatarStats?.withAvatar || 0)}</strong><span>avatars on disk</span></div>
              <div><strong>{fmt(data.refreshInventory.assets.thumbnails.count)}</strong><span>thumbnails on disk</span></div>
              <div><strong>{fmt(data.refreshInventory.assets.gifs.count)}</strong><span>GIFs on disk</span></div>
            </div>
          {/if}
          <form method="POST" action="?/refreshDownloadAssets" class="asset-form">
            <fieldset class="asset-types">
              <legend>Asset types</legend>
              <label class="asset-type">
                <input type="checkbox" name="want_avatars" checked />
                <div>
                  <strong>Profile avatars</strong>
                  <small><code>profile_picture_url</code> per profile → <code>profiles/&lt;username&gt;/&lt;username&gt;.profile.&lt;ext&gt;</code></small>
                </div>
              </label>
              <label class="asset-type">
                <input type="checkbox" name="want_thumbnails" checked />
                <div>
                  <strong>Official thumbnails</strong>
                  <small><code>url_thumbnail</code> per video → <code>_refresh/assets/thumbnails/&lt;attachment_id&gt;.&lt;ext&gt;</code></small>
                </div>
              </label>
              <label class="asset-type">
                <input type="checkbox" name="want_gifs" checked />
                <div>
                  <strong>GIF previews</strong>
                  <small><code>url_gif</code> per video → <code>_refresh/assets/gifs/&lt;attachment_id&gt;.&lt;ext&gt;</code></small>
                </div>
              </label>
            </fieldset>
            <button class="secondary-btn" type="submit" disabled={data.refreshJob?.running || data.avatarJob?.running || data.assetJob?.running}>Download selected</button>
            <small>CLI: <code>npm run sora:download -- --types avatars,thumbnails,gifs</code></small>
          </form>
        </li>
      </ol>

      {#if data.refreshJob?.running || data.refreshJob?.done}
        <div class="kv"><span>Last refresh step</span><code>{data.refreshJob.stage || '—'} ({data.refreshJob.phase})</code></div>
        {#if data.refreshJob.running}
          <form method="POST" action="?/cancelRefreshJob" class="cancel-job-form">
            <button class="danger-btn" type="submit">Cancel current refresh step</button>
          </form>
        {/if}
        {#if data.refreshJob.error}<div class="error-box">{data.refreshJob.error}</div>{/if}
        {#if data.refreshJob.result}
          {#if data.refreshJob.stage === 'extract-permalinks'}
            <div class="metrics">
              <div><strong>{fmt(data.refreshJob.result.files)}</strong><span>manifests scanned</span></div>
              <div><strong>{fmt(data.refreshJob.result.okFiles)}</strong><span>parsed OK</span></div>
              <div><strong>{fmt(data.refreshJob.result.totalLinks)}</strong><span>links extracted</span></div>
              <div><strong>{fmt(data.refreshJob.result.draftFiles)}</strong><span>drafts (no links)</span></div>
              <div><strong>{fmt(data.refreshJob.result.errors?.length || 0)}</strong><span>parse errors</span></div>
            </div>
          {:else if data.refreshJob.stage === 'dedupe-filter'}
            <div class="metrics">
              <div><strong>{fmt(data.refreshJob.result.sourceFiles)}</strong><span>link files combined</span></div>
              <div><strong>{fmt(data.refreshJob.result.totalLines)}</strong><span>total lines read</span></div>
              <div><strong>{fmt(data.refreshJob.result.kept)}</strong><span>unique post URLs kept</span></div>
              <div><strong>{fmt(data.refreshJob.result.duplicates)}</strong><span>duplicates dropped</span></div>
              <div><strong>{fmt(data.refreshJob.result.nonPost)}</strong><span>non-/p/ filtered out</span></div>
            </div>
          {:else if data.refreshJob.stage === 'fetch-html'}
            <div class="metrics">
              <div><strong>{fmt(data.refreshJob.result.total)}</strong><span>URLs in queue</span></div>
              <div><strong>{fmt(data.refreshJob.result.fetchedNew)}</strong><span>newly fetched</span></div>
              <div><strong>{fmt(data.refreshJob.result.refreshed)}</strong><span>refreshed (≥7d old)</span></div>
              <div><strong>{fmt(data.refreshJob.result.skippedFresh)}</strong><span>skipped (still fresh)</span></div>
              <div><strong>{fmt(data.refreshJob.result.failed)}</strong><span>failed</span></div>
              <div><strong>{fmt(data.refreshJob.result.sunset)}</strong><span>sunset/redirect page</span></div>
              <div><strong>{fmt(data.refreshJob.result.keptOriginal)}</strong><span>originals kept on failure</span></div>
              <div><strong>{fmt(data.refreshJob.result.archived)}</strong><span>archived to <code>_refresh/archive/</code></span></div>
            </div>
          {:else if data.refreshJob.stage === 'extract-html'}
            <div class="metrics">
              <div><strong>{fmt(data.refreshJob.result.total)}</strong><span>HTML files in queue</span></div>
              <div><strong>{fmt(data.refreshJob.result.extractedNew)}</strong><span>newly extracted</span></div>
              <div><strong>{fmt(data.refreshJob.result.refreshed)}</strong><span>refreshed (≥7d old)</span></div>
              <div><strong>{fmt(data.refreshJob.result.skippedFresh)}</strong><span>skipped (still fresh)</span></div>
              <div><strong>{fmt(data.refreshJob.result.failed)}</strong><span>failed</span></div>
              <div><strong>{fmt(data.refreshJob.result.keptOriginal)}</strong><span>originals kept on failure</span></div>
              <div><strong>{fmt(data.refreshJob.result.archived)}</strong><span>archived to <code>_refresh/archive/</code></span></div>
              <div><strong>{fmt(data.refreshJob.result.totalPosts)}</strong><span>posts</span></div>
              <div><strong>{fmt(data.refreshJob.result.totalVideos)}</strong><span>videos</span></div>
              <div><strong>{fmt(data.refreshJob.result.totalComments)}</strong><span>comments</span></div>
            </div>
          {:else if data.refreshJob.stage === 'run-all'}
            <div class="run-all-progress">
              {#each ['extract-permalinks','dedupe-filter','fetch-html','extract-html','download-assets'] as key, idx}
                {@const s = data.refreshJob.steps?.[key]}
                <div class="run-all-step" class:done={s?.ran && s?.ok} class:skipped={s?.skipped}>
                  <span class="step-num small">{idx + 1}</span>
                  <span>{key}</span>
                  <span class="run-all-status">{s?.ran && s?.ok ? '✓' : s?.skipped ? 'skipped' : 'failed'}</span>
                </div>
              {/each}
            </div>
            <small class="note">Detailed per-step counts are in the persisted summary above (top of panel) and in the recent-messages log below.</small>
          {:else if data.refreshJob.stage === 'download-assets'}
            <div class="kv"><span>Source files</span><code>{fmt(data.refreshJob.result.files)} extracted.json scanned</code></div>
            {#if data.refreshJob.types?.avatars}
              <div class="metrics">
                <div><strong>{fmt(data.refreshJob.result.avatars.total)}</strong><span>avatars queued</span></div>
                <div><strong>{fmt(data.refreshJob.result.avatars.downloaded)}</strong><span>avatars downloaded</span></div>
                <div><strong>{fmt(data.refreshJob.result.avatars.skipped)}</strong><span>avatars on disk</span></div>
                <div><strong>{fmt(data.refreshJob.result.avatars.failed)}</strong><span>avatars failed</span></div>
              </div>
            {/if}
            {#if data.refreshJob.types?.thumbnails}
              <div class="metrics">
                <div><strong>{fmt(data.refreshJob.result.thumbnails.total)}</strong><span>thumbnails queued</span></div>
                <div><strong>{fmt(data.refreshJob.result.thumbnails.downloaded)}</strong><span>thumbnails downloaded</span></div>
                <div><strong>{fmt(data.refreshJob.result.thumbnails.skipped)}</strong><span>thumbnails on disk</span></div>
                <div><strong>{fmt(data.refreshJob.result.thumbnails.failed)}</strong><span>thumbnails failed</span></div>
              </div>
            {/if}
            {#if data.refreshJob.types?.gifs}
              <div class="metrics">
                <div><strong>{fmt(data.refreshJob.result.gifs.total)}</strong><span>GIFs queued</span></div>
                <div><strong>{fmt(data.refreshJob.result.gifs.downloaded)}</strong><span>GIFs downloaded</span></div>
                <div><strong>{fmt(data.refreshJob.result.gifs.skipped)}</strong><span>GIFs on disk</span></div>
                <div><strong>{fmt(data.refreshJob.result.gifs.failed)}</strong><span>GIFs failed</span></div>
              </div>
            {/if}
          {/if}
        {:else if data.refreshJob.running && (data.refreshJob.stage === 'fetch-html' || data.refreshJob.stage === 'extract-html') && data.refreshJob.progress?.total}
          <div class="progress-track"><div style={`width:${Math.round((data.refreshJob.progress.index / data.refreshJob.progress.total) * 100)}%`}></div></div>
          <div class="kv"><span>Progress</span><code>{fmt(data.refreshJob.progress.index)}/{fmt(data.refreshJob.progress.total)} {data.refreshJob.stage === 'fetch-html' ? 'URLs' : 'HTML files'}</code></div>
        {:else if data.refreshJob.running && data.refreshJob.stage === 'download-assets'}
          <div class="kv"><span>Phase</span><code>{data.refreshJob.phase}</code></div>
          {#if data.refreshJob.progress?.total}
            <div class="progress-track"><div style={`width:${Math.round((data.refreshJob.progress.index / data.refreshJob.progress.total) * 100)}%`}></div></div>
            <div class="kv"><span>{data.refreshJob.progress.kind || 'queue'}</span><code>{fmt(data.refreshJob.progress.index)}/{fmt(data.refreshJob.progress.total)}</code></div>
          {/if}
        {:else if data.refreshJob.running && data.refreshJob.stage === 'run-all'}
          <div class="kv"><span>Current step</span><code>{data.refreshJob.phase}</code></div>
          {#if data.refreshJob.progress?.total}
            <div class="progress-track"><div style={`width:${Math.round((data.refreshJob.progress.index / data.refreshJob.progress.total) * 100)}%`}></div></div>
            <div class="kv"><span>{data.refreshJob.progress.kind || 'queue'}</span><code>{fmt(data.refreshJob.progress.index)}/{fmt(data.refreshJob.progress.total)}</code></div>
          {/if}
          {#if data.refreshJob.steps}
            <div class="run-all-progress">
              {#each ['extract-permalinks','dedupe-filter','fetch-html','extract-html','download-assets'] as key, idx}
                {@const s = data.refreshJob.steps[key]}
                {@const isCurrent = data.refreshJob.phase === key}
                <div class="run-all-step" class:done={s?.ran && s?.ok} class:skipped={s?.skipped} class:current={isCurrent}>
                  <span class="step-num small">{idx + 1}</span>
                  <span>{key}</span>
                  <span class="run-all-status">{s?.ran && s?.ok ? '✓' : s?.skipped ? '⏭' : isCurrent ? '…' : ''}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
        {#if data.refreshJob.messages?.length}
          <div class="job-log">
            <strong>Recent messages</strong>
            {#each data.refreshJob.messages.slice(-8) as message}
              <div class:bad={message.level === 'error'} class:warn={message.level === 'warn'}>{message.text}</div>
            {/each}
          </div>
        {/if}
      {/if}
    </section>

    {#if data.avatarJob?.running || data.avatarJob?.done}
      <section class="panel">
        <h2>Avatar job status</h2>
        <div class="kv"><span>Phase</span><code>{data.avatarJob.phase}</code></div>
        {#if data.avatarJob.running}
          <form method="POST" action="?/cancelAvatarJob" class="cancel-job-form">
            <button class="danger-btn" type="submit">Cancel avatar download</button>
            <small>In-flight downloads complete; the queue stops afterward.</small>
          </form>
        {:else if data.avatarJob.cancelled}
          <div class="warning-box">Avatar download cancelled. Files already downloaded were kept.</div>
        {/if}
        <div class="metrics">
          <div><strong>{fmt(data.avatarJob.filesScanned)}/{fmt(data.avatarJob.filesTotal)}</strong><span>extracted.json scanned</span></div>
          <div><strong>{fmt(data.avatarJob.profilesQueued)}</strong><span>unique profiles</span></div>
          <div><strong>{fmt(data.avatarJob.downloaded)}</strong><span>downloaded</span></div>
          <div><strong>{fmt(data.avatarJob.skipped)}</strong><span>already on disk</span></div>
          <div><strong>{fmt(data.avatarJob.failed)}</strong><span>failed (likely expired)</span></div>
          <div><strong>{fmt(data.avatarJob.registered)}</strong><span>registered in DB</span></div>
        </div>
        {#if data.avatarJob.currentFile}<div class="kv"><span>Current file</span><code>{data.avatarJob.currentFile}</code></div>{/if}
        {#if data.avatarJob.error}<div class="error-box">{data.avatarJob.error}</div>{/if}
        {#if data.avatarJob.messages?.length}
          <div class="job-log">
            <strong>Recent messages</strong>
            {#each data.avatarJob.messages.slice(-8) as message}
              <div class:bad={message.level === 'error'} class:warn={message.level === 'warn'}>{message.text}</div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/if}

  {#if activeTab === 'library'}
    <section class="panel">
      <h2>Library tools</h2>
      <p>These tools are local-only and never change the original Sora metadata.</p>
      <div class="tool-grid">
        <a class="tool-link" href="/favorites">Favorites</a>
        <a class="tool-link" href="/collections">Collections</a>
        <a class="tool-link" href="/hidden">Hidden videos</a>
        <a class="tool-link" href="/commented">Most-commented</a>
        <a class="tool-link" href="/duplicates">Duplicate candidates</a>
        <a class="tool-link" href="/timeline">Timeline</a>
      </div>
    </section>

    <section class="panel">
      <h2>Quick library summary</h2>
      {#if data.archiveStats}
        <div class="metrics">
          <div><strong>{fmt(data.archiveStats.favorites)}</strong><span>favorites</span></div>
          <div><strong>{fmt(data.archiveStats.hidden)}</strong><span>hidden</span></div>
          <div><strong>{fmt(data.archiveStats.reviewed)}</strong><span>reviewed</span></div>
          <div><strong>{fmt(data.archiveStats.liked)}</strong><span>imported liked</span></div>
        </div>
      {/if}
    </section>

    <section class="panel">
      <h2>Duplicate candidates</h2>
      {#if data.duplicates?.length}
        <div class="compact-list">
          {#each data.duplicates as d}
            <div><strong>{d.n}×</strong><code>{d.reason}: {d.match_key}</code></div>
          {/each}
        </div>
        <a class="tool-link inline" href="/duplicates">View all duplicate candidates</a>
      {:else}
        <p>No obvious duplicates found by generation/post ID.</p>
      {/if}
    </section>
  {/if}

  {#if activeTab === 'display'}
    <section class="panel">
      <h2>People / Creator / Character performance</h2>
      <p>These pages use prebuilt summary tables because the archive data is mostly static. The first visit after import may rebuild summaries; after that, the lists avoid expensive grouping joins.</p>
      <p><strong>More information is slower.</strong> Minimal mode loads only names and video counts. Profile and Rich modes add profile joins and can make the first page heavier.</p>
      <form method="POST" action="?/updatePeopleLimits" class="perf-form expanded">
        <label>
          Initial load
          <input type="number" name="personInitialLimit" min="25" max="500" step="25" value={data.config.personInitialLimit || 100} />
          <small>Default: 100. Lower values make first page loads faster.</small>
        </label>
        <label>
          Lazy-load batch
          <input type="number" name="personLoadLimit" min="50" max="1000" step="50" value={data.config.personLoadLimit || 250} />
          <small>Default: 250. Larger batches reduce scroll requests but transfer more rows at once.</small>
        </label>
        <label>
          Index detail level
          <select name="personIndexInfo">
            <option value="minimal" selected={(data.config.personIndexInfo || 'minimal') === 'minimal'}>Minimal — fastest</option>
            <option value="profile" selected={data.config.personIndexInfo === 'profile'}>Profile names/owners</option>
            <option value="rich" selected={data.config.personIndexInfo === 'rich'}>Rich counts/descriptions</option>
          </select>
          <small>Minimal mode avoids profile joins on index pages. Detail pages still load full info when opened.</small>
        </label>
        <label class="checkbox-setting">
          <input type="checkbox" name="personShowImages" checked={data.config.personShowImages === true} />
          Load avatars on index pages
          <small>Off by default. Turning this on makes the lists prettier but adds many image requests.</small>
        </label>
        <label>
          Mobile feed layout
          <select name="mobileFeedLayout">
            <option value="auto" selected={(data.config.mobileFeedLayout || 'auto') === 'auto'}>Automatic — vertical feed on phones</option>
            <option value="grid" selected={data.config.mobileFeedLayout === 'grid'}>Grid on all devices</option>
            <option value="reel" selected={data.config.mobileFeedLayout === 'reel'}>Full-screen vertical feed</option>
          </select>
          <small>Automatic keeps the desktop grid, but uses a swipe-style vertical video feed on small screens.</small>
        </label>
        <button class="secondary-btn" type="submit">Save performance settings</button>
      </form>
    </section>
  {/if}

  {#if activeTab === 'data'}
    <section class="panel">
      <h2>Data & Database</h2>
      <div class="kv"><span>Current engine</span><code>{data.config.dbEngine || 'sqlite'}</code></div>
      <div class="kv"><span>Database path</span><code>{data.config.dbPath}</code></div>
      <div class="db-explain-grid">
        <div>
          <h3>SQLite</h3>
          <p>Recommended default for most users. It creates a normal, inspectable database file that is easy to copy, back up, and open with SQLite tools.</p>
          <ul><li>Most tested option.</li><li>Fast for local browsing and search.</li><li>Simple one-file backup.</li></ul>
        </div>
        <div>
          <h3>DuckDB</h3>
          <p>Experimental local option for users who want stronger archive-wide analysis and faster summary rebuilds on some larger libraries.</p>
          <ul><li>Good for grouped reports and summary generation.</li><li>Useful for testing large metadata scans.</li><li>Not automatically faster for every page.</li></ul>
        </div>
      </div>
      <p class="note">Switch to DuckDB if you are experimenting with larger archive-wide reports. Stay on SQLite if you mainly want the most stable and inspectable local viewer.</p>
      <form method="POST" action="?/switchDatabase" class="choice-row">
        <label><input type="radio" name="dbEngine" value="sqlite" checked={data.config.dbEngine !== 'duckdb'} /> SQLite <small>default, inspectable, simple</small></label>
        <label><input type="radio" name="dbEngine" value="duckdb" checked={data.config.dbEngine === 'duckdb'} /> DuckDB <small>experimental local catalog</small></label>
        <button class="secondary-btn" type="submit" disabled={data.assetJob?.running}>Switch and re-ingest</button>
      </form>
    </section>

    <section class="panel">
      <h2>Backup, export, and optimize</h2>
      <div class="tool-grid">
        <a class="tool-link" href="/api/export/database">Backup database</a>
        <a class="tool-link" href="/api/export/videos.csv">Export videos CSV</a>
        <a class="tool-link" href="/api/export/metadata.json">Export metadata JSON</a>
      </div>
      <form method="POST" action="?/optimizeDatabase">
        <button class="secondary-btn narrow-btn" type="submit">Optimize database / rebuild summaries</button>
        <small>SQLite runs safe maintenance and summary refreshes. DuckDB uses batch summary rebuilds plus checkpoint/analyze when available.</small>
      </form>
    </section>
  {/if}

  {#if activeTab === 'access'}
    {#if form?.accessSaved && form?.accessChanged}
      <div class="warning-box restart-banner">
        <strong>⚠ Restart required.</strong>
        Access mode changed from <code>{form.previousMode}</code> to <code>{form.newMode}</code>, but the running server still listens on the previous interface ({data.network?.runtimeMode === 'lan' ? '0.0.0.0' : '127.0.0.1'}).
        Stop the server (close the terminal window or press Ctrl+C) and restart it with <code>start.bat</code> / <code>start.sh</code> / <code>start.command</code> for the change to take effect.
      </div>
    {:else if form?.accessSaved}
      <div class="success-box">Settings saved.</div>
    {/if}

    {#if data.network?.needsRestart}
      <div class="warning-box restart-banner">
        <strong>⚠ Pending restart.</strong>
        Configured access mode is <code>{data.network.configuredMode}</code> but the running server is bound for <code>{data.network.runtimeMode}</code>. Restart the app to apply.
      </div>
    {/if}

    <section class="panel">
      <h2>Access & Security</h2>
      <p>Sora View Lite is a local archive server. Keep it local-only unless you intentionally want other devices on your network to connect.</p>
      <form method="POST" action="?/updateAccessSettings" class="access-form">
        <label>
          Access mode
          <select name="serverAccessMode">
            <option value="local" selected={(data.config.serverAccessMode || 'local') === 'local'}>Local only</option>
            <option value="lan" selected={data.config.serverAccessMode === 'lan'}>LAN access</option>
          </select>
          <small>Local only is safest. LAN access is for phones, tablets, or other computers on your trusted network. <strong>Changing this requires a full server restart</strong> — the bind address (<code>127.0.0.1</code> vs <code>0.0.0.0</code>) is decided at startup.</small>
        </label>
        <label class="checkbox-setting">
          <input type="checkbox" name="showFullPaths" checked={data.config.showFullPaths !== false} />
          Show full local file paths in Technical Details
          <small>Turn this off if other devices will browse the archive and you do not want local paths displayed.</small>
        </label>
        <button class="secondary-btn" type="submit">Save access settings</button>
      </form>
      <div class="warning-box">Do not enable LAN access on public or untrusted networks. The archive may include private prompts, creator names, local file paths, and media files.</div>
    </section>

    <section class="panel">
      <h2>Network notes</h2>
      <p>Production launchers bind based on <code>config.json → serverAccessMode</code>. Local-only means <code>127.0.0.1</code> (this computer only); LAN means <code>0.0.0.0</code> (any device on this machine's network).</p>

      <div class="kv"><span>Configured mode</span><code>{data.network?.configuredMode || 'local'}</code></div>
      <div class="kv"><span>Running mode</span><code>{data.network?.runtimeMode || 'local'}</code></div>
      <div class="kv"><span>Listening port</span><code>{data.network?.port || 5173}</code></div>

      <h3 class="subhead">From this computer</h3>
      <div class="connect-grid">
        <div class="connect-card">
          <div class="connect-meta">
            <strong>Local loopback</strong>
            <a href={data.network?.localUrl} target="_blank" rel="noopener">{data.network?.localUrl}</a>
            <small>Always works regardless of access mode.</small>
          </div>
          {#if data.network?.localQr}
            <div class="qr">{@html data.network.localQr}</div>
          {/if}
        </div>
      </div>

      {#if data.network?.lan?.length}
        <h3 class="subhead">From phones / other computers on this network</h3>
        {#if data.network.runtimeMode !== 'lan'}
          <p class="note inline-note">⚠ The running server is in <code>local</code> mode, so devices on your network cannot reach these URLs yet. Switch the access mode above and restart the server.</p>
        {/if}
        <div class="connect-grid">
          {#each data.network.lan as iface}
            <div class="connect-card">
              <div class="connect-meta">
                <strong>{iface.name}</strong>
                <a href={iface.url} target="_blank" rel="noopener">{iface.url}</a>
                <small>Scan the QR with a phone on the same Wi-Fi.</small>
              </div>
              {#if iface.qrSvg}
                <div class="qr">{@html iface.qrSvg}</div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="note">No external network interfaces detected. The machine is offline or has only a loopback adapter.</p>
      {/if}
    </section>
  {/if}

  {#if activeTab === 'about'}
    <section class="panel about-panel">
      <h2>About Sora View Lite</h2>
      <p>Sora View Lite is a local-first viewer for SoraVault archives, built to help people preserve and browse their saved Sora videos after the original online experience became unavailable. It supports videos, thumbnails, previews, prompts, creators, characters, remix metadata, favorites, collections, and archive maintenance tools — all from files on your own machine. Special thanks to <strong>Sebastian Haas</strong> for developing SoraVault, which made it possible for users to back up and preserve their Sora libraries in the first place.</p>

      <p>The app does not depend on the live Sora service for browsing. Once your archive is on disk, every page renders from local files — no telemetry, no remote calls, no accounts.</p>

      <h3>What's new in 1.1</h3>
      <p><strong>Download Bookmarked Sora Video</strong> — paste any Sora <code>/p/</code> URL and the app checks your database, then either opens the existing record in the video player or runs a download (page, video, thumbnail, GIF preview, author avatar, and the first SSR page of comments) and ingests it on the spot. That means it tries its best to download the video for you so you can play it.</p>
      <p><strong>Refresh Sora Assets pipeline</strong> — a five-step tool that re-fetches each post's SSR HTML from <code>sora.chatgpt.com</code> with JavaScript disabled (the only known way to bypass the sunset redirect) so the embedded payload yields fresh signed Azure URLs. The downloader then pulls official thumbnails, GIF previews, and profile avatars into your existing <code>sora_v2_creators/&lt;creator&gt;/</code> and <code>profiles/&lt;username&gt;/</code> folders. Files are aged out and refreshed on a 7-day cycle so expired URLs get retried automatically.</p>

      <h3>Themes</h3>
      <p>A three-way toggle in the sidebar cycles between <strong>dark</strong>, <strong>light</strong>, and <strong>Sora</strong> — the last with a starfield background, translucent navy chrome, and a white circle FAB on the mobile bottom nav, mirroring Sora's own post-shutdown mobile UI. Click the sun / cloud / moon icon to switch.</p>

      <h3>For power users</h3>
      <p>Every step of the Refresh pipeline is also available from the terminal as <code>npm run sora:extract-links</code>, <code>sora:dedupe</code>, <code>sora:fetch</code>, <code>sora:extract</code>, <code>sora:download</code>, and <code>sora:refresh-all</code>. A fully standalone, dependency-free script lives at <code>cli/do-all.js</code> for processing saved HTML on any machine with Node 18+. Larger archives can switch from SQLite to DuckDB for analytics-style queries, and an opt-in LAN access mode binds the server to <code>0.0.0.0</code> with QR codes so you can browse from your phone on the same network.</p>

      <p class="note"><strong>Sora is no longer available.</strong> Downloads may still work for a while.</p>

      <div class="kv"><span>Version</span><code>1.1.0</code></div>
      <div class="kv"><span>Database</span><code>{data.config.dbEngine || 'sqlite'}</code></div>
    </section>
  {/if}
</div>

<style>
  .settings-page { max-width: 1040px; padding: 16px 16px 80px; }
  .settings-header { padding-left: 0; }
  .subtitle { margin: 6px 0 0; color: var(--text-secondary); font-size: 14px; }
  .server-tabs { display:flex; gap:8px; overflow-x:auto; padding: 6px 0 10px; margin-top: 8px; scrollbar-width: thin; }
  .server-tabs a { white-space: nowrap; border:1px solid var(--border); background: var(--bg-card); color: var(--text-secondary); border-radius:999px; padding:9px 13px; font-size:13px; font-weight:800; text-decoration:none; }
  .server-tabs a.active { background: var(--text-primary); color: var(--bg-primary); border-color: var(--text-primary); }
  .panel { margin-top: 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 18px; display: grid; gap: 12px; }
  h2 { margin: 0; font-size: 17px; }
  h3 { margin: 0 0 6px; font-size: 15px; }
  p { margin: 0; color: var(--text-secondary); line-height: 1.5; font-size: 14px; }
  .note { color: var(--text-primary); }
  .kv { display: grid; grid-template-columns: 150px minmax(0,1fr); gap: 12px; }
  .kv span { color: var(--text-secondary); }
  code { font-size: 12px; overflow-wrap: anywhere; }
  .choice-row { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)) 180px; gap: 12px; align-items: stretch; }
  .perf-form, .access-form { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; align-items: stretch; }
  .perf-form input, .perf-form select, .access-form select { background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; color: var(--text-primary); padding: 8px 10px; font: inherit; }
  .checkbox-setting { align-content: start; }
  .checkbox-setting input { width: auto; justify-self: start; }
  label { border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: grid; gap: 4px; }
  small { color: var(--text-secondary); display:block; margin-top: 8px; font-size: 12px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .metrics div { border: 1px solid var(--border); background: var(--bg-panel); border-radius: 12px; padding: 12px; display: grid; gap: 4px; }
  .metrics strong { font-size: 22px; }
  .metrics span { color: var(--text-secondary); font-size: 12px; }
  .job-buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tool-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px,1fr)); gap: 10px; }
  .tool-link { display:flex; align-items:center; justify-content:center; min-height: 38px; border-radius: 999px; border: 1px solid var(--border); background: var(--pill-bg); color: var(--pill-text); text-decoration:none; font-weight:750; font-size:13px; padding: 8px 12px; }
  .tool-link.inline { display:inline-flex; width:max-content; margin-top: 8px; }
  .compact-list { display:grid; gap:8px; }
  .compact-list div { display:flex; gap:10px; align-items:center; border:1px solid var(--border); border-radius:10px; padding:8px; background:var(--bg-panel); }
  .job-buttons form { border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
  .primary-btn, .secondary-btn, .danger-btn { min-height: 42px; border-radius: 999px; padding: 10px 14px; font-weight: 750; cursor: pointer; }
  .primary-btn { background: var(--text-primary); color: var(--bg-primary); }
  .secondary-btn { background: var(--pill-bg); color: var(--pill-text); border: 1px solid var(--border); width: 100%; }
  .danger-btn { background: rgba(248,113,113,0.14); color: #f87171; border: 1px solid rgba(248,113,113,0.35); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .warning-panel { border-color: rgba(251, 191, 36, 0.25); }
  .error-box { color: #f87171; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); border-radius: 12px; padding: 12px; font-size: 13px; }
  .success-box { color: #16a34a; background: rgba(34,197,94,0.10); border: 1px solid rgba(34,197,94,0.24); border-radius: 12px; padding: 12px; font-size: 13px; margin-top: 10px; }
  .narrow-btn { width: auto; min-width: 260px; }
  .warning-box { color: #fbbf24; background: rgba(251,191,36,0.10); border: 1px solid rgba(251,191,36,0.25); border-radius: 12px; padding: 12px; font-size: 13px; }
  .cancel-job-form { border: 1px solid rgba(248,113,113,0.2); border-radius: 14px; padding: 12px; display: grid; gap: 8px; max-width: 420px; }
  .progress-track { height: 10px; border-radius: 999px; background: var(--bg-panel); border: 1px solid var(--border); overflow: hidden; }
  .progress-track div { height: 100%; background: var(--text-primary); transition: width 200ms ease; }
  .db-explain-grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
  .db-explain-grid > div { border: 1px solid var(--border); border-radius: 14px; background: var(--bg-panel); padding: 14px; }
  ul { margin: 8px 0 0; color: var(--text-secondary); padding-left: 18px; font-size: 13px; line-height: 1.45; }
  .about-panel p { font-size: 15px; }
  .subhead { margin: 6px 0 0; font-size: 13px; font-weight: 700; color: var(--text-secondary); }
  .kv-grid { display: grid; gap: 6px; }
  .commented-list { display: grid; gap: 6px; }
  .commented-row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font: inherit;
    transition: background 120ms ease;
  }
  .commented-row:hover { background: var(--bg-hover); }
  .commented-count {
    font-weight: 800;
    font-size: 18px;
    color: var(--text-primary);
    text-align: center;
    background: var(--pill-bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 8px;
    min-width: 56px;
  }
  .commented-meta { min-width: 0; display: grid; gap: 2px; }
  .commented-meta strong { font-size: 13px; }
  .commented-prompt { color: var(--text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .commented-aux { color: var(--text-secondary); font-size: 12px; }
  .avatars-warning { line-height: 1.5; }
  .avatars-warning code { color: #fbbf24; background: rgba(251,191,36,0.06); padding: 1px 4px; border-radius: 4px; }
  .restart-banner { line-height: 1.5; margin-top: 16px; }
  .restart-banner code { color: #fbbf24; background: rgba(251,191,36,0.06); padding: 1px 4px; border-radius: 4px; }
  .inline-note { color: #fbbf24; }
  .inline-note code { color: #fbbf24; background: rgba(251,191,36,0.08); padding: 1px 4px; border-radius: 4px; }
  .connect-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 6px; }
  .connect-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    border-radius: 12px;
    padding: 12px;
  }
  .connect-meta { display: grid; gap: 4px; min-width: 0; }
  .connect-meta strong { font-size: 13px; }
  .connect-meta a { color: var(--text-primary); font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
  .connect-meta a:hover { text-decoration: underline; }
  .connect-meta small { color: var(--text-secondary); font-size: 11px; }
  .qr {
    background: #fff;
    border-radius: 8px;
    padding: 4px;
    line-height: 0;
    flex-shrink: 0;
  }
  .qr :global(svg) { display: block; width: 110px; height: 110px; }
  .job-log { display: grid; gap: 6px; max-height: 260px; overflow: auto; padding: 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; }
  .job-log strong { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
  .job-log div { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; line-height: 1.4; }
  .job-log .warn { color: #fbbf24; }
  .job-log .bad { color: #f87171; }
  .manual-steps-heading { margin: 8px 0 0; font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
  .pipeline-steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .pipeline-steps li { border: 1px solid var(--border); border-radius: 14px; padding: 14px; background: var(--bg-panel); display: grid; gap: 8px; }
  .step-head { display: flex; align-items: center; gap: 10px; font-size: 14px; }
  .step-head strong { color: var(--text-primary); }
  .step-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: var(--text-primary); color: var(--bg-primary); font-weight: 800; font-size: 12px; flex-shrink: 0; }
  .pipeline-steps form { display: grid; gap: 6px; max-width: 360px; }
  .ready-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(34,197,94,0.10); border: 1px solid rgba(34,197,94,0.24); color: #16a34a; font-size: 12px; font-weight: 700; width: max-content; }
  .install-card { border: 1px solid rgba(251,191,36,0.25); background: rgba(251,191,36,0.06); border-radius: 12px; padding: 12px; display: grid; gap: 8px; }
  .install-card strong { color: #fbbf24; }
  .copy-cmd { margin: 0; padding: 10px 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-primary); white-space: pre; overflow: auto; user-select: all; }
  .asset-form { max-width: 100%; gap: 10px; }
  .asset-types { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: grid; gap: 6px; margin: 0; }
  .asset-types legend { padding: 0 6px; color: var(--text-secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .asset-type { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; padding: 6px 4px; border: 0; cursor: pointer; }
  .asset-type input { width: 18px; height: 18px; margin-top: 2px; cursor: pointer; }
  .asset-type strong { color: var(--text-primary); font-size: 14px; display: block; }
  .asset-type small { color: var(--text-secondary); font-size: 12px; margin-top: 2px; display: block; overflow-wrap: anywhere; }
  .last-run { border: 1px solid rgba(34,197,94,0.24); background: rgba(34,197,94,0.06); border-radius: 12px; padding: 12px; display: grid; gap: 8px; }
  .last-run-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .last-run-label { font-size: 12px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
  .last-run-when { color: #16a34a; font-weight: 700; }
  .last-run-body { display: flex; flex-wrap: wrap; gap: 14px; color: var(--text-secondary); font-size: 13px; }
  .last-run-body code { color: var(--text-primary); font-weight: 700; padding: 0 2px; }
  .run-all-form { display: grid; gap: 10px; }
  .run-all-form .asset-types { grid-auto-flow: column; grid-auto-columns: 1fr; }
  .run-all-btn { width: 100%; }
  .run-all-progress { display: grid; gap: 4px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; }
  .run-all-step { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 8px; font-size: 13px; color: var(--text-secondary); }
  .run-all-step.done { color: #16a34a; }
  .run-all-step.skipped { color: var(--text-secondary); opacity: 0.6; }
  .run-all-step.current { background: rgba(34,197,94,0.08); color: var(--text-primary); }
  .run-all-status { font-weight: 700; font-size: 12px; }
  .step-num.small { width: 22px; height: 22px; font-size: 11px; }
  .reconcile-form { display: grid; gap: 6px; max-width: 360px; }
  .bookmark-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .bookmark-input { background: var(--bg-input); border: 1px solid var(--border); border-radius: 999px; color: var(--text-primary); padding: 10px 14px; font: inherit; min-height: 42px; }
  .bookmark-input:focus { outline: none; border-color: var(--border-focus); }
  .bookmark-input.invalid { border-color: rgba(248,113,113,0.45); }
  .bookmark-input-hint { color: #f87171; font-size: 12px; margin-top: 4px; display: block; }
  .bookmark-input-hint code { color: #f87171; }
  .bookmark-records { display: grid; gap: 8px; }
  .bookmark-record { display: grid; gap: 4px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg-panel); color: var(--text-primary); text-align: left; font: inherit; cursor: pointer; transition: background 120ms ease; }
  .bookmark-record:hover { background: var(--bg-hover); }
  .bookmark-record strong { font-size: 13px; overflow-wrap: anywhere; }
  .bookmark-record small { color: var(--text-secondary); font-size: 12px; }
  .bookmark-prompt { color: var(--text-secondary); font-style: italic; }
  .bookmark-steps { list-style: none; margin: 0; padding: 8px; display: grid; gap: 4px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 10px; }
  .bookmark-steps li { display: grid; grid-template-columns: 22px 200px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 4px 6px; border-radius: 6px; font-size: 13px; color: var(--text-secondary); }
  .bookmark-steps li.done    { color: #16a34a; }
  .bookmark-steps li.running { background: rgba(34, 197, 94, 0.08); color: var(--text-primary); }
  .bookmark-steps li.pending { opacity: 0.5; }
  .bookmark-step-marker { font-weight: 800; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .bookmark-step-label  { font-weight: 700; }
  .bookmark-step-message { color: var(--text-secondary); overflow-wrap: anywhere; }
  .bookmark-reset-form { margin-top: 6px; display: grid; gap: 6px; max-width: 360px; }
  @media (max-width: 600px) {
    .bookmark-form { grid-template-columns: 1fr; }
    .bookmark-steps li { grid-template-columns: 22px minmax(0, 1fr); }
    .bookmark-step-message { grid-column: 1 / -1; padding-left: 30px; }
  }
  @media (max-width: 600px) {
    .run-all-form .asset-types { grid-auto-flow: row; grid-auto-columns: auto; }
  }
  @media (max-width: 720px) { .choice-row, .perf-form, .access-form, .job-buttons, .kv, .db-explain-grid { grid-template-columns: 1fr; } .server-tabs { padding-bottom: 8px; } }
</style>
