// Typer och kategorikatalog för filer på arbetsordern.
//
// Kategorierna bor HÄR och ingen annanstans: Zod-schemat i app/api/crm/work-orders/_lib.ts läser
// arrayen, UI:t läser etikettkartan, och ett test låser båda mot CHECK-listan i
// supabase/sql/20260815_crm_work_order_files.sql. En array, tre konsumenter.

export const WORK_ORDER_FILE_CATEGORIES = [
  'drawing',
  'preparation',
  'photo_before',
  'photo_after',
  'other',
] as const;

export type WorkOrderFileCategory = (typeof WORK_ORDER_FILE_CATEGORIES)[number];

// Databasen håller stabila engelska nycklar; svenskan lever bara i visningslagret.
export const workOrderFileCategoryLabel: Record<WorkOrderFileCategory, string> = {
  drawing: 'Ritning',
  preparation: 'Förberedelser',
  photo_before: 'Foto före',
  photo_after: 'Foto efter',
  other: 'Övrigt',
};

// Visningsordningen i fliken. Ritningen först — den är det installatören öppnar ordern för.
export const WORK_ORDER_FILE_CATEGORY_ORDER: readonly WorkOrderFileCategory[] = [
  'drawing',
  'preparation',
  'photo_before',
  'photo_after',
  'other',
];

export function toWorkOrderFileCategory(value: unknown): WorkOrderFileCategory {
  return WORK_ORDER_FILE_CATEGORIES.includes(value as WorkOrderFileCategory)
    ? (value as WorkOrderFileCategory)
    : 'other';
}

// Raden som den ligger i databasen.
export type WorkOrderFileRow = {
  id: string;
  work_order_id: string;
  category: string;
  is_internal: boolean;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
};

// Raden som den lämnar servern. `storage_bucket` och `storage_path` är MEDVETET utelämnade —
// klienten behöver bara den signerade URL:en, och sökvägen är en intern lokaliserare som inte har
// på en klient att göra (SUPABASE_CONVENTIONS: "Row-level is not column-level").
export type WorkOrderFileView = {
  id: string;
  work_order_id: string;
  category: WorkOrderFileCategory;
  is_internal: boolean;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  // Kortlivad signerad URL. Sätts bara för bilder (miniatyrer i listan); PDF får null och öppnas
  // via /files/<id>?redirect=1 vid klick, så vi inte signerar det som ändå inte visas.
  url: string | null;
};

export type CreateWorkOrderFileInput = {
  work_order_id: string;
  category: WorkOrderFileCategory;
  is_internal: boolean;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_by: string;
  created_by_name: string;
};
