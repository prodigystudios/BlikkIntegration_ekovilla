function env(name: string): string {
  return (process.env[name] || '').trim();
}

function normalizeOrigin(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/\/$/, '');
}

export function getPublicOrigin(req: Request): string {
  // Allow explicit override in deploy environments.
  const override =
    normalizeOrigin(env('NEXT_PUBLIC_SITE_URL')) ||
    normalizeOrigin(env('SITE_URL')) ||
    normalizeOrigin(env('PUBLIC_SITE_URL'));
  if (override) return override;

  const h = req.headers;

  // Prefer proxy headers.
  const xfHost = (h.get('x-forwarded-host') || '').trim();
  const host = xfHost || (h.get('host') || '').trim();

  const xfProto = (h.get('x-forwarded-proto') || '').trim();
  const proto = xfProto || (host.startsWith('localhost') ? 'http' : 'https');

  if (host) return `${proto}://${host}`;

  // Fallback.
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'http://localhost:3000';
  }
}
