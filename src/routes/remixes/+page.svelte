<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let videos = data.videos;
  let page = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';

  $: {
    const nextDataKey = JSON.stringify([data.page]);
    if (nextDataKey !== currentDataKey) {
      videos = data.videos;
      page = data.page || 1;
      hasMore = data.hasMore;
      loading = false;
      currentDataKey = nextDataKey;
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    page++;
    try {
      const res = await fetch(`/api/videos?type=remix_parents&page=${page}`);
      const next = await res.json();
      videos = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  $: nextHref = `/remixes?page=${page + 1}`;
</script>

<svelte:head><title>Remixed Videos — Sora View</title></svelte:head>

<div class="feed-header">
  <div>
    <h1 class="feed-title">Remixed Videos</h1>
    <div class="stats">
      <span>{data.stats.remix_parent.toLocaleString()} parent videos</span>
      <span>·</span>
      <span>{data.stats.remix_downstream.toLocaleString()} downstream remixes</span>
    </div>
  </div>
</div>

{#if videos.length === 0}
  <div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
    <p>No remix parent videos were found. Re-run import after confirming your vault includes <code>sora_v2_remixes/parents</code>.</p>
  </div>
{:else}
  <div class="video-grid">
    {#each videos as video, i (video.id)}
      <VideoCard {video} index={i} />
    {/each}
  </div>

  <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
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
  .feed-title { font-size: 20px; font-weight: 600; }
  .stats { display: flex; gap: 6px; font-size: 13px; color: var(--text-secondary); flex-wrap: wrap; }
  code { font-family: ui-monospace, monospace; font-size: 12px; background: var(--bg-input); padding: 2px 6px; border-radius: 4px; }
</style>
