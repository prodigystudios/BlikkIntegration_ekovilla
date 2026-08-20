// Konstruktionsvokabulären — VAR i huset isoleringen sitter.
//
// Kanonisk källa. Fram till 2026-08-20 stod listan skriven på SEX ställen:
//
//   ETIKETTKARTOR (tre)          måttblocket, en handrullad ternär i offertformuläret,
//                                egenkontrollens projektkälla
//   VOKABULÄRKOPIOR (tre)        Zod-enumet på offertrutten + två TS-unioner
//
// Ett nytt värde krävde alltså sex träffsäkra ändringar i tre lager, och de felade olika:
//
//   * Missad ETIKETTKARTA → slug:en renderas rå. På egenkontrollen betyder det att "golv" står
//     tryckt på dokumentet KUNDEN FÅR I HANDEN.
//   * Missat ZOD-ENUM → rutten avvisar hela offerten. Fältet är `.optional().default('')`, så
//     felet visar sig som en rad som tappar sin placering, inte som ett tydligt valideringsfel.
//   * Missad TS-UNION → koden kompilerar inte, vilket är det enda av de tre som fångas gratis.
//
// Nu bor listan här och de sex ställena läser den. `Record<ConstructionSlug, string>` nedan gör
// etiketterna uttömmande på typnivå: lägger du till en slug utan etikett vägrar type-check.
//
// ⚠️ DATABASEN HAR EN KOPIA SOM TYPSYSTEMET INTE NÅR. ops_segment_reports.construction har en CHECK
// på exakt de här slug:arna (supabase/sql/20260820_ops_segment_reports_sack_reporting.sql). Ändras
// listan här MÅSTE en ny migrering ändra CHECK:en — annars avvisar databasen ett värde som resten
// av appen anser giltigt, mitt i installatörens sparning. De får aldrig glida isär.

// Ordningen är den listan visas i och samma ordning som databasens CHECK. `vagg | snedtak | vind`
// har varit i drift sedan offertformuläret byggdes; `golv | mellanbjalklag` tillkom med
// säckrapporteringen.
export const CONSTRUCTION_SLUGS = ['vagg', 'snedtak', 'vind', 'golv', 'mellanbjalklag'] as const;

export type ConstructionSlug = (typeof CONSTRUCTION_SLUGS)[number];

// Uttömmande på typnivå — se huvudet.
const CONSTRUCTION_LABELS: Record<ConstructionSlug, string> = {
  vagg: 'Vägg',
  snedtak: 'Snedtak',
  vind: 'Vind',
  golv: 'Golv',
  mellanbjalklag: 'Mellanbjälklag',
};

// Slug + etikett i visningsordning. Det här är formen en väljare mappar över.
export const CONSTRUCTIONS: ReadonlyArray<{ slug: ConstructionSlug; label: string }> =
  CONSTRUCTION_SLUGS.map((slug) => ({ slug, label: CONSTRUCTION_LABELS[slug] }));

// Offertraden lagrar '' för "inte satt" (createEmptyLineItem), så vokabulären som passerar
// valideringen är slug:arna PLUS tomma strängen. Databasens ops_segment_reports vill ha null i
// stället för '' — normaliseringen sker där, inte här.
export const CONSTRUCTION_VALUES_WITH_EMPTY = [...CONSTRUCTION_SLUGS, ''] as const;

// Svensk etikett, eller '' när värdet inte är en känd konstruktion (inklusive tomt och null).
//
// Anropsstället äger sin egen reserv: måttblocket faller tillbaka på artikelnamnet, egenkontrollen
// likaså. Därför returnerar den här '' i stället för att gissa — en delad funktion som valde reserv
// åt alla tre hade tvingat fram fel svar på minst ett av ställena.
export function constructionLabel(value: string | null | undefined): string {
  const slug = (value ?? '').trim().toLowerCase();
  return (CONSTRUCTION_LABELS as Record<string, string>)[slug] ?? '';
}

// Är värdet en av de fem? Enda vägen från en osäker sträng (databas, formulärstate, localStorage)
// till ConstructionSlug — så en slug som fallit ur listan blir null hos anroparen i stället för att
// smugglas ned i databasen och avvisas av CHECK:en mitt i installatörens sparning.
export function isConstructionSlug(value: string | null | undefined): value is ConstructionSlug {
  return (CONSTRUCTION_SLUGS as readonly string[]).includes((value ?? '').trim().toLowerCase());
}

/**
 * Etikett → slug. EXAKT match (skiftlägesokänsligt), aldrig fuzzy.
 *
 * Finns för egenkontrollen, där etappradens etikett är FRI TEXT som installatören kan skriva om.
 * Har raden ingen slug med sig men installatören skrev "Golv" är det ett svar värt att ta emot;
 * skrev hen "Golv i garaget" är det inte det, och rätt utfall är null → "Ospecificerad". En
 * delsträngsmatchning här hade gjort "Vindsfarstun" till vind, och en felplacerad säck syns aldrig
 * hos oss — bara som fel hink långt senare.
 */
export function constructionFromLabel(label: string | null | undefined): ConstructionSlug | null {
  const needle = (label ?? '').trim().toLowerCase();
  if (!needle) return null;
  return CONSTRUCTION_SLUGS.find((slug) => CONSTRUCTION_LABELS[slug].toLowerCase() === needle) ?? null;
}

/**
 * Gissa konstruktionen ur ett Fortnox-artikelnamn.
 *
 * ⚠️ ORDNINGSKÄNSLIG — grenarna är inte utbytbara.
 *
 *   1. `vind` MÅSTE ligga före `mellanbjalklag`. Vind-grenen matchar `vinds?bjälklag`, och ett
 *      bredare bjälklagsmönster under den skulle stjäla "vindsbjälklag" och placera vindsisolering
 *      i ett mellanbjälklag. Just nu kolliderar de inte (mönstret nedan kräver `mellan`-prefixet),
 *      men ordningen är spärren som håller även om någon breddar det.
 *   2. ⚠️ LÄGG ALDRIG TILL ETT BART `bjälklag`-MÖNSTER. Utan prefix är ordet tvetydigt — det kan
 *      vara vinds-, mellan- eller golvbjälklag — och rätt svar är då '' (ospecificerad), inte en
 *      gissning. En felgissad placering syns aldrig hos oss; den dyker upp som fel hink i
 *      säckrapporteringens differens långt senare.
 *   3. `mellanbjalklag` före `golv` så att den mer specifika vinner på "mellanbjälklag/golv".
 *
 * Returnerar '' när inget mönster träffar. Det är ett giltigt tillstånd, inte ett fel: den
 * PLANERADE placeringen är en gissning på artikelnamnet och det finns ingen mänsklig väljare på
 * offertraden. Rader utan träff redovisas som "Ospecificerad".
 */
export function inferConstructionFromArticle(name?: string | null): ConstructionSlug | '' {
  const value = (name || '').toLowerCase();
  if (/sned\s*tak|snedtak|taklut|lutande/.test(value)) return 'snedtak';
  if (/\bvind\b|vinds?bjälklag|vinden/.test(value)) return 'vind';
  if (/mellanbjälklag|mellanbjalklag/.test(value)) return 'mellanbjalklag';
  if (/golv/.test(value)) return 'golv';
  if (/vägg|vagg|regel|stomme|väggreg/.test(value)) return 'vagg';
  return '';
}
