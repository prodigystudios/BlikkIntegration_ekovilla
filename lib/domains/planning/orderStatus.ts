// Arbetsorderns status visas på varje kort och backlogpost som hör till ordern. När en skrivning på
// schemat ger ordern ny status ska ALLA visa den, inte bara raden som ändrades — annars står etapp 1
// som "Planerad" och etapp 2 som "Ej planerad" för samma order.
//
// Statusen kommer från servern (readWorkOrderStatus, läst efter databasens trigger). Regeln för NÄR
// den byts bor bara i triggern ops_segments_sync_work_order_status; här finns ingen kopia av den.
//
// Samma array tillbaka när inget ändras, så att en oförändrad lista inte ritar om tavlan.

type BacklogEntry = { id: string; status: string };
type SegmentEntry = { work_order_id: string | null; job: { status: string } | null };

export function backlogWithOrderStatus<T extends BacklogEntry>(items: T[], workOrderId: string, status: string | null | undefined): T[] {
  if (!status || !items.some((b) => b.id === workOrderId && b.status !== status)) return items;
  return items.map((b) => (b.id === workOrderId && b.status !== status ? { ...b, status } : b));
}

export function segmentsWithOrderStatus<T extends SegmentEntry>(items: T[], workOrderId: string, status: string | null | undefined): T[] {
  const stale = (s: T) => s.work_order_id === workOrderId && s.job !== null && s.job.status !== status;
  if (!status || !items.some(stale)) return items;
  return items.map((s) => (stale(s) && s.job ? { ...s, job: { ...s.job, status } } : s));
}
