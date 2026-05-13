import { getCharacters } from '$lib/db.js';
import { getConfig } from '$lib/config.js';

export async function load({ url }) {
  const q = url.searchParams.get('q') || '';
  const config = getConfig() || {};
  const initialLimit = Number(config.personInitialLimit || 100);
  const loadLimit = Number(config.personLoadLimit || 250);
  const personIndexInfo = config.personIndexInfo || 'minimal';
  const personShowImages = config.personShowImages === true;
  const characters = await getCharacters(1, q, initialLimit, null, { personIndexInfo });
  return { characters, q, initialLimit, loadLimit, personIndexInfo, personShowImages, hasMore: characters.length >= initialLimit };
}
