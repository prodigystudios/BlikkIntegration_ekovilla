import type { SupabaseClient } from '@supabase/supabase-js';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { normalizeBlocks, type Block } from './blocks';
import { resolveFileKind, signInfoImageUrls, toDownloadUrl, type InfoFileKind } from './storage';

// Raden heter fortfarande "image" efter tabellen (info_section_images) men bär sedan
// 2026-08-21 även pdf:er. `kind` är det sidan renderar på — aldrig filändelsen på plats.
export type InfoImage = {
  id: string;
  caption: string | null;
  fileName: string;
  kind: InfoFileKind;
  // null när objektet inte gick att signera (borttaget i storage, fel bucket). Sidan visar
  // en tydlig platshållare i stället för en trasig <img>.
  url: string | null;
  // Samma adress med ?download= påhängt. Eget fält och inte något klienten bygger själv:
  // en seedad fil ligger på vårt eget ursprung och ska INTE ha parametern, och skillnaden
  // hör hemma där sanningen om raden finns.
  downloadUrl: string | null;
};

export type InfoSection = {
  id: string;
  title: string;
  body: Block[];
  images: InfoImage[];
  // Bärs ända ut till redigeraren. Utan den skulle omordningen tvingas skriva radens INDEX som
  // ny sort_order, och index är bara samma sak som lagrad ordning så länge värdena råkar vara
  // 0..n-1 — vilket de slutar vara så fort något raderas.
  sortOrder: number;
};

export type InfoGroup = {
  id: string;
  title: string;
  sections: InfoSection[];
  sortOrder: number;
};

type ImageRow = {
  id: string;
  section_id: string;
  caption: string | null;
  file_name: string;
  content_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_path: string | null;
};

/**
 * Läser hela /dokument-information i tre frågor och sätter ihop trädet i minnet.
 *
 * Tre platta select:er i stället för en nästlad join med flit: PostgREST kapar nästlade
 * barnlistor tyst vid sin radgräns, och en sektion som tappar sina bilder utan felmeddelande
 * är precis den sortens bugg ingen anmäler. Sidan är dessutom liten — tre frågor är billigare
 * än risken.
 *
 * `client` ska vara sessionsklienten: RLS avgör vem som får läsa. Signeringen av bilderna
 * sker sedan med service-role, efter att RLS redan har släppt igenom raderna.
 */
export async function loadInfoPage(client: SupabaseClient): Promise<InfoGroup[]> {
  const [groupsRes, sectionsRes, imagesRes] = await Promise.all([
    client.from('info_groups').select('id, title, sort_order, created_at').order('sort_order').order('created_at'),
    client.from('info_sections').select('id, group_id, title, body, sort_order, created_at').order('sort_order').order('created_at'),
    client
      .from('info_section_images')
      // 🧨 content_type kräver 20260821_info_section_files.sql. Körs koden först svarar
      // PostgREST 42703 och HELA sidan faller ned i sin felruta — se filhuvudet i migreringen.
      .select('id, section_id, caption, file_name, content_type, storage_bucket, storage_path, public_path, sort_order, created_at')
      .order('sort_order')
      .order('created_at'),
  ]);

  if (groupsRes.error) throw new Error(groupsRes.error.message);
  if (sectionsRes.error) throw new Error(sectionsRes.error.message);
  if (imagesRes.error) throw new Error(imagesRes.error.message);

  const imageRows = (imagesRes.data || []) as ImageRow[];

  // Signera per bucket. I praktiken är det en enda bucket, men bucketnamnet bor per rad just
  // för att en flytt ska vara möjlig — då finns två under övergången.
  const pathsByBucket = new Map<string, string[]>();
  for (const row of imageRows) {
    if (!row.storage_bucket || !row.storage_path) continue;
    const list = pathsByBucket.get(row.storage_bucket) ?? [];
    list.push(row.storage_path);
    pathsByBucket.set(row.storage_bucket, list);
  }

  const signed = new Map<string, string>();
  const admin = getOptionalSupabaseAdmin();
  if (admin && pathsByBucket.size > 0) {
    const results = await Promise.all(
      Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
        const urls = await signInfoImageUrls(admin, bucket, paths);
        return [bucket, urls] as const;
      }),
    );
    for (const [bucket, urls] of results) {
      for (const [path, url] of urls) signed.set(`${bucket}::${path}`, url);
    }
  }

  const imagesBySection = new Map<string, InfoImage[]>();
  for (const row of imageRows) {
    const url = row.public_path
      ? row.public_path
      : signed.get(`${row.storage_bucket}::${row.storage_path}`) ?? null;
    const list = imagesBySection.get(row.section_id) ?? [];
    list.push({
      id: row.id,
      caption: row.caption,
      fileName: row.file_name,
      // Sökvägen före filnamnet: file_name är fritext som administratören kan ha skrivit utan
      // ändelse (de seedade raderna heter "Lathund Isolering"), medan sökvägen alltid bär den.
      kind: resolveFileKind(row.content_type, row.storage_path || row.public_path || row.file_name),
      url,
      // En seedad fil ligger under /documents/ på vårt eget ursprung — där fungerar html-
      // attributet `download`, och ?download= hade bara varit en okänd parameter.
      downloadUrl: row.public_path ? row.public_path : url ? toDownloadUrl(url) : null,
    });
    imagesBySection.set(row.section_id, list);
  }

  const sectionsByGroup = new Map<string, InfoSection[]>();
  for (const row of (sectionsRes.data || []) as Array<{ id: string; group_id: string; title: string; body: unknown; sort_order: number }>) {
    const list = sectionsByGroup.get(row.group_id) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      sortOrder: row.sort_order ?? 0,
      // Whitelistas även på läsvägen, inte bara vid sparning: kolumnen är jsonb och kan ha
      // handredigerats i Supabase-editorn sedan den skrevs.
      body: normalizeBlocks(row.body),
      images: imagesBySection.get(row.id) ?? [],
    });
    sectionsByGroup.set(row.group_id, list);
  }

  return ((groupsRes.data || []) as Array<{ id: string; title: string; sort_order: number }>).map((group) => ({
    id: group.id,
    title: group.title,
    sortOrder: group.sort_order ?? 0,
    sections: sectionsByGroup.get(group.id) ?? [],
  }));
}
