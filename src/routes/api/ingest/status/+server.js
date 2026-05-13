import { json } from '@sveltejs/kit';
import { getIngestJob } from '$lib/server/ingest-job.js';

export function GET() {
  return json(getIngestJob());
}
