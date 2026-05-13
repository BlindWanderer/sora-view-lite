<script>
  export let data;
  export let form;

  $: archivePath = form?.archivePath ?? data.prefillArchivePath ?? data.config?.archivePath ?? '';
  $: dbEngine = form?.dbEngine ?? data.prefillDbEngine ?? data.config?.dbEngine ?? 'sqlite';
  $: manifestMode = form?.manifestMode ?? data.prefillManifestMode ?? data.config?.manifestMode ?? 'unknown';
  $: dbPath = form?.dbPath ?? data.config?.dbPath ?? '';
  $: defaultDbPath = archivePath
    ? `${archivePath.replace(/[\\/]*$/, '')}${archivePath.includes('\\') ? '\\' : '/'}${dbEngine === 'duckdb' ? 'sora.duckdb' : 'sora.db'}`
    : '';
  $: error = form?.error || (data.appState?.state === 'missing_archive' ? data.appState.error : '');
</script>

<svelte:head><title>Setup — Sora View Lite</title></svelte:head>

<div class="wizard">
  <form class="wizard-card" method="POST" action="?/save">
    <div class="wizard-logo"><img src="/sora-cloud.svg" alt="" /></div>

    <div class="title-block">
      <h1 class="wizard-title">Connect your Sora Vault</h1>
      <p class="wizard-subtitle">Choose the folder that contains your backed-up Sora videos. Sora View will create a local index and enrich it with manifests, sidecars, and folder/filename metadata.</p>
    </div>

    <div class="field-group">
      <label class="field-label" for="archive">Sora Vault folder
        <span class="field-hint">Type the archive path, or use the server-side folder browser. Browsing only fills this field; your database and manifest choices are saved only when you click Continue.</span>
      </label>
      <div class="path-row">
        <input id="archive" name="archivePath" class="field-input" type="text" value={archivePath} placeholder="C:\\Users\\you\\sora-vault or /home/you/sora-vault" spellcheck="false" autocomplete="off" required />
        <a class="browse-btn" href={archivePath ? `/setup/browse?path=${encodeURIComponent(archivePath)}` : '/setup/browse'}>Browse</a>
      </div>
    </div>

    <div class="field-group">
      <span class="field-label">Database engine
        <span class="field-hint">SQLite is the default and easiest to inspect. DuckDB is experimental and best for curious single-user local testing.</span>
      </span>
      <div class="choice-grid">
        <label class="choice"><input type="radio" name="dbEngine" value="sqlite" checked={dbEngine === 'sqlite'} /> <span><strong>SQLite</strong><small>Default local viewer database</small></span></label>
        <label class="choice"><input type="radio" name="dbEngine" value="duckdb" checked={dbEngine === 'duckdb'} /> <span><strong>DuckDB</strong><small>Experimental, not multi-user</small></span></label>
      </div>
    </div>

    <div class="field-group">
      <span class="field-label">Did you keep your Sora Vault manifest files?
        <span class="field-hint">These are usually named <code>soravault_manifest_&lt;date&gt;.json</code>. They improve dates, creators, likes, remixes, and character metadata. We scan either way.</span>
      </span>
      <div class="choice-grid manifest-grid">
        <label class="choice"><input type="radio" name="manifestMode" value="yes" checked={manifestMode === 'yes'} /> <span><strong>Yes</strong><small>Use manifests if found</small></span></label>
        <label class="choice"><input type="radio" name="manifestMode" value="no" checked={manifestMode === 'no'} /> <span><strong>No</strong><small>Still scan just in case</small></span></label>
        <label class="choice"><input type="radio" name="manifestMode" value="unknown" checked={manifestMode === 'unknown'} /> <span><strong>I don't know</strong><small>Scan anyway</small></span></label>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label" for="db">Database file <span class="optional">optional</span>
        <span class="field-hint">Defaults to <code>{dbEngine === 'duckdb' ? 'sora.duckdb' : 'sora.db'}</code> inside the archive folder. Changing database engine requires a re-import.</span>
      </label>
      <input id="db" name="dbPath" class="field-input" type="text" value={dbPath} placeholder={defaultDbPath || 'Leave blank to use archive folder'} spellcheck="false" autocomplete="off" />
    </div>

    {#if error}<div class="error-box"><span>{error}</span></div>{/if}

    <button type="submit" class="continue-btn">Continue to import →</button>

    <div class="wizard-tip"><strong>Import order:</strong> advanced extracted JSON → Sora Vault manifests → sidecar text files → folder and filename fallback.</div>
  </form>
</div>

<style>
  .wizard { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(circle at top, var(--bg-secondary), var(--bg-primary) 48%); }
  .wizard-card { width: 100%; max-width: 720px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 22px; padding: 38px; display: flex; flex-direction: column; gap: 20px; box-shadow: var(--shadow); }
  .wizard-logo { display: flex; justify-content: center; }
  .wizard-logo img { width: 46px; height: 46px; object-fit: contain; }
  .title-block { display: flex; flex-direction: column; gap: 8px; }
  .wizard-title { font-size: 24px; font-weight: 750; text-align: center; }
  .wizard-subtitle { font-size: 14px; color: var(--text-secondary); text-align: center; line-height: 1.5; max-width: 580px; margin: 0 auto; }
  .field-group { display: flex; flex-direction: column; gap: 8px; }
  .field-label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; font-weight: 650; }
  .field-hint { font-size: 12px; font-weight: 400; color: var(--text-secondary); line-height: 1.45; }
  .optional { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
  .path-row { display: flex; gap: 8px; align-items: stretch; }
  .field-input { flex: 1; background: var(--bg-input); border: 1px solid var(--border); border-radius: 11px; padding: 11px 13px; font-size: 13px; color: var(--text-primary); font-family: ui-monospace, monospace; outline: none; min-width: 0; }
  .field-input:focus { border-color: var(--border-focus); }
  .browse-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; min-height: 42px; border-radius: 11px; border: 1px solid var(--border); background: var(--pill-bg); color: var(--pill-text); font-size: 13px; font-weight: 650; text-decoration: none; }
  .choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .manifest-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .choice { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 13px; background: var(--bg-input); cursor: pointer; }
  .choice input { margin-top: 2px; }
  .choice span { display: flex; flex-direction: column; gap: 3px; }
  .choice small { color: var(--text-secondary); line-height: 1.35; }
  .error-box { color: #f87171; font-size: 13px; padding: 10px 14px; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.2); border-radius: 11px; line-height: 1.4; }
  .continue-btn { display: flex; align-items: center; justify-content: center; width: 100%; padding: 13px; background: var(--text-primary); color: var(--bg-primary); border-radius: 999px; font-size: 15px; font-weight: 750; font-family: var(--font); border: none; }
  .wizard-tip { font-size: 12px; color: var(--text-secondary); background: var(--bg-input); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; line-height: 1.5; }
  @media (max-width: 720px) { .wizard-card { padding: 26px; } .path-row, .choice-grid, .manifest-grid { grid-template-columns: 1fr; flex-direction: column; } .browse-btn { min-height: 40px; } }
</style>
