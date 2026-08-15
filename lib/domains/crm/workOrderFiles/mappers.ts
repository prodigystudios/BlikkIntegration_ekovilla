import { toWorkOrderFileCategory, type WorkOrderFileRow, type WorkOrderFileView } from './types';

// Rad → vy. `storage_bucket` och `storage_path` följer inte med som fält.
//
// ⚠️ DET ÄR INTE SAMMA SAK SOM ATT SÖKVÄGEN ÄR HEMLIG. En signerad URL har formen
// `/object/sign/<bucket>/<path>?token=…`, så för varje rad som får en miniatyr kan klienten läsa
// ut både bucket och sökväg ur URL:en. Att utelämna fälten håller bara nere ytan — det är ingen
// säkerhetsgräns, och inget får bero på att sökvägen är okänd.
//
// Det som faktiskt bär säkerheten ligger på skrivsidan: uppladdarens id är en del av sökvägen, och
// bekräftelsesteget avvisar både en sökväg som inte är anroparens egen och en som redan är
// registrerad (app/api/crm/work-orders/[id]/files/route.ts). Utan dem hade en läsbehörig användare
// kunnat spela tillbaka en sökväg härifrån och få filen raderad.
//
// SUPABASE_CONVENTIONS: "Row-level is not column-level" — policyn öppnar raden, kolumngränsen dras
// här.
export function mapWorkOrderFileRow(row: WorkOrderFileRow, url: string | null): WorkOrderFileView {
  return {
    id: row.id,
    work_order_id: row.work_order_id,
    category: toWorkOrderFileCategory(row.category),
    is_internal: row.is_internal,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    url,
  };
}
