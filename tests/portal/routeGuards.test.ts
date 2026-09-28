import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 🧨 Middleware släpper HELA /api/portal/ förbi sessionskontrollen (återförsäljarportalen har ingen session). En route
 * där som glömmer signaturkontrollen är alltså öppen för vem som helst på internet. Testet går igenom varje route under
 * app/api/portal/ och kräver att varje handler BÖRJAR med portalens grind och använder svaret:
 *
 *   const verified = await verifyPortalRequest(req);
 *   if (!verified.ok) return verified.response;
 *
 * Inget får komma före — inte ens en läsning av kroppen eller en databasklient. Handlers ska vara
 * `export async function POST(...)`, så att testet ser dem; andra exportformer underkänns.
 */

const ROOT = resolve(process.cwd(), 'app/api/portal');
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
/** Grindarna en portalroute får börja med. Fas 4b lägger till cron-routens grind här. */
const GUARDS = ['verifyPortalRequest'];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' || name === 'route.tsx' ? [path] : [];
  });
}

/** Koden utan kommentarer, så att en utkommenterad grind inte räknas. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Handlerns kropp från första `{` efter signaturen, fram till första två satserna. */
function handlers(source: string): { method: string; body: string }[] {
  const found: { method: string; body: string }[] = [];
  const pattern = new RegExp(`export\\s+async\\s+function\\s+(${METHODS})\\s*\\([^)]*\\)[^{]*\\{`, 'g');
  for (const match of source.matchAll(pattern)) {
    found.push({ method: match[1], body: source.slice((match.index ?? 0) + match[0].length) });
  }
  return found;
}

const files = routeFiles(ROOT);

describe('routerna under /api/portal/ (middleware släpper dem utan session)', () => {
  it('hittar routerna — ett test som inte ser några prövar ingenting', () => {
    expect(files.map((f) => relative(ROOT, f))).toContain(join('ping', 'route.ts'));
  });

  for (const file of files) {
    const name = relative(process.cwd(), file);
    const source = stripComments(readFileSync(file, 'utf8'));

    it(`${name}: handlers exporteras så att testet ser dem`, () => {
      expect(source).not.toMatch(new RegExp(`export\\s+(const|let|var)\\s+(${METHODS})\\b`));
      expect(source).not.toMatch(new RegExp(`export\\s*\\{[^}]*\\b(${METHODS})\\b[^}]*\\}`));
      expect(handlers(source).length).toBeGreaterThan(0);
    });

    it(`${name}: varje handler börjar med portalens grind och använder svaret`, () => {
      for (const { method, body } of handlers(source)) {
        const guard = body.match(
          new RegExp(`^\\s*const\\s+(\\w+)\\s*=\\s*await\\s+(${GUARDS.join('|')})\\(\\s*\\w+\\s*\\)\\s*;`),
        );
        expect(guard, `${method} i ${name} börjar inte med ${GUARDS.join(' eller ')}`).not.toBeNull();
        const rest = body.slice(guard![0].length);
        const [, variable] = guard!;
        expect(
          rest,
          `${method} i ${name} använder inte grindens svar direkt efteråt`,
        ).toMatch(new RegExp(`^\\s*if\\s*\\(\\s*!\\s*${variable}\\.ok\\s*\\)\\s*return\\s+${variable}\\.response\\s*;`));
      }
    });

    it(`${name}: tar inte in en sessionsgrind — inloggning hör hemma under /api/crm/portal/`, () => {
      expect(source).not.toMatch(/requirePermission|requireAnyPermission|requireSignedInUser|getCurrentUser|createSessionClient/);
    });
  }
});
