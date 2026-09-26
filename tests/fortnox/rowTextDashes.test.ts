import { describe, it, expect } from 'vitest';
import { appendFortnoxTextNote, fortnoxRowText } from '@/lib/domains/fortnox/helpers';
import { buildOrderRows } from '@/lib/domains/fortnox/orders';
import { buildOfferRows } from '@/lib/domains/fortnox/offers';
import { buildInvoiceRows } from '@/lib/domains/fortnox/partialInvoices';

// 🧨 Fortnox avvisar em-streck (—) i en radbeskrivning med 2000359 "otillåtna tecken". Ett enda
// streck i ett ordernamn, en benämning eller en radtext fällde HELA pushen — ordern stämplades
// 'failed' och faktureringen spärrades. Varje väg där fritext blir en Description prövas för sig.
const EM = '—';
const EN = '–';
const hasDash = (s: unknown) => /[–—]/.test(String(s));

describe('fortnoxRowText', () => {
  it('byter em- och tankstreck mot bindestreck och lämnar resten orört', () => {
    expect(fortnoxRowText(`Vind ${EM} garage ${EN} förråd - loft`)).toBe('Vind - garage - förråd - loft');
    expect(fortnoxRowText('Lösull 190 mm, 45 kg/m³')).toBe('Lösull 190 mm, 45 kg/m³');
  });
});

describe('fritext till Fortnox-rader — inget streck når dokumentet', () => {
  const item = { id: 'a', pricing_mode: 'item' as const, unit_price: '100', quantity: '2', article_name: `Isolering ${EM} vind`, line_note: `Tänk på ${EN} hunden` };

  // Ordernamnet och märkningen: dokumentets textrad, sist.
  it('ordern: titelraden', () => {
    // Utan radtext: annars slås noten (med flit) ihop med radtextens textrad — se sista testet.
    const rows = buildOrderRows([{ ...item, line_note: '' }], 25, false, false, `Projekt: Villa ${EM} Norrköping`);
    expect(rows[rows.length - 1].Description).toBe('Projekt: Villa - Norrköping');
  });

  it('ordern: benämning och radtext', () => {
    const [row, text] = buildOrderRows([item], 25, false);
    expect(row.Description).toBe('Isolering - vind');
    expect(text.Description).toBe('Tänk på - hunden');
  });

  // Radtexten som Description när raden saknar artikelnamn.
  it('ordern: radtext som enda beskrivning', () => {
    const [row] = buildOrderRows([{ ...item, article_name: null }], 25, false);
    expect(row.Description).toBe('Tänk på - hunden');
  });

  it('offerten: benämning och textraden med radtext', () => {
    const rows = buildOfferRows([item], 25, false);
    expect(rows.some((r) => hasDash(r.Description))).toBe(false);
    expect(rows[0].Description).toBe('Isolering - vind');
  });

  it('delfakturan: benämningen', () => {
    const rows = buildInvoiceRows([item], new Map([['a', 1]]), 25, false);
    expect(rows[0].Description).toBe('Isolering - vind');
  });

  // Noten slås ihop med en föregående textrad — även den vägen ska tvättas.
  it('textnoten, också när den slås ihop med en befintlig textrad', () => {
    const merged = appendFortnoxTextNote(buildOrderRows([item], 25, false), `Märkning: A${EM}1`);
    expect(merged[merged.length - 1].Description).toBe('Tänk på - hunden  Märkning: A-1');
  });
});
