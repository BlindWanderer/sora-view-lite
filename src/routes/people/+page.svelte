<script>
  import { onMount } from 'svelte';

  export let data;
  let q = data.q || '';
  let sort = data.sort || 'videos';
  let people = [...(data.people || [])];
  let routeKey = '';
  let loading = false;
  let hasMore = data.hasMore || false;
  let offset = people.length;
  let sentinel;

  $: {
    const nextKey = `${data.q || ''}|${data.sort || 'videos'}|${data.initialLimit || 100}`;
    if (nextKey !== routeKey) {
      routeKey = nextKey;
      q = data.q || '';
      sort = data.sort || 'videos';
      people = [...(data.people || [])];
      offset = people.length;
      hasMore = data.hasMore || false;
      loading = false;
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const params = new URLSearchParams({
        type: 'people',
        q,
        sort,
        limit: String(data.loadLimit || 250),
        offset: String(offset),
      });
      const res = await fetch(`/api/people-index?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const more = await res.json();
      people = [...people, ...more];
      offset = people.length;
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

  function initials(name) { return String(name || '?').slice(0, 2).toUpperCase(); }
  function avatarColor(name) {
    const colors = ['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#e879f9'];
    let hash = 0;
    for (const c of String(name || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }
  function hrefFor(person) {
    return person.kind === 'character'
      ? `/characters/${encodeURIComponent(person.name)}`
      : `/creators/${encodeURIComponent(person.name)}`;
  }
  function hideBrokenImage(event) { event.currentTarget.style.display = 'none'; }
</script>

<svelte:head><title>People — Sora View</title></svelte:head>

<div class="page-header">
  <h1 class="page-title">People</h1>
  <span class="count">{people.length} loaded</span>
</div>

<form class="filter-wrap" method="GET" action="/people">
  <div class="search-bar">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
    <input type="search" name="q" placeholder="Search creators and characters…" bind:value={q} />
    <select name="sort" bind:value={sort} aria-label="Sort people">
      <option value="videos">Most videos</option>
      <option value="name">Name A–Z</option>
    </select>
    <button class="small-submit" type="submit">Search</button>
  </div>
</form>

{#if people.length === 0}
  <div class="empty-state"><p>No people found.</p></div>
{:else}
  <div class="people-grid">
    {#each people as person (`${person.kind}:${person.name}`)}
      <a href={hrefFor(person)} class="person-card">
        <div class="avatar" style="background: {avatarColor(person.name)}">
          {#if data.personShowImages && person.name}
            <img src="/api/profile-image/{encodeURIComponent(person.name)}" alt="" on:error={hideBrokenImage} />
          {/if}
          <span>{initials(person.display_name || person.name)}</span>
        </div>
        <div class="person-body">
          <div class="person-name">{person.display_name || person.name}</div>
          <div class="person-handle">{person.kind === 'character' ? '@' : ''}{person.name}</div>
          {#if person.owner_username}
            <div class="person-meta">Owner: {person.owner_username}</div>
          {/if}
          <div class="person-meta">{person.video_count} videos · {person.kind}</div>
        </div>
      </a>
    {/each}
  </div>
  <div class="load-wrap" bind:this={sentinel}>
    {#if hasMore}
      <button class="load-more" type="button" on:click={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
    {:else}
      <span class="end-note">End of people</span>
    {/if}
  </div>
{/if}

<style>
  .page-header { padding: 16px 16px 0; display: flex; align-items: center; gap: 10px; }
  .count { font-size: 13px; color: var(--text-secondary); background: var(--bg-input); padding: 2px 8px; border-radius: var(--radius-pill); }
  .filter-wrap { padding: 12px 16px; position: sticky; top: 0; background: var(--bg-primary); z-index: 5; }
  .search-bar { display: flex; align-items: center; gap: 10px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 8px 14px; }
  .search-bar:focus-within { border-color: var(--border-focus); }
  .search-bar input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: 14px; font-family: var(--font); }
  .search-bar select { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-primary); font-size: 12px; padding: 6px 9px; outline: none; }
  .small-submit { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
  .small-submit:hover { color: var(--text-primary); }
  .people-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; padding: 4px 16px 10px; }
  .person-card { display: flex; gap: 12px; align-items: center; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 12px; transition: background 150ms, transform 150ms; }
  .person-card:hover { background: var(--bg-hover); transform: translateY(-1px); }
  .avatar { width: 52px; height: 52px; border-radius: 50%; flex: 0 0 auto; display: grid; place-items: center; color: #fff; font-weight: 800; overflow: hidden; position: relative; }
  .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .avatar span { position: relative; z-index: 0; }
  .person-body { min-width: 0; display: grid; gap: 2px; }
  .person-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .person-handle, .person-meta { color: var(--text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .load-wrap { display: grid; place-items: center; padding: 16px 16px 70px; }
  .load-more { border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--bg-card); color: var(--text-primary); padding: 9px 18px; font-weight: 700; }
  .end-note { color: var(--text-secondary); font-size: 12px; }
  @media (max-width: 600px) { .search-bar { flex-wrap: wrap; } .people-grid { grid-template-columns: 1fr; } }
</style>
