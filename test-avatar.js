#!/usr/bin/env node
/**
 * test-avatar.js — probe a single avatar URL.
 *
 * Usage:
 *   node test-avatar.js "<url>"                    # try downloading; show outcome
 *   node test-avatar.js --head "<url>"             # HEAD-style, no body, just status + headers
 *   node test-avatar.js --from <extracted.json> [--user <username>]
 *       # pull profile_picture_url for the given username (or the first profile)
 *       # out of an extracted.json file, then try it
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help' || args[0] === '-h') {
  console.error('Usage: node test-avatar.js <url>');
  console.error('       node test-avatar.js --head <url>');
  console.error('       node test-avatar.js --from <extracted.json> [--user <username>]');
  process.exit(1);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

async function getUrl() {
  const fromFile = flag('--from');
  if (fromFile) {
    const wantUser = flag('--user');
    const payload = JSON.parse(fs.readFileSync(fromFile, 'utf8'));
    const candidates = [];
    const all = Array.isArray(payload?.all_profiles) ? payload.all_profiles : [];
    for (const p of all) if (p?.username && p?.profile_picture_url) candidates.push(p);
    const posts = Array.isArray(payload?.posts) ? payload.posts : [];
    for (const post of posts) {
      if (post?.author?.username && post.author.profile_picture_url) candidates.push(post.author);
      const cmts = Array.isArray(post?.comments) ? post.comments : [];
      for (const c of cmts) if (c?.author?.username && c.author.profile_picture_url) candidates.push(c.author);
    }
    if (!candidates.length) throw new Error('No profiles with profile_picture_url found in file.');
    const pick = wantUser ? candidates.find((c) => c.username === wantUser) : candidates[0];
    if (!pick) throw new Error(`User ${wantUser} not found. Available: ${candidates.slice(0, 10).map((c) => c.username).join(', ')}`);
    console.log(`Picked: ${pick.username} (display: ${pick.display_name || '—'})`);
    return pick.profile_picture_url;
  }
  const headIdx = args.indexOf('--head');
  if (headIdx !== -1 && args[headIdx + 1]) return { url: args[headIdx + 1], headOnly: true };
  return args.find((a) => /^https?:\/\//.test(a)) || args[0];
}

function fetchOnce(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const driver = parsed.protocol === 'https:' ? https : http;

    console.log(`\n→ ${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search ? '?…' : ''}`);
    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      const se = params.get('se');
      const sp = params.get('sp');
      const sr = params.get('sr');
      console.log(`   sas params: se=${se}  sp=${sp}  sr=${sr}`);
      if (se) {
        const expires = new Date(se);
        const ms = expires.getTime() - Date.now();
        const days = Math.round(ms / 86400000);
        console.log(`   expires: ${se}  →  ${ms > 0 ? `in ~${days}d` : `EXPIRED ~${-days}d ago`}`);
      }
    }

    const req = driver.get(url, { headers: HEADERS }, (res) => {
      console.log(`\n← HTTP ${res.statusCode} ${res.statusMessage || ''}`);
      console.log(`   content-type:   ${res.headers['content-type'] || '(none)'}`);
      console.log(`   content-length: ${res.headers['content-length'] || '(none)'}`);
      if (res.headers['x-ms-error-code']) console.log(`   x-ms-error-code: ${res.headers['x-ms-error-code']}`);
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        console.log(`   redirect → ${res.headers.location}`);
        res.resume();
        return fetchOnce(res.headers.location, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (c) => { if (body.length < 2000) body += c.toString('utf8'); });
        res.on('end', () => {
          if (body.trim()) console.log(`   body (truncated):\n${body.slice(0, 1500)}`);
          resolve({ ok: false, status: res.statusCode });
        });
        return;
      }
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => {
        console.log(`   ✓ downloaded ${bytes} bytes`);
        resolve({ ok: true, bytes });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Timeout 30s')));
    req.on('error', reject);
  });
}

const target = await getUrl();
const url = typeof target === 'string' ? target : target.url;
try {
  await fetchOnce(url);
} catch (err) {
  console.error(`\nFAIL: ${err.message}`);
  process.exit(1);
}
