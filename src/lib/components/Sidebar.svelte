<script>
  import { page } from '$app/stores';

  export let currentTheme = 'dark';

  $: path = $page.url.pathname;

  const desktopNavItems = [
    { href: '/',            label: 'Feed',        icon: 'feed' },
    { href: '/search',      label: 'Search',      icon: 'search' },
    { href: '/remixes',     label: 'Remixes',     icon: 'remixes' },
    { href: '/characters',  label: 'Characters',  icon: 'characters' },
    { href: '/creators',    label: 'Creators',    icon: 'creators' },
    { href: '/people',      label: 'People',      icon: 'people' },
    { href: '/favorites',   label: 'Favorites',   icon: 'favorites' },
    { href: '/collections', label: 'Collections', icon: 'collections' },
    { href: '/profile',     label: 'Profile',     icon: 'profile' },
    { href: '/server',      label: 'Server',      icon: 'server' },
  ];

  const mobilePrimaryItems = [
    { href: '/',          label: 'Feed',      icon: 'feed' },
    { href: '/people',    label: 'People',    icon: 'people' },
    { href: '/favorites', label: 'Favorites', icon: 'favorites' },
  ];

  const mobileMoreItems = [
    { href: '/remixes',     label: 'Remixes',     icon: 'remixes' },
    { href: '/characters',  label: 'Characters',  icon: 'characters' },
    { href: '/creators',    label: 'Creators',    icon: 'creators' },
    { href: '/collections', label: 'Collections', icon: 'collections' },
    { href: '/hidden',      label: 'Hidden',      icon: 'hidden' },
    { href: '/profile',     label: 'Profile',     icon: 'profile' },
    { href: '/server',      label: 'Server',      icon: 'server' },
  ];

  $: mobileMoreActive = mobileMoreItems.some((item) => isActive(item.href));

  function isActive(href) {
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }

  function iconSvg(icon) {
    const icons = {
      feed: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
      remixes: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
      characters: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      creators: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      people: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="7" r="2.5"/><path d="M2.5 21a5.5 5.5 0 0 1 11 0"/><path d="M14 21a4.5 4.5 0 0 1 7.5-3.35"/></svg>',
      favorites: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
      collections: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h7"/></svg>',
      hidden: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.76-2.15 2.12-3.98 3.87-5.31"/><path d="M9.9 4.24A11.1 11.1 0 0 1 12 4c5 0 9.27 3.11 11 8a11.7 11.7 0 0 1-2.26 3.56"/><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"/><path d="M3 3l18 18"/></svg>',
      profile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      server: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 20a1.65 1.65 0 0 0-1.82-.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.82-.33H2a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.6 4a1.65 1.65 0 0 0 1-.6A1.65 1.65 0 0 0 9.91 1H10a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15.4 4a1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.37.2.67.5.87.87H22a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/></svg>',
      more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>'
    };
    return icons[icon] || '';
  }

  // Cycle is dark → light → sora → dark. The icon shown is the destination
  // of the next click, not the current theme — same convention as the
  // original two-way toggle.
  function themeIcon() {
    if (currentTheme === 'dark') {
      // Next click goes to light → show sun.
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    }
    if (currentTheme === 'light') {
      // Next click goes to sora → show the Sora cloud mascot.
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="M7.5 18a4.5 4.5 0 0 1-.6-8.96 5.5 5.5 0 0 1 10.6-1.04A4.5 4.5 0 0 1 17 18H7.5z"/><circle cx="10" cy="13" r="0.9" fill="#0a1428" stroke="none"/><circle cx="14.5" cy="13" r="0.9" fill="#0a1428" stroke="none"/></svg>';
    }
    // currentTheme === 'sora' → next click goes to dark → show moon.
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  let mobileMoreEl;
  let previousPath = '';

  $: if (mobileMoreEl && previousPath !== path) {
    closeMobileMore();
    previousPath = path;
  }

  function closeMobileMore() {
    if (mobileMoreEl) mobileMoreEl.open = false;
  }

  function handleWindowClick(event) {
    if (!mobileMoreEl?.open) return;
    if (mobileMoreEl.contains(event.target)) return;
    closeMobileMore();
  }

  function handleWindowKeydown(event) {
    if (event.key === 'Escape') closeMobileMore();
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<nav class="sidebar" aria-label="Main navigation">
  <a href="/" class="logo" aria-label="Home" title="Home">
    <img class="sora-logo" src="/sora-cloud.svg" alt="" width="34" height="34" />
  </a>

  <ul class="nav-list">
    {#each desktopNavItems as item}
      <li>
        <a
          href={item.href}
          class="nav-item"
          class:active={isActive(item.href)}
          title={item.label}
          aria-label={item.label}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          {@html iconSvg(item.icon)}
          <span class="nav-label">{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>

  <form method="POST" action="/api/theme/toggle" class="theme-form">
    <button class="theme-btn" type="submit" title="Toggle theme" aria-label="Toggle theme">
      {@html themeIcon()}
    </button>
  </form>
</nav>

<nav class="mobile-nav" aria-label="Mobile navigation">
  {#each mobilePrimaryItems.slice(0, 2) as item}
    <a
      href={item.href}
      class="mobile-nav-item"
      on:click={closeMobileMore}
      class:active={isActive(item.href)}
      aria-label={item.label}
      aria-current={isActive(item.href) ? 'page' : undefined}
    >
      {@html iconSvg(item.icon)}
      <span>{item.label}</span>
    </a>
  {/each}

  <!-- Center FAB. Sora's mobile UI uses a prominent white circle as the
       primary action; we point it at Search since that's the most useful
       single-tap action for an archive viewer. The FAB is structural (lives
       in every theme); the Sora-theme override in app.css refines its
       color to match the starfield. -->
  <a href="/search" class="mobile-fab" aria-label="Search" on:click={closeMobileMore}>
    {@html iconSvg('search')}
  </a>

  {#each mobilePrimaryItems.slice(2) as item}
    <a
      href={item.href}
      class="mobile-nav-item"
      on:click={closeMobileMore}
      class:active={isActive(item.href)}
      aria-label={item.label}
      aria-current={isActive(item.href) ? 'page' : undefined}
    >
      {@html iconSvg(item.icon)}
      <span>{item.label}</span>
    </a>
  {/each}

  <details bind:this={mobileMoreEl} class="mobile-more" class:active={mobileMoreActive}>
    <summary aria-label="More navigation">
      {@html iconSvg('more')}
      <span>More</span>
    </summary>
    <div class="mobile-more-menu">
      {#each mobileMoreItems as item}
        <a href={item.href} class:active={isActive(item.href)} on:click={closeMobileMore}>
          {@html iconSvg(item.icon)}
          <span>{item.label}</span>
        </a>
      {/each}
      <form method="POST" action="/api/theme/toggle">
        <button type="submit" on:click={closeMobileMore}>
          {@html themeIcon()}
          <span>Toggle theme</span>
        </button>
      </form>
    </div>
  </details>
</nav>

<style>
  .sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: var(--sidebar-w);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0 12px;
    z-index: 100;
    gap: 0;
  }

  @media (max-width: 768px) { .sidebar { display: none; } }

  .logo {
    width: 46px;
    height: 46px;
    color: var(--text-primary);
    margin-bottom: 8px;
    border-radius: 14px;
    transition: transform 140ms ease, opacity var(--transition);
    display: grid;
    place-items: center;
    background: transparent;
  }
  .logo:hover { transform: scale(1.05); opacity: 0.92; }
  .sora-logo { width: 34px; height: 34px; display: block; object-fit: contain; }

  .nav-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    width: 100%;
    padding: 0 6px;
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 4px;
    border-radius: 10px;
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition);
    width: 100%;
  }
  .nav-item:hover  { background: var(--bg-hover);   color: var(--text-primary); }
  .nav-item.active { color: var(--text-primary); }

  .nav-label { font-size: 9px; font-weight: 500; letter-spacing: 0.02em; }

  .theme-form { margin: 0; }
  .theme-btn {
    padding: 8px;
    border-radius: 10px;
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition);
  }
  .theme-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .mobile-nav {
    display: none;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: var(--mobile-nav-h);
    background: color-mix(in srgb, var(--bg-secondary) 94%, transparent 6%);
    border-top: 1px solid var(--border);
    z-index: 1200;
    align-items: center;
    justify-content: space-around;
    padding: 0 8px max(env(safe-area-inset-bottom), 0px);
    backdrop-filter: blur(18px);
  }
  @media (max-width: 768px) { .mobile-nav { display: flex; } }

  .mobile-nav-item,
  .mobile-more > summary {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 100%;
    padding: 7px 4px;
    color: var(--text-secondary);
    border-radius: 12px;
    transition: color var(--transition), background var(--transition);
    font-size: 10px;
    font-weight: 700;
    list-style: none;
  }
  .mobile-nav-item.active,
  .mobile-more.active > summary,
  .mobile-nav-item:hover,
  .mobile-more > summary:hover { color: var(--text-primary); background: var(--bg-hover); }
  .mobile-more > summary::-webkit-details-marker { display: none; }

  /* Center FAB on the mobile bottom nav. Larger and rounder than the other
     nav items, sits above the row's plane via a small upward translate.
     Colors come from CSS variables so the button auto-inverts in light
     theme (white pill on dark bg, dark pill on light bg). */
  .mobile-fab {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 6px;
    background: var(--text-primary);
    color: var(--bg-primary);
    box-shadow: 0 6px 18px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.08) inset;
    transform: translateY(-6px);
    transition: transform 140ms ease, box-shadow 140ms ease;
  }
  .mobile-fab:hover  { transform: translateY(-7px); box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.10) inset; }
  .mobile-fab:active { transform: translateY(-4px) scale(0.97); }

  .mobile-more {
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
  }

  .mobile-more-menu {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(var(--mobile-nav-h) + 10px);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
    border-radius: 18px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    max-height: min(70vh, 460px);
    overflow-y: auto;
    overflow-x: hidden;
  }

  .mobile-more-menu a,
  .mobile-more-menu button {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text-primary);
    text-align: left;
    font: inherit;
    font-size: 14px;
  }
  .mobile-more-menu a.active { border-color: var(--border-focus); background: var(--bg-active); }
  .mobile-more-menu form { margin: 0; }
</style>
