<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  export let data;
  const formatter = new Intl.NumberFormat();
  function fmt(n) { return formatter.format(Number(n || 0)); }
</script>

<svelte:head><title>Videos with comments — Sora View Lite</title></svelte:head>

<div class="page-wrap">
  <header class="page-header">
    <h1 class="page-title">Videos with comments</h1>
    <p class="subtitle">
      {fmt(data.total)} {data.total === 1 ? 'video' : 'videos'} have at least one comment, sorted by comment count.
    </p>
  </header>
  <div class="video-grid">
    {#each data.videos as video, i}
      <VideoCard {video} index={i} />
    {/each}
  </div>
  {#if data.hasMore}
    <div class="more-row">
      <a class="more-link" href="?page={data.page + 1}">Load more →</a>
    </div>
  {/if}
</div>

<style>
  .page-wrap { padding: 16px 16px 90px; }
  .subtitle { color: var(--text-secondary); font-size: 14px; }
  .more-row { display: flex; justify-content: center; margin-top: 24px; }
  .more-link {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 10px 18px;
    background: var(--pill-bg);
    color: var(--pill-text);
    font-weight: 700;
    font-size: 13px;
    text-decoration: none;
  }
  .more-link:hover { background: var(--bg-hover); }
</style>
