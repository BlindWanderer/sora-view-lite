<script>
  import { onMount } from 'svelte';

  export let data;

  let q = data.q || '';
  let characters = [...(data.characters || [])];
  let routeKey = '';
  let loading = false;
  let hasMore = data.hasMore || false;
  let offset = characters.length;
  let sentinel;

  $: {
    const nextKey = `${data.q || ''}|${data.initialLimit || 100}`;
    if (nextKey !== routeKey) {
      routeKey = nextKey;
      q = data.q || '';
      characters = [...(data.characters || [])];
      offset = characters.length;
      hasMore = data.hasMore || false;
      loading = false;
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const params = new URLSearchParams({
        type: 'characters',
        q,
        limit: String(data.loadLimit || 250),
        offset: String(offset),
      });
      const res = await fetch(`/api/people-index?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const more = await res.json();
      characters = [...characters, ...more];
      offset = characters.length;
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

  function avatarColor(name) {
    const colors = ['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#e879f9'];
    let hash = 0;
    for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }

  function initials(name) { return String(name || '?').slice(0, 2).toUpperCase(); }

  function hideBrokenImage(event) {
    event.currentTarget.style.display = 'none';
  }
</script>

<svelte:head><title>Characters — Sora View</title></svelte:head>

<div class="page-header">
  <h1 class="page-title">Characters</h1>
  <span class="count">{characters.length} loaded</span>
</div>

<form class="filter-wrap" method="GET" action="/characters">
  <div class="search-bar">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
    <input type="search" name="q" placeholder="Filter characters…" bind:value={q} />
    <button class="small-submit" type="submit">Search</button>
  </div>
</form>

{#if characters.length === 0 && !q}
  <div class="empty-state">
    <p>No characters found. Characters are @mentions in video prompts.</p>
  </div>
{:else if characters.length === 0}
  <div class="empty-state"><p>No characters match.</p></div>
{:else}
  <div class="chars-grid">
    {#each characters as char (char.character_name)}
      <a href="/characters/{encodeURIComponent(char.character_name)}" class="char-card">
        <div class="char-avatar" style="background: {avatarColor(char.character_name)}">
          {#if data.personShowImages && char.character_name}
            <img src="/api/profile-image/{encodeURIComponent(char.character_name)}" alt="" on:error={hideBrokenImage} />
          {/if}
          <span>{initials(char.display_name || char.character_name)}</span>
        </div>
        <div class="char-name">@{char.display_name || char.character_name}</div>
        <div class="char-count">{char.cast_count} videos</div>
      </a>
    {/each}
  </div>
  <div class="load-wrap" bind:this={sentinel}>
    {#if hasMore}
      <button class="load-more" type="button" on:click={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
    {:else}
      <span class="end-note">End of characters</span>
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
  .search-bar input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text-primary); font-size: 14px; font-family: var(--font);
  }
  .search-bar input::placeholder { color: var(--text-secondary); }
  .search-bar svg { color: var(--text-secondary); }
  .small-submit { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
  .small-submit:hover { color: var(--text-primary); }

  .chars-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 12px;
    padding: 4px 16px 10px;
  }

  @media (min-width: 600px) {
    .chars-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  }

  .char-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 8px;
    border-radius: 14px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    text-align: center;
    transition: background 150ms, transform 150ms;
  }
  .char-card:hover { background: var(--bg-hover); transform: translateY(-1px); }

  .char-avatar {
    width: 56px; height: 56px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 18px;
    overflow: hidden;
    position: relative;
  }
  .char-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .char-avatar span { position: relative; z-index: 0; }

  .char-name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
  .char-count { color: var(--text-secondary); font-size: 12px; }
  .load-wrap { display: grid; place-items: center; padding: 16px 16px 70px; }
  .load-more { border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--bg-card); color: var(--text-primary); padding: 9px 18px; font-weight: 700; }
  .end-note { color: var(--text-secondary); font-size: 12px; }
</style>
