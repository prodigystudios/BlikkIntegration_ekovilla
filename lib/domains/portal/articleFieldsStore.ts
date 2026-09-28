import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PORTAL_ARTICLE_CATEGORIES,
  PORTAL_CUSTOMER_NAME_MAX,
  PORTAL_NOTE_MAX,
  PORTAL_SORT_ORDER_MAX,
  hasAtMostThreeDecimals,
  toPortalArticleFields,
  type PortalArticleFields,
} from './articleFields';

// Portalfältens validering och läsningar/skrivningar (`crm_portal_article_fields`, fas 2a). Reglerna bor i
// ./articleFields.ts och i databasen (supabase/migrations/20260928064437_portal_article_fields.sql).
//
// SESSIONSKLIENTEN: RLS kräver crm.article.manage. Bara servern importerar filen (zod ska inte till webbläsaren).

const SELECT = 'article_number, customer_name, category, labor_share, note, sort_order, publish, updated_at';

// ------------------------------------------------------------------------------------------------------- validering

/**
 * Kroppen när fälten sparas. Hela uppsättningen skickas (PUT). En publicerad artikel kräver kundnamn och kategori,
 * som migreringens check: portalens kolumner är not null, och det som saknas här går inte att fylla i någon annanstans.
 */
export const portalArticleFieldsInputSchema = z
  .object({
    customer_name: z.string().trim().max(PORTAL_CUSTOMER_NAME_MAX, `Kundnamnet får vara högst ${PORTAL_CUSTOMER_NAME_MAX} tecken`),
    category: z.enum(PORTAL_ARTICLE_CATEGORIES).nullable(),
    labor_share: z
      .number()
      .min(0, 'Arbetsandelen är 0–100 %')
      .max(1, 'Arbetsandelen är 0–100 %')
      .refine(hasAtMostThreeDecimals, 'Arbetsandelen får ha högst en decimal i procent'),
    note: z.string().trim().max(PORTAL_NOTE_MAX, `Anteckningen får vara högst ${PORTAL_NOTE_MAX} tecken`),
    sort_order: z.number().int('Ordningen är ett heltal').min(0, 'Ordningen kan inte vara negativ').max(PORTAL_SORT_ORDER_MAX),
    publish: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.publish) return;
    if (!value.customer_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customer_name'], message: 'Ange kundnamnet för att publicera artikeln' });
    }
    if (!value.category) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Välj kategori för att publicera artikeln' });
    }
  });

export type PortalArticleFieldsInput = z.infer<typeof portalArticleFieldsInputSchema>;

// ----------------------------------------------------------------------------------------------------- databasen

/** Fälten för en artikel, eller null om den inte har några. Sessionsklienten: RLS kräver crm.article.manage. */
export async function getPortalArticleFields(
  supabase: SupabaseClient,
  articleNumber: string,
): Promise<PortalArticleFields | null> {
  const { data, error } = await supabase
    .from('crm_portal_article_fields')
    .select(SELECT)
    .eq('article_number', articleNumber)
    .maybeSingle();
  if (error) throw new Error(`Kunde inte läsa portalfälten: ${error.message}`);
  return data ? toPortalArticleFields(data) : null;
}

/** Alla artiklars fält, för artikellistan. Några hundra rader som mest, långt under PostgRESTs tak på 1000. */
export async function listPortalArticleFields(supabase: SupabaseClient): Promise<PortalArticleFields[]> {
  const { data, error } = await supabase.from('crm_portal_article_fields').select(SELECT).order('article_number');
  if (error) throw new Error(`Kunde inte läsa portalfälten: ${error.message}`);
  return (data ?? []).map(toPortalArticleFields);
}

export type SavePortalArticleFieldsResult =
  | { kind: 'saved'; fields: PortalArticleFields }
  | { kind: 'forbidden' }
  | { kind: 'invalid'; message: string }
  | { kind: 'db_error'; message: string };

/**
 * Sparar fälten (upsert på artikelnumret) och läser tillbaka raden. Sessionsklienten, så att RLS är grinden. Utan
 * läsningen tillbaka hade en UPDATE som RLS stoppat sett lyckad ut: den ger inget fel, bara noll rader.
 */
export async function savePortalArticleFields(
  supabase: SupabaseClient,
  articleNumber: string,
  input: PortalArticleFieldsInput,
  userId: string,
): Promise<SavePortalArticleFieldsResult> {
  const { data, error } = await supabase
    .from('crm_portal_article_fields')
    .upsert(
      {
        article_number: articleNumber,
        customer_name: input.customer_name,
        category: input.category,
        labor_share: input.labor_share,
        note: input.note,
        sort_order: input.sort_order,
        publish: input.publish,
        updated_by: userId,
      },
      { onConflict: 'article_number' },
    )
    .select(SELECT)
    .maybeSingle();

  if (error) {
    // 42501: RLS eller en saknad grant. 23514: en check i migreringen, som schemat ovan redan borde ha fångat.
    if (error.code === '42501') return { kind: 'forbidden' };
    if (error.code === '23514') return { kind: 'invalid', message: 'Fälten bryter mot en regel i databasen' };
    return { kind: 'db_error', message: error.message };
  }
  if (!data) return { kind: 'forbidden' };
  return { kind: 'saved', fields: toPortalArticleFields(data) };
}
