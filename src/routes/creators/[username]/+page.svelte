<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let videos  = data.videos;
  let page    = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';

  $: tab = data.tab || 'videos';
  $: info = data.info || {};
  $: characters = data.characters || [];

  $: {
    const nextDataKey = JSON.stringify([data.username, data.page, data.tab]);
    if (nextDataKey !== currentDataKey) {
      videos = data.videos;
      page = data.page || 1;
      hasMore = data.hasMore;
      loading = false;
      currentDataKey = nextDataKey;
    }
  }

  function initials(name) { return (name || '?').slice(0, 2).toUpperCase(); }
  function avatarColor(name) {
    const colors = ['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8'];
    let hash = 0;
    for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }
  function fmt(n) { return n == null ? '' : new Intl.NumberFormat().format(Number(n || 0)); }
  function hideBrokenImage(event) { event.currentTarget.style.display = 'none'; }

  $: nextHref = `/creators/${encodeURIComponent(data.username)}?tab=${encodeURIComponent(tab)}&page=${page + 1}`;

  async function loadMore() {
    if (loading || !hasMore || tab !== 'videos') return;
    loading = true;
    page++;
    try {
      const res  = await fetch(`/api/videos?type=creator&author=${encodeURIComponent(data.username)}&page=${page}`);
      const next = await res.json();
      videos  = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }
</script>

<svelte:head><title>{data.username} — Sora View</title></svelte:head>

<div class="creator-header">
  <a href="/creators" class="back-btn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    Creators
  </a>

  <div class="creator-hero">
    <div class="creator-avatar" style="background: {avatarColor(data.username)}">
      <img src="/api/profile-image/{encodeURIComponent(data.username)}" alt="" on:error={hideBrokenImage} />
      <span>{initials(info.display_name || data.username)}</span>
    </div>
    <h1 class="creator-name">{info.display_name || data.username}</h1>
    <p class="creator-handle">@{data.username}</p>
    {#if info.description}
      <p class="creator-description">{info.description}</p>
    {/if}
    <div class="creator-stats-row">
      <span>{fmt(info.video_count)} archive videos</span>
      {#if info.post_count != null}<span>{fmt(info.post_count)} Sora posts</span>{/if}
      {#if info.likes_received_count != null}<span>{fmt(info.likes_received_count)} likes received</span>{/if}
      {#if info.remix_count != null}<span>{fmt(info.remix_count)} remixes</span>{/if}
      {#if info.character_count != null}<span>{fmt(info.character_count)} characters</span>{/if}
    </div>
  </div>

  <div class="tab-bar">
    <a class:active={tab === 'videos'} href="/creators/{encodeURIComponent(data.username)}?tab=videos">Videos</a>
    <a class:active={tab === 'characters'} href="/creators/{encodeURIComponent(data.username)}?tab=characters">Characters used <small>{characters.length}</small></a>
    <a class:active={tab === 'stats'} href="/creators/{encodeURIComponent(data.username)}?tab=stats">Stats</a>
  </div>
</div>

{#if tab === 'characters'}
  {#if characters.length === 0}
    <div class="empty-state"><p>No characters used by this creator were found yet.</p></div>
  {:else}
    <div class="character-grid">
      {#each characters as char (char.character_name)}
        <a class="character-card" href="/characters/{encodeURIComponent(char.character_name)}">
          <div class="mini-avatar" style="background: {avatarColor(char.character_name)}">
            <img src="/api/profile-image/{encodeURIComponent(char.character_name)}" alt="" on:error={hideBrokenImage} />
            <span>{initials(char.display_name || char.character_name)}</span>
          </div>
          <div>
            <strong>{char.display_name || `@${char.character_name}`}</strong>
            <span>@{char.character_name}</span>
            {#if char.owner_username}<em>Owner: {char.owner_username}</em>{/if}
            <small>{fmt(char.video_count)} videos · latest {char.latest_date || 'unknown'}</small>
          </div>
        </a>
      {/each}
    </div>
  {/if}
{:else if tab === 'stats'}
  <section class="stats-panel">
    <h2>Creator metadata</h2>
    <dl>
      <div><dt>Archive videos</dt><dd>{fmt(info.video_count)}</dd></div>
      {#if info.latest_date}<div><dt>Latest archived video</dt><dd>{info.latest_date}</dd></div>{/if}
      {#if info.follower_count != null}<div><dt>Followers</dt><dd>{fmt(info.follower_count)}</dd></div>{/if}
      {#if info.following_count != null}<div><dt>Following</dt><dd>{fmt(info.following_count)}</dd></div>{/if}
      {#if info.post_count != null}<div><dt>Sora post count</dt><dd>{fmt(info.post_count)}</dd></div>{/if}
      {#if info.reply_count != null}<div><dt>Replies</dt><dd>{fmt(info.reply_count)}</dd></div>{/if}
      {#if info.likes_received_count != null}<div><dt>Likes received</dt><dd>{fmt(info.likes_received_count)}</dd></div>{/if}
      {#if info.remix_count != null}<div><dt>Remix count</dt><dd>{fmt(info.remix_count)}</dd></div>{/if}
      {#if info.cameo_count != null}<div><dt>Cameo count</dt><dd>{fmt(info.cameo_count)}</dd></div>{/if}
      {#if info.character_count != null}<div><dt>Character count</dt><dd>{fmt(info.character_count)}</dd></div>{/if}
    </dl>
  </section>
{:else}
  {#if videos.length === 0}
    <div class="empty-state"><p>No videos found for this creator.</p></div>
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
  .creator-header { padding: 12px 16px 0; }
  .back-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 13px; padding: 4px 0; transition: color 150ms; }
  .back-btn:hover { color: var(--text-primary); }
  .creator-hero { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 0 16px; text-align: center; }
  .creator-avatar { width: 80px; height: 80px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 28px; color: #fff; overflow: hidden; position: relative; }
  .creator-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .creator-avatar span { position:relative; z-index:0; }
  .creator-name { font-size: 22px; font-weight: 700; }
  .creator-handle { color: var(--text-secondary); font-size: 13px; }
  .creator-description { max-width: 620px; color: var(--text-secondary); line-height: 1.45; font-size: 14px; }
  .creator-stats-row { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:4px; }
  .creator-stats-row span { border:1px solid var(--border); background:var(--bg-card); border-radius:999px; padding:5px 9px; font-size:12px; color:var(--text-secondary); }
  .tab-bar { display:flex; border-bottom:1px solid var(--border); margin-top:4px; }
  .tab-bar a { padding:10px 16px; color:var(--text-secondary); border-bottom:2px solid transparent; font-weight:650; font-size:14px; }
  .tab-bar a.active { color:var(--text-primary); border-bottom-color:var(--text-primary); }
  .tab-bar small { opacity:.75; }
  .character-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px,1fr)); gap:12px; padding:16px; }
  .character-card { display:flex; gap:12px; align-items:center; border:1px solid var(--border); background:var(--bg-card); border-radius:16px; padding:12px; }
  .character-card:hover { background:var(--bg-hover); }
  .character-card div:last-child { display:grid; gap:2px; min-width:0; }
  .character-card strong, .character-card span, .character-card em, .character-card small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .character-card span, .character-card em, .character-card small { color:var(--text-secondary); font-size:12px; font-style:normal; }
  .mini-avatar { width:48px; height:48px; border-radius:50%; display:grid; place-items:center; flex:0 0 auto; color:#fff; font-weight:800; overflow:hidden; position:relative; }
  .mini-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .mini-avatar span { position:relative; z-index:0; }
  .stats-panel { margin:16px; border:1px solid var(--border); background:var(--bg-card); border-radius:16px; padding:18px; }
  .stats-panel h2 { font-size:17px; margin:0 0 12px; }
  dl { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:10px; margin:0; }
  dl div { border:1px solid var(--border); background:var(--bg-panel); border-radius:12px; padding:12px; }
  dt { color:var(--text-secondary); font-size:12px; } dd { margin:4px 0 0; font-weight:800; }
</style>
