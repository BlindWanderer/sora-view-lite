import { json } from '@sveltejs/kit';
import { getCharacterCoStars, getCharacterCreators } from '$lib/db.js';

export async function GET({ params, url }) {
  const name = String(params.name || '').toLowerCase();
  const type = String(url.searchParams.get('type') || 'creators').toLowerCase();
  const rawLimit = Number(url.searchParams.get('limit') || 1000);
  const limit = Math.max(25, Math.min(5000, Number.isFinite(rawLimit) ? rawLimit : 1000));

  if (!name) return json([]);
  if (type === 'costars' || type === 'co-stars' || type === 'appears-with') {
    return json(await getCharacterCoStars(name, { limit }));
  }
  return json(await getCharacterCreators(name, { limit }));
}
