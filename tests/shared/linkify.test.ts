import { describe, it, expect } from 'vitest';
import { splitLinkParts } from '@/lib/shared/linkify';

// splitLinkParts matas med ANVÄNDARSKRIVEN text (arbetsorderkommentarer). Testerna nedan är därför
// lika mycket en spärr mot att någon "förenklar" den till strängbygge med taggar i som en
// funktionskontroll.

describe('splitLinkParts', () => {
  it('plockar ut adressen ur egenkontrollens kommentarrad', () => {
    const body = 'Egenkontroll gjord 2026-08-28\nLadda ner här: https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2FEgenkontroll_Kund_6579.pdf';
    expect(splitLinkParts(body)).toEqual([
      { type: 'text', value: 'Egenkontroll gjord 2026-08-28\nLadda ner här: ' },
      { type: 'link', value: 'https://app.ekovilla.se/api/storage/download?path=Egenkontroller%2FEgenkontroll_Kund_6579.pdf' },
    ]);
  });

  it('lämnar text utan adresser orörd, som en enda del', () => {
    expect(splitLinkParts('Kollade vinden, allt OK.')).toEqual([
      { type: 'text', value: 'Kollade vinden, allt OK.' },
    ]);
  });

  it('hanterar flera adresser och behåller texten mellan dem', () => {
    const parts = splitLinkParts('se https://a.example/x och https://b.example/y tack');
    expect(parts.map((p) => p.type)).toEqual(['text', 'link', 'text', 'link', 'text']);
    expect(parts[1].value).toBe('https://a.example/x');
    expect(parts[3].value).toBe('https://b.example/y');
    expect(parts[4].value).toBe(' tack');
  });

  // 🧨 Punkten efter adressen hör till meningen. Utan putsningen blir den en del av href och
  // nedladdningen svarar 404 — på en länk som SER rätt ut.
  it('lämnar avslutande skiljetecken utanför adressen', () => {
    const parts = splitLinkParts('Filen ligger på https://a.example/rapport.pdf.');
    expect(parts[1]).toEqual({ type: 'link', value: 'https://a.example/rapport.pdf' });
    expect(parts[2]).toEqual({ type: 'text', value: '.' });
  });

  it('behåller en slutparentes som hör till adressen', () => {
    const parts = splitLinkParts('se https://sv.wikipedia.org/wiki/Cellulosa_(material) nu');
    expect(parts[1].value).toBe('https://sv.wikipedia.org/wiki/Cellulosa_(material)');
  });

  it('klipper bort en slutparentes som hör till meningen', () => {
    const parts = splitLinkParts('(se https://a.example/x)');
    expect(parts[1].value).toBe('https://a.example/x');
    expect(parts[2]).toEqual({ type: 'text', value: ')' });
  });

  // 🧨 SÄKERHETSSPÄRREN. Ett annat schema får aldrig bli klickbart: kommentaren skrivs av en
  // människa, och en klickbar javascript:-adress i en delad tråd är en väg in i någon annans
  // session. Regexet matchar bara http/https — det här testet är vakten mot att någon vidgar det.
  it('gör INTE andra scheman klickbara', () => {
    for (const evil of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
    ]) {
      expect(splitLinkParts(`klicka ${evil} här`)).toEqual([
        { type: 'text', value: `klicka ${evil} här` },
      ]);
    }
  });

  it('ger en tom lista för tom text', () => {
    expect(splitLinkParts('')).toEqual([]);
    expect(splitLinkParts(null)).toEqual([]);
    expect(splitLinkParts(undefined)).toEqual([]);
  });

  // Sammanfogade delar måste ge tillbaka originalet exakt — annars tappar renderingen tecken ur en
  // kommentar någon skrivit.
  it('bevarar originaltexten när delarna fogas ihop igen', () => {
    for (const body of [
      'Egenkontroll gjord 2026-08-28\nLadda ner här: https://a.example/x.pdf',
      'a https://a.example/1. b https://b.example/2) c',
      'ingen adress alls',
      'https://a.example/x',
    ]) {
      expect(splitLinkParts(body).map((p) => p.value).join('')).toBe(body);
    }
  });
});
