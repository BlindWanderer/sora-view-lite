<script>
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  export let hasMore = true;
  export let loading = false;
  export let href = '';

  const dispatch = createEventDispatcher();

  let sentinel;
  let observer;

  function attachObserver() {
    if (!observer || !sentinel) return;
    observer.disconnect();
    observer.observe(sentinel);
  }

  onMount(() => {
    // Create the observer even when the first tab/page has no additional rows.
    // SvelteKit keeps page components mounted during query-param navigation, so
    // a later tab can set hasMore=true without remounting this component.
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          dispatch('loadMore');
        }
      },
      { rootMargin: '300px 0px' }
    );
    attachObserver();
  });

  $: if (observer && sentinel) {
    attachObserver();
  }

  onDestroy(() => observer?.disconnect());
</script>

<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>

{#if loading}
  <div class="load-indicator">
    <div class="spinner"></div>
  </div>
{:else if hasMore && href}
  <div class="fallback-wrap">
    <a class="load-more-link" href={href}>Load more</a>
  </div>
{/if}

<style>
  .sentinel { height: 1px; }

  .load-indicator,
  .fallback-wrap {
    display: flex;
    justify-content: center;
    padding: 24px;
  }

  .load-more-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 9px 18px;
    border-radius: 999px;
    background: var(--pill-bg);
    color: var(--pill-text);
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 600;
  }
  .load-more-link:hover { background: var(--bg-hover); }

  .spinner {
    width: 28px; height: 28px;
    border: 2px solid var(--border);
    border-top-color: var(--text-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
