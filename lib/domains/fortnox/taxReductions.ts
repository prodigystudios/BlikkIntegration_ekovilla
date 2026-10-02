// Skattereduktionsposten på offerter och ordrar — Fortnox `/taxreductions`.
//
// VARFÖR DEN FINNS. Fortnox support 2026-10-02: skattereduktionen skapas INTE av `POST /offers`;
// den är en egen resurs som ska skapas med ett separat `POST /taxreductions` efter dokumentet. Vi
// gjorde aldrig det, och symptomet var att ett höjt ROT-avdrag i CRM aldrig nådde Fortnox.
//
// 🧪 MÄTT MOT TESTBOLAGET 2026-10-02 (offert 37–40, order 90). Läs innan du ändrar ordningen nedan:
//
// 1. Utan post räknar Fortnox avdraget ur husarbetsraderna och följer med vid varje PUT
//    (`TaxReduction` 3 750 → 7 500). Posten saknas då helt — ingen sökande, inget personnummer.
// 2. 🧨 FINNS EN POST ÄR DOKUMENTETS AVDRAG = POSTERNAS `AskedAmount`, och raderna slutar styra:
//    arbetet höjt till 30 000 gav fortfarande 5 000. Exakt felet som syntes i drift — posten hade
//    skapats för hand i Fortnox husarbetesflik, och därefter frös beloppet.
// 3. 🧨 SÄNKS ARBETET UNDER POSTENS BELOPP NEKAS HELA DOKUMENT-PUT:EN (2003227 "Summan av raderna
//    överskrider möjlig skattereduktion"). Posten måste alltså sänkas FÖRE dokumentet skrivs, och
//    höjas EFTER. Begärs mer än raderna ger nekas posten (2003228).
// 4. 🧨 VARJE DOKUMENT-PUT ERSÄTTER POSTEN MED ETT NYTT ID (22 → 24, 25 → 27), beloppet behålls.
//    Id:t går inte att spara — det slås upp efter varje skrivning.
// 5. 🧨 DEN SISTA POSTEN PÅ ETT HUSARBETSDOKUMENT GÅR INTE ATT RADERA (2001246 "använd PUT"). Därav
//    PUT på plats i stället för radera-och-skapa. Övriga poster går att radera.
// 6. `createorder` KOPIERAR offertens post till ordern (samma belopp, sökande, beteckning). Ordern
//    har sedan samma fällor som offerten.
// 7. ROT avslaget på en offert med post: utan husarbetsrader nekas dagens payload (2003227), men
//    `TaxReductionType: 'none'` går igenom och Fortnox tar då bort posterna själv. Se offers.ts.
// 8. `PropertyDesignation` och `ResidenceAssociationOrganisationNumber` FINNS på posten — tvärtemot
//    vad FORTNOX_INTEGRATION.md sekt. 4b påstår om API:t. Vi skickar dem; textraden/referensen
//    finns kvar som förut.
//
// ⚖️ BELOPPET ÄR CRM:S `rotDeduction` (computePricing) — samma tal säljaren ser i formuläret. Det
// går inte att låta Fortnox räkna: med en post på plats rapporterar dokumentet postens belopp, inte
// sitt eget tak (punkt 2), och den sista posten går inte att ta bort för att läsa taket (punkt 5).
// Därmed når `rot_percent` och `max_deduction` Fortnox, via posten. Saknas en post (nytt dokument)
// läser vi Fortnox egen uträkning ur svaret och begär aldrig mer än den.
//
// ⚠️ CRM BÄR EN SÖKANDE och äger posterna på dokument det skickar: fler poster än en slås ihop till
// vår. Delar man avdraget mellan två sökande för hand i Fortnox skrivs det över vid nästa push.
//
// ⚠️ ALLT HÄR ÄR BEST EFFORT. Ett fel loggas och pushen fortsätter. Fallbacken är exakt läget före
// den här modulen (Fortnox räknar ur raderna, ingen sökande) — och ett fel här får aldrig stämpla
// en order 'failed', för det spärrar faktureringen.

import { computePricing, type PricingLineItem, type RotPricingInput } from '@/lib/domains/crm/pricing';
import { normalizePersonalNumber } from '@/lib/domains/crm/personalNumber';
import { FortnoxApiError, fortnoxDelete, fortnoxGet, fortnoxPost, fortnoxPut } from './client';

export type TaxReductionDocumentType = 'OFFER' | 'ORDER';

const LIST_FILTER: Record<TaxReductionDocumentType, 'offers' | 'orders'> = { OFFER: 'offers', ORDER: 'orders' };

/** En post som Fortnox returnerar den. Listan bär INTE `AskedAmount` — bara `GET /taxreductions/{id}` gör det. */
export type FortnoxTaxReductionPost = {
  Id?: number | null;
  ReferenceDocumentType?: string | null;
  ReferenceNumber?: number | string | null;
  CustomerName?: string | null;
  SocialSecurityNumber?: string | null;
  AskedAmount?: number | null;
  PropertyDesignation?: string | null;
  ResidenceAssociationOrganisationNumber?: string | null;
};

export type TaxReductionApplicant = { name: string; personalNumber: string };

/** Det posten ska säga efter pushen. */
export type TaxReductionTarget = {
  /** Hela kronor. Under 1 begärs ingenting (Fortnox minimum är 1). */
  amount: number;
  /** Null när CRM saknar ett giltigt tolvsiffrigt personnummer — då kan ingen ny post skapas. */
  applicant: TaxReductionApplicant | null;
  propertyDesignation: string | null;
  brfOrgNumber: string | null;
};

type TaxReductionPayload = {
  TaxReduction: {
    ReferenceDocumentType: TaxReductionDocumentType;
    ReferenceNumber: string;
    CustomerName: string;
    SocialSecurityNumber: string;
    AskedAmount: number;
    PropertyDesignation?: string;
    ResidenceAssociationOrganisationNumber?: string;
  };
};

// ── Rena delar ───────────────────────────────────────────────────────────────

/**
 * Hör posten till just det här dokumentet? Fortnox numrerar offerter, ordrar och fakturor i SKILDA
 * serier, så filtret i frågan kontrolleras i efterhand — samma skäl som `belongsToOffer` i
 * offerPdf.ts. En post som slinker igenom bär en främmande kunds personnummer, och här skulle vi
 * dessutom SKRIVA i den.
 */
export function belongsToDocument(
  post: Pick<FortnoxTaxReductionPost, 'ReferenceDocumentType' | 'ReferenceNumber'>,
  type: TaxReductionDocumentType,
  documentNumber: string,
): boolean {
  if ((post.ReferenceDocumentType ?? '').toUpperCase() !== type) return false;
  return String(post.ReferenceNumber ?? '') === String(documentNumber);
}

/**
 * Beloppet att begära: CRM:s ROT-avdrag över raderna, i hela kronor. Anroparen har redan avgjort att
 * ROT gäller (påslaget och ingen omvänd skattskyldighet) och skickar de rader dokumentet bär.
 */
export function rotAskedAmount(
  lineItems: PricingLineItem[],
  vatPercent: number | string | null,
  rot: Pick<RotPricingInput, 'rot_percent' | 'max_deduction'> | null | undefined,
): number {
  const { rotDeduction } = computePricing(lineItems, vatPercent, {
    isPrivate: true,
    rot: { enabled: true, rot_percent: rot?.rot_percent, max_deduction: rot?.max_deduction },
  });
  return Math.max(0, Math.floor(rotDeduction));
}

/**
 * Sökanden på posten. ⚠️ SAMMA ORDNING SOM `resolveRotApplicants` (documentPdfDesign.ts) — PDF:en
 * och posten ska namnge samma person, och ett test låser de två mot varandra. Inte importerad
 * därifrån för att slippa dra in pdf-lib i varje offertsparning.
 *
 * Namnet ur ROT-sektionens eget fält, annars kundnamnet. Personnumret ur KUNDKORTET, annars
 * dokumentets snapshot — och bara ett giltigt tolvsiffrigt nummer. Ett tiosiffrigt dödar ROT tyst
 * i Fortnox (se personalNumber.ts); hellre ingen post än en post som ser rätt ut och inte fungerar.
 */
export function resolveTaxReductionApplicant(input: {
  applicantName?: string | null;
  customerName?: string | null;
  cardPersonalNumber?: string | null;
  snapshotPersonalNumber?: string | null;
}): TaxReductionApplicant | null {
  const text = (value: unknown) => String(value ?? '').trim();
  const name = text(input.applicantName) || text(input.customerName);
  const raw = text(input.cardPersonalNumber) || text(input.snapshotPersonalNumber);
  const personalNumber = raw ? normalizePersonalNumber(raw) : null;
  return name && personalNumber ? { name, personalNumber } : null;
}

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Vilken post vi behåller, och vilka som ska bort. CRM bär en sökande: posten med vår sökandes
 * personnummer om den finns, annars den första. Resten raderas — summan av alla poster är
 * dokumentets avdrag, och vår post ensam ska bära det.
 */
export function pickKeptPost<T extends FortnoxTaxReductionPost>(
  posts: T[],
  personalNumber: string | null,
): { keep: T | null; extra: T[] } {
  if (!posts.length) return { keep: null, extra: [] };
  const ours = personalNumber ? posts.find((p) => digits(p.SocialSecurityNumber) === digits(personalNumber)) : undefined;
  const keep = ours ?? posts[0];
  return { keep, extra: posts.filter((p) => p !== keep) };
}

/**
 * Hur långt posten måste ner INNAN dokumentet skrivs, eller null om den kan stå kvar.
 *
 * Dokument-PUT:en nekas när posten begär mer än de nya raderna ger (punkt 3 överst). Vi vet inte
 * Fortnox nya tak förrän efteråt, men vårt eget mål ryms i det — så posten sänks till målet. Ett
 * HÖGRE mål väntar till efter skrivningen, för först då ryms det. Fortnox minimum är 1.
 */
export function amountBeforeDocumentWrite(currentAsked: number | null | undefined, target: number): number | null {
  const floor = Math.max(1, Math.floor(target));
  return typeof currentAsked === 'number' && currentAsked > floor ? floor : null;
}

/**
 * Postens kropp. Fastighetsbeteckning och BRF:ens org.nr bara när CRM har dem — vi tömmer aldrig
 * något ekonomi kan ha skrivit in för hand.
 */
export function buildTaxReductionPayload(
  type: TaxReductionDocumentType,
  documentNumber: string,
  amount: number,
  applicant: TaxReductionApplicant,
  place: Pick<TaxReductionTarget, 'propertyDesignation' | 'brfOrgNumber'>,
): TaxReductionPayload {
  const property = place.propertyDesignation?.trim();
  const brf = place.brfOrgNumber?.trim();
  return {
    TaxReduction: {
      ReferenceDocumentType: type,
      ReferenceNumber: String(documentNumber),
      CustomerName: applicant.name,
      SocialSecurityNumber: applicant.personalNumber,
      AskedAmount: Math.floor(amount),
      ...(property ? { PropertyDesignation: property } : {}),
      ...(brf ? { ResidenceAssociationOrganisationNumber: brf } : {}),
    },
  };
}

/** Säger posten redan det vi tänkt skicka? Då sparar vi en PUT. */
export function postMatchesPayload(post: FortnoxTaxReductionPost, payload: TaxReductionPayload): boolean {
  const want = payload.TaxReduction;
  return Number(post.AskedAmount) === want.AskedAmount
    && String(post.CustomerName ?? '').trim() === want.CustomerName
    && digits(post.SocialSecurityNumber) === digits(want.SocialSecurityNumber)
    && (want.PropertyDesignation === undefined || String(post.PropertyDesignation ?? '').trim() === want.PropertyDesignation)
    && (want.ResidenceAssociationOrganisationNumber === undefined
      || String(post.ResidenceAssociationOrganisationNumber ?? '').trim() === want.ResidenceAssociationOrganisationNumber);
}

/** Sökanden att skriva: CRM:s om den finns, annars den posten redan bär — så beloppet ändå kan rättas. */
function applicantFor(target: TaxReductionTarget, post: FortnoxTaxReductionPost): TaxReductionApplicant | null {
  if (target.applicant) return target.applicant;
  const name = String(post.CustomerName ?? '').trim();
  const personalNumber = String(post.SocialSecurityNumber ?? '').trim();
  return name && personalNumber ? { name, personalNumber } : null;
}

// ── Mot Fortnox ──────────────────────────────────────────────────────────────

function logFailure(type: TaxReductionDocumentType, documentNumber: string, step: string, e: unknown): void {
  const reason = e instanceof FortnoxApiError
    ? `${e.fortnoxMessage ?? e.message}${e.fortnoxCode ? ` (kod ${e.fortnoxCode})` : ''}`
    : (e as Error)?.message ?? String(e);
  console.error(`[fortnox-skattereduktion] ${type} ${documentNumber}: ${step} misslyckades — ${reason}`);
}

async function listPosts(type: TaxReductionDocumentType, documentNumber: string): Promise<FortnoxTaxReductionPost[]> {
  const res = await fortnoxGet<{ TaxReductions?: FortnoxTaxReductionPost[] }>('/taxreductions', {
    filter: LIST_FILTER[type],
    referencenumber: String(documentNumber),
  });
  return (res.TaxReductions ?? []).filter((post) => belongsToDocument(post, type, documentNumber));
}

async function readPost(id: number): Promise<FortnoxTaxReductionPost> {
  const res = await fortnoxGet<{ TaxReduction?: FortnoxTaxReductionPost }>(`/taxreductions/${id}`);
  return res.TaxReduction ?? {};
}

/**
 * Skriver posten. Nekar Fortnox kroppen och den bar fastighetsuppgifter görs ett försök till utan
 * dem: ett felformaterat BRF-nummer får inte kosta själva beloppet, för det är beloppet kunden ser.
 */
async function writePost(id: number | null, payload: TaxReductionPayload): Promise<void> {
  const send = (body: TaxReductionPayload) =>
    id == null ? fortnoxPost('/taxreductions', body) : fortnoxPut(`/taxreductions/${id}`, body);
  try {
    await send(payload);
  } catch (e) {
    const { PropertyDesignation, ResidenceAssociationOrganisationNumber, ...rest } = payload.TaxReduction;
    const hadPlace = PropertyDesignation !== undefined || ResidenceAssociationOrganisationNumber !== undefined;
    if (!(e instanceof FortnoxApiError) || e.status !== 400 || !hadPlace) throw e;
    console.warn(`[fortnox-skattereduktion] ${rest.ReferenceDocumentType} ${rest.ReferenceNumber}: fastighetsuppgifterna nekades (${e.fortnoxMessage ?? e.message}) — skickar beloppet utan dem`);
    await send({ TaxReduction: rest });
  }
}

/** Har dokumentet poster? Fel räknas som nej — anroparen behåller då dagens beteende. */
export async function documentHasTaxReductionPosts(type: TaxReductionDocumentType, documentNumber: string): Promise<boolean> {
  try {
    return (await listPosts(type, documentNumber)).length > 0;
  } catch (e) {
    logFailure(type, documentNumber, 'uppslaget av poster', e);
    return false;
  }
}

/**
 * FÖRE dokument-PUT:en på ett dokument som redan finns: städa bort extra poster och sänk vår, så att
 * PUT:en inte nekas med 2003227 när avdraget minskat. Höjningar väntar till efteråt.
 */
export async function prepareTaxReductionForDocumentWrite(
  type: TaxReductionDocumentType,
  documentNumber: string,
  target: TaxReductionTarget,
): Promise<void> {
  try {
    const posts = await listPosts(type, documentNumber);
    const { keep, extra } = pickKeptPost(posts, target.applicant?.personalNumber ?? null);
    if (!keep?.Id) return;
    // Bara andra poster än den vi behåller — den sista går inte att radera (punkt 5 överst).
    for (const post of extra) if (post.Id) await fortnoxDelete(`/taxreductions/${post.Id}`);
    const current = await readPost(keep.Id);
    const lowered = amountBeforeDocumentWrite(current.AskedAmount, target.amount);
    if (lowered == null) return;
    const applicant = applicantFor(target, current);
    if (!applicant) return;
    await writePost(keep.Id, buildTaxReductionPayload(type, documentNumber, lowered, applicant, target));
  } catch (e) {
    logFailure(type, documentNumber, 'sänkningen före dokumentet', e);
  }
}

/**
 * EFTER dokumentets POST/PUT: posten får målbeloppet och CRM:s sökande. Saknas posten skapas den —
 * men bara med ett giltigt personnummer, och aldrig över Fortnox egen uträkning, som står i
 * dokumentsvaret så länge ingen post finns.
 */
export async function syncTaxReductionAfterDocumentWrite(
  type: TaxReductionDocumentType,
  documentNumber: string,
  target: TaxReductionTarget,
  writtenDocument: { TaxReduction?: number | null } | null | undefined,
): Promise<void> {
  try {
    const posts = await listPosts(type, documentNumber);
    const { keep, extra } = pickKeptPost(posts, target.applicant?.personalNumber ?? null);

    if (!keep?.Id) {
      if (!target.applicant) return;
      const ceiling = typeof writtenDocument?.TaxReduction === 'number' ? Math.floor(writtenDocument.TaxReduction) : null;
      const amount = ceiling == null ? target.amount : Math.min(target.amount, ceiling);
      if (amount < 1) return;
      await writePost(null, buildTaxReductionPayload(type, documentNumber, amount, target.applicant, target));
      return;
    }

    // `createorder` kopierar offertens poster — fler än en kan alltså dyka upp här också.
    for (const post of extra) if (post.Id) await fortnoxDelete(`/taxreductions/${post.Id}`);
    if (target.amount < 1) return;
    const current = await readPost(keep.Id);
    const applicant = applicantFor(target, current);
    if (!applicant) return;
    const payload = buildTaxReductionPayload(type, documentNumber, target.amount, applicant, target);
    if (postMatchesPayload(current, payload)) return;
    await writePost(keep.Id, payload);
  } catch (e) {
    logFailure(type, documentNumber, 'posten efter dokumentet', e);
  }
}
