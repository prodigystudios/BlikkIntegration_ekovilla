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
// 7. Utan husarbetsrader kvar (ROT avslaget, allt arbete borta) nekas dagens payload (2003227), men
//    `TaxReductionType: 'none'` går igenom och Fortnox tar då bort posterna själv — på offert OCH
//    order. `'rot'` igen går också, och är ofarligt på ett dokument som redan är ROT. Med en
//    husarbetsrad kvar nekas `'none'` (2004001); en rad som utelämnar `HouseWork` ÄRVER flaggan från
//    raden som låg på samma position — orderns projektnot hamnar t.ex. där arbetsraden låg när
//    arbetet skrivs av. 🧨 Uttryckligt `HouseWork: false` räcker inte, TYPEN ärvs och nekas
//    (2004021); `HouseWork: false` + `HouseWorkType: null` går igenom (`withoutHouseWork`).
// 8. `PropertyDesignation` och `ResidenceAssociationOrganisationNumber` FINNS på posten — tvärtemot
//    vad FORTNOX_INTEGRATION.md sekt. 4b påstår om API:t. Vi skickar dem; textraden/referensen
//    finns kvar som förut.
// 9. Fortnox avrundar underlaget NEDÅT till hela kronor (416,66 → 416) och taket är 30 % av det,
//    golvat. CRM räknar på oavrundat underlag och kan alltså hamna en krona över. `referencenumber`
//    filtreras på serverns sida. "Övrigt" (OTHERCOSTS) på en husarbetsrad nekas redan av Fortnox.
//
// ⚖️ BELOPPET ÄR CRM:S `rotDeduction` (computePricing) — samma tal säljaren ser i formuläret. Det
// går inte att låta Fortnox räkna: med en post på plats rapporterar dokumentet postens belopp, inte
// sitt eget tak (punkt 2), och den sista posten går inte att ta bort för att läsa taket (punkt 5).
// Därmed når `rot_percent` och `max_deduction` Fortnox, via posten. Saknas en post (nytt dokument)
// läser vi Fortnox egen uträkning ur svaret och begär aldrig mer än den. Nekar Fortnox CRM:s belopp
// (en procentsats över lagens, avrundningen i punkt 9) begärs Fortnox tak i stället.
//
// 🧭 SKRIVNINGEN ÄR REAKTIV, inte förutsägande. Första försöket är exakt dokumentets vanliga
// payload, så ett dokument utan poster — varje företagsoffert — kostar inte ett enda extra anrop.
// Först när Fortnox nekar med 2003227 sänks posterna till minimum, och räcker inte det (inga
// husarbetsrader kvar) skickas `'none'` (punkt 7). Taket kan inte förutsägas: det bestäms av rader
// som kan ärva husarbete positionellt och av Fortnox avrundning.
//
// ⚠️ CRM BÄR EN SÖKANDE och äger posterna på dokument det skickar: fler poster än en slås ihop till
// vår. Delar man avdraget mellan två sökande för hand i Fortnox skrivs det över vid nästa push. Och
// en post ekonomi skrivit in för hand (CRM utan giltigt personnummer) försvinner om dokumentet måste
// gå via `none` — CRM har ingen sökande att skapa en ny med.
//
// ⚠️ POSTENS EGNA STEG ÄR BEST EFFORT. Ett fel loggas och pushen fortsätter; fallbacken är läget
// före den här modulen (Fortnox räknar ur raderna, ingen sökande). Bara själva dokumentskrivningen
// får kasta — och den gör det bara när den hade kastat utan posterna också.

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
function applicantFor(ours: TaxReductionApplicant | null | undefined, post: FortnoxTaxReductionPost): TaxReductionApplicant | null {
  if (ours) return ours;
  const name = String(post.CustomerName ?? '').trim();
  const personalNumber = String(post.SocialSecurityNumber ?? '').trim();
  return name && personalNumber ? { name, personalNumber } : null;
}

// ── Mot Fortnox ──────────────────────────────────────────────────────────────

/** Posterna begär mer än dokumentets nya rader ger. Nekar HELA dokumentskrivningen. */
const POSTS_EXCEED_DOCUMENT = 2003227;
/** Posten begär mer än dokumentet ger. Nekar posten. */
const POST_EXCEEDS_DOCUMENT = 2003228;
/** `TaxReductionType: 'none'` med husarbetsrader kvar — flaggan (2004001) eller typen (2004021). */
const NONE_WITH_HOUSEWORK_ROWS = [2004001, 2004021];
/**
 * Lagens ROT-sats sedan 2026-01-01 (50 % gällde 2025-05-12–2025-12-31). Används BARA när Fortnox
 * nekat CRM:s belopp, för att begära Fortnox tak i stället — mätt: taket är 30 % av underlaget,
 * golvat (punkt 9). Ändras lagen och Fortnox med den nekas även det här beloppet, och felet loggas.
 */
const ROT_RATE = 0.3;

/**
 * Raderna i `'none'`-skrivningen: uttryckligen utan husarbete. Ett `none`-dokument får inte ha
 * något, och utelämnade fält ärvs positionellt — även typen, så flaggan ensam räcker inte (punkt 7).
 *
 * ⚠️ BARA I `none`-SKRIVNINGEN. På ett ROT-dokument tar ett uttryckligt `false` bort artikelns egen
 * husarbetsflagga (se rotRowHouseWork i helpers.ts) — där ska vi vara tysta.
 */
export function withoutHouseWork<R extends object>(rows: R[]): Array<R & { HouseWork: false; HouseWorkType: null }> {
  return rows.map((row) => ({ ...row, HouseWork: false as const, HouseWorkType: null }));
}

/** Dokumentet som Fortnox svarar med efter en skrivning — de fält posten behöver. */
export type WrittenDocument = { TaxReduction?: number | null; BasisTaxReduction?: number | null };

function isFortnoxCode(e: unknown, code: number): boolean {
  return e instanceof FortnoxApiError && e.fortnoxCode === code;
}

function describe(e: unknown): string {
  return e instanceof FortnoxApiError
    ? `${e.fortnoxMessage ?? e.message}${e.fortnoxCode ? ` (kod ${e.fortnoxCode})` : ''}`
    : (e as Error)?.message ?? String(e);
}

function logFailure(type: TaxReductionDocumentType, documentNumber: string, step: string, e: unknown): void {
  console.error(`[fortnox-skattereduktion] ${type} ${documentNumber}: ${step} misslyckades — ${describe(e)}`);
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
 * Skriver posten. Nekar Fortnox kroppen av något annat skäl än beloppet, och den bar
 * fastighetsuppgifter, görs ett försök till utan dem: ett felformaterat BRF-nummer får inte kosta
 * själva beloppet, för det är beloppet kunden ser.
 */
async function writePost(id: number | null, payload: TaxReductionPayload): Promise<void> {
  const send = (body: TaxReductionPayload) =>
    id == null ? fortnoxPost('/taxreductions', body) : fortnoxPut(`/taxreductions/${id}`, body);
  try {
    await send(payload);
  } catch (e) {
    const { PropertyDesignation, ResidenceAssociationOrganisationNumber, ...rest } = payload.TaxReduction;
    const hadPlace = PropertyDesignation !== undefined || ResidenceAssociationOrganisationNumber !== undefined;
    const aboutAmount = isFortnoxCode(e, POST_EXCEEDS_DOCUMENT) || isFortnoxCode(e, POSTS_EXCEED_DOCUMENT);
    if (!(e instanceof FortnoxApiError) || e.status !== 400 || aboutAmount || !hadPlace) throw e;
    console.warn(`[fortnox-skattereduktion] ${rest.ReferenceDocumentType} ${rest.ReferenceNumber}: fastighetsuppgifterna nekades (${describe(e)}) — skickar beloppet utan dem`);
    await send({ TaxReduction: rest });
  }
}

/**
 * Beloppet att begära: målet, och nekar Fortnox det — Fortnox tak ur dokumentets underlag (punkt 9).
 */
async function writePostAmount(
  id: number | null,
  payload: TaxReductionPayload,
  written: WrittenDocument | null | undefined,
): Promise<void> {
  try {
    await writePost(id, payload);
  } catch (e) {
    if (!isFortnoxCode(e, POST_EXCEEDS_DOCUMENT)) throw e;
    const basis = Number(written?.BasisTaxReduction);
    const ceiling = Number.isFinite(basis) ? Math.floor(Math.floor(basis) * ROT_RATE) : null;
    if (ceiling == null || ceiling < 1 || ceiling >= payload.TaxReduction.AskedAmount) throw e;
    const { ReferenceDocumentType, ReferenceNumber, AskedAmount } = payload.TaxReduction;
    console.warn(`[fortnox-skattereduktion] ${ReferenceDocumentType} ${ReferenceNumber}: ${AskedAmount} kr nekades — begär Fortnox tak ${ceiling} kr`);
    await writePost(id, { TaxReduction: { ...payload.TaxReduction, AskedAmount: ceiling } });
  }
}

/**
 * FÖRE dokumentskrivningen: städa bort extra poster och sänk vår till målet, så att den vanliga
 * skrivningen oftast går igenom på första försöket när avdraget minskat. Höjningar väntar till efteråt.
 */
async function lowerPostsTowards(
  type: TaxReductionDocumentType,
  documentNumber: string,
  target: TaxReductionTarget | null,
  amount: number,
): Promise<void> {
  const posts = await listPosts(type, documentNumber);
  const { keep, extra } = pickKeptPost(posts, target?.applicant?.personalNumber ?? null);
  if (!keep?.Id) return;
  // Bara andra poster än den vi behåller — den sista går inte att radera (punkt 5 överst).
  for (const post of extra) if (post.Id) await fortnoxDelete(`/taxreductions/${post.Id}`);
  const current = await readPost(keep.Id);
  const lowered = amountBeforeDocumentWrite(current.AskedAmount, amount);
  if (lowered == null) return;
  const applicant = applicantFor(target?.applicant, current);
  if (!applicant) throw new Error('posten saknar sökande och kan inte skrivas om');
  await writePost(keep.Id, buildTaxReductionPayload(type, documentNumber, lowered, applicant, target ?? {
    // ROT avslaget i CRM: posten behåller sina egna uppgifter, bara beloppet sänks.
    propertyDesignation: null, brfOrgNumber: null,
  }));
}

/**
 * Skriver ett dokument som redan finns i Fortnox, med skattereduktionsposten i rätt ordning.
 *
 * `write` gör själva dokument-PUT:en och får ett `TaxReductionType` att lägga till när Fortnox
 * kräver det — vid `'none'` också raderna genom `withoutHouseWork`. `target` är null när ROT inte gäller enligt CRM — posten skrivs då inte, men den kan
 * fortfarande stå i vägen (kopierad av `createorder`, kvar från innan ROT slogs av), och då röjs den.
 *
 * Kastar bara när skrivningen hade kastat utan poster också: 2003227 rör posterna och hanteras här,
 * allt annat går rakt igenom till anroparen som förut.
 */
export async function writeDocumentKeepingTaxReduction<T extends WrittenDocument>(
  type: TaxReductionDocumentType,
  documentNumber: string,
  target: TaxReductionTarget | null,
  write: (reductionType?: 'none' | 'rot') => Promise<T | undefined>,
): Promise<T | undefined> {
  if (target) {
    try {
      await lowerPostsTowards(type, documentNumber, target, target.amount);
    } catch (e) {
      logFailure(type, documentNumber, 'sänkningen före dokumentet', e);
    }
  }

  let written: T | undefined;
  try {
    written = await write();
  } catch (e) {
    if (target && NONE_WITH_HOUSEWORK_ROWS.some((code) => isFortnoxCode(e, code))) {
      // ROT gäller i CRM men dokumentet står som `none` — en återhämtning som avbröts mellan `none`
      // och `rot` (nätverksfel, timeout). Ordrar skickar aldrig typen själva, så utan det här nekades
      // varje senare push för husarbetsraderna och faktureringen låg spärrad. `rot` är uppmätt
      // ofarligt på ett ROT-dokument; ett `none`-dokument har inga poster att krocka med.
      console.warn(`[fortnox-skattereduktion] ${type} ${documentNumber}: dokumentet stod som none med ROT i CRM — skickar rot`);
      written = await write('rot');
    } else {
      if (!isFortnoxCode(e, POSTS_EXCEED_DOCUMENT)) throw e;
      written = await recoverFromPostsAboveDocument(type, documentNumber, target, write, e);
    }
  }

  if (target) await syncTaxReductionAfterDocumentWrite(type, documentNumber, target, written);
  return written;
}

/** Fortnox nekade dokumentet för att posterna begär mer än raderna ger (2003227). */
async function recoverFromPostsAboveDocument<T extends WrittenDocument>(
  type: TaxReductionDocumentType,
  documentNumber: string,
  target: TaxReductionTarget | null,
  write: (reductionType?: 'none' | 'rot') => Promise<T | undefined>,
  original: unknown,
): Promise<T | undefined> {
  // Steg 1, bara med ROT i CRM: posten ner till Fortnox minimum och samma skrivning igen. Räcker
  // när det finns husarbete kvar — ett lägre tak än förut, eller CRM:s belopp över Fortnox (punkt
  // 9). Efteråt får posten sitt riktiga belopp.
  if (target) {
    try {
      await lowerPostsTowards(type, documentNumber, target, 1);
    } catch (e) {
      logFailure(type, documentNumber, 'sänkningen efter nekat dokument', e);
      throw original;
    }
    try {
      const written = await write();
      console.warn(`[fortnox-skattereduktion] ${type} ${documentNumber}: dokumentet nekades (2003227) — gick igenom med posten sänkt`);
      return written;
    } catch (e) {
      if (!isFortnoxCode(e, POSTS_EXCEED_DOCUMENT)) throw e;
    }
  }
  // Steg 2: inget husarbete som kan bära posten — eller ROT avslaget i CRM, då inget ska bära den.
  // Den sista posten går varken att radera eller sätta under 1 kr. Bara `'none'` med raderna
  // uttryckligen utan husarbete går igenom, och då tar Fortnox själv bort posterna (punkt 7). Gäller
  // ROT fortfarande i CRM återställs regimen direkt — utan post, som ett nytt ROT-dokument.
  let cleared: T | undefined;
  try {
    cleared = await write('none');
  } catch (e) {
    if (!NONE_WITH_HOUSEWORK_ROWS.some((code) => isFortnoxCode(e, code))) throw e;
    // ÅTERVÄNDSGRÄND: en rad utan belopp (typiskt orderns projektnot, som hamnat på arbetsradens
    // plats) har ärvt husarbetsflaggan. Underlaget är 0, så posten ryms inte; den sista posten går
    // inte att radera; och `none` nekas för flaggans skull. Inget API-anrop tar sig ur det — en
    // människa måste rensa husarbetet på dokumentet i Fortnox. Säg det i stället för Fortnox kod.
    logFailure(type, documentNumber, 'none med husarbetsrader kvar', e);
    throw new FortnoxApiError(
      400,
      `${type} ${documentNumber}: skattereduktionsposten ryms inte och kan inte tas bort (${describe(e)})`,
      undefined,
      'Fortnox-dokumentet har kvar en skattereduktion men inga ROT-belopp som kan bära den. '
        + 'Rensa husarbetet (skattereduktionen) på dokumentet i Fortnox och synka igen.',
    );
  }
  console.warn(`[fortnox-skattereduktion] ${type} ${documentNumber}: inga husarbetsrader kvar — posten borttagen via TaxReductionType none`);
  return target ? write('rot') : cleared;
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
  writtenDocument: WrittenDocument | null | undefined,
): Promise<void> {
  try {
    const posts = await listPosts(type, documentNumber);
    const { keep, extra } = pickKeptPost(posts, target.applicant?.personalNumber ?? null);

    if (!keep?.Id) {
      if (!target.applicant) return;
      const ceiling = typeof writtenDocument?.TaxReduction === 'number' ? Math.floor(writtenDocument.TaxReduction) : null;
      const amount = ceiling == null ? target.amount : Math.min(target.amount, ceiling);
      if (amount < 1) return;
      await writePostAmount(null, buildTaxReductionPayload(type, documentNumber, amount, target.applicant, target), writtenDocument);
      return;
    }

    // `createorder` kopierar offertens poster — fler än en kan alltså dyka upp här också.
    for (const post of extra) if (post.Id) await fortnoxDelete(`/taxreductions/${post.Id}`);
    if (target.amount < 1) return;
    const current = await readPost(keep.Id);
    const applicant = applicantFor(target.applicant, current);
    if (!applicant) return;
    const payload = buildTaxReductionPayload(type, documentNumber, target.amount, applicant, target);
    if (postMatchesPayload(current, payload)) return;
    await writePostAmount(keep.Id, payload, writtenDocument);
  } catch (e) {
    logFailure(type, documentNumber, 'posten efter dokumentet', e);
  }
}
