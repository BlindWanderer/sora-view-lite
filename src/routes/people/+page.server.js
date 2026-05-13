import { getPeople } from '$lib/db.js';
import { getConfig } from '$lib/config.js';

export async function load({ url }) {
  const q = url.searchParams.get('q') || '';
  const sort = url.searchParams.get('sort') === 'name' ? 'name' : 'videos';
  const config = getConfig() || {};
  const initialLimit = Number(config.personInitialLimit || 100);
  const loadLimit = Number(config.personLoadLimit || 250);
  const personIndexInfo = config.personIndexInfo || 'minimal';
  const personShowImages = config.personShowImages === true;
  const people = await getPeople(q, sort, { limit: initialLimit, offset: 0, personIndexInfo });
  return { q, sort, people, initialLimit, loadLimit, personIndexInfo, personShowImages, hasMore: people.length >= initialLimit };
}
