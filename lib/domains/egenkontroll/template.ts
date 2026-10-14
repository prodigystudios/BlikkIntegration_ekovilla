import type { EtappClosedRow, EtappOpenRow } from './calculations';

// Egenkontrollens blankett — kortens rubriker, fälten, kontrollerna och etapptabellernas kolumner,
// precis som egenkontrollens PDF (app/api/pdf/generate/route.ts) skriver ut dem.
//
// EN källa, två läsare: PDF:en fyller i blanketten, KMA-planens bilaga 6
// (lib/domains/crm/kmaPlans/document.ts) visar den tom som mall. Bilagan var tidigare en egen kopia
// efter en äldre Word-mall och gled isär — Luftspalt i stället för Takfotsventilation, andra
// kolumner, en signaturrad för platschefen som egenkontrollen inte har (Williams beslut 2026-10-14:
// bilagan ska vara den egenkontroll vi använder).
//
// Ren data: inga importer utom typer, så varken KMA-planen eller routen drar in den andra.

/** Kortens rubriker, i PDF:ens ordning. */
export const EGENKONTROLL_SECTIONS = {
  project: 'Projekt',
  material: 'Material',
  checks: 'Kontroller',
  comments: 'Övriga kommentarer',
  openStages: 'Etapper (öppet)',
  closedStages: 'Etapper (slutet)',
  signature: 'Signatur',
} as const;

/** Projektkortet. PDF:en ritar de tre första i vänster kolumn, de tre sista i höger. */
export const EGENKONTROLL_PROJECT_FIELDS = {
  client: 'Kund / beställare',
  address: 'Adress',
  installationDate: 'Installationsdatum',
  installer: 'Ansvarig installatör',
  orderId: 'Vårt ordernummer',
  projectNumber: 'Projektnummer',
} as const;

export const EGENKONTROLL_MATERIAL_FIELD = 'Använt material';

/** Fältet i kortet "Övriga kommentarer". */
export const EGENKONTROLL_COMMENT_FIELD = 'Kommentar';

/** Etapprader per tabell — formulärets tak, och bilaga 6:s tomma rader att skriva på. */
export const EGENKONTROLL_MAX_STAGE_ROWS = 6;

/** Kontrollerna. `key` är nyckeln i PDF-anropets `checks` — app/egenkontroll/page.tsx skickar dem. */
export const EGENKONTROLL_CHECKS = [
  { key: 'takfotsventilation', label: 'Takfotsventilation' },
  { key: 'snickerier', label: 'Snickerier' },
  { key: 'tatskikt', label: 'Tätskikt' },
  { key: 'genomforningar', label: 'Genomförningar' },
  { key: 'grovstadning', label: 'Grovstädning' },
  { key: 'markskylt', label: 'Märkskylt' },
] as const;

// Etapptabellernas kolumner: nyckel (fältet i etappraden) och rubrik, i PDF:ens ordning. Bredderna
// hör till varje ritare — egenkontrollens PDF och bilaga 6 har olika typsnitt — och slås upp per
// nyckel där, så en ny kolumn här stoppar typkontrollen tills båda gett den en bredd.
type StageColumn<Row> = { key: keyof Row & string; label: string };

export const EGENKONTROLL_OPEN_STAGE_COLUMNS = [
  { key: 'etapp', label: 'Etapp' },
  { key: 'ytaM2', label: 'Yta m2' },
  { key: 'bestalldTjocklek', label: 'Beställd tjocklek' },
  { key: 'sattningsprocent', label: 'Sättningsprocent %' },
  { key: 'installeradTjocklek', label: 'Installerad tjocklek' },
  { key: 'antalSack', label: 'Antal säck' },
  { key: 'installeradDensitet', label: 'Installerad densitet' },
  { key: 'lambdavarde', label: 'Lambdavärde' },
] as const satisfies ReadonlyArray<StageColumn<EtappOpenRow>>;

export const EGENKONTROLL_CLOSED_STAGE_COLUMNS = [
  { key: 'etapp', label: 'Etapp' },
  { key: 'ytaM2', label: 'Yta m2' },
  { key: 'bestalldTjocklek', label: 'Beställd tjocklek' },
  { key: 'uppmatTjocklek', label: 'Uppmätt tjocklek' },
  { key: 'antalSackKgPerSack', label: 'Antal säck' },
  { key: 'installeradDensitet', label: 'Installerad densitet' },
  { key: 'lambdavarde', label: 'Lambdavärde' },
] as const satisfies ReadonlyArray<StageColumn<EtappClosedRow>>;

export type EgenkontrollOpenStageKey = (typeof EGENKONTROLL_OPEN_STAGE_COLUMNS)[number]['key'];
export type EgenkontrollClosedStageKey = (typeof EGENKONTROLL_CLOSED_STAGE_COLUMNS)[number]['key'];

/** Signaturkortets rader, uppifrån. */
export const EGENKONTROLL_SIGNATURE_FIELDS = {
  dateCity: 'Datum och ort',
  signature: 'Underskrift',
  nameClarification: 'Namnförtydligande',
} as const;
