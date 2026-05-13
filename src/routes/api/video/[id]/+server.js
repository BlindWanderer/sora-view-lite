import { getConfig } from '$lib/config.js';
import { getVideo } from '$lib/db.js';
import fs from 'fs';
import path from 'path';

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.m4v': return 'video/x-m4v';
    default: return 'video/mp4';
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

export async function GET({ params, request }) {
  const video = await getVideo(params.id);
  if (!video) return new Response('Not found', { status: 404 });

  const config = getConfig();
  const filePath = path.resolve(config.archivePath, video.file_path);
  const archiveRoot = path.resolve(config.archivePath);
  const relToArchive = path.relative(archiveRoot, filePath);
  if (relToArchive.startsWith('..') || path.isAbsolute(relToArchive)) return new Response('Invalid media path', { status: 400 });
  if (!fs.existsSync(filePath)) return new Response('File not found on disk', { status: 404 });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get('range');
  const contentType = mimeFor(filePath);

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024, fileSize - 1);
    if (Number.isNaN(start) || start >= fileSize) {
      return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } });
    }
    const stream = safeFileStream(filePath, { start, end });
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      }
    });
  }

  return new Response(safeFileStream(filePath), {
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
  });
}
