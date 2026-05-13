<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let q         = data.q;
  let author    = data.author;
  let dateFrom  = data.dateFrom;
  let dateTo    = data.dateTo;
  let character = data.character;
  let minLikes  = data.minLikes || '';
  let minViews  = data.minViews || '';

  let videos  = data.videos;
  let page    = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';

  // SvelteKit reuses this component during client-side GET form navigation.
  // Keep local UI state synchronized with freshly loaded server data; otherwise
  // the URL changes and __data.json loads, but the old empty result array stays visible.
  $: {
    const nextDataKey = JSON.stringify([
      data.q,
      data.author,
      data.dateFrom,
      data.dateTo,
      data.character,
      data.minLikes,
      data.minViews,
      data.page
    ]);

    if (nextDataKey !== currentDataKey) {
      q         = data.q;
      author    = data.author;
      dateFrom  = data.dateFrom;
      dateTo    = data.dateTo;
      character = data.character;
      minLikes  = data.minLikes || '';
      minViews  = data.minViews || '';
      videos    = data.videos;
      page      = data.page || 1;
      hasMore   = data.hasMore;
      loading   = false;
      currentDataKey = nextDataKey;
    }
  }

  function buildParams(p = 1) {
    const params = new URLSearchParams();
    if (q)         params.set('q', q);
    if (author)    params.set('author', author);
    if (dateFrom)  params.set('dateFrom', dateFrom);
    if (dateTo)    params.set('dateTo', dateTo);
    if (character) params.set('character', character);
    if (minLikes)  params.set('minLikes', minLikes);
    if (minViews)  params.set('minViews', minViews);
    params.set('page', String(p));
    return params;
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    page++;
    try {
      const params = buildParams(page);
      params.set('type', 'search');
      const res  = await fetch(`/api/videos?${params}`);
      const next = await res.json();
      videos  = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }

  $: hasQuery = !!(q || author || dateFrom || dateTo || character || minLikes || minViews);
  $: hasAdvancedFilters = !!(author || dateFrom || dateTo || character || minLikes || minViews);
  $: nextHref = `/search?${buildParams(page + 1).toString()}`;
</script>

<svelte:head><title>Search — Sora View</title></svelte:head>

<div class="search-page">
  <form class="search-top" method="GET" action="/search">
    <div class="search-bar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <input
        type="search"
        name="q"
        placeholder="Search prompts, creators…"
        bind:value={q}
        autofocus
      />
    </div>

    <details class="filters-panel" open={hasAdvancedFilters}>
      <summary>Filters</summary>
      <div class="filters">
        <div class="filter-row">
          <label class="filter-label">
            Creator
            <input class="filter-input" name="author" type="text" bind:value={author} placeholder="username" />
          </label>
          <label class="filter-label">
            Character
            <input class="filter-input" name="character" type="text" bind:value={character} placeholder="@name" />
          </label>
        </div>
        <div class="filter-row">
          <label class="filter-label">
            From
            <input class="filter-input" name="dateFrom" type="date" bind:value={dateFrom} />
          </label>
          <label class="filter-label">
            To
            <input class="filter-input" name="dateTo" type="date" bind:value={dateTo} />
          </label>
        </div>
        <div class="filter-row">
          <label class="filter-label">
            Minimum likes
            <input class="filter-input" name="minLikes" type="number" min="0" step="1" bind:value={minLikes} placeholder="≥ likes" />
          </label>
          <label class="filter-label">
            Minimum views
            <input class="filter-input" name="minViews" type="number" min="0" step="1" bind:value={minViews} placeholder="≥ views" />
          </label>
        </div>
      </div>
    </details>

    <button class="btn btn-primary search-btn" type="submit">Search</button>
  </form>

  {#if !hasQuery}
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <p>Search for videos by prompt, creator, or character.</p>
    </div>
  {:else if videos.length === 0}
    <div class="empty-state">
      <p>No results found.</p>
    </div>
  {:else}
    <div class="result-count">Showing {videos.length} result{videos.length === 1 ? '' : 's'}</div>
    <div class="video-grid">
      {#each videos as video, i (video.id)}
        <VideoCard {video} index={i} />
      {/each}
    </div>
    <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
  {/if}
</div>

<style>
  .search-page { display: flex; flex-direction: column; min-height: 100vh; }

  .search-top {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 10;
    border-bottom: 1px solid var(--border);
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    padding: 10px 16px;
    transition: border-color 150ms;
  }
  .search-bar:focus-within { border-color: var(--border-focus); }
  .search-bar input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text-primary); font-size: 15px; font-family: var(--font);
  }
  .search-bar input::placeholder { color: var(--text-secondary); }
  .search-bar svg { color: var(--text-secondary); flex-shrink: 0; }

  .filters-panel summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    width: max-content;
  }

  .filters { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }

  .filter-row { display: flex; gap: 8px; }

  .filter-label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .filter-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--text-primary);
    font-family: var(--font);
    outline: none;
    transition: border-color 150ms;
  }
  .filter-input:focus { border-color: var(--border-focus); }

  .search-btn { align-self: flex-end; padding: 8px 24px; }

  .result-count {
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
