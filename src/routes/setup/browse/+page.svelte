<script>
  export let data;
  export let form;

  $: currentPath = form?.archivePath || data.currentPath || '';

  function hrefFor(path) {
    return `/setup/browse?path=${encodeURIComponent(path)}`;
  }

  function selectHref(path) {
    return `/setup?archivePath=${encodeURIComponent(path)}`;
  }
</script>

<svelte:head><title>Browse Folders — Sora View Lite</title></svelte:head>

<div class="browser-page">
  <div class="browser-card">
    <div class="browser-header">
      <div>
        <h1>Browse for Sora Vault</h1>
        <p>This browser only chooses the folder. You will return to setup to confirm SQLite/DuckDB and manifest options before import starts.</p>
      </div>
      <a class="secondary-link" href={currentPath ? selectHref(currentPath) : '/setup'}>Back to setup</a>
    </div>

    {#if form?.error}
      <div class="error-box">{form.error}</div>
    {:else if data.error}
      <div class="error-box">Could not read this folder: {data.error}</div>
    {/if}

    <div class="current-box">
      <div class="current-label">Current folder</div>
      <div class="current-path">{currentPath || 'Computer'}</div>
    </div>

    <div class="nav-row">
      {#if data.isRootListing}
        <span class="muted">Choose a drive.</span>
      {:else}
        {#if data.parentPath}
          <a class="nav-btn" href={hrefFor(data.parentPath)}>← Parent folder</a>
        {/if}
        {#if data.rootPath && data.rootPath !== currentPath}
          <a class="nav-btn" href={hrefFor(data.rootPath)}>Root</a>
        {/if}
      {/if}
    </div>

    <div class="folder-list">
      {#if data.entries.length === 0}
        <div class="empty-state">No subfolders found here.</div>
      {:else}
        {#each data.entries as entry}
          <a class="folder-row" href={hrefFor(entry.fullPath)}>
            <span class="folder-icon">📁</span>
            <span class="folder-name">{entry.name}</span>
            <span class="folder-chevron">›</span>
          </a>
        {/each}
      {/if}
    </div>

    {#if currentPath}
      <div class="use-panel">
        <div>
          <strong>Use this folder?</strong>
          <span>This returns to setup with the path filled in. It does not start import yet.</span>
        </div>
        <a class="use-btn" href={selectHref(currentPath)}>Use this folder →</a>
      </div>
    {/if}
  </div>
</div>

<style>
  .browser-page {
    min-height: 100vh;
    padding: 32px 18px;
    display: flex;
    justify-content: center;
    background: radial-gradient(circle at top, var(--bg-secondary), var(--bg-primary) 48%);
  }

  .browser-card {
    width: 100%;
    max-width: 880px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow);
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .browser-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }

  h1 { font-size: 24px; font-weight: 760; margin: 0 0 6px; }
  p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.45; }

  .secondary-link,
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: var(--pill-bg);
    color: var(--pill-text);
    border-radius: 999px;
    padding: 9px 14px;
    text-decoration: none;
    font-size: 13px;
    font-weight: 650;
    white-space: nowrap;
  }

  .secondary-link:hover,
  .nav-btn:hover,
  .folder-row:hover { background: var(--bg-hover); }

  .current-box {
    border: 1px solid var(--border);
    background: var(--bg-input);
    border-radius: 14px;
    padding: 12px 14px;
  }

  .current-label { color: var(--text-secondary); font-size: 12px; margin-bottom: 5px; }
  .current-path { font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }

  .nav-row { display: flex; gap: 10px; align-items: center; min-height: 38px; }
  .muted { color: var(--text-secondary); font-size: 13px; }

  .folder-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    max-height: 48vh;
    overflow-y: auto;
  }

  .folder-row {
    display: grid;
    grid-template-columns: 28px 1fr 20px;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
    text-decoration: none;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .folder-row:last-child { border-bottom: none; }
  .folder-name { overflow-wrap: anywhere; font-size: 14px; }
  .folder-chevron { color: var(--text-secondary); font-size: 22px; text-align: right; }

  .empty-state {
    padding: 28px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .use-panel {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 14px;
    align-items: center;
    border-top: 1px solid var(--border);
    padding-top: 18px;
  }

  .use-panel div { display: flex; flex-direction: column; gap: 4px; }
  .use-panel strong { font-size: 14px; }
  .use-panel span { color: var(--text-secondary); font-size: 12px; line-height: 1.4; }

  .use-btn {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 14px;
    font-weight: 750;
    background: var(--text-primary);
    color: var(--bg-primary);
    white-space: nowrap;
  }

  .use-btn:hover { opacity: 0.85; }

  .error-box {
    color: #f87171;
    font-size: 13px;
    padding: 10px 14px;
    background: rgba(248,113,113,0.1);
    border: 1px solid rgba(248,113,113,0.2);
    border-radius: 11px;
    line-height: 1.4;
  }

  @media (max-width: 640px) {
    .browser-card { padding: 22px; }
    .browser-header, .use-panel { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; }
    .secondary-link, .use-btn { width: 100%; }
  }
</style>
