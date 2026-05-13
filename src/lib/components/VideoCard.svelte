<script>
  export let video;
  export let index  = 0;

  let hovered  = false;
  let videoEl;
  let previewImageFailed = false;

  function serializeVideo(value) {
    return JSON.stringify(value ?? {});
  }

  function isImagePreview(path = '') {
    return /\.(gif|webp|png|jpe?g)$/i.test(String(path));
  }


  function compactCount(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return String(n);
  }

  function buildStats(value) {
    if (!value) return [];
    return [
      { key: 'views', label: 'views', icon: '👁', value: compactCount(value.view_count) },
      { key: 'likes', label: 'likes', icon: '♥', value: compactCount(value.like_count) },
      { key: 'remixes', label: 'remixes', icon: '↻', value: compactCount(value.remix_count) },
      { key: 'shares', label: 'shares', icon: '↗', value: compactCount(value.share_count) },
      { key: 'replies', label: 'replies', icon: '💬', value: compactCount(value.reply_count) }
    ].filter((item) => item.value);
  }

  $: src = `/api/video/${video.id}`;
  $: thumbSrc = video.thumbnail_path ? `/api/asset/${video.id}/thumb` : '';
  $: previewSrc = video.preview_path ? `/api/asset/${video.id}/preview` : '';
  $: useImagePreview = previewSrc && isImagePreview(video.preview_path) && !previewImageFailed;
  $: hoverVideoSrc = useImagePreview ? '' : (previewSrc || src);
  $: stats = buildStats(video);

  $: if (video?.id) {
    previewImageFailed = false;
  }

  function handleMouseEnter() {
    hovered = true;
    if (!useImagePreview) videoEl?.play().catch(() => {});
  }

  function handleMouseLeave() {
    hovered = false;
    if (videoEl) { videoEl.pause(); videoEl.currentTime = 0; }
  }

  function handlePreviewImageError() {
    previewImageFailed = true;
    if (hovered) setTimeout(() => videoEl?.play().catch(() => {}), 0);
  }

  function openLightbox(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof window !== 'undefined' && window.SoraViewLightbox?.openFromCard) {
      window.SoraViewLightbox.openFromCard(event.currentTarget, { updateHistory: true });
    }
  }
</script>

<button
  type="button"
  class="card"
  data-sora-video-card
  data-video-id={video.id}
  data-video-index={index}
  data-video-json={serializeVideo(video)}
  on:click={openLightbox}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  aria-label={video.prompt || video.filename}
>
  <div class="media">
    {#if thumbSrc}
      <img class="thumb" src={thumbSrc} alt="" class:hidden={hovered} loading="lazy" />
    {:else}
      <div class="placeholder" class:hidden={hovered}></div>
    {/if}

    {#if useImagePreview}
      <img
        class="preview-img"
        src={previewSrc}
        alt=""
        class:visible={hovered}
        loading="lazy"
        on:error={handlePreviewImageError}
      />
    {:else}
      <video
        bind:this={videoEl}
        src={hoverVideoSrc}
        preload="none"
        loop
        muted
        playsinline
        class:visible={hovered}
      ></video>
    {/if}

    <div class="overlay">
      {#if video.author}
        <span class="author">{video.author}</span>
      {/if}
      {#if video.duration_s}
        <span class="duration">{Math.round(video.duration_s)}s</span>
      {/if}
    </div>

    {#if video.local_favorite || video.reviewed}
      <div class="video-card-flags" aria-label="Local flags">
        {#if video.local_favorite}<span class="video-card-flag" title="Favorite">★</span>{/if}
        {#if video.reviewed}<span class="video-card-flag" title="Reviewed">✓</span>{/if}
      </div>
    {/if}

    {#if stats.length}
      <div class="card-stats" aria-label="Video stats">
        {#each stats as stat}
          <span class="card-stat" aria-label={`${stat.value} ${stat.label}`}>
            <span title={stat.label} aria-label={stat.label}>{stat.icon}</span>
            <span>{stat.value}</span>
          </span>
        {/each}
      </div>
    {/if}

    {#if !hovered}
      <div class="play-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.14v14l11-7-11-7z"/>
        </svg>
      </div>
    {/if}
  </div>

  {#if video.prompt}
    <p class="prompt truncate">{video.prompt}</p>
  {/if}

</button>

<style>
  .card {
    position: relative;
    display: block;
    width: 100%;
    border: 0;
    padding: 0;
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    appearance: none;
    transition: transform 120ms ease, box-shadow 120ms ease;
    outline: none;
  }

  .card:hover,
  .card:focus-visible {
    transform: scale(1.02);
    box-shadow: var(--shadow);
    z-index: 2;
  }

  .card:focus-visible {
    box-shadow: 0 0 0 2px var(--border-focus), var(--shadow);
  }

  .media {
    position: relative;
    aspect-ratio: 9 / 16;
    background: var(--bg-card);
    overflow: hidden;
  }

  .thumb,
  .preview-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb.hidden { opacity: 0; }

  .preview-img {
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .preview-img.visible { opacity: 1; }

  .placeholder {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
    animation: pulse 2s ease-in-out infinite;
  }
  .placeholder.hidden { opacity: 0; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  video.visible { opacity: 1; }

  .overlay {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 24px 8px 6px;
    background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 4px;
    pointer-events: none;
  }

  .author {
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70%;
  }

  .duration {
    font-size: 11px;
    color: rgba(255,255,255,0.8);
    flex-shrink: 0;
  }

  .play-icon {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255,255,255,0.7);
    opacity: 0;
    transition: opacity 150ms ease;
    pointer-events: none;
  }

  .card:hover .play-icon { opacity: 1; }

  .prompt {
    padding: 6px 8px 2px;
    font-size: 12px;
    color: var(--text-secondary);
    max-height: 36px;
  }

  .card-stats {
    position: absolute;
    top: 7px;
    right: 7px;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: calc(100% - 14px);
    color: #fff;
    pointer-events: none;
    z-index: 3;
  }

  .card-stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 20px;
    padding: 3px 6px;
    border-radius: 999px;
    background: rgba(0,0,0,0.58);
    border: 1px solid rgba(255,255,255,0.18);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    backdrop-filter: blur(8px);
  }
</style>
