import { describe, it, expect, vi, beforeEach } from 'vitest';

// Skattereduktionsposten (`/taxreductions`) på offert och order.
//
// Två lager. De rena funktionerna stavar ut Fortnox fältnamn och CRM:s belopp. Pushtesterna kör den
// RIKTIGA offert- och orderpushen mot en fake som gör exakt det testbolaget gjorde 2026-10-02 (se
// taxReductions.ts överst) — det är där felen satt: en post fryser avdraget, ett sänkt arbete nekar
// hela dokumentet, varje dokument-PUT byter postens Id och den sista posten går inte att radera.
// Pröva skydden genom att ta bort sänkningen före PUT:en eller `none`-grenen i offers.ts: då ska
// testerna här bli röda med Fortnox egna felkoder.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn(), fortnoxDelete: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { FortnoxApiError, fortnoxDelete, fortnoxGet, fortnoxPost, fortnoxPut } from '@/lib/domains/fortnox/client';
import {
  amountBeforeDocumentWrite,
  belongsToDocument,
  buildTaxReductionPayload,
  pickKeptPost,
  postMatchesPayload,
  prepareTaxReductionForDocumentWrite,
  resolveTaxReductionApplicant,
  rotAskedAmount,
  syncTaxReductionAfterDocumentWrite,
  type TaxReductionTarget,
} from '@/lib/domains/fortnox/taxReductions';
import { resolveRotApplicants } from '@/lib/domains/fortnox/documentPdfDesign';
import { pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';
import { updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

// Skatteverkets testperson Tolvan Tolvansson — inte en verklig person.
const PNR = '19121212-1212';

// ── Fortnox, som testbolaget betedde sig ─────────────────────────────────────

type Row = { Price?: number; Quantity?: number; OrderedQuantity?: number; VAT?: number; HouseWork?: boolean };
type Doc = { type: 'OFFER' | 'ORDER'; reductionType: string; rows: Row[] };
type Post = {
  Id: number; ReferenceDocumentType: 'OFFER' | 'ORDER'; ReferenceNumber: string; CustomerName: string;
  SocialSecurityNumber: string; AskedAmount: number; PropertyDesignation?: string | null;
  ResidenceAssociationOrganisationNumber?: string | null;
};

function fortnoxError(status: number, code: number, message: string) {
  return new FortnoxApiError(status, `Fortnox ${status}: ${message}`, code, message);
}

class FakeFortnox {
  docs = new Map<string, Doc>();
  posts: Post[] = [];
  private nextPostId = 100;
  private nextDocNumber = { OFFER: 37, ORDER: 90 };
  /** Fortnox räknar ROT-taket själv: 30 % av husarbetet inkl. moms. */
  private key = (type: 'OFFER' | 'ORDER', n: string) => `${type}:${n}`;

  basis(doc: Doc): number {
    return doc.rows.filter((r) => r.HouseWork).reduce(
      (sum, r) => sum + (r.Price ?? 0) * (r.Quantity ?? r.OrderedQuantity ?? 0) * (1 + (r.VAT ?? 0) / 100), 0,
    );
  }
  ceiling(doc: Doc): number { return Math.floor(this.basis(doc) * 0.3); }
  postsFor(type: 'OFFER' | 'ORDER', n: string) {
    return this.posts.filter((p) => p.ReferenceDocumentType === type && p.ReferenceNumber === n);
  }
  docView(type: 'OFFER' | 'ORDER', n: string) {
    const doc = this.docs.get(this.key(type, n))!;
    const posts = this.postsFor(type, n);
    // Punkt 2: finns en post är avdraget posternas summa, annars Fortnox egen uträkning.
    const reduction = doc.reductionType === 'rot'
      ? (posts.length ? posts.reduce((s, p) => s + p.AskedAmount, 0) : this.ceiling(doc))
      : null;
    return { DocumentNumber: n, TaxReductionType: doc.reductionType, TaxReduction: reduction };
  }

  seedDoc(type: 'OFFER' | 'ORDER', n: string, rows: Row[]) {
    this.docs.set(this.key(type, n), { type, reductionType: 'rot', rows });
  }
  seedPost(post: Omit<Post, 'Id'>): Post {
    const created = { ...post, Id: this.nextPostId++ };
    this.posts.push(created);
    return created;
  }

  async get(path: string, params?: Record<string, string>) {
    if (path === '/taxreductions') {
      const type = params?.filter === 'orders' ? 'ORDER' : 'OFFER';
      // Listan bär inte AskedAmount (mätt). Och Fortnox numrerar i skilda serier, så en post för en
      // FAKTURA med samma nummer ligger med i svaret — anroparen måste sålla.
      return {
        TaxReductions: [
          ...this.posts.filter((p) => p.ReferenceDocumentType === type)
            .map(({ AskedAmount: _omitted, ...rest }) => ({ ...rest, ReferenceNumber: Number(rest.ReferenceNumber) })),
          { Id: 1, ReferenceDocumentType: 'INVOICE', ReferenceNumber: Number(params?.referencenumber), CustomerName: 'Främling', SocialSecurityNumber: '19800101-0000' },
        ],
      };
    }
    const single = /^\/taxreductions\/(\d+)$/.exec(path);
    if (single) {
      const post = this.posts.find((p) => p.Id === Number(single[1]));
      if (!post) throw fortnoxError(404, 2000519, 'Kan inte hitta skattereduktionen.');
      return { TaxReduction: { ...post } };
    }
    throw new Error(`fake: okänd GET ${path}`);
  }

  async post(path: string, body: any) {
    if (path === '/offers' || path === '/orders') {
      const type = path === '/offers' ? 'OFFER' : 'ORDER';
      const n = String(this.nextDocNumber[type]++);
      const payload = type === 'OFFER' ? body.Offer : body.Order;
      this.docs.set(this.key(type, n), { type, reductionType: payload.TaxReductionType ?? 'none', rows: payload.OfferRows ?? payload.OrderRows });
      return type === 'OFFER' ? { Offer: this.docView(type, n) } : { Order: this.docView(type, n) };
    }
    if (path === '/taxreductions') {
      const t = body.TaxReduction;
      const doc = this.docs.get(this.key(t.ReferenceDocumentType, t.ReferenceNumber))!;
      const sum = this.postsFor(t.ReferenceDocumentType, t.ReferenceNumber).reduce((s, p) => s + p.AskedAmount, 0);
      if (sum + t.AskedAmount > this.ceiling(doc)) throw fortnoxError(400, 2003228, 'Skattereduktion på rad överskrider möjlig skattereduktion på fakturan.');
      return { TaxReduction: this.seedPost(t) };
    }
    throw new Error(`fake: okänd POST ${path}`);
  }

  async put(path: string, body: any) {
    const docPath = /^\/(offers|orders)\/(\d+)$/.exec(path);
    if (docPath) {
      const type = docPath[1] === 'offers' ? 'OFFER' : 'ORDER';
      const n = docPath[2];
      const doc = this.docs.get(this.key(type, n))!;
      const payload = type === 'OFFER' ? body.Offer : body.Order;
      const next: Doc = { ...doc, rows: payload.OfferRows ?? payload.OrderRows ?? doc.rows };
      if (payload.TaxReductionType === 'none') {
        if (next.rows.some((r) => r.HouseWork)) throw fortnoxError(400, 2004001, 'Skattereduktionstyp får inte vara none om det finns rader med husarbete.');
        next.reductionType = 'none';
        // Punkt 7: Fortnox tar själv bort posterna.
        this.posts = this.posts.filter((p) => !(p.ReferenceDocumentType === type && p.ReferenceNumber === n));
      } else if (payload.TaxReductionType) {
        next.reductionType = payload.TaxReductionType;
      }
      const posts = this.postsFor(type, n);
      // Punkt 3: summan av posterna får inte överstiga det nya taket.
      if (next.reductionType === 'rot' && posts.reduce((s, p) => s + p.AskedAmount, 0) > this.ceiling(next)) {
        throw fortnoxError(400, 2003227, 'Summan av raderna överskrider möjlig skattereduktion på fakturan.');
      }
      this.docs.set(this.key(type, n), next);
      // Punkt 4: varje dokument-PUT ersätter posterna med nya Id.
      for (const post of posts) post.Id = this.nextPostId++;
      return type === 'OFFER' ? { Offer: this.docView(type, n) } : { Order: this.docView(type, n) };
    }
    const single = /^\/taxreductions\/(\d+)$/.exec(path);
    if (single) {
      const post = this.posts.find((p) => p.Id === Number(single[1]));
      if (!post) throw fortnoxError(404, 2000519, 'Kan inte hitta skattereduktionen.');
      const t = body.TaxReduction;
      const doc = this.docs.get(this.key(post.ReferenceDocumentType, post.ReferenceNumber))!;
      const others = this.postsFor(post.ReferenceDocumentType, post.ReferenceNumber).filter((p) => p !== post);
      if (others.reduce((s, p) => s + p.AskedAmount, 0) + t.AskedAmount > this.ceiling(doc)) {
        throw fortnoxError(400, 2003228, 'Skattereduktion på rad överskrider möjlig skattereduktion på fakturan.');
      }
      Object.assign(post, t);
      return { TaxReduction: { ...post } };
    }
    throw new Error(`fake: okänd PUT ${path}`);
  }

  async delete(path: string) {
    const single = /^\/taxreductions\/(\d+)$/.exec(path);
    const post = single ? this.posts.find((p) => p.Id === Number(single[1])) : undefined;
    if (!post) throw fortnoxError(404, 2000519, 'Kan inte hitta skattereduktionen.');
    const doc = this.docs.get(this.key(post.ReferenceDocumentType, post.ReferenceNumber))!;
    // Punkt 5: den sista posten på ett husarbetsdokument går inte att radera.
    if (doc.reductionType === 'rot' && this.postsFor(post.ReferenceDocumentType, post.ReferenceNumber).length === 1) {
      throw fortnoxError(400, 2001246, 'Minst en skattereduktion måste vara kopplat till en faktura som är märkt för husarbete, använd PUT för att isället uppdatera.');
    }
    this.posts = this.posts.filter((p) => p !== post);
  }
}

let fake: FakeFortnox;

function wireFake() {
  fake = new FakeFortnox();
  vi.mocked(fortnoxGet).mockImplementation(((path: string, params?: Record<string, string>) => fake.get(path, params)) as never);
  vi.mocked(fortnoxPost).mockImplementation(((path: string, body: unknown) => fake.post(path, body)) as never);
  vi.mocked(fortnoxPut).mockImplementation(((path: string, body: unknown) => fake.put(path, body)) as never);
  vi.mocked(fortnoxDelete).mockImplementation(((path: string) => fake.delete(path)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  wireFake();
});

// ── Rena delar ───────────────────────────────────────────────────────────────

describe('belongsToDocument', () => {
  it('kräver både dokumenttyp och nummer — serierna är skilda', () => {
    expect(belongsToDocument({ ReferenceDocumentType: 'OFFER', ReferenceNumber: 37 }, 'OFFER', '37')).toBe(true);
    expect(belongsToDocument({ ReferenceDocumentType: 'INVOICE', ReferenceNumber: 37 }, 'OFFER', '37')).toBe(false);
    expect(belongsToDocument({ ReferenceDocumentType: 'ORDER', ReferenceNumber: '37' }, 'OFFER', '37')).toBe(false);
    expect(belongsToDocument({ ReferenceDocumentType: 'OFFER', ReferenceNumber: 38 }, 'OFFER', '37')).toBe(false);
  });
});

describe('rotAskedAmount', () => {
  const labour = (price: string) => ({ pricing_mode: 'item', unit_price: price, quantity: '1', is_rot_work: true });
  const material = { pricing_mode: 'item', unit_price: '5000', quantity: '1' };

  it('är 30 % av arbetet inklusive moms, i hela kronor — samma tal som formuläret visar', () => {
    expect(rotAskedAmount([labour('10000'), material], 25, null)).toBe(3750);
    expect(rotAskedAmount([labour('333.33')], 25, null)).toBe(124); // 124,99875 → 124
  });

  it('följer CRM:s procent och maxavdrag', () => {
    expect(rotAskedAmount([labour('20000')], 25, { max_deduction: 5000 })).toBe(5000);
    expect(rotAskedAmount([labour('10000')], 25, { rot_percent: 20 })).toBe(2500);
    // Svensk decimal i en sträng, som ROT-fälten kan ligga i kolumnen.
    expect(rotAskedAmount([labour('10000')], '25', { rot_percent: '20,5' as unknown as number })).toBe(2562);
  });

  it('räknar bara arbete — material ger inget avdrag', () => {
    expect(rotAskedAmount([material], 25, null)).toBe(0);
  });
});

describe('resolveTaxReductionApplicant', () => {
  it('tar personnumret ur kundkortet före snapshotet, normaliserat till ÅÅÅÅMMDD-XXXX', () => {
    expect(resolveTaxReductionApplicant({ customerName: 'Tolvan', cardPersonalNumber: '191212121212', snapshotPersonalNumber: '19800101-0000' }))
      .toEqual({ name: 'Tolvan', personalNumber: PNR });
    expect(resolveTaxReductionApplicant({ customerName: 'Tolvan', cardPersonalNumber: null, snapshotPersonalNumber: PNR }))
      .toEqual({ name: 'Tolvan', personalNumber: PNR });
  });

  it('namnet ur ROT-sektionen vinner över kundnamnet', () => {
    expect(resolveTaxReductionApplicant({ applicantName: 'Sökande Person', customerName: 'Kund', cardPersonalNumber: PNR })?.name).toBe('Sökande Person');
  });

  // ⚠️ Tio siffror dödar ROT tyst i Fortnox. Hellre ingen post än en som ser rätt ut.
  it('ger ingen sökande utan ett giltigt tolvsiffrigt nummer eller utan namn', () => {
    expect(resolveTaxReductionApplicant({ customerName: 'Tolvan', cardPersonalNumber: '121212-1212' })).toBeNull();
    expect(resolveTaxReductionApplicant({ customerName: 'Tolvan', cardPersonalNumber: '' })).toBeNull();
    expect(resolveTaxReductionApplicant({ customerName: '', cardPersonalNumber: PNR })).toBeNull();
  });

  // PDF:en och posten ska namnge samma person. Regeln bor på två ställen (pdf-lib hålls utanför
  // push-vägen), så de låses mot varandra här.
  it('väljer samma namn och nummer som PDF:ens resolveRotApplicants', () => {
    const cases = [
      { rot: { applicant_name: 'A' }, card: PNR, snap: '19800101-0008', customer: 'K' },
      { rot: { applicant_name: '' }, card: '', snap: PNR, customer: 'K' },
      { rot: null, card: '  ', snap: PNR, customer: 'Kund Kundsson' },
    ];
    for (const c of cases) {
      const [pdf] = resolveRotApplicants({ rotDetails: c.rot, cardPersonalNumber: c.card, snapshotPersonalNumber: c.snap, customerName: c.customer });
      const post = resolveTaxReductionApplicant({ applicantName: c.rot?.applicant_name, customerName: c.customer, cardPersonalNumber: c.card, snapshotPersonalNumber: c.snap });
      expect(post?.name).toBe(pdf.name);
      expect(post?.personalNumber.replace(/\D/g, '')).toBe(String(pdf.personalNumber).replace(/\D/g, ''));
    }
  });
});

describe('pickKeptPost', () => {
  const a = { Id: 1, SocialSecurityNumber: '19800101-0008' };
  const b = { Id: 2, SocialSecurityNumber: '191212121212' };

  it('behåller vår sökandes post oavsett format, resten ska bort', () => {
    expect(pickKeptPost([a, b], PNR)).toEqual({ keep: b, extra: [a] });
  });

  it('behåller den första när ingen är vår', () => {
    expect(pickKeptPost([a, b], null)).toEqual({ keep: a, extra: [b] });
    expect(pickKeptPost([], PNR)).toEqual({ keep: null, extra: [] });
  });
});

describe('amountBeforeDocumentWrite', () => {
  it('sänker bara när posten begär mer än målet — en höjning väntar till efter dokumentet', () => {
    expect(amountBeforeDocumentWrite(7500, 3750)).toBe(3750);
    expect(amountBeforeDocumentWrite(3750, 7500)).toBeNull();
    expect(amountBeforeDocumentWrite(3750, 3750)).toBeNull();
    expect(amountBeforeDocumentWrite(undefined, 3750)).toBeNull();
  });

  it('går aldrig under Fortnox minimum 1', () => {
    expect(amountBeforeDocumentWrite(7500, 0)).toBe(1);
  });
});

describe('buildTaxReductionPayload', () => {
  const applicant = { name: 'Tolvan Tolvansson', personalNumber: PNR };

  // Fältnamnen är Fortnox — stavas ut ordagrant.
  it('bär exakt Fortnox fältnamn', () => {
    expect(buildTaxReductionPayload('OFFER', '37', 3750.9, applicant, { propertyDesignation: ' Mätby 1:1 ', brfOrgNumber: '769600-1234' })).toEqual({
      TaxReduction: {
        ReferenceDocumentType: 'OFFER',
        ReferenceNumber: '37',
        CustomerName: 'Tolvan Tolvansson',
        SocialSecurityNumber: PNR,
        AskedAmount: 3750,
        PropertyDesignation: 'Mätby 1:1',
        ResidenceAssociationOrganisationNumber: '769600-1234',
      },
    });
  });

  it('utelämnar tom fastighetsbeteckning och BRF — tömmer aldrig något ekonomi skrivit in', () => {
    const { TaxReduction } = buildTaxReductionPayload('ORDER', '90', 10, applicant, { propertyDesignation: '  ', brfOrgNumber: null });
    expect(TaxReduction).not.toHaveProperty('PropertyDesignation');
    expect(TaxReduction).not.toHaveProperty('ResidenceAssociationOrganisationNumber');
  });

  it('postMatchesPayload ser formatskillnader i personnumret som samma', () => {
    const payload = buildTaxReductionPayload('OFFER', '37', 3750, applicant, { propertyDesignation: null, brfOrgNumber: null });
    expect(postMatchesPayload({ AskedAmount: 3750, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: '191212121212' }, payload)).toBe(true);
    expect(postMatchesPayload({ AskedAmount: 3000, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR }, payload)).toBe(false);
  });
});

// ── Ordningen mot Fortnox ────────────────────────────────────────────────────

const labourRows = (price: number): Row[] => [
  { Price: 5000, Quantity: 1, VAT: 25 },
  { Price: price, Quantity: 1, VAT: 25, HouseWork: true },
];

const target = (amount: number, applicant: TaxReductionTarget['applicant'] = { name: 'Tolvan Tolvansson', personalNumber: PNR }): TaxReductionTarget => ({
  amount, applicant, propertyDesignation: 'Mätby 1:1', brfOrgNumber: null,
});

describe('prepare + sync mot fakens Fortnox', () => {
  it('ett höjt avdrag når posten — felet som syntes i drift', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    fake.seedPost({ ReferenceDocumentType: 'OFFER', ReferenceNumber: '37', CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, AskedAmount: 3750 });

    await prepareTaxReductionForDocumentWrite('OFFER', '37', target(7500));
    const written = await fake.put('/offers/37', { Offer: { OfferRows: labourRows(20000) } });
    expect(written.Offer?.TaxReduction).toBe(3750); // fryst — det är just det posten måste rätta
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(7500), written.Offer);

    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([7500]);
    expect(fake.docView('OFFER', '37').TaxReduction).toBe(7500);
  });

  // 🧨 Utan sänkningen FÖRE dokumentet nekas hela PUT:en med 2003227.
  it('ett sänkt avdrag sänks före dokumentet, så PUT:en går igenom', async () => {
    fake.seedDoc('OFFER', '37', labourRows(20000));
    fake.seedPost({ ReferenceDocumentType: 'OFFER', ReferenceNumber: '37', CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, AskedAmount: 7500 });

    await prepareTaxReductionForDocumentWrite('OFFER', '37', target(3750));
    const written = await fake.put('/offers/37', { Offer: { OfferRows: labourRows(10000) } });
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750), written.Offer);

    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([3750]);
  });

  it('slår ihop flera poster till vår — den sista raderas aldrig', async () => {
    fake.seedDoc('ORDER', '90', labourRows(30000));
    fake.seedPost({ ReferenceDocumentType: 'ORDER', ReferenceNumber: '90', CustomerName: 'Make', SocialSecurityNumber: '19800101-0008', AskedAmount: 5000 });
    fake.seedPost({ ReferenceDocumentType: 'ORDER', ReferenceNumber: '90', CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, AskedAmount: 5000 });

    await prepareTaxReductionForDocumentWrite('ORDER', '90', target(11250));
    const written = await fake.put('/orders/90', { Order: { OrderRows: labourRows(30000) } });
    await syncTaxReductionAfterDocumentWrite('ORDER', '90', target(11250), written.Order);

    expect(fake.postsFor('ORDER', '90')).toEqual([expect.objectContaining({ SocialSecurityNumber: PNR, AskedAmount: 11250 })]);
  });

  it('skapar posten när den saknas — aldrig över Fortnox egen uträkning', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    // CRM begär 50 % — Fortnox tak är 3 750, som dokumentsvaret bär så länge ingen post finns.
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(6250), fake.docView('OFFER', '37'));

    expect(fake.postsFor('OFFER', '37')).toEqual([expect.objectContaining({
      AskedAmount: 3750, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, PropertyDesignation: 'Mätby 1:1',
    })]);
  });

  it('skapar ingen post utan giltigt personnummer — men rättar beloppet på en som finns', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750, null), fake.docView('OFFER', '37'));
    expect(fake.postsFor('OFFER', '37')).toHaveLength(0);

    // En post som ekonomi skrivit in för hand behåller sin sökande; bara beloppet följer CRM.
    fake.seedDoc('OFFER', '38', labourRows(20000));
    fake.seedPost({ ReferenceDocumentType: 'OFFER', ReferenceNumber: '38', CustomerName: 'För Hand', SocialSecurityNumber: '19800101-0008', AskedAmount: 1000 });
    await syncTaxReductionAfterDocumentWrite('OFFER', '38', target(7500, null), fake.docView('OFFER', '38'));
    expect(fake.postsFor('OFFER', '38')).toEqual([expect.objectContaining({ CustomerName: 'För Hand', AskedAmount: 7500 })]);
  });

  it('rör aldrig en post för en faktura med samma nummer', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750), fake.docView('OFFER', '37'));
    const touched = [...vi.mocked(fortnoxPut).mock.calls, ...vi.mocked(fortnoxDelete).mock.calls].map((c) => String(c[0]));
    expect(touched).not.toContain('/taxreductions/1');
  });

  it('skickar beloppet utan fastighetsuppgifter när Fortnox nekar dem', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    const realPost = fake.post.bind(fake);
    vi.mocked(fortnoxPost).mockImplementation((async (path: string, body: any) => {
      if (path === '/taxreductions' && body.TaxReduction.PropertyDesignation) throw fortnoxError(400, 2000000, 'Ogiltig fastighetsbeteckning');
      return realPost(path, body);
    }) as never);

    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750), fake.docView('OFFER', '37'));

    expect(fake.postsFor('OFFER', '37')).toEqual([expect.objectContaining({ AskedAmount: 3750 })]);
    expect(fake.postsFor('OFFER', '37')[0]).not.toHaveProperty('PropertyDesignation');
  });

  // Best effort: fallbacken är läget före posten fanns, och ett fel här får aldrig fälla en push.
  it('kastar aldrig — ett Fortnox-fel loggas', async () => {
    vi.mocked(fortnoxGet).mockRejectedValue(fortnoxError(403, 2000663, 'Har inte behörighet'));
    await expect(prepareTaxReductionForDocumentWrite('OFFER', '37', target(3750))).resolves.toBeUndefined();
    await expect(syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750), null)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[fortnox-skattereduktion] OFFER 37'));
  });
});

// ── Sömmen: den riktiga offert- och orderpushen ──────────────────────────────

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err);
  return chain;
}

function installDb(tables: Record<string, Record<string, unknown>>) {
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => {
      const chain = makeChain({ data: tables[table] ?? null, error: null });
      // claimFortnoxPush: update(...).eq().neq().select('id') ska ge en rad.
      chain.select = vi.fn((cols?: string) => (cols === 'id' ? makeChain({ data: [{ id: 'x' }], error: null }) : chain));
      return chain;
    }),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

const rotQuote = (overrides: Record<string, unknown> = {}) => ({
  id: 'q-1',
  project_name: 'Vind',
  description: null,
  amount: 0,
  vat_percent: 25,
  quote_date: '2026-10-02',
  valid_until: null,
  notes: null,
  customer_id: 'cust-1',
  customer_name: 'Tolvan Tolvansson',
  customer_source: { kind: 'fortnox', fortnox_customer_id: '22' },
  customer_snapshot: { customer_name: 'Tolvan Tolvansson', reverse_vat: false },
  assigned_to: null,
  rot_details: { enabled: true, rot_percent: 30, max_deduction: 50000, property_designation: 'Mätby 1:1' },
  line_items: [
    { id: 'm', pricing_mode: 'item', unit_price: '5000', quantity: '1' },
    { id: 'l', pricing_mode: 'item', article_number: '10058', unit_price: '10000', quantity: '1', is_rot_work: true },
  ],
  fortnox_offer_number: null as string | null,
  ...overrides,
});

describe('pushQuoteToFortnox — skattereduktionsposten', () => {
  const withLabour = (price: string) => [
    { id: 'm', pricing_mode: 'item', unit_price: '5000', quantity: '1' },
    { id: 'l', pricing_mode: 'item', article_number: '10058', unit_price: price, quantity: '1', is_rot_work: true },
  ];

  async function push(quote: Record<string, unknown>) {
    installDb({ crm_quotes: quote, crm_customers: { personal_number: '191212121212' } });
    return pushQuoteToFortnox('q-1');
  }

  it('ny ROT-offert får en post med CRM:s belopp, sökande och fastighetsbeteckning', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote());
    expect(fake.postsFor('OFFER', n)).toEqual([expect.objectContaining({
      ReferenceDocumentType: 'OFFER', AskedAmount: 3750, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, PropertyDesignation: 'Mätby 1:1',
    })]);
  });

  // Hela kedjan som felet gick: skapa → höj → sänk, med posten på plats hela vägen.
  it('höjt och sedan sänkt arbete följer med till Fortnox utan att offerten nekas', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote());

    await push(rotQuote({ fortnox_offer_number: n, line_items: withLabour('20000') }));
    expect(fake.docView('OFFER', n).TaxReduction).toBe(7500);

    await push(rotQuote({ fortnox_offer_number: n, line_items: withLabour('8000') }));
    expect(fake.docView('OFFER', n).TaxReduction).toBe(3000);
    expect(fake.postsFor('OFFER', n)).toHaveLength(1);
  });

  it('maxavdraget i CRM når Fortnox', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote({
      line_items: withLabour('20000'),
      rot_details: { enabled: true, rot_percent: 30, max_deduction: 5000 },
    }));
    expect(fake.docView('OFFER', n).TaxReduction).toBe(5000);
  });

  // 🧨 Utan `none` nekas PUT:en med 2003227 och offerten kan inte längre sparas utan ROT.
  it('ROT avslaget på en offert med post: typen none, och Fortnox tar bort posten', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote());

    await push(rotQuote({
      fortnox_offer_number: n,
      rot_details: { enabled: false },
      line_items: [{ id: 'm', pricing_mode: 'item', unit_price: '5000', quantity: '1' }],
    }));

    const offerPuts = vi.mocked(fortnoxPut).mock.calls.filter(([path]) => path === `/offers/${n}`);
    expect((offerPuts.at(-1)![1] as { Offer: Record<string, unknown> }).Offer.TaxReductionType).toBe('none');
    expect(fake.postsFor('OFFER', n)).toHaveLength(0);
  });

  it('en företagsoffert utan poster skickas som förut — ingen typ, inga postanrop utöver uppslaget', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote({ rot_details: { enabled: false }, line_items: [{ id: 'm', pricing_mode: 'item', unit_price: '5000', quantity: '1' }] }));
    await push(rotQuote({ fortnox_offer_number: n, rot_details: { enabled: false }, line_items: [{ id: 'm', pricing_mode: 'item', unit_price: '6000', quantity: '1' }] }));

    const put = vi.mocked(fortnoxPut).mock.calls.find(([path]) => path === `/offers/${n}`)!;
    expect((put[1] as { Offer: Record<string, unknown> }).Offer).not.toHaveProperty('TaxReductionType');
    expect(vi.mocked(fortnoxPost).mock.calls.map(([path]) => path)).not.toContain('/taxreductions');
  });

  it('ett fel på posten fäller inte offerten', async () => {
    const realPost = fake.post.bind(fake);
    vi.mocked(fortnoxPost).mockImplementation((async (path: string, body: unknown) => {
      if (path === '/taxreductions') throw fortnoxError(403, 2000663, 'Har inte behörighet');
      return realPost(path, body);
    }) as never);

    await expect(push(rotQuote())).resolves.toEqual(expect.objectContaining({ updated: false }));
  });
});

describe('updateWorkOrderInFortnox — orderns post', () => {
  // `createorder` kopierar offertens post till ordern. Arbetet på arbetsordern blev sedan MINDRE
  // än på offerten — utan sänkningen före rad-PUT:en nekas hela ordern (2003227), och den står
  // 'failed' med faktureringen spärrad.
  it('arbete som minskat sedan offerten sänker posten före rad-PUT:en', async () => {
    fake.seedDoc('ORDER', '90', labourRows(30000));
    fake.seedPost({ ReferenceDocumentType: 'ORDER', ReferenceNumber: '90', CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, AskedAmount: 11250 });

    installDb({
      crm_work_orders: {
        id: 'wo-1', status: 'in_progress', quote_id: null, customer_id: 'cust-1', assigned_to: null,
        customer_snapshot: { reverse_vat: false, customer_name: 'Tolvan Tolvansson' },
        work_address: null, vat_percent: 25, project_name: 'Vind', fortnox_order_number: '90',
        line_items: [{ id: 'l', pricing_mode: 'item', article_number: '10058', unit_price: '10000', quantity: '1', is_rot_work: true }],
        rot_details: { enabled: true, rot_percent: 30, max_deduction: 50000 },
      },
      crm_customers: { customer_type: 'private', personal_number: '191212121212' },
    });

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(fake.postsFor('ORDER', '90')).toEqual([expect.objectContaining({ AskedAmount: 3750 })]);
    expect(fake.docView('ORDER', '90').TaxReduction).toBe(3750);
  });
});
