export function GET() {
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
