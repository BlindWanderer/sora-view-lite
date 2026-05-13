import { json } from '@sveltejs/kit';
import { getRemixesForVideo } from '$lib/db.js';

export async function GET({ params }) {
  return json(await getRemixesForVideo(params.id));
}
