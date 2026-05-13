<script>
  export let data;
  export let form;

  const formatter = new Intl.NumberFormat();

  function fmt(value) {
    return formatter.format(Number(value || 0));
  }

  const PHASE_LABELS = {
    idle: 'Ready',
    starting: 'Starting…',
    scanning: 'Scanning archive for videos and JSON files',
    parsing_metadata: 'Parsing manifest and extracted JSON metadata',
    ingesting: 'Indexing videos, sidecars, and metadata',
    parsing_comments: 'Indexing comments from extracted.json files',
    downloading_avatars: 'Downloading missing profile avatars',
    reconciling_avatars: 'Reconciling avatar registry',
    refreshing_video_comment_counts: 'Refreshing comment counts on videos',
    complete: 'Complete',
    failed: 'Failed',
    error: 'Error',
    warning: 'Warning',
  };

  function phaseLabel(phase) {
    return PHASE_LABELS[phase] || phase || 'idle';
  }

  $: job = data.job || {};
  $: totalTarget = Math.max(Number(job.found || 0), Number(job.processed || 0), 1);
  $: pct = Math.max(0, Math.min(100, Math.round((Number(job.processed || 0) / totalTarget) * 100)));
  $: shouldRefresh = job?.running;
  $: importError = form?.error || (job?.done && !job?.ok ? job.error : '');
  $: hasCommentActivity = Number(job?.commentFilesFound || 0) > 0
    || Number(job?.commentsInserted || 0) > 0
    || Number(job?.avatarsDownloaded || 0) > 0
    || Number(job?.avatarsSkipped || 0) > 0
    || Number(job?.avatarsRegistered || 0) > 0;
</script>

<svelte:head>
  <title>Import — Sora View Lite</title>
  {#if shouldRefresh}
    <meta http-equiv="refresh" content="1">
  {/if}
</svelte:head>

<div class="wizard">
  <div class="wizard-card">
    <div class="step-label">Step 2 of 2</div>
    <h1>Import your Sora Vault</h1>
    <p class="subtitle">Sora View is creating a local {data.config.dbEngine === 'duckdb' ? 'DuckDB' : 'SQLite'} index of your videos, manifests, and comments. This can take time on large archives. This page refreshes automatically while import is running. Profile avatar downloads are opt-in — finish import, then visit <em>Server Configuration → Assets</em> to fetch them.</p>

    <div class="config-box">
      <div><span>Archive</span><code>{data.config.archivePath}</code></div>
      <div><span>Database</span><code>{data.config.dbPath}</code></div>
      <div><span>Engine</span><code>{data.config.dbEngine || 'sqlite'}</code></div>
      <div><span>Manifest scan</span><code>{data.config.manifestMode || 'unknown'} — recursive scan always runs</code></div>
    </div>

    {#if importError}
      <div class="error-box">{importError}</div>
    {/if}

    {#if data.appState?.ready && !job?.running && !job?.done}
      <div class="ready-box">
        <strong>Database already ready.</strong>
        <span>{data.appState.database?.totalVideos?.toLocaleString() || 0} videos are indexed.</span>
      </div>
      <div class="actions">
        <a class="secondary-btn" href="/setup">Change folder</a>
        <form method="POST" action="?/start">
          <button class="secondary-btn" type="submit">Re-run import</button>
        </form>
        <a class="primary-btn" href="/">Open Sora View</a>
      </div>
    {:else}
      <div class="progress-card">
        <div class="status-row">
          <div>
            <div class="status-title">{job?.running ? 'Import running…' : job?.done && job?.ok ? 'Import complete' : 'Ready to import'}</div>
            <div class="status-subtitle">{phaseLabel(job?.phase)}{job?.currentFile ? ` · ${job.currentFile}` : ''}</div>
          </div>
          <strong>{pct}%</strong>
        </div>
        <div class="bar"><div class="bar-fill" style="width: {pct}%"></div></div>

        <div class="section-label">Videos &amp; metadata</div>
        <div class="metrics">
          <div><strong>{fmt(job.found)}</strong><span>videos found</span></div>
          <div><strong>{fmt(job.processed)}</strong><span>processed</span></div>
          <div><strong>{fmt(job.inserted)}</strong><span>inserted</span></div>
          <div><strong>{fmt(job.skipped)}</strong><span>updated/skipped</span></div>
          <div><strong>{fmt(job.manifestsFound)}</strong><span>JSON metadata files</span></div>
          <div><strong>{fmt(job.thumbnailsFound)}</strong><span>thumbnails found</span></div>
          <div><strong>{fmt(job.previewsFound)}</strong><span>previews found</span></div>
          <div><strong>{fmt(job.errors)}</strong><span>errors</span></div>
        </div>

        {#if hasCommentActivity || job?.phase === 'parsing_comments' || job?.phase === 'downloading_avatars' || job?.phase === 'reconciling_avatars'}
          <div class="section-label">Comments &amp; avatars</div>
          <div class="metrics">
            <div><strong>{fmt(job.commentFilesFound)}</strong><span>extracted.json files</span></div>
            <div><strong>{fmt(job.commentsInserted)}</strong><span>comments inserted</span></div>
            <div><strong>{fmt(job.commentProfilesUpserted)}</strong><span>profiles upserted</span></div>
            <div><strong>{fmt(job.avatarsDownloaded)}</strong><span>avatars downloaded</span></div>
            <div><strong>{fmt(job.avatarsSkipped)}</strong><span>avatars on disk</span></div>
            <div><strong>{fmt(job.avatarsFailed)}</strong><span>avatars failed</span></div>
            <div><strong>{fmt(job.avatarsRegistered)}</strong><span>registered in DB</span></div>
            <div><strong>{fmt(job.avatarsCleared)}</strong><span>cleared (file gone)</span></div>
          </div>
        {/if}

        {#if job?.messages?.length}
          <div class="log">
            {#each job.messages.slice(-6) as message}
              <div class:bad={message.level === 'error'}>{message.text}</div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="actions">
        <a class="secondary-btn" href="/setup">Change folder</a>
        {#if job?.running}
          <button class="primary-btn" type="button" disabled>Importing…</button>
        {:else if job?.done && job?.ok}
          <a class="primary-btn" href="/">Open Sora View</a>
        {:else}
          <form method="POST" action="?/start">
            <button class="primary-btn" type="submit">Start import →</button>
          </form>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .wizard { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(circle at top, var(--bg-secondary), var(--bg-primary) 48%); }
  .wizard-card { width: 100%; max-width: 820px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 22px; padding: 36px; display: flex; flex-direction: column; gap: 18px; box-shadow: var(--shadow); }
  .step-label { color: var(--text-tertiary); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
  h1 { font-size: 25px; font-weight: 750; margin: 0; }
  .subtitle { color: var(--text-secondary); font-size: 14px; line-height: 1.55; margin: 0; }
  .config-box, .progress-card, .ready-box, .error-box { border: 1px solid var(--border); background: var(--bg-input); border-radius: 15px; }
  .config-box { display: grid; gap: 1px; overflow: hidden; }
  .config-box > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding: 12px 14px; background: var(--bg-panel); }
  .config-box span { color: var(--text-secondary); font-size: 13px; }
  code { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-primary); overflow-wrap: anywhere; }
  .ready-box, .progress-card, .error-box { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
  .ready-box span, .status-subtitle { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
  .status-row { display:flex; align-items:center; justify-content:space-between; gap:18px; }
  .status-title { font-size: 16px; font-weight: 720; }
  .bar { height: 9px; border-radius: 999px; overflow: hidden; background: var(--bg-secondary); border: 1px solid var(--border); }
  .bar-fill { height: 100%; background: var(--text-primary); transition: width 220ms ease; }
  .section-label { color: var(--text-tertiary); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 6px; }
  .metrics { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; }
  .metrics div { background: var(--bg-panel); border:1px solid var(--border); border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:3px; }
  .metrics strong { font-size:18px; }
  .metrics span { color: var(--text-secondary); font-size:11px; }
  .log { max-height: 132px; overflow:auto; display:grid; gap:6px; }
  .log div { font-size:12px; color:var(--text-secondary); background: var(--bg-panel); border-radius:8px; padding:6px 8px; overflow-wrap:anywhere; }
  .log .bad { color:#f87171; }
  .error-box { color: #f87171; font-size: 13px; background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.2); line-height: 1.45; }
  .actions { display: grid; grid-template-columns: 180px minmax(0, 1fr) 180px; gap: 10px; align-items: stretch; }
  .actions form { margin: 0; width: 100%; display: contents; }
  .primary-btn, .secondary-btn { width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; border-radius: 999px; padding: 10px 14px; font-size: 14px; font-weight: 750; font-family: var(--font); border: none; cursor: pointer; text-align: center; box-sizing: border-box; }
  .primary-btn { background: var(--text-primary); color: var(--bg-primary); }
  .secondary-btn { background: var(--pill-bg); color: var(--pill-text); border: 1px solid var(--border); }
  button:disabled { opacity: 0.65; cursor: wait; }
  @media (max-width: 720px) { .wizard-card { padding: 26px; } .actions, .metrics { grid-template-columns: 1fr; } .config-box > div { grid-template-columns: 1fr; gap: 5px; } }
</style>
