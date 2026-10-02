import { describe, it, expect, vi, beforeEach } from 'vitest';

// Skattereduktionsposten (`/taxreductions`) på offert och order.
//
// Två lager. De rena funktionerna stavar ut Fortnox fältnamn och CRM:s belopp. Pushtesterna kör den
// RIKTIGA offert- och orderpushen mot en fake som gör det testbolaget gjorde 2026-10-02 (se
// taxReductions.ts överst): en post fryser avdraget, ett sänkt arbete nekar hela dokumentet, varje
// dokument-PUT byter postens Id, den sista posten går inte att radera, `createorder` kopierar posten,
// en rad som utelämnar `HouseWork` ärver flaggan positionellt, och underlaget avrundas nedåt.
//
// Faken räknar sitt tak på SITT sätt (30 % av avrundat underlag) och inte med CRM:s formel — annars
// kunde CRM aldrig hamna över taket, och just det är fallen som gick sönder i granskningen.

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
  resolveTaxReductionApplicant,
  rotAskedAmount,
  syncTaxReductionAfterDocumentWrite,
  withoutHouseWork,
  writeDocumentKeepingTaxReduction,
  type TaxReductionTarget,
} from '@/lib/domains/fortnox/taxReductions';
import { resolveRotApplicants } from '@/lib/domains/fortnox/documentPdfDesign';
import { pushQuoteToFortnox } from '@/lib/domains/fortnox/offers';
import { pushWorkOrderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

// Skatteverkets testperson Tolvan Tolvansson — inte en verklig person.
const PNR = '19121212-1212';

// ── Fortnox, som testbolaget betedde sig ─────────────────────────────────────

type DocType = 'OFFER' | 'ORDER' | 'INVOICE';
type Row = { Price?: number; Quantity?: number; OrderedQuantity?: number; VAT?: number; HouseWork?: boolean; HouseWorkType?: string | null };

/** Som Fortnox lagrar raden: en husarbetsrad bär en typ. */
const stored = (r: Row): Row => ({ ...r, HouseWork: r.HouseWork ?? false, HouseWorkType: r.HouseWorkType ?? (r.HouseWork ? 'CONSTRUCTION' : null) });
type Doc = { reductionType: string; rows: Row[] };
type Post = {
  Id: number; ReferenceDocumentType: DocType; ReferenceNumber: string; CustomerName: string;
  SocialSecurityNumber: string; AskedAmount: number; PropertyDesignation?: string | null;
  ResidenceAssociationOrganisationNumber?: string | null;
};

function fortnoxError(status: number, code: number, message: string) {
  return new FortnoxApiError(status, `Fortnox ${status}: ${message}`, code, message);
}

const POSTS_EXCEED = () => fortnoxError(400, 2003227, 'Summan av raderna överskrider möjlig skattereduktion på fakturan.');
const POST_EXCEEDS = () => fortnoxError(400, 2003228, 'Skattereduktion på rad överskrider möjlig skattereduktion på fakturan.');

class FakeFortnox {
  docs = new Map<string, Doc>();
  posts: Post[] = [];
  private nextPostId = 100;
  private nextDocNumber = { OFFER: 37, ORDER: 90 };
  private key = (type: DocType, n: string) => `${type}:${n}`;

  constructor() {
    // En FAKTURA med samma nummer som offerterna — skilda serier. Får aldrig röras.
    this.posts.push({ Id: 1, ReferenceDocumentType: 'INVOICE', ReferenceNumber: '37', CustomerName: 'Främling', SocialSecurityNumber: '19800101-0008', AskedAmount: 1000 });
  }

  /** Punkt 9: underlaget avrundas nedåt till hela kronor, taket är 30 % av det, golvat. */
  basis(doc: Doc): number {
    return Math.floor(doc.rows.filter((r) => r.HouseWork).reduce(
      (sum, r) => sum + (r.Price ?? 0) * (r.Quantity ?? r.OrderedQuantity ?? 0) * (1 + (r.VAT ?? 0) / 100), 0,
    ));
  }
  ceiling(doc: Doc): number { return doc.reductionType === 'rot' ? Math.floor(this.basis(doc) * 0.3) : 0; }
  postsFor(type: DocType, n: string) {
    return this.posts.filter((p) => p.ReferenceDocumentType === type && p.ReferenceNumber === n);
  }
  docView(type: DocType, n: string) {
    const doc = this.docs.get(this.key(type, n))!;
    const posts = this.postsFor(type, n);
    // Punkt 2: finns en post är avdraget posternas summa, annars Fortnox egen uträkning.
    const reduction = doc.reductionType === 'rot'
      ? (posts.length ? posts.reduce((s, p) => s + p.AskedAmount, 0) : this.ceiling(doc))
      : null;
    return { DocumentNumber: n, TaxReductionType: doc.reductionType, BasisTaxReduction: this.basis(doc), TaxReduction: reduction };
  }

  seedDoc(type: 'OFFER' | 'ORDER', n: string, rows: Row[], reductionType = 'rot') {
    this.docs.set(this.key(type, n), { reductionType, rows: rows.map(stored) });
  }
  seedPost(post: Omit<Post, 'Id'>): Post {
    const created = { ...post, Id: this.nextPostId++ };
    this.posts.push(created);
    return created;
  }

  async get(path: string, params?: Record<string, string>) {
    if (path === '/taxreductions') {
      const type = params?.filter === 'orders' ? 'ORDER' : 'OFFER';
      // Listan bär inte AskedAmount (mätt). Fakturaposten med samma nummer följer med, som om
      // filtret slarvat — anroparen måste sålla själv.
      return {
        TaxReductions: this.posts
          .filter((p) => (p.ReferenceDocumentType === type || p.ReferenceDocumentType === 'INVOICE')
            && (!params?.referencenumber || p.ReferenceNumber === params.referencenumber))
          .map(({ AskedAmount: _omitted, ...rest }) => ({ ...rest, ReferenceNumber: Number(rest.ReferenceNumber) })),
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
      const rows: Row[] = (payload.OfferRows ?? payload.OrderRows).map(stored);
      this.docs.set(this.key(type, n), { reductionType: payload.TaxReductionType ?? 'none', rows });
      return type === 'OFFER' ? { Offer: this.docView(type, n) } : { Order: this.docView(type, n) };
    }
    if (path === '/taxreductions') {
      const t = body.TaxReduction;
      const doc = this.docs.get(this.key(t.ReferenceDocumentType, t.ReferenceNumber))!;
      const sum = this.postsFor(t.ReferenceDocumentType, t.ReferenceNumber).reduce((s, p) => s + p.AskedAmount, 0);
      if (sum + t.AskedAmount > this.ceiling(doc)) throw POST_EXCEEDS();
      return { TaxReduction: this.seedPost(t) };
    }
    throw new Error(`fake: okänd POST ${path}`);
  }

  async put(path: string, body?: any) {
    const createOrder = /^\/offers\/(\d+)\/createorder$/.exec(path);
    if (createOrder) {
      // Punkt 6: ordern byggs ur offertens rader, och posten kopieras med.
      const offer = this.docs.get(this.key('OFFER', createOrder[1]))!;
      const n = String(this.nextDocNumber.ORDER++);
      this.docs.set(this.key('ORDER', n), {
        reductionType: offer.reductionType,
        rows: offer.rows.map((r) => ({ ...r, OrderedQuantity: r.Quantity, Quantity: undefined })),
      });
      for (const p of this.postsFor('OFFER', createOrder[1])) {
        this.seedPost({ ...p, ReferenceDocumentType: 'ORDER', ReferenceNumber: n });
      }
      return { Order: this.docView('ORDER', n) };
    }
    const docPath = /^\/(offers|orders)\/(\d+)$/.exec(path);
    if (docPath) {
      const type = docPath[1] === 'offers' ? 'OFFER' : 'ORDER';
      const n = docPath[2];
      const doc = this.docs.get(this.key(type, n))!;
      const payload = type === 'OFFER' ? body.Offer : body.Order;
      const sent: Row[] | undefined = payload.OfferRows ?? payload.OrderRows;
      // Positionell PUT: en rad som utelämnar ett fält ärver det från raden på samma plats — både
      // flaggan och TYPEN (punkt 7).
      const rows = sent
        ? sent.map((r, i) => ({
            ...r,
            HouseWork: 'HouseWork' in r ? r.HouseWork : (doc.rows[i]?.HouseWork ?? false),
            HouseWorkType: 'HouseWorkType' in r ? r.HouseWorkType : (doc.rows[i]?.HouseWorkType ?? null),
          }))
        : doc.rows;
      const next: Doc = { reductionType: payload.TaxReductionType ?? doc.reductionType, rows };
      if (next.reductionType === 'none' && rows.some((r) => r.HouseWork)) {
        throw fortnoxError(400, 2004001, 'Skattereduktionstyp får inte vara none om det finns rader med husarbete.');
      }
      if (next.reductionType === 'none' && rows.some((r) => r.HouseWorkType)) {
        throw fortnoxError(400, 2004021, "Dokument med skattereduktionstypen 'none' får inte innehålla rader med husarbetestypen 'CONSTRUCTION'.");
      }
      const posts = this.postsFor(type, n);
      if (next.reductionType === 'none') {
        // Punkt 7: Fortnox tar själv bort posterna.
        this.posts = this.posts.filter((p) => !posts.includes(p));
      } else if (posts.reduce((s, p) => s + p.AskedAmount, 0) > this.ceiling(next)) {
        throw POSTS_EXCEED(); // Punkt 3
      }
      this.docs.set(this.key(type, n), next);
      // Punkt 4: varje dokument-PUT ersätter posterna med nya Id.
      for (const post of this.postsFor(type, n)) post.Id = this.nextPostId++;
      return type === 'OFFER' ? { Offer: this.docView(type, n) } : { Order: this.docView(type, n) };
    }
    const single = /^\/taxreductions\/(\d+)$/.exec(path);
    if (single) {
      const post = this.posts.find((p) => p.Id === Number(single[1]));
      if (!post) throw fortnoxError(404, 2000519, 'Kan inte hitta skattereduktionen.');
      const t = body.TaxReduction;
      const others = this.postsFor(post.ReferenceDocumentType, post.ReferenceNumber).filter((p) => p !== post);
      const doc = this.docs.get(this.key(post.ReferenceDocumentType, post.ReferenceNumber));
      if (doc && others.reduce((s, p) => s + p.AskedAmount, 0) + t.AskedAmount > this.ceiling(doc)) throw POST_EXCEEDS();
      Object.assign(post, t);
      return { TaxReduction: { ...post } };
    }
    throw new Error(`fake: okänd PUT ${path}`);
  }

  async delete(path: string) {
    const single = /^\/taxreductions\/(\d+)$/.exec(path);
    const post = single ? this.posts.find((p) => p.Id === Number(single[1])) : undefined;
    if (!post) throw fortnoxError(404, 2000519, 'Kan inte hitta skattereduktionen.');
    const doc = this.docs.get(this.key(post.ReferenceDocumentType, post.ReferenceNumber));
    // Punkt 5: den sista posten på ett husarbetsdokument går inte att radera.
    if (doc?.reductionType === 'rot' && this.postsFor(post.ReferenceDocumentType, post.ReferenceNumber).length === 1) {
      throw fortnoxError(400, 2001246, 'Minst en skattereduktion måste vara kopplat till en faktura som är märkt för husarbete, använd PUT för att isället uppdatera.');
    }
    this.posts = this.posts.filter((p) => p !== post);
  }
}

let fake: FakeFortnox;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake = new FakeFortnox();
  vi.mocked(fortnoxGet).mockImplementation(((path: string, params?: Record<string, string>) => fake.get(path, params)) as never);
  vi.mocked(fortnoxPost).mockImplementation(((path: string, body: unknown) => fake.post(path, body)) as never);
  vi.mocked(fortnoxPut).mockImplementation(((path: string, body: unknown) => fake.put(path, body)) as never);
  vi.mocked(fortnoxDelete).mockImplementation(((path: string) => fake.delete(path)) as never);
});

/** Ingen skrivning fick röra fakturaposten med samma nummer. */
function expectInvoicePostUntouched() {
  const touched = [...vi.mocked(fortnoxPut).mock.calls, ...vi.mocked(fortnoxDelete).mock.calls].map((c) => String(c[0]));
  expect(touched).not.toContain('/taxreductions/1');
  expect(fake.posts.find((p) => p.Id === 1)).toEqual(expect.objectContaining({ ReferenceDocumentType: 'INVOICE', AskedAmount: 1000 }));
}

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

/** Materialet först, arbetet sist — som buildOfferRows lägger dem. */
const labourRows = (price: number, flag = true): Row[] => [
  { Price: 5000, Quantity: 1, VAT: 25 },
  { Price: price, Quantity: 1, VAT: 25, ...(flag ? { HouseWork: true } : {}) },
];

const target = (amount: number, applicant: TaxReductionTarget['applicant'] = { name: 'Tolvan Tolvansson', personalNumber: PNR }): TaxReductionTarget => ({
  amount, applicant, propertyDesignation: 'Mätby 1:1', brfOrgNumber: null,
});

const tolvan = (type: 'OFFER' | 'ORDER', n: string, amount: number) => fake.seedPost({
  ReferenceDocumentType: type, ReferenceNumber: n, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, AskedAmount: amount,
});

/** Dokument-PUT mot faken, som offers.ts/orders.ts gör den. */
const offerWriter = (n: string, rows: Row[]) => async (reductionType?: 'none' | 'rot') =>
  (await fortnoxPut<{ Offer?: { TaxReduction?: number | null } }>(`/offers/${n}`, {
    Offer: { OfferRows: reductionType === 'none' ? withoutHouseWork(rows) : rows, ...(reductionType ? { TaxReductionType: reductionType } : {}) },
  }))?.Offer;

describe('writeDocumentKeepingTaxReduction mot fakens Fortnox', () => {
  it('ett höjt avdrag når posten — felet som syntes i drift', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    tolvan('OFFER', '37', 3750);

    await writeDocumentKeepingTaxReduction('OFFER', '37', target(7500), offerWriter('37', labourRows(20000)));

    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([7500]);
    expect(fake.docView('OFFER', '37').TaxReduction).toBe(7500);
    expectInvoicePostUntouched();
  });

  // 🧨 Utan sänkningen FÖRE dokumentet nekas hela PUT:en med 2003227.
  it('ett sänkt avdrag sänks före dokumentet, så första PUT:en går igenom', async () => {
    fake.seedDoc('OFFER', '37', labourRows(20000));
    tolvan('OFFER', '37', 7500);

    await writeDocumentKeepingTaxReduction('OFFER', '37', target(3750), offerWriter('37', labourRows(10000)));

    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([3750]);
    expect(vi.mocked(fortnoxPut).mock.calls.filter(([path]) => path === '/offers/37')).toHaveLength(1);
  });

  it('slår ihop flera poster till vår — den sista raderas aldrig', async () => {
    fake.seedDoc('ORDER', '90', labourRows(30000));
    fake.seedPost({ ReferenceDocumentType: 'ORDER', ReferenceNumber: '90', CustomerName: 'Make', SocialSecurityNumber: '19800101-0008', AskedAmount: 5000 });
    tolvan('ORDER', '90', 5000);

    await writeDocumentKeepingTaxReduction('ORDER', '90', target(11250), async () => (await fake.put('/orders/90', { Order: { OrderRows: labourRows(30000) } })).Order);

    expect(fake.postsFor('ORDER', '90')).toEqual([expect.objectContaining({ SocialSecurityNumber: PNR, AskedAmount: 11250 })]);
  });

  // Granskningsfynd: CRM:s belopp över Fortnox tak. Procenten 50 ligger kvar från 2025.
  it('CRM begär mer än Fortnox tak: posten får taket, dokumentet nekas inte', async () => {
    fake.seedDoc('OFFER', '37', labourRows(20000));
    tolvan('OFFER', '37', 7500);

    // Höjning: 50 % av 30 000 inkl. moms = 18 750 mot taket 11 250 → 2003228 → taket.
    await writeDocumentKeepingTaxReduction('OFFER', '37', target(18750), offerWriter('37', labourRows(30000)));
    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([11250]);

    // Sänkning: 50 % av 12 500 = 6 250 mot nya taket 3 750. Sänkningen före räcker inte → 2003227 →
    // posten till 1 kr, PUT:en igen, och sedan taket.
    await writeDocumentKeepingTaxReduction('OFFER', '37', target(6250), offerWriter('37', labourRows(10000)));
    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([3750]);
  });

  it('avrundningen: CRM en krona över taket ger taket', async () => {
    // 333,34 + moms = 416,675 → CRM 125; Fortnox underlag 416 → tak 124.
    fake.seedDoc('OFFER', '37', labourRows(1000));
    tolvan('OFFER', '37', 375);
    await writeDocumentKeepingTaxReduction('OFFER', '37', target(125), offerWriter('37', labourRows(333.34)));
    expect(fake.postsFor('OFFER', '37').map((p) => p.AskedAmount)).toEqual([124]);
  });

  // Granskningsfynd: ROT kvar men allt arbete borta. Den sista posten går varken att radera eller
  // sätta under 1 kr — bara `none` går, och ROT återställs direkt utan post.
  it('ROT på men inget arbete kvar: none, sedan rot igen — dokumentet nekas inte', async () => {
    fake.seedDoc('ORDER', '90', labourRows(10000));
    tolvan('ORDER', '90', 3750);
    const types: (string | undefined)[] = [];

    await writeDocumentKeepingTaxReduction('ORDER', '90', target(0), async (reductionType) => {
      types.push(reductionType);
      // Projektnoten (0 kr) hamnar där arbetsraden låg och ärver husarbetet — som när arbetet skrivs av.
      const rows: Row[] = [{ Price: 5000, OrderedQuantity: 1, VAT: 25 }, { Price: 0, OrderedQuantity: 0, VAT: 25 }];
      return (await fake.put('/orders/90', { Order: { OrderRows: reductionType === 'none' ? withoutHouseWork(rows) : rows, ...(reductionType ? { TaxReductionType: reductionType } : {}) } })).Order;
    });

    expect(types).toEqual([undefined, undefined, 'none', 'rot']);
    expect(fake.docView('ORDER', '90').TaxReductionType).toBe('rot');
    expect(fake.postsFor('ORDER', '90')).toHaveLength(0);
  });

  // ROT avslaget i CRM: arbetsraden ligger kvar på sin plats och ärver husarbetet (positionell PUT).
  // Dagens payload går igenom — posten och typen rörs inte. Precis som före ändringen.
  it('ROT av med husarbete kvar via positionsarv: första PUT:en går igenom som förut', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    tolvan('OFFER', '37', 3750);

    await writeDocumentKeepingTaxReduction('OFFER', '37', null, offerWriter('37', labourRows(10000, false)));

    const puts = vi.mocked(fortnoxPut).mock.calls.filter(([path]) => path === '/offers/37');
    expect(puts).toHaveLength(1);
    expect((puts[0][1] as { Offer: Record<string, unknown> }).Offer).not.toHaveProperty('TaxReductionType');
  });

  // ROT avslaget och den genererade arbetsraden (sist) försvinner: inget husarbete kvar → none.
  it('ROT av och arbetsraden borta: none, och posten försvinner — ingen rot tillbaka', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    tolvan('OFFER', '37', 3750);
    const types: (string | undefined)[] = [];

    await writeDocumentKeepingTaxReduction('OFFER', '37', null, async (reductionType) => {
      types.push(reductionType);
      return offerWriter('37', [{ Price: 5000, Quantity: 1, VAT: 25 }])(reductionType);
    });

    expect(types).toEqual([undefined, 'none']);
    expect(fake.docView('OFFER', '37').TaxReductionType).toBe('none');
    expect(fake.postsFor('OFFER', '37')).toHaveLength(0);
  });

  // ROT avslaget, och en rad som ärvt husarbetet på arbetsradens plats bär inte posten. CRM säger
  // ingen ROT — `none` med raderna rensade, inte en kvarglömd post på 1 kr.
  it('ROT av, ärvt husarbete under posten: none med raderna rensade', async () => {
    fake.seedDoc('OFFER', '37', [{ Price: 2000, Quantity: 1, VAT: 25, HouseWork: true }, { Price: 10000, Quantity: 1, VAT: 25, HouseWork: true }]);
    tolvan('OFFER', '37', 4500);
    const types: (string | undefined)[] = [];

    await writeDocumentKeepingTaxReduction('OFFER', '37', null, async (reductionType) => {
      types.push(reductionType);
      return offerWriter('37', [{ Price: 2000, Quantity: 1, VAT: 25 }])(reductionType); // ärver husarbete på plats 0
    });

    expect(types).toEqual([undefined, 'none']);
    expect(fake.docView('OFFER', '37').TaxReductionType).toBe('none');
    expect(fake.postsFor('OFFER', '37')).toHaveLength(0);
  });

  it('nekar Fortnox none ändå blir felet begripligt — inte en felkod', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    tolvan('OFFER', '37', 3750);
    // En skrivare som INTE rensar raderna: typen ärvs och none nekas (2004021).
    const stubborn = async (reductionType?: 'none' | 'rot') =>
      (await fortnoxPut<{ Offer?: { TaxReduction?: number | null } }>('/offers/37', { Offer: { OfferRows: [{ Price: 5000, Quantity: 1, VAT: 25 }, { Price: 0, Quantity: 0, VAT: 25 }], ...(reductionType ? { TaxReductionType: reductionType } : {}) } }))?.Offer;

    await expect(writeDocumentKeepingTaxReduction('OFFER', '37', null, stubborn)).rejects.toMatchObject({
      fortnoxMessage: expect.stringContaining('Rensa husarbetet'),
    });
  });

  it('ett dokumentfel som inte rör posterna går rakt igenom', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    const boom = fortnoxError(400, 2000359, 'Otillåtna tecken');
    await expect(writeDocumentKeepingTaxReduction('OFFER', '37', target(3750), async () => { throw boom; })).rejects.toBe(boom);
  });

  it('ett dokument utan poster och utan ROT kostar inga postanrop alls', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000, false), 'none');
    await writeDocumentKeepingTaxReduction('OFFER', '37', null, offerWriter('37', labourRows(12000, false)));
    expect(fortnoxGet).not.toHaveBeenCalled();
    expect(fortnoxPost).not.toHaveBeenCalled();
  });
});

describe('syncTaxReductionAfterDocumentWrite', () => {
  it('skapar posten när den saknas — aldrig över Fortnox egen uträkning', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(6250), fake.docView('OFFER', '37'));

    expect(fake.postsFor('OFFER', '37')).toEqual([expect.objectContaining({
      AskedAmount: 3750, CustomerName: 'Tolvan Tolvansson', SocialSecurityNumber: PNR, PropertyDesignation: 'Mätby 1:1',
    })]);
    expectInvoicePostUntouched();
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

  // Fakturaposten bär nummer 37 och ligger först i listan. Släpper dokumentfiltret igenom den blir
  // den "vår" post och skrivs över med en främmande kunds avdrag.
  it('rör aldrig en post för en faktura med samma nummer', async () => {
    fake.seedDoc('OFFER', '37', labourRows(10000));
    tolvan('OFFER', '37', 3750);
    await syncTaxReductionAfterDocumentWrite('OFFER', '37', target(3750, null), fake.docView('OFFER', '37'));
    await writeDocumentKeepingTaxReduction('OFFER', '37', target(1000, null), offerWriter('37', labourRows(5000)));
    expectInvoicePostUntouched();
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

const material = { id: 'm', pricing_mode: 'item', unit_price: '5000', quantity: '1' };
const withLabour = (price: string) => [
  material,
  { id: 'l', pricing_mode: 'item', article_number: '10058', unit_price: price, quantity: '1', is_rot_work: true },
];

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
  line_items: withLabour('10000'),
  fortnox_offer_number: null as string | null,
  ...overrides,
});

describe('pushQuoteToFortnox — skattereduktionsposten', () => {
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

  // 🧨 Den genererade arbetsraden försvinner när ROT slås av. Utan `none` nekas PUT:en (2003227) och
  // offerten går inte längre att spara utan ROT.
  it('ROT avslaget på en offert med utbrutet arbete: none, och posten försvinner', async () => {
    const carved = [{ id: 'm', pricing_mode: 'item', unit_price: '15000', quantity: '1', labor_cost: '10000' }];
    const { fortnox_offer_number: n } = await push(rotQuote({ line_items: carved }));
    expect(fake.postsFor('OFFER', n)).toHaveLength(1);

    await push(rotQuote({ fortnox_offer_number: n, rot_details: { enabled: false }, line_items: carved }));

    expect(fake.docView('OFFER', n).TaxReductionType).toBe('none');
    expect(fake.postsFor('OFFER', n)).toHaveLength(0);
  });

  // ROT av OCH en ny rad i samma sparning: den nya raden hamnar där arbetsraden låg och ärver dess
  // husarbete — flagga och typ. Utan rensade rader nekas none, och offerten kan inte sparas.
  it('ROT av med en ny rad på arbetsradens plats: none med raderna rensade', async () => {
    const carved = { id: 'm', pricing_mode: 'item', unit_price: '15000', quantity: '1', labor_cost: '10000' };
    const { fortnox_offer_number: n } = await push(rotQuote({ line_items: [carved] }));

    await push(rotQuote({ fortnox_offer_number: n, rot_details: { enabled: false }, line_items: [carved, { id: 'x', pricing_mode: 'item', unit_price: '1000', quantity: '1' }] }));

    expect(fake.docView('OFFER', n).TaxReductionType).toBe('none');
    expect(fake.postsFor('OFFER', n)).toHaveLength(0);
  });

  // Granskningsfynd 1: en ROT-rad ligger kvar på sin plats och ärver husarbetet. `none` hade nekats
  // (2004001) — dagens payload går igenom, som före ändringen.
  it('ROT avslaget med en kvarliggande ROT-rad: pushen går igenom som förut', async () => {
    const { fortnox_offer_number: n } = await push(rotQuote());
    await expect(push(rotQuote({ fortnox_offer_number: n, rot_details: { enabled: false } }))).resolves.toEqual(expect.objectContaining({ updated: true }));
    const puts = vi.mocked(fortnoxPut).mock.calls.filter(([path]) => path === `/offers/${n}`);
    expect(puts.map(([, body]) => (body as { Offer: Record<string, unknown> }).Offer.TaxReductionType)).not.toContain('none');
  });

  it('en företagsoffert skickas som förut — inga postanrop alls', async () => {
    const business = { rot_details: { enabled: false }, line_items: [material] };
    const { fortnox_offer_number: n } = await push(rotQuote(business));
    await push(rotQuote({ ...business, fortnox_offer_number: n, line_items: [{ ...material, unit_price: '6000' }] }));

    const put = vi.mocked(fortnoxPut).mock.calls.find(([path]) => path === `/offers/${n}`)!;
    expect((put[1] as { Offer: Record<string, unknown> }).Offer).not.toHaveProperty('TaxReductionType');
    expect(vi.mocked(fortnoxGet).mock.calls.map(([path]) => path)).not.toContain('/taxreductions');
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

const workOrderRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'wo-1', status: 'in_progress', quote_id: 'q-1', customer_id: 'cust-1', assigned_to: null,
  customer_snapshot: { reverse_vat: false, customer_name: 'Tolvan Tolvansson' },
  work_address: null, project_name: 'Vind', client_name: 'Tolvan Tolvansson', amount: 0, vat_percent: 25,
  currency_code: 'SEK', fortnox_order_number: null,
  line_items: withLabour('4000'),
  rot_details: { enabled: true, rot_percent: 30, max_deduction: 50000 },
  ...overrides,
});

describe('arbetsordern — orderns post', () => {
  function db(row: Record<string, unknown>) {
    installDb({
      crm_work_orders: row,
      crm_quotes: { fortnox_offer_number: '37', customer_id: 'cust-1', customer_source: { kind: 'fortnox', fortnox_customer_id: '22' }, assigned_to: null, customer_snapshot: row.customer_snapshot as Record<string, unknown>, rot_details: { enabled: true } },
      crm_customers: { customer_type: 'private', personal_number: '191212121212', fortnox_customer_id: '22' },
    });
  }

  // `createorder` kopierar offertens post. Arbetsordern fick MINDRE arbete än offerten — utan att
  // posten sänks före rad-PUT:en nekas ordern (2003227), står 'failed' och spärrar faktureringen.
  it('createorder med mindre arbete än offerten: posten följer arbetsordern', async () => {
    fake.seedDoc('OFFER', '37', [{ Price: 5000, Quantity: 1, VAT: 25 }, { Price: 10000, Quantity: 1, VAT: 25, HouseWork: true }]);
    tolvan('OFFER', '37', 3750);
    db(workOrderRow());

    const { fortnox_order_number: m } = await pushWorkOrderToFortnox('wo-1');

    expect(fake.postsFor('ORDER', String(m))).toEqual([expect.objectContaining({ AskedAmount: 1500, SocialSecurityNumber: PNR })]);
    expect(fake.docView('ORDER', String(m)).TaxReduction).toBe(1500);
  });

  // Granskningsfynd 3: ROT slogs av på arbetsordern innan ordern fanns i Fortnox. `createorder`
  // kopierar ändå offertens ROT och post, och arbetsraden är borta. Raden som hamnar på dess plats
  // ärver husarbetet (positionellt) — `none` med raderna rensade, som CRM säger.
  it('createorder med ROT avslaget på arbetsordern: none, ordern skapas', async () => {
    fake.seedDoc('OFFER', '37', [{ Price: 15000, Quantity: 1, VAT: 25 }, { Price: 10000, Quantity: 1, VAT: 25, HouseWork: true }]);
    tolvan('OFFER', '37', 3750);
    db(workOrderRow({ rot_details: { enabled: false }, line_items: [
      { id: 'm', pricing_mode: 'item', unit_price: '15000', quantity: '1' },
      { id: 'n', pricing_mode: 'item', unit_price: '3000', quantity: '1' },
    ] }));

    const { fortnox_order_number: m } = await pushWorkOrderToFortnox('wo-1');

    expect(fake.docView('ORDER', String(m)).TaxReductionType).toBe('none');
    expect(fake.postsFor('ORDER', String(m))).toHaveLength(0);
    expect(fake.docs.get(`ORDER:${m}`)!.rows.every((r) => !r.HouseWork && !r.HouseWorkType)).toBe(true);
  });

  // Bara projektnoten (0 kr) hamnar på arbetsradens plats och ärver husarbetet — flaggan OCH typen.
  // Utan `HouseWorkType: null` i none-skrivningen nekas den (2004021, uppmätt).
  it('createorder där bara projektnoten ärver husarbetet: none med typen rensad', async () => {
    fake.seedDoc('OFFER', '37', [{ Price: 15000, Quantity: 1, VAT: 25 }, { Price: 10000, Quantity: 1, VAT: 25, HouseWork: true }]);
    tolvan('OFFER', '37', 3750);
    db(workOrderRow({ rot_details: { enabled: false }, line_items: [{ id: 'm', pricing_mode: 'item', unit_price: '15000', quantity: '1' }] }));

    const { fortnox_order_number: m } = await pushWorkOrderToFortnox('wo-1');

    expect(fake.docView('ORDER', String(m)).TaxReductionType).toBe('none');
    expect(fake.postsFor('ORDER', String(m))).toHaveLength(0);
  });

  // Arbetet avskrivet på en ROT-order: projektnoten ärver arbetsradens plats. none → rot igen, utan post.
  it('allt arbete avskrivet med ROT kvar: ordern går igenom och är fortfarande ROT', async () => {
    fake.seedDoc('ORDER', '90', [{ Price: 5000, OrderedQuantity: 1, VAT: 25 }, { Price: 10000, OrderedQuantity: 1, VAT: 25, HouseWork: true }]);
    tolvan('ORDER', '90', 3750);
    db(workOrderRow({ quote_id: null, fortnox_order_number: '90', line_items: [
      material, { id: 'l', pricing_mode: 'item', article_number: '10058', unit_price: '10000', quantity: '1', is_rot_work: true, written_off: true },
    ] }));

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(fake.docView('ORDER', '90').TaxReductionType).toBe('rot');
    expect(fake.postsFor('ORDER', '90')).toHaveLength(0);
  });

  it('withoutHouseWork skickar både flaggan och typen uttryckligen', () => {
    expect(withoutHouseWork([{ Price: 1, HouseWork: true, HouseWorkType: 'CONSTRUCTION' }, { Price: 2 }])).toEqual([
      { Price: 1, HouseWork: false, HouseWorkType: null },
      { Price: 2, HouseWork: false, HouseWorkType: null },
    ]);
  });

  it('omsynk med minskat arbete sänker posten före rad-PUT:en', async () => {
    fake.seedDoc('ORDER', '90', labourRows(30000));
    tolvan('ORDER', '90', 11250);
    db(workOrderRow({ quote_id: null, fortnox_order_number: '90', line_items: withLabour('10000') }));

    await updateWorkOrderInFortnox('wo-1', { recheckAfterPush: false });

    expect(fake.postsFor('ORDER', '90')).toEqual([expect.objectContaining({ AskedAmount: 3750 })]);
    expect(fake.docView('ORDER', '90').TaxReduction).toBe(3750);
  });
});
