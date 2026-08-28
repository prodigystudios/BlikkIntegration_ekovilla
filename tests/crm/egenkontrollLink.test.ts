import { describe, it, expect } from 'vitest';
import { findLatestEgenkontrollLink } from '@/lib/domains/crm/egenkontrollLink';

const commentUrl = (host: string, file: string) =>
  `https://${host}/api/storage/download?path=Egenkontroller%2F${file}`;

const href = (file: string) =>
  `/api/storage/download?path=${encodeURIComponent(`Egenkontroller/${file}`)}`;

const comment = (body: string, created_at: string) => ({ body, created_at });

describe('findLatestEgenkontrollLink', () => {
  it('hittar egenkontrollen i kommentaren och svarar med VÅR egen adress', () => {
    expect(
      findLatestEgenkontrollLink([
        comment('Börjar imorgon', '2026-08-20T08:00:00Z'),
        comment(
          `Egenkontroll gjord 2026-08-28\nLadda ner här: ${commentUrl('app.ekovilla.se', 'Egenkontroll_Kund_6579.pdf')}`,
          '2026-08-28T15:00:00Z',
        ),
      ]),
    ).toBe(href('Egenkontroll_Kund_6579.pdf'));
  });

  // 🧨 SÄKERHETSSPÄRREN. Knappen heter "Öppna egenkontrollen (PDF)" och sitter i orderns eget kort,
  // så den bär husets auktoritet. Läste vi värdnamnet ur kommentaren kunde en inloggad kollega
  // klistra in en adress till vilken server som helst och få den renderad under den rubriken.
  // Sökvägen återanvänds; ursprunget kastas.
  it('litar ALDRIG på värdnamnet i kommentaren', () => {
    const result = findLatestEgenkontrollLink([
      comment(`Ladda ner här: ${commentUrl('phish.example', 'Egenkontroll_Kund_6579.pdf')}`, '2026-08-28T09:00:00Z'),
    ]);
    expect(result).toBe(href('Egenkontroll_Kund_6579.pdf'));
    expect(result).not.toContain('phish.example');
    expect(result?.startsWith('/api/storage/download?path=')).toBe(true);
  });

  // Länkar skrivna före domänbytet pekar på vercel.app-adressen. Filen ligger i samma bucket, så
  // ombyggnaden gör att de fungerar på app.ekovilla.se — och slutar inte fungera den dagen den
  // gamla domänen stängs av.
  it('räddar gamla länkar som bär den utgående domänen', () => {
    expect(
      findLatestEgenkontrollLink([
        comment(
          `Ladda ner här: ${commentUrl('blikk-integration-ekovilla.vercel.app', 'Egenkontroll_Tils_bygg.pdf')}`,
          '2026-08-21T09:00:00Z',
        ),
      ]),
    ).toBe(href('Egenkontroll_Tils_bygg.pdf'));
  });

  // 🧨 En ny egenkontroll ERSÄTTER orderns tidigare — samma regel som final-raderna i säckboken.
  // Visas den äldsta läser kontoret siffror som inte längre gäller.
  it('väljer den SENASTE när ordern har flera egenkontroller', () => {
    expect(
      findLatestEgenkontrollLink([
        comment(`Ladda ner här: ${commentUrl('app.ekovilla.se', 'gammal.pdf')}`, '2026-08-20T09:00:00Z'),
        comment(`Ladda ner här: ${commentUrl('app.ekovilla.se', 'ny.pdf')}`, '2026-08-28T09:00:00Z'),
      ]),
    ).toBe(href('ny.pdf'));
  });

  it('bryr sig inte om vilken ordning kommentarerna kommer i', () => {
    expect(
      findLatestEgenkontrollLink([
        comment(`Ladda ner här: ${commentUrl('app.ekovilla.se', 'ny.pdf')}`, '2026-08-28T09:00:00Z'),
        comment(`Ladda ner här: ${commentUrl('app.ekovilla.se', 'gammal.pdf')}`, '2026-08-20T09:00:00Z'),
      ]),
    ).toBe(href('ny.pdf'));
  });

  // 🧨 KÄRNSPÄRREN. Utan Egenkontroller-prefixet hade vilken arkivlänk som helst i en kommentar —
  // en ritning, ett kvitto — dykt upp under rubriken "Egenkontroll".
  it('plockar INTE upp andra arkivlänkar', () => {
    const annat = 'https://app.ekovilla.se/api/storage/download?path=Documents%2FRitning.pdf';
    expect(findLatestEgenkontrollLink([comment(`Ritningen: ${annat}`, '2026-08-28T09:00:00Z')])).toBeNull();
  });

  it('plockar INTE upp godtyckliga adresser', () => {
    expect(
      findLatestEgenkontrollLink([comment('Se https://example.com/Egenkontroller/fake.pdf', '2026-08-28T09:00:00Z')]),
    ).toBeNull();
  });

  it('avvisar sökvägstraversering', () => {
    const evil = 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2F..%2F..%2Fsecret.pdf';
    expect(findLatestEgenkontrollLink([comment(`Ladda ner här: ${evil}`, '2026-08-28T09:00:00Z')])).toBeNull();
  });

  it('avvisar en mapp utan fil i sig', () => {
    const bare = 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2F';
    expect(findLatestEgenkontrollLink([comment(`Ladda ner här: ${bare}`, '2026-08-28T09:00:00Z')])).toBeNull();
  });

  it('godtar även en okodad sökväg', () => {
    const url = 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller/Egenkontroll_Kund_6579.pdf';
    expect(findLatestEgenkontrollLink([comment(`Ladda ner här: ${url}`, '2026-08-28T09:00:00Z')])).toBe(
      href('Egenkontroll_Kund_6579.pdf'),
    );
  });

  it('lämnar avslutande skiljetecken utanför sökvägen', () => {
    expect(
      findLatestEgenkontrollLink([
        comment(`Ladda ner här: ${commentUrl('app.ekovilla.se', 'rapport.pdf')}.`, '2026-08-28T09:00:00Z'),
      ]),
    ).toBe(href('rapport.pdf'));
  });

  it('kraschar inte på trasig procentkodning', () => {
    const broken = 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2F%E0%A4%A.pdf';
    expect(() => findLatestEgenkontrollLink([comment(broken, '2026-08-28T09:00:00Z')])).not.toThrow();
    expect(findLatestEgenkontrollLink([comment(broken, '2026-08-28T09:00:00Z')])).toBeNull();
  });

  // Ett otolkbart datum får inte kasta bort en länk vi faktiskt kan öppna.
  it('använder länken även när datumet inte går att tolka', () => {
    expect(
      findLatestEgenkontrollLink([
        { body: `Ladda ner här: ${commentUrl('app.ekovilla.se', 'rapport.pdf')}`, created_at: 'inte ett datum' },
      ]),
    ).toBe(href('rapport.pdf'));
  });

  it('ger null när ordern saknar egenkontroll', () => {
    expect(findLatestEgenkontrollLink([comment('Inget särskilt', '2026-08-28T09:00:00Z')])).toBeNull();
    expect(findLatestEgenkontrollLink([])).toBeNull();
    expect(findLatestEgenkontrollLink(null)).toBeNull();
    expect(findLatestEgenkontrollLink(undefined)).toBeNull();
  });

  it('kraschar inte på en kommentar utan text', () => {
    expect(findLatestEgenkontrollLink([{ body: null, created_at: null }])).toBeNull();
  });
});
