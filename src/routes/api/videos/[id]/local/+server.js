import { json } from '@sveltejs/kit';
import { setVideoLocalState } from '$lib/db.js';

export async function POST({ params, request }) {
  const body = await request.json().catch(() => ({}));
  const video = await setVideoLocalState(params.id, body || {});
  return json({ ok: true, video });
}
