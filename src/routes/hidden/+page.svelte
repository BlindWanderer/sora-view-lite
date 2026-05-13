<script>import VideoCard from '$lib/components/VideoCard.svelte'; export let data;</script>
<svelte:head><title>Hidden videos — Sora View Lite</title></svelte:head>
<div class="page-wrap"><header class="page-header"><h1 class="page-title">Hidden videos</h1><p class="subtitle">Videos hidden from normal feeds. Open a video and choose Unhide to restore it.</p></header><div class="video-grid">{#each data.videos as video,i}<VideoCard {video} index={i}/>{/each}</div></div>
<style>.page-wrap{padding:16px 16px 90px}.subtitle{color:var(--text-secondary);font-size:14px}</style>
