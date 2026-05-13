<script>
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';

  export let video;
  export let remixes = [];
  export let closeHref = '/';

  let videoEl;
  let muted = true;

  $: cameos = video?.cameos ?? (video?.cameo_list ? video.cameo_list.split(',') : []);
  $: remixTitle = video?.source_dir === 'remix_downstream' ? 'Related remixes' : 'Remixes';

  $: if (videoEl && video?.id) {
    const currentId = video.id;
    tick().then(() => {
      if (!videoEl || video?.id !== currentId) return;
      videoEl.currentTime = 0;
      videoEl.muted = muted;
      videoEl.play().catch(() => {});
    });
  }

  function close() {
    goto(closeHref);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) close();
  }

  function toggleMute() {
    muted = !muted;
    if (videoEl) videoEl.muted = muted;
  }

  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  }

  function fmtDuration(s) {
    if (!s) return '';
    const n = Number(s);
    if (!Number.isFinite(n)) return '';
    return n >= 60 ? `${Math.floor(n / 60)}m ${Math.round(n % 60)}s` : `${n.toFixed(1)}s`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if video}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="server-backdrop" data-lightbox-root role="dialog" aria-modal="true" aria-label="Video details" on:click={handleBackdropClick}>
    <a class="backdrop-close-link" href={closeHref} aria-label="Close lightbox"></a>
    <a class="close-btn icon-btn" href={closeHref} data-lightbox-close aria-label="Close lightbox">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </a>

    <div class="server-modal">
      <div class="server-video-wrap">
        <button class="mute-btn" type="button" on:click={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {#if muted}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.63 3.63a1 1 0 0 0-1.41 1.41L7.29 10.1 7 10H4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h3l5 5v-6.59l4.18 4.18A5.97 5.97 0 0 1 15 17.83v1.76a7.97 7.97 0 0 0 2.23-1.77l2.14 2.14a1 1 0 0 0 1.41-1.41L3.63 3.63zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53A7.96 7.96 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM12 4L9.91 6.09 12 8.18V4zm4.5 8c0-1.77-1-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/>
            </svg>
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          {/if}
        </button>

        <video
          bind:this={videoEl}
          src="/api/video/{video.id}"
          controls
          autoplay
          loop
          playsinline
          {muted}
        ></video>
      </div>

      <aside class="server-info-panel">
        <div class="info-author">
          <div class="author-avatar">{(video.author || '?')[0].toUpperCase()}</div>
          <div class="author-meta">
            {#if video.author}
              <a class="author-name" href="/creators/{encodeURIComponent(video.author)}">{video.author}</a>
            {:else}
              <span class="author-name">Unknown</span>
            {/if}
            {#if video.date}<span class="video-date">{fmtDate(video.date)}</span>{/if}
          </div>
        </div>

        {#if video.prompt}<p class="info-prompt">{video.prompt}</p>{/if}

        {#if cameos.length > 0}
          <div class="info-section">
            <h4 class="section-label">Characters</h4>
            <div class="cameo-chips">
              {#each cameos as name}
                <a class="cameo-chip" href="/characters/{encodeURIComponent(name)}">@{name}</a>
              {/each}
            </div>
          </div>
        {/if}

        <div class="info-meta">
          {#if video.duration_s}<span>{fmtDuration(video.duration_s)}</span>{/if}
          {#if video.width && video.height}<span>{video.width}×{video.height}</span>{/if}
          {#if video.source_dir}<span>{video.source_dir.replace('_', ' ')}</span>{/if}
        </div>

        {#if remixes.length > 0}
          <section class="remix-section" aria-label={remixTitle}>
            <div class="remix-heading">
              <h3>{remixTitle}</h3>
              <span>{remixes.length}</span>
            </div>
            <div class="remix-list">
              {#each remixes as remix}
                <a class="remix-row" href={remix.href || `?video=${remix.id}`}>
                  <video class="remix-thumb" src="/api/video/{remix.id}" muted playsinline preload="metadata"></video>
                  <div class="remix-copy">
                    <strong>{remix.author || 'Unknown creator'}</strong>
                    {#if remix.prompt}<span>{remix.prompt}</span>{/if}
                    <small>
                      {#if remix.duration_s}{fmtDuration(remix.duration_s)} · {/if}{remix.date ? fmtDate(remix.date) : 'No date'}
                    </small>
                  </div>
                </a>
              {/each}
            </div>
          </section>
        {:else if video.source_dir === 'remix_parent'}
          <section class="remix-section empty-remixes" aria-label="Remixes">
            <div class="remix-heading"><h3>Remixes</h3><span>0</span></div>
            <p>No downstream remixes were matched for this parent yet. Re-run import after this update if your vault sidecars include parent IDs.</p>
          </section>
        {/if}
      </aside>
    </div>
  </div>
{/if}

<style>
  .server-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(0,0,0,0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .backdrop-close-link {
    position: fixed;
    inset: 0;
    z-index: 0;
  }

  .server-modal {
    position: relative;
    z-index: 1;
    width: min(1220px, 100%);
    max-height: calc(100vh - 32px);
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 16px;
    align-items: stretch;
  }

  .server-video-wrap {
    position: relative;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .server-video-wrap > video {
    max-width: 100%;
    max-height: calc(100vh - 32px);
    border-radius: 12px;
    background: #000;
  }

  .server-info-panel {
    overflow: auto;
    border-radius: 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    padding: 16px;
    color: var(--text-primary);
  }

  .close-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 1201;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.12);
    color: #fff;
  }
  .close-btn:hover { background: rgba(255,255,255,0.2); }
  .close-btn { text-decoration: none; }

  .mute-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(0,0,0,0.55);
    color: #fff;
    display: grid;
    place-items: center;
    z-index: 2;
  }
  .mute-btn:hover { background: rgba(0,0,0,0.75); }

  .info-author { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .author-avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--bg-active); display: flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .author-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .author-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .video-date { font-size: 12px; color: var(--text-secondary); }
  .info-prompt { font-size: 14px; line-height: 1.5; margin-bottom: 18px; white-space: pre-wrap; }
  .section-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
  .cameo-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .cameo-chip {
    padding: 5px 10px; border-radius: 999px; background: var(--pill-bg); color: var(--pill-text); font-size: 12px;
  }
  .info-meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--text-secondary); font-size: 12px; margin-top: 18px; }
  .info-meta span { padding: 4px 8px; border-radius: 999px; background: var(--bg-input); }

  .remix-section {
    margin-top: 20px;
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }

  .remix-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .remix-heading h3 { font-size: 14px; font-weight: 750; margin: 0; }
  .remix-heading span {
    min-width: 24px;
    height: 24px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--bg-input);
    color: var(--text-secondary);
    font-size: 12px;
  }

  .remix-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 44vh;
    overflow: auto;
    padding-right: 3px;
  }

  .remix-row {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    border: 1px solid var(--border);
    background: var(--bg-input);
    border-radius: 12px;
    padding: 8px;
    color: var(--text-primary);
  }
  .remix-row:hover { background: var(--bg-hover); }

  .remix-thumb {
    width: 58px;
    height: 78px;
    object-fit: cover;
    border-radius: 8px;
    background: #050505;
  }

  .remix-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .remix-copy strong { font-size: 12px; }
  .remix-copy span {
    font-size: 12px;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.35;
  }
  .remix-copy small { font-size: 11px; color: var(--text-tertiary); }
  .empty-remixes p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.45; }

  @media (max-width: 900px) {
    .server-backdrop { align-items: flex-start; overflow: auto; }
    .server-modal { grid-template-columns: 1fr; }
    .server-video-wrap > video { max-height: 60vh; }
    .remix-list { max-height: none; }
  }
</style>
