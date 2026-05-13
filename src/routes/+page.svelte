<script>
  import { onMount, tick } from 'svelte';
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let videos  = data.videos;
  let page    = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';
  let isMobileViewport = false;
  let reelRoot;
  let reelObserver;
  const mobileQuery = '(max-width: 760px)';

  $: {
    const nextDataKey = JSON.stringify([data.seed, data.page]);
    if (nextDataKey !== currentDataKey) {
      videos = data.videos;
      page = data.page || 1;
      hasMore = data.hasMore;
      loading = false;
      currentDataKey = nextDataKey;
    }
  }



  $: useMobileReel = data.mobileFeedLayout === 'reel' || ((data.mobileFeedLayout || 'auto') === 'auto' && isMobileViewport);

  function stopReelVideos(except = null) {
    if (!reelRoot) return;
    reelRoot.querySelectorAll('video').forEach((video) => {
      if (except && video === except) return;
      try { video.pause(); } catch {}
    });
  }

  function playReelVideo(video) {
    if (!video) return;
    stopReelVideos(video);
    try {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      if (!video.src && video.dataset.src) video.src = video.dataset.src;
      const attempt = () => video.play().catch(() => {});
      if (video.readyState < 2) {
        video.load?.();
        video.addEventListener('canplay', attempt, { once: true });
      }
      attempt();
    } catch {}
  }

  function playMostVisibleReel() {
    if (!useMobileReel || !reelRoot) return;
    const rootRect = reelRoot.getBoundingClientRect();
    let best = null;
    let bestVisible = 0;
    reelRoot.querySelectorAll('[data-reel-item]').forEach((item) => {
      const rect = item.getBoundingClientRect();
      const visible = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
      if (visible > bestVisible) {
        bestVisible = visible;
        best = item;
      }
    });
    playReelVideo(best?.querySelector('video'));
  }

  async function setupReelObserver() {
    if (!useMobileReel || !reelRoot || typeof IntersectionObserver === 'undefined') return;
    await tick();
    if (reelObserver) reelObserver.disconnect();
    reelObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target.querySelector('video');
        if (!video) continue;
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          playReelVideo(video);
        } else {
          try { video.pause(); } catch {}
        }
      }
    }, { root: reelRoot, threshold: [0, 0.35, 0.6, 0.85] });
    reelRoot.querySelectorAll('[data-reel-item]').forEach((item) => reelObserver.observe(item));
    setTimeout(playMostVisibleReel, 80);
    setTimeout(playMostVisibleReel, 300);
  }

  onMount(() => {
    const mq = window.matchMedia(mobileQuery);
    const update = () => { isMobileViewport = mq.matches; };
    update();
    mq.addEventListener?.('change', update);
    return () => {
      mq.removeEventListener?.('change', update);
      reelObserver?.disconnect();
    };
  });

  $: if (useMobileReel && videos.length) setupReelObserver();
  $: if (!useMobileReel) stopReelVideos();

  function openReelDetails(video) {
    if (typeof window !== 'undefined' && window.SoraViewLightbox?.openById) {
      window.SoraViewLightbox.openById(video.id, { updateHistory: true });
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    page++;
    try {
      const res  = await fetch(`/api/videos?page=${page}&seed=${encodeURIComponent(data.seed)}&mode=${encodeURIComponent(data.mode || 'all')}`);
      const next = await res.json();
      videos  = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  $: nextHref = `/?seed=${encodeURIComponent(data.seed)}&mode=${encodeURIComponent(data.mode || 'all')}&page=${page + 1}`;
</script>

<svelte:head><title>Feed — Sora View</title></svelte:head>

<div class="feed-header" class:mobile-reel-active={useMobileReel}>
  <div>
    <h1 class="feed-title">Feed</h1>
    <div class="stats">
      <span>{data.stats.total.toLocaleString()} videos</span>
      <span>·</span>
      <span>{data.stats.creators.toLocaleString()} creators</span>
      {#if data.stats.chars > 0}
        <span>·</span>
        <span>{data.stats.chars.toLocaleString()} characters</span>
      {/if}
      {#if (data.stats.remix_parent + data.stats.remix_downstream) > 0}
        <span>·</span>
        <span>{(data.stats.remix_parent + data.stats.remix_downstream).toLocaleString()} remixes</span>
      {/if}
    </div>
  </div>
  
  <form method="GET" action="/" data-sveltekit-reload class="mode-form">
    <input type="hidden" name="seed" value={data.seed} />
    <label>
      Feed mode
      <select name="mode">
        <option value="all" selected={data.mode === 'all'}>All videos</option>
        <option value="favorites" selected={data.mode === 'favorites'}>Favorites</option>
        <option value="high_likes" selected={data.mode === 'high_likes'}>Most liked</option>
        <option value="high_views" selected={data.mode === 'high_views'}>Most viewed</option>
        <option value="reviewed" selected={data.mode === 'reviewed'}>Reviewed</option>
      </select>
    </label>
    <button class="btn btn-secondary" type="submit">Apply</button>
  </form>

  <form method="GET" action="/" data-sveltekit-reload>
    <input type="hidden" name="seed" value={Math.floor(Math.random() * 2147483646) + 1} />
    <button class="btn btn-secondary" type="submit">Shuffle</button>
  </form>
</div>

{#if videos.length === 0}
  <div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
    <p>No videos found. Go to <code>/setup/ingest</code> to import or reindex your archive.</p>
  </div>
{:else}
  {#if useMobileReel}
    <div class="mobile-reel-feed" bind:this={reelRoot} on:scroll={playMostVisibleReel} aria-label="Mobile video feed">
      {#each videos as video, i (video.id)}
        <section class="mobile-reel-item" data-reel-item aria-label={video.prompt || video.filename || 'Video'}>
          <video
            src={`/api/video/${video.id}`}
            poster={video.thumbnail_path ? `/api/asset/${video.id}/thumb` : undefined}
            muted
            loop
            playsinline
            controls
            autoplay={i === 0}
            preload={i < 2 ? 'auto' : 'none'}
          ></video>
          <div class="mobile-reel-overlay">
            <div class="mobile-reel-copy">
              {#if video.author}<a href={`/creators/${encodeURIComponent(video.author)}`}>@{video.author}</a>{/if}
              {#if video.prompt}<p>{video.prompt}</p>{/if}
            </div>
            <button type="button" class="mobile-reel-details" on:click={() => openReelDetails(video)}>Details</button>
          </div>
        </section>
      {/each}
      <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
    </div>
  {:else}
    <div class="video-grid">
      {#each videos as video, i (video.id)}
        <VideoCard {video} index={i} />
      {/each}
    </div>

    <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
  {/if}
{/if}

<style>
  .feed-header {
    padding: 16px 16px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .feed-header.mobile-reel-active {
    display: none;
  }

  .feed-title {
    font-size: 20px;
    font-weight: 600;
  }

  .mode-form label { display:flex; align-items:center; gap:8px; color:var(--text-secondary); font-size:12px; }
  .mode-form select { background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:999px; padding:8px 12px; }

  .stats {
    display: flex;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    flex-wrap: wrap;
  }

  code {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    background: var(--bg-input);
    padding: 2px 6px;
    border-radius: 4px;
  }


  .mobile-reel-feed {
    display: grid;
    gap: 0;
    height: calc(100dvh - 64px);
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    overscroll-behavior-y: contain;
    background: #000;
  }

  .mobile-reel-item {
    position: relative;
    height: calc(100dvh - 64px);
    min-height: 520px;
    scroll-snap-align: start;
    overflow: hidden;
    background: #000;
  }

  .mobile-reel-item video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  .mobile-reel-overlay {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding: 72px 14px 18px;
    background: linear-gradient(to top, rgba(0,0,0,.78), transparent);
    color: #fff;
    pointer-events: none;
  }

  .mobile-reel-copy {
    min-width: 0;
    display: grid;
    gap: 6px;
  }

  .mobile-reel-copy a {
    color: #fff;
    font-weight: 850;
    text-decoration: none;
    pointer-events: auto;
  }

  .mobile-reel-copy p {
    max-height: 4.2em;
    overflow: hidden;
    color: rgba(255,255,255,.92);
    font-size: 13px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .mobile-reel-details {
    flex: 0 0 auto;
    border: 1px solid rgba(255,255,255,.24);
    background: rgba(255,255,255,.16);
    color: #fff;
    border-radius: 999px;
    padding: 9px 12px;
    font-weight: 800;
    pointer-events: auto;
    backdrop-filter: blur(8px);
  }

  @media (min-width: 761px) {
    .mobile-reel-feed { display: none; }
  }

</style>
