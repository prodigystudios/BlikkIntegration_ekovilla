import { describe, it, expect } from 'vitest';
import { buildDocumentEmailDraft, buildDocumentFilename, buildMailtoUrl } from '@/lib/domains/crm/documentEmail';

describe('buildDocumentEmailDraft', () => {
  it('offert: ämne, brödtext och filnamn', () => {
    const draft = buildDocumentEmailDraft({ kind: 'offer', ref: '12345', projectName: 'Takisolering villa' });
    expect(draft.subject).toBe('Offert 12345 – Takisolering villa');
    expect(draft.body).toContain('Här kommer offert 12345 gällande Takisolering villa. Offerten bifogas som PDF.');
    expect(draft.filename).toBe('Offert 12345 - Takisolering villa.pdf');
  });

  it('orderbekräftelse: egen ordlydelse och eget filnamn', () => {
    const draft = buildDocumentEmailDraft({ kind: 'order', ref: '778', projectName: 'Vindsisolering' });
    expect(draft.subject).toBe('Orderbekräftelse 778 – Vindsisolering');
    expect(draft.body).toContain('Här kommer orderbekräftelse 778 gällande Vindsisolering. Orderbekräftelsen bifogas som PDF.');
    // Filnamnet måste vara ASCII — å/ä/ö i ett filnamn ger olika resultat per webbläsare.
    expect(draft.filename).toBe('Orderbekraftelse 778 - Vindsisolering.pdf');
  });

  it('utan projektnamn utelämnas både suffix och "gällande"', () => {
    const draft = buildDocumentEmailDraft({ kind: 'offer', ref: '12345', projectName: null });
    expect(draft.subject).toBe('Offert 12345');
    expect(draft.body).toContain('Här kommer offert 12345. Offerten bifogas som PDF.');
  });

  it('blankt projektnamn behandlas som inget', () => {
    expect(buildDocumentEmailDraft({ kind: 'offer', ref: '1', projectName: '   ' }).subject).toBe('Offert 1');
  });

  it('brödtexten inleds med hälsning och avslutas med avsändarrad', () => {
    const body = buildDocumentEmailDraft({ kind: 'offer', ref: '1' }).body;
    expect(body.startsWith('Hej,')).toBe(true);
    expect(body.endsWith('Med vänliga hälsningar')).toBe(true);
  });
});

describe('buildMailtoUrl', () => {
  it('bygger mailto med kodat ämne och brödtext', () => {
    const url = buildMailtoUrl('anna@acme.se', { subject: 'Offert 1', body: 'Hej,\nRad två' });
    expect(url).toBe('mailto:anna%40acme.se?subject=Offert%201&body=Hej%2C%0ARad%20tv%C3%A5');
  });

  // Utan kodning skulle URL:en ta slut vid första & eller # och utkastet tystnade halvvägs.
  it('kodar tecken som annars skulle kapa URL:en', () => {
    const url = buildMailtoUrl('a@b.se', { subject: 'Tak & vind #2', body: 'A&B #3' });
    expect(url).toContain('subject=Tak%20%26%20vind%20%232');
    expect(url).toContain('body=A%26B%20%233');
    expect(url).not.toContain('#2');
  });

  it('tom mottagare ger ändå ett giltigt utkast', () => {
    expect(buildMailtoUrl('', { subject: 'S', body: 'B' })).toBe('mailto:?subject=S&body=B');
  });
});

describe('buildDocumentFilename', () => {
  it('offertnummer + offertnamn', () => {
    expect(buildDocumentFilename({ kind: 'offer', ref: '12345', projectName: 'Takisolering villa' }))
      .toBe('Offert 12345 - Takisolering villa.pdf');
  });

  // documentRef() ger numret som "#12345", och # är inget att ha i ett filnamn.
  it('rensar # och andra tecken som inte hör hemma i ett filnamn', () => {
    expect(buildDocumentFilename({ kind: 'offer', ref: '#12345', projectName: 'Tak / vind: etapp 2' }))
      .toBe('Offert 12345 - Tak vind etapp 2.pdf');
  });

  // å/ä/ö i ett filnamn renderas olika per webbläsare och filsystem.
  it('transkriberar å/ä/ö till ASCII', () => {
    expect(buildDocumentFilename({ kind: 'order', ref: '778', projectName: 'Vindsbjälklag Åkersberga' }))
      .toBe('Orderbekraftelse 778 - Vindsbjalklag Akersberga.pdf');
  });

  it('utan projektnamn blir det bara typ och nummer', () => {
    expect(buildDocumentFilename({ kind: 'offer', ref: '12345', projectName: '   ' })).toBe('Offert 12345.pdf');
    expect(buildDocumentFilename({ kind: 'offer', ref: '12345' })).toBe('Offert 12345.pdf');
  });

  // Ett långt projektnamn får inte spränga filnamnslängden på mottagarens filsystem.
  it('kapar ett långt projektnamn', () => {
    const name = buildDocumentFilename({ kind: 'offer', ref: '1', projectName: 'A'.repeat(200) });
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
