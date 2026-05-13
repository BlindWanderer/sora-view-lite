import { getDuplicateCandidates } from '$lib/db.js';
export async function load() { return { duplicates: await getDuplicateCandidates({ limit: 100 }) }; }
