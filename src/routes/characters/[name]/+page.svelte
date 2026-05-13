<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let videos  = data.videos;
  let page    = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';
  let showingAllCreators = false;
  let showingAllCoStars = false;
  let loadingCreators = false;
  let loadingCoStars = false;
  let allCreators = [];
  let allCoStars = [];

  $: info = data.info || {};
  $: coStars = showingAllCoStars ? allCoStars : (data.coStars || []);
  $: creators = showingAllCreators ? allCreators : (data.creators || []);

  $: {
    const nextDataKey = JSON.stringify([data.name, data.page]);
    if (nextDataKey !== currentDataKey) {
      videos = data.videos;
      page = data.page || 1;
      hasMore = data.hasMore;
      loading = false;
      showingAllCreators = false;
      showingAllCoStars = false;
      allCreators = [];
      allCoStars = [];
      currentDataKey = nextDataKey;
    }
  }

  function avatarColor(name) {
    const colors = ['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#e879f9'];
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }
  function fmt(n) { return new Intl.NumberFormat().format(Number(n || 0)); }
  function hideBrokenImage(event) { event.currentTarget.style.display = 'none'; }

  $: nextHref = `/characters/${encodeURIComponent(data.name)}?page=${page + 1}`;



  async function showAllCreators() {
    if (loadingCreators) return;
    loadingCreators = true;
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(data.name)}/insights?type=creators&limit=1000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allCreators = await res.json();
      showingAllCreators = true;
    } catch (e) { console.error(e); }
    finally { loadingCreators = false; }
  }

  async function showAllCoStars() {
    if (loadingCoStars) return;
    loadingCoStars = true;
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(data.name)}/insights?type=costars&limit=1000`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allCoStars = await res.json();
      showingAllCoStars = true;
    } catch (e) { console.error(e); }
    finally { loadingCoStars = false; }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    page++;
    try {
      const res  = await fetch(`/api/videos?type=character&character=${encodeURIComponent(data.name)}&page=${page}`);
      const next = await res.json();
      videos  = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }
</script>

<svelte:head><title>@{data.name} — Sora View</title></svelte:head>

<div class="char-header">
  <a href="/characters" class="back-btn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    Characters
  </a>

  <div class="char-hero">
    <div class="char-avatar" style="background: {avatarColor(data.name)}">
      <img src="/api/profile-image/{encodeURIComponent(data.name)}" alt="" on:error={hideBrokenImage} />
      <span>{(info.display_name || data.name).slice(0, 2).toUpperCase()}</span>
    </div>
    <div class="char-meta">
      <h1 class="char-name">{info.display_name || `@${data.name}`}</h1>
      <p class="char-handle">@{data.name}</p>
      {#if info.owner_username}<p class="char-stats">Owner: <a href="/creators/{encodeURIComponent(info.owner_username)}">{info.owner_username}</a></p>{/if}
      <p class="char-stats">{fmt(info.cast_count)} videos</p>
    </div>
  </div>

  <div class="insight-grid">
    {#if creators.length}
      <section>
        <h2>Used by creators</h2>
        <div class="chip-list">
          {#each creators as creator}
            <a href="/creators/{encodeURIComponent(creator.author)}">{creator.display_name || creator.author}<small>{fmt(creator.video_count)}</small></a>
          {/each}
        </div>
        {#if !showingAllCreators && creators.length >= 25}
          <button type="button" class="see-all-btn" on:click={showAllCreators} disabled={loadingCreators}>{loadingCreators ? 'Loading…' : 'See all creators'}</button>
        {/if}
      </section>
    {/if}
    {#if coStars.length}
      <section>
        <h2>Appears with</h2>
        <div class="chip-list">
          {#each coStars as star}
            <a href="/characters/{encodeURIComponent(star.character_name)}">@{star.character_name}<small>{fmt(star.shared_count)}</small></a>
          {/each}
        </div>
        {#if !showingAllCoStars && coStars.length >= 25}
          <button type="button" class="see-all-btn" on:click={showAllCoStars} disabled={loadingCoStars}>{loadingCoStars ? 'Loading…' : 'See all appearances'}</button>
        {/if}
      </section>
    {/if}
  </div>

  <div class="tab-bar"><button class="tab-btn active">Videos</button></div>
</div>

{#if videos.length === 0}
  <div class="empty-state"><p>No videos found featuring @{data.name}.</p></div>
{:else}
  <div class="video-grid">
    {#each videos as video, i (video.id)}
      <VideoCard {video} index={i} />
    {/each}
  </div>
  <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
{/if}

<style>
  .char-header { padding: 12px 16px 0; }
  .back-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 13px; padding: 4px 0; transition: color 150ms; }
  .back-btn:hover { color: var(--text-primary); }
  .char-hero { display: flex; align-items: center; gap: 16px; padding: 20px 0; }
  .char-avatar { width: 80px; height: 80px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 28px; color: #fff; flex-shrink: 0; overflow:hidden; position:relative; }
  .char-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .char-avatar span { position:relative; z-index:0; }
  @media (min-width: 769px) { .char-hero { flex-direction: column; justify-content: center; padding: 32px 0 20px; } .char-header { display: flex; flex-direction: column; align-items: center; } .back-btn { align-self: flex-start; } .tab-bar { width: 100%; } }
  .char-meta { display: flex; flex-direction: column; gap: 4px; align-items:center; text-align:center; }
  .char-name { font-size: 22px; font-weight: 700; }
  .char-handle, .char-stats { font-size: 14px; color: var(--text-secondary); }
  .char-stats a { color: var(--text-primary); }
  .insight-grid { width:100%; display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; margin-bottom:12px; }
  .insight-grid section { border:1px solid var(--border); background:var(--bg-card); border-radius:16px; padding:14px; }
  .insight-grid h2 { font-size:15px; margin:0 0 10px; }
  .chip-list { display:flex; flex-wrap:wrap; gap:8px; }
  .chip-list a { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border); background:var(--pill-bg); color:var(--pill-text); border-radius:999px; padding:6px 9px; font-size:12px; }
  .chip-list small { opacity:.7; }
  .see-all-btn { margin-top:10px; border:1px solid var(--border); background:var(--bg-hover); color:var(--text-primary); border-radius:999px; padding:7px 11px; font-size:12px; font-weight:700; }
  .see-all-btn:disabled { opacity:.6; cursor:wait; }
  .tab-bar { display: flex; width: 100%; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
  .tab-btn { flex: 1; max-width: 160px; padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--text-secondary); border-bottom: 2px solid transparent; text-align: center; }
  .tab-btn.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
</style>
