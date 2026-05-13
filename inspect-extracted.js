#!/usr/bin/env node
/**
 * inspect-extracted.js
 * Sample a handful of *.extracted.json files and dump their top-level shape.
 * Usage: node inspect-extracted.js <dir> [--sample 8]
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const root = path.resolve(args[0] || '.');
const sampleIdx = args.indexOf('--sample');
const sampleN = sampleIdx !== -1 && args[sampleIdx + 1] ? Number(args[sampleIdx + 1]) : 8;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (['profiles', 'node_modules', '.git'].includes(e.name) || e.name.startsWith('.')) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile() && /\.extracted\.json$/i.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

const files = [];
for (const f of walk(root)) { files.push(f); if (files.length >= 50000) break; }
console.log(`Total *.extracted.json found: ${files.length}\n`);

const step = Math.max(1, Math.floor(files.length / sampleN));
const samples = [];
for (let i = 0; i < files.length && samples.length < sampleN; i += step) samples.push(files[i]);

for (const file of samples) {
  console.log('━'.repeat(78));
  console.log(`FILE: ${path.relative(root, file)}`);
  let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log(`  parse error: ${e.message}`); continue; }
  if (!payload || typeof payload !== 'object') { console.log('  not an object'); continue; }
  console.log(`  top-level keys: ${Object.keys(payload).join(', ')}`);
  console.log(`  post_count=${payload.post_count}  comment_count=${payload.comment_count}  profile_count=${payload.profile_count}  video_count=${payload.video_count}`);
  if (Array.isArray(payload.posts)) {
    console.log(`  posts.length=${payload.posts.length}`);
    const firstWithComments = payload.posts.find((p) => Array.isArray(p?.comments) && p.comments.length > 0);
    if (firstWithComments) {
      const c = firstWithComments.comments[0];
      console.log(`  sample post has ${firstWithComments.comments.length} comments; first comment keys: ${Object.keys(c).join(', ')}`);
      if (c.author) console.log(`    comment.author keys: ${Object.keys(c.author).join(', ')}`);
    } else {
      console.log(`  no posts with non-empty comments[]`);
      const first = payload.posts[0];
      if (first) console.log(`  first post keys: ${Object.keys(first).slice(0, 20).join(', ')}`);
    }
  }
  if (Array.isArray(payload.all_profiles)) console.log(`  all_profiles.length=${payload.all_profiles.length}`);
  if (Array.isArray(payload.items)) console.log(`  items.length=${payload.items.length}`);
  if (Array.isArray(payload.chains)) console.log(`  chains.length=${payload.chains.length}`);
  if (Array.isArray(payload.comments)) console.log(`  TOP-LEVEL comments.length=${payload.comments.length}`);
}
