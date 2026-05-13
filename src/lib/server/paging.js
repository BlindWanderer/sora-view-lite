import { PAGE_SIZE } from '$lib/db.js';

export function readPageParam(url) {
  return Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
}

export async function collectPages(loader, page, pageSize = PAGE_SIZE) {
  const videos = [];
  let lastBatch = [];
  for (let p = 1; p <= page; p++) {
    lastBatch = await loader(p);
    videos.push(...lastBatch);
    if (lastBatch.length < pageSize) break;
  }
  return { videos, hasMore: lastBatch.length === pageSize };
}

export function nextPageHref(url, nextPage) {
  const params = new URLSearchParams(url.searchParams);
  params.set('page', String(nextPage));
  params.delete('video');
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}
