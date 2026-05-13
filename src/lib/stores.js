import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// ── Theme ─────────────────────────────────────────────────────────────────

function createTheme() {
  const initial = browser
    ? (localStorage.getItem('theme') || 'dark')
    : 'dark';

  const { subscribe, set } = writable(initial);

  return {
    subscribe,
    toggle() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      set(next);
    },
    init() {
      if (!browser) return;
      const saved = localStorage.getItem('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', saved);
      set(saved);
    }
  };
}

export const theme = createTheme();

// ── Lightbox ──────────────────────────────────────────────────────────────

export const lightbox = writable(null); // null | { video, videos, index }

export function openLightbox(video, videos = [], index = 0) {
  lightbox.set({ video, videos, index });
  if (browser) document.body.style.overflow = 'hidden';
}

export function closeLightbox() {
  lightbox.set(null);
  if (browser) document.body.style.overflow = '';
}
