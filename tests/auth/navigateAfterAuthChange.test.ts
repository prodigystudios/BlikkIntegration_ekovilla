import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { navigateAfterAuthChange } from '@/lib/auth/navigateAfterAuthChange';

/**
 * Ett auth-byte följs av en FULL sidladdning, aldrig av en mjuk navigering.
 *
 * 🧨 Rotlayouten läser profil och behörigheter en gång per full laddning och renderas inte om vid
 * klientnavigering. Inloggningssidan körde `router.replace('/')` med en omladdning 250 ms senare som
 * reserv — men reserven sköt bara om man fortfarande stod på /auth. Svarade servern snabbare vann den
 * mjuka navigeringen, och användaren landade på Start med inloggningssidans skal: ingen roll, inga
 * nycklar, tills någon laddade om. "Ibland", i månader, och oftare när sidorna blev snabbare.
 *
 * Felet syns inte i någon typkontroll och inte i något test som renderar en sida — bara i en riktig
 * webbläsare, och bara när racet går åt fel håll. Därför en vakt på källkoden.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navigateAfterAuthChange', () => {
  it('laddar om hela sidan och ersätter historikposten', () => {
    const replace = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { replace, assign } });

    navigateAfterAuthChange('/');

    expect(replace).toHaveBeenCalledWith('/');
    // assign hade lagt auth-sidan i historiken — bakåtknappen hade tagit en inloggad användare dit.
    expect(assign).not.toHaveBeenCalled();
  });
});

// .ts med: en hook i app/auth som lindar useRouter hade annars tagit tillbaka racet förbi vakten.
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

// Sidorna som släpper in användaren i appen efter ett auth-byte.
const ENTRY_PAGES = [
  'app/auth/sign-in/page.tsx',
  'app/auth/create-account/page.tsx',
  'app/auth/reset-password-confirm/page.tsx',
];

describe('auth-sidorna navigerar aldrig mjukt', () => {
  const authSources = sourcesUnder('app/auth');

  it('hittar sidorna (annars är vakten tom)', () => {
    expect(authSources).toEqual(expect.arrayContaining(ENTRY_PAGES));
  });

  // Varje väg ut från en auth-sida korsar auth-gränsen: in i appen efter inloggning, nytt konto eller
  // nytt lösenord. Behöver en framtida auth-sida länka till en annan auth-sida duger en <a href>.
  it.each(authSources)('%s använder inte useRouter', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/\buseRouter\b/);
    expect(src).not.toMatch(/\brouter\.(replace|push)\(/);
  });

  it.each(ENTRY_PAGES)('%s går in i appen med navigateAfterAuthChange', (file) => {
    expect(readFileSync(file, 'utf8')).toContain("navigateAfterAuthChange('/')");
  });

  it('utloggningen laddar om till inloggningssidan', () => {
    // Åt andra hållet: en mjuk navigering lämnar förra användarens profil och nycklar i skalet.
    const src = readFileSync('app/components/ProfileMenu.tsx', 'utf8');
    expect(src).toContain("navigateAfterAuthChange('/auth/sign-in')");
    expect(src).not.toMatch(/\brouter\.(replace|push)\(\s*['"`]\/auth/);
  });
});
