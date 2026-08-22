function env(name: string): string {
  return (process.env[name] || '').trim();
}

function normalizeOrigin(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/\/$/, '');
}

/**
 * Origin som requesten FAKTISKT kom in på — utan kanonisk override.
 *
 * Använd den här när värdet beskriver var klienten står, inte var appen bor. Enda nuvarande
 * anropare är push-prenumerationerna: en PushSubscription är bunden till service workerns origin,
 * så en prenumeration skapad på blikk-integration-ekovilla.vercel.app MÅSTE stämplas med den
 * adressen. `getPublicOrigin` hade svarat app.ekovilla.se även då (overriden vinner alltid), och
 * kolumnen hade blivit oanvändbar för att skilja gamla rader från nya.
 *
 * För allt som ska ut ur appen — länkar i mejl, SMS, Blikk-kommentarer — är det tvärtom:
 * använd `getPublicOrigin`.
 */
export function getRequestOrigin(req: Request): string {
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

/**
 * Appens kanoniska origin — den adress vi vill att omvärlden ska se.
 *
 * NEXT_PUBLIC_SITE_URL vinner över hosten med flit: den gamla vercel.app-adressen svarar
 * fortfarande, och länkar som genereras därifrån hamnar permanent i kundmejl och externa system.
 */
export function getPublicOrigin(req: Request): string {
  // Allow explicit override in deploy environments.
  const override =
    normalizeOrigin(env('NEXT_PUBLIC_SITE_URL')) ||
    normalizeOrigin(env('SITE_URL')) ||
    normalizeOrigin(env('PUBLIC_SITE_URL'));
  if (override) return override;

  return getRequestOrigin(req);
}
