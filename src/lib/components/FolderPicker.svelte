<script>
  import { createEventDispatcher } from 'svelte';

  export let open  = false;
  export let title = 'Select Folder';

  const dispatch = createEventDispatcher();

  let currentPath = '';
  let entries     = [];
  let breadcrumbs = [];
  let loading     = false;
  let error       = '';
  let sep         = '/';

  $: if (open) browse('');

  async function browse(targetPath) {
    loading = true;
    error   = '';
    try {
      const res  = await fetch(`/api/browse?path=${encodeURIComponent(targetPath)}`);
      const data = await res.json();
      if (data.error) { error = data.error; return; }
      currentPath = data.path;
      entries     = data.entries;
      breadcrumbs = data.parts ?? [];
      sep         = data.sep ?? '/';
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function select() {
    dispatch('select', currentPath);
    open = false;
  }

  function cancel() {
    open = false;
  }

  function handleKey(e) {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window on:keydown={handleKey} />

{#if open}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="backdrop" on:click|self={cancel}>
    <div class="picker" role="dialog" aria-label={title} aria-modal="true">

      <div class="picker-header">
        <h3>{title}</h3>
        <button class="close-x" on:click={cancel} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Breadcrumbs -->
      <div class="breadcrumbs">
        <button class="crumb root-btn" on:click={() => browse('')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
        {#each breadcrumbs as crumb, i}
          <span class="crumb-sep">{sep}</span>
          {#if i === breadcrumbs.length - 1}
            <span class="crumb crumb-current">{crumb.name}</span>
          {:else}
            <button class="crumb crumb-link" on:click={() => browse(crumb.fullPath)}>
              {crumb.name}
            </button>
          {/if}
        {/each}
      </div>

      <!-- Current path display -->
      <div class="current-path">
        <input
          type="text"
          value={currentPath}
          on:change={e => browse(e.target.value)}
          spellcheck="false"
          aria-label="Current path"
        />
      </div>

      <!-- Directory listing -->
      <div class="dir-list">
        {#if loading}
          <div class="list-loading">
            <div class="spinner"></div>
          </div>
        {:else if error}
          <div class="list-error">{error}</div>
        {:else if entries.length === 0}
          <div class="list-empty">No subdirectories found.</div>
        {:else}
          {#each entries as entry (entry.fullPath)}
            <button class="dir-entry" on:click={() => browse(entry.fullPath)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="folder-icon">
                <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>
              </svg>
              <span class="dir-name">{entry.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          {/each}
        {/if}
      </div>

      <!-- Footer -->
      <div class="picker-footer">
        <div class="selected-label">
          {#if currentPath}
            <span class="selected-path">{currentPath}</span>
          {:else}
            <span class="selected-placeholder">No folder selected</span>
          {/if}
        </div>
        <div class="footer-btns">
          <button class="btn btn-secondary" on:click={cancel}>Cancel</button>
          <button class="btn btn-primary" on:click={select} disabled={!currentPath}>
            Select This Folder
          </button>
        </div>
      </div>

    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 120ms ease;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .picker {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    width: 100%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .picker-header h3 { font-size: 16px; font-weight: 600; }

  .close-x {
    color: var(--text-secondary);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    transition: color 150ms, background 150ms;
  }
  .close-x:hover { color: var(--text-primary); background: var(--bg-hover); }

  /* Breadcrumbs */
  .breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .crumb {
    font-size: 12px;
    color: var(--text-secondary);
    padding: 2px 4px;
    border-radius: 4px;
    white-space: nowrap;
    transition: color 150ms, background 150ms;
  }

  .root-btn {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
  }

  .crumb-link { color: var(--text-secondary); }
  .crumb-link:hover { color: var(--text-primary); background: var(--bg-hover); }
  .crumb-current { color: var(--text-primary); font-weight: 500; }
  .crumb-sep { color: var(--text-tertiary); font-size: 12px; padding: 0 1px; }

  /* Path input */
  .current-path {
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .current-path input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: var(--text-primary);
    outline: none;
    transition: border-color 150ms;
  }
  .current-path input:focus { border-color: var(--border-focus); }

  /* Directory list */
  .dir-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 8px;
    min-height: 200px;
  }

  .list-loading {
    display: flex;
    justify-content: center;
    padding: 32px;
  }

  .spinner {
    width: 24px; height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--text-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .list-error  { padding: 16px; font-size: 13px; color: #f87171; text-align: center; }
  .list-empty  { padding: 16px; font-size: 13px; color: var(--text-secondary); text-align: center; }

  .dir-entry {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 8px;
    text-align: left;
    transition: background 150ms;
  }
  .dir-entry:hover { background: var(--bg-hover); }

  .folder-icon { color: #fbbf24; flex-shrink: 0; }
  .dir-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { color: var(--text-tertiary); flex-shrink: 0; }

  /* Footer */
  .picker-footer {
    padding: 14px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .selected-label {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-path { color: var(--text-primary); font-family: ui-monospace, monospace; }
  .selected-placeholder { color: var(--text-secondary); }

  .footer-btns { display: flex; gap: 8px; flex-shrink: 0; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 999px;
    font-size: 13px; font-weight: 600;
    transition: background 150ms, opacity 150ms;
    white-space: nowrap;
  }
  .btn-primary { background: var(--text-primary); color: var(--bg-primary); }
  .btn-primary:hover { opacity: 0.85; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary {
    background: var(--pill-bg); color: var(--pill-text);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover { background: var(--bg-hover); }
</style>
