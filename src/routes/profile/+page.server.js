import { getProfileVideos, getProfileCounts, inferOwnerUsername } from '$lib/db.js';
import { getConfig, updateConfig } from '$lib/config.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';
import { fail, redirect } from '@sveltejs/kit';

const VALID_TABS = new Set(['profile', 'drafts', 'liked']);

export async function load({ url }) {
  const requestedTab = url.searchParams.get('tab') || 'profile';
  const tab = VALID_TABS.has(requestedTab) ? requestedTab : 'profile';
  const config = getConfig();
  const page = readPageParam(url);
  const counts = await getProfileCounts();
  const result = await collectPages((p) => getProfileVideos(tab, p), page);

  return {
    videos: result.videos,
    tab,
    counts,
    ownerUsername: config?.ownerUsername || await inferOwnerUsername(),
    page,
    hasMore: result.hasMore,
    nextHref: nextPageHref(url, page + 1)
  };
}

export const actions = {
  saveProfile: async ({ request }) => {
    const form = await request.formData();
    const ownerUsername = String(form.get('ownerUsername') || '').trim();
    if (ownerUsername.length > 80) return fail(400, { error: 'Username is too long.' });
    updateConfig({ ownerUsername: ownerUsername || null });
    throw redirect(303, '/profile');
  }
};
