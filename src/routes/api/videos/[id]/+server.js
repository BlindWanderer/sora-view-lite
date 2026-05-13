import { json, error } from '@sveltejs/kit';
import { getConfig } from '$lib/config.js';
import { getVideo, getRemixesForVideo, getSimilarVideos } from '$lib/db.js';
import path from 'path';

function attachFullPath(video) {
  if (!video) return video;
  const config = getConfig();
  if (!config?.archivePath || !video.file_path) return video;
  return {
    ...video,
    full_path: path.resolve(config.archivePath, video.file_path),
  };
}

export async function GET({ params }) {
  const video = await getVideo(params.id);
  if (!video) throw error(404, 'Video not found');
  return json({ video: attachFullPath(video), remixes: await getRemixesForVideo(video), similar: await getSimilarVideos(video.id) });
}
