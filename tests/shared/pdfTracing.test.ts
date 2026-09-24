import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// outputFileTracingIncludes i next.config.js — listan över filer under public/ som PDF-routerna läser
// VID KÖRNING och som därför måste packas med i respektive serverfunktion.
//
// DRIFTINCIDENTEN 2026-09-04: offertens typsnitt följde aldrig med (ENOENT i drift), eftersom Next
// bara spårar ett path.join med enbart literaler. Lokalt märks ingenting — filerna ligger kvar på
// disk — så varken dev, typkontroll eller en vanlig test fångar felet. Två sätt att få det tillbaka:
// ett mönster som inte längre hittar någon fil (omdöpt eller flyttad fil), och en nyckel som inte
// längre är en route (omdöpt mapp) — båda tysta. Den här vakten fångar båda, och kräver att
// KMA-planens route har typsnitten och BÅDA loggorna.

const require = createRequire(import.meta.url);
const config = require('../../next.config.js') as {
  experimental: { outputFileTracingIncludes: Record<string, string[]> };
};
const includes = config.experimental.outputFileTracingIncludes;

/** Filerna ett mönster träffar. Mönstren är antingen en exakt sökväg eller katalog/*.ändelse. */
function filesFor(pattern: string): string[] {
  const full = resolve(process.cwd(), pattern);
  if (!full.includes('*')) return existsSync(full) ? [full] : [];
  const dir = dirname(full);
  const glob = new RegExp(`^${basename(full).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return existsSync(dir) ? readdirSync(dir).filter((name) => glob.test(name)) : [];
}

describe('outputFileTracingIncludes', () => {
  it('varje mönster hittar minst en fil', () => {
    for (const [route, patterns] of Object.entries(includes)) {
      for (const pattern of patterns) {
        expect(filesFor(pattern).length, `${route}: ${pattern}`).toBeGreaterThan(0);
      }
    }
  });

  it('varje nyckel är en route som finns', () => {
    for (const route of Object.keys(includes)) {
      expect(existsSync(join(process.cwd(), 'app', route, 'route.ts')), route).toBe(true);
    }
  });

  it('KMA-planens PDF-route har typsnitten och båda bolagens loggor', () => {
    const patterns = includes['/api/crm/work-orders/[id]/kma-plans/[planId]/pdf'];
    expect(patterns).toBeDefined();
    expect(patterns).toEqual(
      expect.arrayContaining([
        './public/brand/fonts/*.ttf',
        './public/brand/Ekovilla_logo_Figma.png',
        './public/brand/Isoleringslandslaget_logo.jpg',
      ]),
    );
  });
});
