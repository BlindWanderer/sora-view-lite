<script>
  export let data;
  export let form;
</script>
<svelte:head><title>Collections — Sora View Lite</title></svelte:head>
<div class="page-wrap">
  <header class="page-header"><h1 class="page-title">Collections</h1><p class="subtitle">Local playlists for organizing your archive. These do not modify your video files.</p></header>
  <section class="panel">
    <h2>Create collection</h2>
    {#if form?.error}<div class="error-box">{form.error}</div>{/if}
    <form method="POST" action="?/create" class="inline-form"><input name="name" placeholder="Collection name" required /><button class="btn btn-primary" type="submit">Create</button></form>
  </section>
  <section class="entity-grid">
    {#each data.collections as collection}
      <a class="entity-card" href={`/collections/${collection.id}`}>
        <div class="avatar">{collection.name.slice(0,2).toUpperCase()}</div>
        <div><h3>{collection.name}</h3><p>{collection.video_count || 0} videos{collection.latest_date ? ` · latest ${collection.latest_date}` : ''}</p></div>
      </a>
    {/each}
  </section>
</div>
<style>
.page-wrap{padding:16px 16px 90px}.subtitle{color:var(--text-secondary);font-size:14px}.panel{background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:16px;margin:14px 0}.inline-form{display:flex;gap:10px}.inline-form input{flex:1;background:var(--bg-input);border:1px solid var(--border);border-radius:999px;padding:10px 14px;color:var(--text-primary)}.entity-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.entity-card{display:flex;align-items:center;gap:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:14px;color:inherit;text-decoration:none}.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--pill-bg);font-weight:800}.entity-card h3{margin:0}.entity-card p{margin:4px 0 0;color:var(--text-secondary);font-size:13px}.error-box{color:#f87171}
</style>
