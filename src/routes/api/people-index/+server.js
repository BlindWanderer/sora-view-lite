import { json } from '@sveltejs/kit';
import { getCreators, getCharacters, getPeople } from '$lib/db.js';
import { getConfig } from '$lib/config.js';

function intParam(url, name, fallback, min = 1, max = 1000) {
  const n = parseInt(url.searchParams.get(name) || String(fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET({ url }) {
  const type = url.searchParams.get('type') || 'people';
  const q = url.searchParams.get('q') || '';
  const sort = url.searchParams.get('sort') === 'name' ? 'name' : 'videos';
  const limit = intParam(url, 'limit', 250, 25, 1000);
  const offset = intParam(url, 'offset', 0, 0, 10000000);

  const config = getConfig() || {};
  const personIndexInfo = config.personIndexInfo || 'minimal';
  if (type === 'creators') return json(await getCreators(q, sort, { limit, offset, personIndexInfo }));
  if (type === 'characters') return json(await getCharacters(1, q, limit, offset, { personIndexInfo }));
  return json(await getPeople(q, sort, { limit, offset, personIndexInfo }));
}
