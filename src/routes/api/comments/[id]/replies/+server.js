import { json } from '@sveltejs/kit';
import { getCommentReplies } from '$lib/db.js';

export async function GET({ params, url }) {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
  const replies = await getCommentReplies(params.id, { limit });
  return json({ replies });
}
