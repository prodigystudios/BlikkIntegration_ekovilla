import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * 🧨 Middleware släpper HELA /api/portal/ förbi sessionskontrollen (återförsäljarportalen har ingen session). En route
 * där som glömmer signaturkontrollen är alltså öppen för vem som helst på internet. Testet går igenom VARJE route i
 * app/ — inte bara app/api/portal/ — räknar ut vilken adress den svarar på, och kräver för allt under /api/portal/ att
 * varje handler BÖRJAR med portalens grind, importerad från app/api/portal/_shared.ts, och använder svaret:
 *
 *   export async function POST(req: NextRequest) {
 *     const verified = await verifyPortalRequest(req);
 *     if (!verified.ok) return verified.response;
 *
 * Inget får komma före — inte ens en läsning av kroppen eller en databasklient. Handlers ska vara
 * `export async function`; varje annan exportform av en HTTP-metod underkänns, liksom `export *` och `export default`.
 * En catch-all som kunde svara under /api/portal/ utanför de här reglerna underkänns också.
 */

const APP = resolve(process.cwd(), 'app');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_ALT = METHODS.join('|');
/** Grindarna en portalroute får börja med. Fas 4b lägger till cron-routens grind här. */
const GUARDS = ['verifyPortalRequest'];
const PORTAL_PREFIX = ['api', 'portal'];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

/** Adressens delar: routegrupper `(x)` och parallella `@x` syns inte i adressen. */
function urlSegments(file: string): string[] {
  return relative(APP, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'));
}

const isDynamic = (segment: string) => /^\[.*\]$/.test(segment);
const isCatchAll = (segment: string) => /^\[\[?\.\.\./.test(segment);

/** Kan routen svara på en adress under /api/portal/? */
function servesUnderPortal(segments: string[]): boolean {
  for (let i = 0; i < PORTAL_PREFIX.length; i++) {
    const segment = segments[i];
    if (segment === undefined) return false;
    if (isCatchAll(segment)) return true;
    if (!isDynamic(segment) && segment !== PORTAL_PREFIX[i]) return false;
  }
  return segments.length > PORTAL_PREFIX.length;
}

/**
 * Koden utan kommentarer, så att en utkommenterad grind inte räknas. Strängar lämnas orörda: annars hade `'/*'` i en
 * sträng fått resten av filen att försvinna fram till nästa kommentar.
 */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function handlers(source: string): { method: string; param: string | undefined; body: string }[] {
  const pattern = new RegExp(`export\\s+async\\s+function\\s+(${METHOD_ALT})\\s*\\(\\s*(\\w+)?[^)]*\\)[^{]*\\{`, 'g');
  return [...source.matchAll(pattern)].map((match) => ({
    method: match[1],
    param: match[2],
    body: source.slice((match.index ?? 0) + match[0].length),
  }));
}

const portalRoutes = routeFiles(APP).filter((file) => servesUnderPortal(urlSegments(file)));

describe('routerna som svarar under /api/portal/ (middleware släpper dem utan session)', () => {
  it('hittar routerna — ett test som inte ser några prövar ingenting', () => {
    expect(portalRoutes.map((f) => relative(APP, f))).toContain(join('api', 'portal', 'ping', 'route.ts'));
  });

  it('räknar ut adressen rätt, också genom routegrupper och catch-all', () => {
    expect(servesUnderPortal(['api', 'portal', 'ping'])).toBe(true);
    expect(servesUnderPortal(['api', 'portal', '[quoteId]', 'messages'])).toBe(true);
    expect(servesUnderPortal(['api', '[...slug]'])).toBe(true);
    expect(servesUnderPortal(['[[...all]]'])).toBe(true);
    expect(servesUnderPortal(['api', '[x]', 'y'])).toBe(true);
    expect(servesUnderPortal(['api', 'portal'])).toBe(false);
    expect(servesUnderPortal(['api', 'crm', 'portal', 'x'])).toBe(false);
    expect(servesUnderPortal(['api', 'portalen', 'x'])).toBe(false);
    expect(urlSegments(join(APP, '(publik)', 'api', 'portal', 'x', 'route.ts'))).toEqual(['api', 'portal', 'x']);
  });

  for (const file of portalRoutes) {
    const name = relative(process.cwd(), file);
    const source = stripComments(readFileSync(file, 'utf8'));
    const segments = urlSegments(file);

    it(`${name}: ligger under app/api/portal/ och är ingen catch-all`, () => {
      expect(relative(APP, file).startsWith(join('api', 'portal') + sep)).toBe(true);
      expect(segments.some(isCatchAll)).toBe(false);
    });

    it(`${name}: handlers exporteras bara som export async function`, () => {
      // Varje export av ett metodnamn som INTE är `export async function METOD`.
      expect(source).not.toMatch(new RegExp(`export\\s+(?!async\\s+function\\s)(?:\\w+\\s+)*(?:function\\s+)?(${METHOD_ALT})\\b`));
      expect(source).not.toMatch(new RegExp(`export\\s*\\{[^}]*\\b(${METHOD_ALT})\\b[^}]*\\}`));
      expect(source).not.toMatch(/export\s*\*/);
      expect(source).not.toMatch(/export\s+default\b/);
      expect(handlers(source).length).toBeGreaterThan(0);
    });

    it(`${name}: grinden är den riktiga, importerad från app/api/portal/_shared.ts`, () => {
      for (const guard of GUARDS) {
        if (!source.includes(guard)) continue;
        expect(source).toMatch(
          new RegExp(`import\\s*\\{[^}]*\\b${guard}\\b[^}]*\\}\\s*from\\s*['"](?:(?:\\.\\./)+_shared|@/app/api/portal/_shared)['"]`),
        );
        // Ingen egen funktion eller variabel med samma namn.
        expect(source).not.toMatch(new RegExp(`(?:function|const|let|var|class)\\s+${guard}\\b`));
        expect(source).not.toMatch(new RegExp(`\\bas\\s+${guard}\\b`));
      }
    });

    it(`${name}: varje handler börjar med grinden på sin egen request och använder svaret`, () => {
      for (const { method, param, body } of handlers(source)) {
        expect(param, `${method} i ${name} tar ingen request`).toBeDefined();
        const guard = body.match(
          new RegExp(`^\\s*const\\s+(\\w+)\\s*=\\s*await\\s+(${GUARDS.join('|')})\\(\\s*${param}\\s*\\)\\s*;`),
        );
        expect(guard, `${method} i ${name} börjar inte med ${GUARDS.join(' eller ')}(${param})`).not.toBeNull();
        const variable = guard![1];
        expect(body.slice(guard![0].length), `${method} i ${name} använder inte grindens svar direkt efteråt`).toMatch(
          new RegExp(`^\\s*if\\s*\\(\\s*!\\s*${variable}\\.ok\\s*\\)\\s*return\\s+${variable}\\.response\\s*;`),
        );
      }
    });

    it(`${name}: cachar inga fetch-anrop, också när Next inte räknar routen som dynamisk`, () => {
      // 🧨 Next 14.2 sätter revalidate = 0 bara för routes med POST, DELETE, PATCH eller OPTIONS (hasNonStaticMethods i
      // app-route/module.js räknar POST två gånger och glömmer PUT). En portalroute läser aldrig kakan, så en route med
      // bara GET eller PUT cachar annars varje supabase-läsning (fas 4b: cron-routen, fas 8: ändringen av en beställning).
      const methods = handlers(source).map((h) => h.method);
      if (methods.some((m) => ['POST', 'DELETE', 'PATCH', 'OPTIONS'].includes(m))) return;
      expect(source).toMatch(/export\s+const\s+fetchCache\s*=\s*['"]force-no-store['"]/);
    });

    it(`${name}: tar inte in en sessionsgrind — inloggning hör hemma under /api/crm/portal/`, () => {
      expect(source).not.toMatch(/requirePermission|requireAnyPermission|requireSignedInUser|getCurrentUser|createSessionClient/);
    });
  }
});
