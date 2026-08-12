import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  canTransition,
  getTimeApproval,
  periodLockError,
  periodStartOf,
  setTimePeriodStatus,
  statusOf,
} from '@/lib/domains/time/approvals';
import {
  can,
  getEffectivePermissions,
  ok,
  periodQuerySchema,
  requireSignedInUser,
  routeError,
  setPeriodStatusSchema,
  validationError,
} from '../_lib';

// Attest av en kalendermånad.
//
// EN ENDA ÅTGÄRDSFORM för hela domänen: POST med målstatus. Alternativet — /submit, /approve,
// /reopen som egna routes — hade spridit övergångsmatrisen över fyra filer, och matrisen är regeln.
// Vem som får göra vad avgörs av canTransition (och slutgiltigt av RPC:n), inte av vilken adress
// som anropades.
//
// Ingen userId-parameter på GET, av samma skäl som på /api/time/entries: den egna perioden är det
// den anställde ska se. Andras status finns i attestvyn — GET /api/admin/time/approvals, bakom
// time.approve.

// GET /api/time/approvals?period=YYYY-MM — den inloggades egen status för månaden.
export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const url = new URL(req.url);
    const parsed = periodQuerySchema.safeParse({ period: url.searchParams.get('period') });
    if (!parsed.success) return validationError(parsed.error);

    const periodStart = periodStartOf(parsed.data.period);
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getTimeApproval(supabase, user.currentUser.id, periodStart);
    if (error) return routeError(500, 'time_approval_read_failed', error.message);

    // Ingen rad = öppen period. Raden skapas först vid första övergången, så svaret normaliseras
    // här i stället för att varje läsare ska behöva känna till tomma tillståndet.
    return ok({ period_start: periodStart, status: statusOf(data), approval: data ?? null });
  } catch (e: any) {
    return routeError(500, 'time_approval_unexpected', e?.message || 'Kunde inte hämta periodens status');
  }
}

// POST /api/time/approvals — lämna in, ångra, attestera eller öppna igen.
export async function POST(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const parsed = setPeriodStatusSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const periodStart = periodStartOf(parsed.data.period);
    const targetUserId = parsed.data.user_id || user.currentUser.id;
    const isSelf = targetUserId === user.currentUser.id;

    const perms = await getEffectivePermissions();
    const canApprove = can(perms, 'time.approve');

    // Snabb återvändo innan något läses: att röra någon annans period kräver nyckeln, punkt.
    if (!isSelf && !canApprove) return routeError(403, 'forbidden', 'Forbidden');

    const supabase = createRouteHandlerClient({ cookies });

    // Utgångsläget måste läsas för att övergången ska kunna prövas — matrisen beror på BÅDE var
    // perioden står och vem som frågar. Den som får läsa raden är den själv eller någon med
    // time.approve/read.all (RLS), vilket är exakt de som får hit.
    const current = await getTimeApproval(supabase, targetUserId, periodStart);
    if (current.error) return routeError(500, 'time_approval_read_failed', current.error.message);

    const from = statusOf(current.data);
    const check = canTransition(from, parsed.data.status, { isSelf, canApprove });
    if (!check.allowed) return routeError(403, 'time_approval_forbidden', check.reason);

    const { data, error } = await setTimePeriodStatus(supabase, {
      userId: targetUserId,
      periodStart,
      status: parsed.data.status,
      note: parsed.data.note,
    });
    if (error) {
      // RPC:n är sista ordet och svarar med `raise exception` (P0001) och ett färdigt meddelande —
      // typiskt när två personer agerade samtidigt och utgångsläget hann ändras efter läsningen.
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_approval_write_failed', error.message);
    }

    // RPC:n returnerar raden; en no-op mot en period utan rad ger null (= fortsatt öppen).
    const row = Array.isArray(data) ? data[0] ?? null : data ?? null;
    return ok({ period_start: periodStart, status: statusOf(row), approval: row });
  } catch (e: any) {
    return routeError(500, 'time_approval_write_unexpected', e?.message || 'Kunde inte ändra periodens status');
  }
}
