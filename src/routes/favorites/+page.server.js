import { getFavoriteVideos } from '$lib/db.js';
import { collectPages, readPageParam } from '$lib/server/paging.js';
export async function load({ url }) { const page=readPageParam(url); const {videos,hasMore}=await collectPages(p=>getFavoriteVideos(p), page); return {videos,page,hasMore}; }
