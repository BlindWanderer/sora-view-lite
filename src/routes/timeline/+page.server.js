import { getTimelineStats } from '$lib/db.js';
export async function load() { return { months: await getTimelineStats() }; }
