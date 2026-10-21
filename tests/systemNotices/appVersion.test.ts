import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isOtherAppVersionLive } from '@/lib/domains/systemNotices/appVersion';

describe('isOtherAppVersionLive', () => {
  it('är sant när servern kör en annan version än fliken', () => {
    expect(isOtherAppVersionLive('dpl_gammal', 'dpl_ny')).toBe(true);
  });

  it('är falskt när versionerna är samma', () => {
    expect(isOtherAppVersionLive('dpl_ny', 'dpl_ny')).toBe(false);
  });

  // Tomt = vet inte. Lokalt saknas versionen helt, och ett svar utan fältet (en äldre driftsättning) ska inte få varje
  // flik att be om omladdning.
  it('är falskt när någon sida saknar version', () => {
    expect(isOtherAppVersionLive('', 'dpl_ny')).toBe(false);
    expect(isOtherAppVersionLive('dpl_gammal', '')).toBe(false);
    expect(isOtherAppVersionLive('dpl_gammal', null)).toBe(false);
    expect(isOtherAppVersionLive(undefined, 'dpl_ny')).toBe(false);
  });
});

// 🧨 Versionen måste komma från BYGGET på båda sidor. Läste servern den ur miljön vid körning hade den kunnat få en annan
// källa än den som bakades in i klientkoden (en variabel som finns vid körning men inte vid bygge) — och då hade varje
// flik, för alla användare, visat "Appen har uppdaterats" hela tiden.
describe('versionen bakas in vid bygget', () => {
  it('next.config.js bakar in NEXT_PUBLIC_APP_BUILD_ID via env', () => {
    const config = readFileSync('next.config.js', 'utf8');
    expect(config).toMatch(/env:\s*\{[^}]*NEXT_PUBLIC_APP_BUILD_ID:/);
  });

  it('appVersion läser bara den inbakade variabeln', () => {
    const source = readFileSync('lib/domains/systemNotices/appVersion.ts', 'utf8');
    const reads = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(reads).toEqual(['NEXT_PUBLIC_APP_BUILD_ID']);
  });

  it('/api/app-status läser ingen miljövariabel själv', () => {
    const route = readFileSync('app/api/app-status/route.ts', 'utf8');
    expect(route).toContain("from '@/lib/domains/systemNotices/appVersion'");
    expect(route).not.toMatch(/process\.env/);
  });
});
