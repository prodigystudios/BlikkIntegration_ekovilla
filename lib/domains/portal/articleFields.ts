/**
 * Portalfälten per artikel (`crm_portal_article_fields`, RESELLER_PORTAL_CRM_PLAN.md fas 2a): det
 * återförsäljarportalens prislista behöver utöver Fortnox. Priset (lista 160) och enheten kommer från Fortnox;
 * kundnamnet, kategorin, arbetsandelen, anteckningen, ordningen och om artikeln publiceras finns bara här.
 *
 * Redigeras på artikelsidan med `crm.article.manage` (RLS är grinden, routen speglar den). Publiceringen i fas 2b
 * läser fälten och hoppar över det `portalPublishBlockers` säger.
 *
 * Ren och utan zod: artikelsidans kort importerar den, och zod hade följt med till webbläsaren. Valideringen av
 * kroppen och databasanropen ligger i ./articleFieldsStore.ts.
 */

/** Samma värden som portalens `pricelist_articles.category` och migreringens check. */
export const PORTAL_ARTICLE_CATEGORIES = ['losull', 'skivor', 'tatskikt', 'verktyg', 'etablering', 'ovrigt'] as const;
export type PortalArticleCategory = (typeof PORTAL_ARTICLE_CATEGORIES)[number];

export const PORTAL_ARTICLE_CATEGORY_LABELS: Record<PortalArticleCategory, string> = {
  losull: 'Lösull',
  skivor: 'Skivor',
  tatskikt: 'Tätskikt och tejp',
  verktyg: 'Verktyg',
  etablering: 'Etablering',
  ovrigt: 'Övrigt',
};

export const PORTAL_CUSTOMER_NAME_MAX = 200;
export const PORTAL_NOTE_MAX = 500;
export const PORTAL_SORT_ORDER_MAX = 2_147_483_647; // Postgres integer

export type PortalArticleFields = {
  article_number: string;
  customer_name: string;
  category: PortalArticleCategory | null;
  /** 0–1, högst tre decimaler (numeric(4,3), som portalens kolumn). 0,455 = 45,5 %. */
  labor_share: number;
  note: string;
  sort_order: number;
  publish: boolean;
  updated_at: string | null;
};

/** Tomma fält för en artikel som inte har några än. Publiceras inte. */
export function emptyPortalArticleFields(articleNumber: string): PortalArticleFields {
  return {
    article_number: articleNumber,
    customer_name: '',
    category: null,
    labor_share: 0,
    note: '',
    sort_order: 0,
    publish: false,
    updated_at: null,
  };
}

function isCategory(value: unknown): value is PortalArticleCategory {
  return typeof value === 'string' && (PORTAL_ARTICLE_CATEGORIES as readonly string[]).includes(value);
}

/** En rad ur databasen. `labor_share` är numeric och kan komma som sträng; en okänd kategori blir null. */
export function toPortalArticleFields(row: Record<string, unknown>): PortalArticleFields {
  const share = Number(row.labor_share);
  const sort = Number(row.sort_order);
  return {
    article_number: String(row.article_number ?? ''),
    customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
    category: isCategory(row.category) ? row.category : null,
    labor_share: Number.isFinite(share) ? share : 0,
    note: typeof row.note === 'string' ? row.note : '',
    sort_order: Number.isInteger(sort) ? sort : 0,
    publish: row.publish === true,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

// ----------------------------------------------------------------------------------------------------- arbetsandelen

/**
 * Högst tre decimaler. numeric(4,3) avrundar en fjärde decimal TYST (0,4555 blir 0,456), så den nekas här i stället.
 * Toleransen tar bort flyttalsbruset i t.ex. 0.1 + 0.2.
 */
export function hasAtMostThreeDecimals(value: number): boolean {
  const thousandths = value * 1000;
  return Math.abs(thousandths - Math.round(thousandths)) < 1e-6;
}

/**
 * Arbetsandelen som användaren skriver den, i procent: "45", "45,5", "45.5", "45 %". Högst en decimal (0,455 är
 * tre decimaler som andel), 0–100. Ger andelen 0–1, eller null för tomt och ogiltigt: en tom ruta är inte 0 %.
 */
export function parseLaborSharePercent(text: string): number | null {
  const match = text.trim().replace(/\s*%$/, '').match(/^(\d{1,3})(?:[.,](\d))?$/);
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? 0);
  if (tenths > 1000) return null;
  // Heltal i tiondels procent → andel med tre decimaler, utan flyttalsbrus: 455 → 0.455.
  return tenths / 1000;
}

/** Andelen som procent med svenskt komma, utan onödig decimal: 0.45 → "45", 0.455 → "45,5". */
export function formatLaborSharePercent(share: number): string {
  const tenths = Math.round(share * 1000);
  const whole = Math.trunc(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0 ? String(whole) : `${whole},${decimal}`;
}

/** Artikelnumret ur adressen: samma regel som migreringens check (1–50 tecken, inga blanksteg runt). */
export function isValidPortalArticleNumber(value: string): boolean {
  return value.length >= 1 && value.length <= 50 && value === value.trim();
}

// ---------------------------------------------------------------------------------------------- vad som publiceras

export type PortalPublishBlocker = 'inactive' | 'missing_unit' | 'missing_price';

export const PORTAL_PUBLISH_BLOCKER_LABELS: Record<PortalPublishBlocker, string> = {
  inactive: 'Artikeln är inaktiv',
  missing_unit: 'Artikeln saknar enhet',
  missing_price: 'Artikeln saknar pris på lista 160',
};

/**
 * Varför en artikel inte kommer med i prislistan fast den är markerad (William 2026-09-28: vilken artikel som helst
 * kan markeras, och publiceringen sållar). Enheten, priset och aktiv kan ändras i Fortnox efter att fälten sparats,
 * så regeln prövas vid publiceringen (fas 2b) och visas som en varning på artikelsidan, med samma funktion.
 *
 * `resellerPrice` är grundpriset (FromQuantity 0) på lista 160; null = inget pris. 0 kr är ett pris.
 */
export function portalPublishBlockers(article: {
  active: boolean;
  unit: string | null;
  resellerPrice: number | null;
}): PortalPublishBlocker[] {
  const blockers: PortalPublishBlocker[] = [];
  if (!article.active) blockers.push('inactive');
  if (!article.unit?.trim()) blockers.push('missing_unit');
  if (article.resellerPrice === null || !Number.isFinite(article.resellerPrice)) blockers.push('missing_price');
  return blockers;
}
