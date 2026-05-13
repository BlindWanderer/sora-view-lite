import { getConfig } from '$lib/config.js';
import { getVideo } from '$lib/db.js';
import fs from 'fs';
import path from 'path';

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function safeFileStream(filePath, options = {}) {
  let nodeStream;
  let closed = false;
  return new ReadableStream({
    start(controller) {
      nodeStream = fs.createReadStream(filePath, options);
      nodeStream.on('data', (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          closed = true;
          try { nodeStream.destroy(); } catch {}
        }
      });
      nodeStream.on('end', () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      });
      nodeStream.on('error', (err) => {
        if (closed) return;
        closed = true;
        try { controller.error(err); } catch {}
      });
    },
    cancel() {
      closed = true;
      try { nodeStream?.destroy(); } catch {}
    }
  });
}

export async function GET({ params }) {
  const video = await getVideo(params.id);
  if (!video) return new Response('Not found', { status: 404 });
  const rel = params.type === 'preview' ? video.preview_path : video.thumbnail_path;
  if (!rel) return new Response('No asset', { status: 404 });

  const config = getConfig();
  const filePath = path.resolve(config.archivePath, rel);
  const archiveRoot = path.resolve(config.archivePath);
  const relToArchive = path.relative(archiveRoot, filePath);
  if (relToArchive.startsWith('..') || path.isAbsolute(relToArchive)) return new Response('Invalid asset path', { status: 400 });
  if (!fs.existsSync(filePath)) return new Response('Asset not found', { status: 404 });

  const stat = fs.statSync(filePath);
  return new Response(safeFileStream(filePath), {
    headers: {
      'Content-Length': String(stat.size),
      'Content-Type': mimeFor(filePath),
      'Cache-Control': 'public, max-age=3600',
    }
  });
}
