import { describe, it, expect } from 'vitest';
import { findLatestEgenkontrollLink } from '@/lib/domains/crm/egenkontrollLink';

const link = (file: string) =>
  `https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2F${file}`;

const comment = (body: string, created_at: string) => ({ body, created_at });

describe('findLatestEgenkontrollLink', () => {
  it('hittar länken i egenkontrollens kommentar', () => {
    const url = link('Egenkontroll_Kund_6579.pdf');
    expect(
      findLatestEgenkontrollLink([
        comment('Börjar imorgon', '2026-08-20T08:00:00Z'),
        comment(`Egenkontroll gjord 2026-08-28\nLadda ner här: ${url}`, '2026-08-28T15:00:00Z'),
      ]),
    ).toBe(url);
  });

  // 🧨 En ny egenkontroll ERSÄTTER orderns tidigare — samma regel som final-raderna i säckboken.
  // Visas den äldsta läser kontoret siffror som inte längre gäller.
  it('väljer den SENASTE när ordern har flera egenkontroller', () => {
    const gammal = link('Egenkontroll_Kund_6579.pdf');
    const ny = link('Egenkontroll_Kund_6579-1.pdf');
    expect(
      findLatestEgenkontrollLink([
        comment(`Ladda ner här: ${gammal}`, '2026-08-20T09:00:00Z'),
        comment(`Ladda ner här: ${ny}`, '2026-08-28T09:00:00Z'),
      ]),
    ).toBe(ny);
  });

  it('bryr sig inte om vilken ordning kommentarerna kommer i', () => {
    const gammal = link('gammal.pdf');
    const ny = link('ny.pdf');
    expect(
      findLatestEgenkontrollLink([
        comment(`Ladda ner här: ${ny}`, '2026-08-28T09:00:00Z'),
        comment(`Ladda ner här: ${gammal}`, '2026-08-20T09:00:00Z'),
      ]),
    ).toBe(ny);
  });

  // 🧨 KÄRNSPÄRREN. Utan Egenkontroller-prefixet i matchningen hade vilken arkivlänk som helst i en
  // kommentar — en ritning, ett kvitto — dykt upp under rubriken "Egenkontroll".
  it('plockar INTE upp andra arkivlänkar', () => {
    const annat = 'https://app.ekovilla.se/api/storage/download?path=Documents%2FRitning.pdf';
    expect(findLatestEgenkontrollLink([comment(`Ritningen: ${annat}`, '2026-08-28T09:00:00Z')])).toBeNull();
  });

  it('plockar INTE upp godtyckliga adresser', () => {
    expect(
      findLatestEgenkontrollLink([comment('Se https://example.com/Egenkontroller/fake.pdf', '2026-08-28T09:00:00Z')]),
    ).toBeNull();
  });

  it('godtar även en okodad sökväg', () => {
    const url = 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller/Egenkontroll_Kund_6579.pdf';
    expect(findLatestEgenkontrollLink([comment(`Ladda ner här: ${url}`, '2026-08-28T09:00:00Z')])).toBe(url);
  });

  it('lämnar avslutande skiljetecken utanför adressen', () => {
    const url = link('rapport.pdf');
    expect(findLatestEgenkontrollLink([comment(`Ladda ner här: ${url}.`, '2026-08-28T09:00:00Z')])).toBe(url);
  });

  // Ett otolkbart datum får inte kasta bort en länk vi faktiskt kan öppna.
  it('använder länken även när datumet inte går att tolka', () => {
    const url = link('rapport.pdf');
    expect(findLatestEgenkontrollLink([{ body: `Ladda ner här: ${url}`, created_at: 'inte ett datum' }])).toBe(url);
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
