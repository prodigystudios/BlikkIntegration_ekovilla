// Arbetsorderns status följer schemat: "Ej planerad" (draft) blir "Planerad" (scheduled) när ordern
// läggs ut, och tillbaka när dess sista kort tas bort. Alla andra statusar står kvar.
//
// ⚠️ DATABASEN ÄGER REGELN. Triggern ops_segments_sync_work_order_status
// (20261006185916_work_order_status_follows_schedule.sql) gör bytet — den går förbi RLS på ordern,
// vilket klienten inte kan (en säljare som lägger ut en kollegas order hade uppdaterat 0 rader).
// Det här är bara tavlans lokala spegling, så att statusen syns direkt efter en placering.
// Ändras regeln ska båda ändras.

export function statusAfterScheduleChange(status: string, placed: boolean): string {
  if (placed && status === 'draft') return 'scheduled';
  if (!placed && status === 'scheduled') return 'draft';
  return status;
}
