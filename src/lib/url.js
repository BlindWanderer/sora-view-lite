export function withQueryParam(url, key, value) {
  const params = new URLSearchParams(url.searchParams);
  if (value === null || value === undefined || value === '') params.delete(key);
  else params.set(key, String(value));
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

export function withoutQueryParam(url, key) {
  const params = new URLSearchParams(url.searchParams);
  params.delete(key);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}
