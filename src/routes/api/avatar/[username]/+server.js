import { getConfig } from '$lib/config.js';
import { findExistingAvatar } from '$lib/server/profile-fetch.js';
import fs from 'fs';
import path from 'path';

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.jpg':
    case '.jpeg':
    default: return 'image/jpeg';
  }
}

export async function GET({ params }) {
  const config = getConfig();
  if (!config?.archivePath) return new Response('No archive configured', { status: 503 });

  const username = String(params.username || '').trim();
  if (!username || username.includes('/') || username.includes('\\') || username.includes('..')) {
    return new Response('Invalid username', { status: 400 });
  }

  const filePath = findExistingAvatar(config.archivePath, username);
  if (!filePath) return new Response('Avatar not found', { status: 404 });

  // Defensive: confirm the resolved path is still inside profiles/
  const archiveRoot = path.resolve(config.archivePath);
  const profilesRoot = path.join(archiveRoot, 'profiles');
  const rel = path.relative(profilesRoot, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return new Response('Invalid avatar path', { status: 400 });
  }

  const stat = fs.statSync(filePath);
  return new Response(fs.readFileSync(filePath), {
    headers: {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    }
  });
}
