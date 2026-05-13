const VALID_THEMES = ['dark', 'light', 'sora'];

export async function handle({ event, resolve }) {
  const raw = event.cookies.get('sora_theme');
  const theme = VALID_THEMES.includes(raw) ? raw : 'dark';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%sora_theme%', theme)
  });
}
