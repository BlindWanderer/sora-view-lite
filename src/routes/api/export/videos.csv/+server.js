import { getDB } from '$lib/db.js';

function csv(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function GET() {
  const db = await getDB();
  const rows = await db.all(`SELECT id, author, date, prompt, filename, file_path, generation_id, task_id, post_id, view_count, like_count, remix_count, share_count, reply_count, local_favorite, hidden, reviewed FROM videos ORDER BY date DESC, id DESC`);
  const headers = ['id','author','date','prompt','filename','file_path','generation_id','task_id','post_id','view_count','like_count','remix_count','share_count','reply_count','local_favorite','hidden','reviewed'];
  const body = [headers.join(',')].concat(rows.map(r => headers.map(h => csv(r[h])).join(','))).join('\n');
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="sora-view-videos.csv"' } });
}
