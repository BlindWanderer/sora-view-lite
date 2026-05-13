import { redirect } from '@sveltejs/kit';

// Three-way cycle: dark → light → sora → dark.
// The icon shown on the toggle is the destination of the next click, so the
// user always sees where they're going next, not where they are.
const ORDER = ['dark', 'light', 'sora'];

export function POST({ request, cookies }) {
  const raw = cookies.get('sora_theme');
  const current = ORDER.includes(raw) ? raw : 'dark';
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  cookies.set('sora_theme', next, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365
  });

  const referer = request.headers.get('referer') || '/';
  throw redirect(303, referer);
}
