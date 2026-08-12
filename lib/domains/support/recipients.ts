import type { SupabaseClient } from '@supabase/supabase-js';

// Vem som notifieras om ett nytt appärende.
//
// VARFÖR ADMINROLLEN OCH INGEN EGEN MOTTAGARLISTA: felanmälan har en tabell
// (fault_report_recipients) eftersom "arbetsledare" inte är en roll i appen. Här sammanfaller
// mottagaren med den som kan agera — backloggen är admin-gatad, så att notifiera exakt den
// mängden håller notis och behörighet i takt automatiskt. Ingen tabell, ingen adminyta att
// underhålla, ingen risk att listan säger en sak och RLS en annan.
//
// Service-role-klient krävs: `profiles` är self-read-only under RLS, så en sessionsklient hade
// aldrig fått se någon annans rad.
export async function listTicketNotifyRecipients(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin');
  if (error || !data) return [];
  return (data as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
}

// Rapportören ska inte få en notis om sitt eget ärende — hen står framför formuläret och har redan
// sett bekräftelsen. Gäller på riktigt: den som rapporterar är ofta själv admin.
export function excludeReporter(recipientIds: string[], reporterId: string | null): string[] {
  return recipientIds.filter((id) => id !== reporterId);
}
