<script>
  import VideoCard from '$lib/components/VideoCard.svelte';
  import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';

  export let data;

  let videos  = data.videos;
  let page    = data.page || 1;
  let loading = false;
  let hasMore = data.hasMore;
  let currentDataKey = '';

  $: tab = data.tab;

  // SvelteKit keeps this component mounted when changing /profile?tab=... .
  // Reset the local list from new load data so tabs update immediately without refresh.
  $: {
    const nextDataKey = JSON.stringify([data.tab, data.page]);
    if (nextDataKey !== currentDataKey) {
      videos = data.videos;
      page = data.page || 1;
      hasMore = data.hasMore;
      loading = false;
      currentDataKey = nextDataKey;
    }
  }

  $: nextHref = `/profile?tab=${encodeURIComponent(tab)}&page=${page + 1}`;

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    page++;
    try {
      const params = new URLSearchParams({ type: 'profile', sourceDir: tab, page: String(page) });
      const res  = await fetch(`/api/videos?${params}`);
      const next = await res.json();
      videos  = [...videos, ...next];
      hasMore = next.length === 24;
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }

  const tabs = [
    { key: 'profile', label: 'Published' },
    { key: 'drafts',  label: 'Drafts' },
    { key: 'liked',   label: 'Liked' },
  ];
</script>

<svelte:head><title>My Archive — Sora View</title></svelte:head>

<div class="profile-hero">
  <div class="owner-avatar">
    {data.ownerUsername ? data.ownerUsername.slice(0,2).toUpperCase() : 'ME'}
  </div>
  <h1 class="owner-name">{data.ownerUsername || 'My Archive'}</h1>
  <details class="profile-edit">
    <summary>Edit profile</summary>
    <form method="POST" action="?/saveProfile" class="profile-form">
      <label>
        Display username
        <input name="ownerUsername" type="text" value={data.ownerUsername || ''} placeholder="My username" />
      </label>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>
  </details>
  <div class="profile-stats">
    <div class="stat">
      <span class="stat-val">{data.counts.profile}</span>
      <span class="stat-label">published</span>
    </div>
    <div class="stat">
      <span class="stat-val">{data.counts.drafts}</span>
      <span class="stat-label">drafts</span>
    </div>
    <div class="stat">
      <span class="stat-val">{data.counts.liked}</span>
      <span class="stat-label">liked</span>
    </div>
  </div>
</div>

<nav class="tab-bar" aria-label="Profile sections">
  {#each tabs as t}
    <a
      class="tab-btn"
      class:active={tab === t.key}
      href="/profile?tab={t.key}"
      aria-current={tab === t.key ? 'page' : undefined}
    >
      {t.label}
    </a>
  {/each}
</nav>

{#if videos.length === 0}
  <div class="empty-state">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
    <p>No {tab} videos found in your archive.</p>
  </div>
{:else}
  <div class="video-grid">
    {#each videos as video, i (video.id)}
      <VideoCard {video} index={i} />
    {/each}
  </div>
  {#key tab}
    <InfiniteScroll {hasMore} {loading} href={nextHref} on:loadMore={loadMore} />
  {/key}
{/if}

<style>
  .profile-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 16px 20px;
    text-align: center;
  }

  .owner-avatar {
    width: 80px; height: 80px;
    border-radius: 50%;
    background: var(--bg-active);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 26px;
    color: var(--text-primary);
  }

  .owner-name { font-size: 22px; font-weight: 700; }

  .profile-edit summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
  }

  .profile-form {
    margin-top: 10px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .profile-form label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .profile-form input {
    min-width: 240px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 10px;
    padding: 9px 11px;
    font: inherit;
  }

  .profile-stats {
    display: flex;
    gap: 32px;
    margin-top: 4px;
  }

  .stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .stat-val { font-size: 20px; font-weight: 700; }
  .stat-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 10;
    backdrop-filter: blur(12px);
  }

  .tab-btn {
    flex: 1;
    padding: 12px 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    transition: all 150ms;
    text-align: center;
  }
  .tab-btn.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
  .tab-btn:hover  { color: var(--text-primary); background: var(--bg-hover); }
</style>
