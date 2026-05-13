<script>import VideoCard from '$lib/components/VideoCard.svelte'; export let data;</script>
<svelte:head><title>Favorites — Sora View Lite</title></svelte:head>
<div class="page-wrap"><header class="page-header"><h1 class="page-title">Favorites</h1><p class="subtitle">Videos you marked locally as favorites.</p></header><div class="video-grid">{#each data.videos as video,i}<VideoCard {video} index={i}/>{/each}</div></div>
<style>.page-wrap{padding:16px 16px 90px}.subtitle{color:var(--text-secondary);font-size:14px}</style>
