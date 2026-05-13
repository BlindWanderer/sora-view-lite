<script>
  import { onMount } from 'svelte';

  export let data;

  let q = data.q || '';
  let sort = data.sort || 'videos';
  let creators = [...(data.creators || [])];
  let routeKey = '';
  let loading = false;
  let hasMore = data.hasMore || false;
  let offset = creators.length;
  let sentinel;

  $: {
    const nextKey = `${data.q || ''}|${data.sort || 'videos'}|${data.initialLimit || 100}`;
    if (nextKey !== routeKey) {
      routeKey = nextKey;
      q = data.q || '';
      sort = data.sort || 'videos';
      creators = [...(data.creators || [])];
      offset = creators.length;
      hasMore = data.hasMore || false;
      loading = false;
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const params = new URLSearchParams({
        type: 'creators',
        q,
        sort,
        limit: String(data.loadLimit || 250),
        offset: String(offset),
      });
      const res = await fetch(`/api/people-index?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const more = await res.json();
      creators = [...creators, ...more];
      offset = creators.length;
      hasMore = more.length >= Number(data.loadLimit || 250);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: '700px 0px' });
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function initials(name) {
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  function avatarColor(name) {
    const colors = ['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8'];
    let hash = 0;
    for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }

  function hideBrokenImage(event) {
    event.currentTarget.style.display = 'none';
  }
</script>

<svelte:head><title>Creators — Sora View</title></svelte:head>

<div class="page-header">
  <h1 class="page-title">Creators</h1>
  <span class="count">{creators.length} loaded</span>
</div>

<form class="filter-wrap" method="GET" action="/creators">
  <div class="search-bar">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
    <input type="search" name="q" placeholder="Filter creators…" bind:value={q} />
    <select name="sort" bind:value={sort} aria-label="Sort creators">
      <option value="videos">Most videos</option>
      <option value="name">Name A–Z</option>
    </select>
    <button class="small-submit" type="submit">Search</button>
  </div>
</form>

{#if creators.length === 0}
  <div class="empty-state">
    <p>No creators found.</p>
  </div>
{:else}
  <ul class="creators-list">
    {#each creators as creator (creator.author)}
      <li>
        <a href="/creators/{encodeURIComponent(creator.author)}" class="creator-row">
          <div class="avatar" style="background: {avatarColor(creator.author)}">
            {#if data.personShowImages && creator.author}
              <img src="/api/profile-image/{encodeURIComponent(creator.author)}" alt="" on:error={hideBrokenImage} />
            {/if}
            <span>{initials(creator.author)}</span>
          </div>
          <div class="creator-info">
            <span class="creator-name">{creator.display_name || creator.author}</span>
            <span class="creator-meta">{creator.video_count} videos · {creator.latest_date || ''}</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </a>
      </li>
    {/each}
  </ul>
  <div class="load-wrap" bind:this={sentinel}>
    {#if hasMore}
      <button class="load-more" type="button" on:click={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
    {:else}
      <span class="end-note">End of creators</span>
    {/if}
  </div>
{/if}

<style>
  .page-header {
    padding: 16px 16px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .count {
    font-size: 13px;
    color: var(--text-secondary);
    background: var(--bg-input);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
  }

  .filter-wrap {
    padding: 12px 16px;
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 5;
  }

  .search-bar {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: var(--radius-pill); padding: 8px 14px;
  }
  .search-bar:focus-within { border-color: var(--border-focus); }
  .search-bar input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: 14px; font-family: var(--font); }
  .search-bar select { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-primary); font-size: 12px; padding: 6px 9px; outline: none; }
  .search-bar input::placeholder { color: var(--text-secondary); }
  .search-bar svg { color: var(--text-secondary); }
  .small-submit { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
  .small-submit:hover { color: var(--text-primary); }

  .creators-list { list-style: none; padding: 0 8px; }

  .creator-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    border-radius: 10px;
    transition: background 150ms;
  }
  .creator-row:hover { background: var(--bg-hover); }

  .avatar {
    width: 44px; height: 44px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 16px;
    color: #fff;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
  }
  .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .avatar span { position: relative; z-index: 0; }

  .creator-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .creator-name {
    font-weight: 600;
    font-size: 14px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .creator-meta {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .chevron { color: var(--text-tertiary); flex-shrink: 0; }
  .load-wrap { display: grid; place-items: center; padding: 16px 16px 70px; }
  .load-more { border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--bg-card); color: var(--text-primary); padding: 9px 18px; font-weight: 700; }
  .end-note { color: var(--text-secondary); font-size: 12px; }
</style>
