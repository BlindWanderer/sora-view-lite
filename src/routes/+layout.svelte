<script>
  import '../app.css';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import { page } from '$app/stores';

  export let data;

  $: isSetup = $page.url.pathname.startsWith('/setup');
  $: if (typeof window !== 'undefined') {
    window.SORA_VIEW_SETTINGS = { showFullPaths: data.clientSettings?.showFullPaths !== false };
  }
</script>


<div class="app-shell">
  {#if !isSetup}
    <Sidebar currentTheme={data.theme} />
  {/if}

  <main class="main-content" class:full={isSetup}>
    <slot />
  </main>
</div>

<style>
  .full { margin-left: 0 !important; }
</style>
