// Driftmeddelanden — ren logik. Ingen databas, ingen klocka: `now` skickas in, så reglerna går att testa.
import {
  SYSTEM_NOTICE_AREAS,
  SYSTEM_NOTICE_KINDS,
  systemNoticeKindLabel,
  type SystemNoticeArea,
  type SystemNoticeKind,
  type SystemNoticeRow,
  type SystemNoticeView,
} from './types';

export function toSystemNoticeKind(value: unknown): SystemNoticeKind {
  return SYSTEM_NOTICE_KINDS.includes(value as SystemNoticeKind) ? (value as SystemNoticeKind) : 'info';
}

export function toSystemNoticeView(row: SystemNoticeRow): SystemNoticeView {
  const kind = toSystemNoticeKind(row.kind);
  return {
    id: row.id,
    kind,
    kind_label: systemNoticeKindLabel[kind],
    message: row.message,
    // Okända nycklar tappas: databasen släpper inte in dem, men en rad ur en framtida version ska inte krascha bannern.
    areas: (row.affected_areas ?? []).filter((a): a is SystemNoticeArea => SYSTEM_NOTICE_AREAS.includes(a as SystemNoticeArea)),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_by_name: row.created_by_name,
    updated_at: row.updated_at,
  };
}

// Samma regel som RLS-policyn app_system_notices_select: påslaget och inte avslutat. Bannern prövar den själv också,
// så att ett meddelande vars sluttid passerar försvinner utan att vänta på nästa hämtning.
export function isSystemNoticeActive(notice: Pick<SystemNoticeView, 'starts_at' | 'ends_at'>, now: Date): boolean {
  const t = now.getTime();
  if (new Date(notice.starts_at).getTime() > t) return false;
  return notice.ends_at === null || new Date(notice.ends_at).getTime() > t;
}

// Det allvarligaste överst; inom samma sort det senast påslagna.
const KIND_ORDER: Record<SystemNoticeKind, number> = { disruption: 0, update: 1, maintenance: 2, info: 3 };

export function sortSystemNoticesForDisplay(notices: SystemNoticeView[]): SystemNoticeView[] {
  return [...notices].sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
}

// "Stängbar tills det ändras": det som stängs är just det här INNEHÅLLET — sort, text och vad det påverkar. Ändras
// något av det syns meddelandet igen. Inte updated_at: varje sparning (även en flyttad sluttid eller en sparning utan
// ändring) hade då tagit tillbaka bannern för alla som stängt den.
export function systemNoticeDismissKey(notice: Pick<SystemNoticeView, 'id' | 'kind' | 'message' | 'areas'>): string {
  const content = `${notice.kind}|${notice.areas.join(',')}|${notice.message}`;
  // djb2 — kort nyckel i localStorage, inget säkerhetsbehov.
  let hash = 5381;
  for (let i = 0; i < content.length; i++) hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  return `${notice.id}:${(hash >>> 0).toString(36)}`;
}

const stockholmDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });
const stockholmTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stockholmDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' });

/**
 * Sluttiden som bannern skriver ("Beräknas klart 18:00"), i SVENSK tid oavsett läsarens och serverns zon. Bara
 * klockslaget samma dag; annars datum och klockslag ("23 okt. 18:00").
 */
export function formatSystemNoticeEnd(endsAt: string, now: Date): string {
  const end = new Date(endsAt);
  const time = stockholmTime.format(end);
  return stockholmDay.format(end) === stockholmDay.format(now) ? time : `${stockholmDate.format(end)} ${time}`;
}

// En sluttid som redan passerat hade gjort meddelandet osynligt i samma ögonblick som det sparades.
export function systemNoticeEndProblem(endsAt: string | null | undefined, now: Date): string | null {
  if (!endsAt) return null;
  return new Date(endsAt).getTime() > now.getTime() ? null : 'Sluttiden har redan passerat.';
}

export type SystemNoticeUpdateInput = {
  kind?: SystemNoticeKind;
  message?: string;
  affected_areas?: SystemNoticeArea[];
  ends_at?: string | null;
  end?: boolean;
};

// Kolumnerna en PATCH skriver. `end` = slå av nu (sätter sluttiden till nu, raden blir historik). updated_at ändras
// alltid — det är den som får en ny text att synas igen för den som stängt den gamla.
export function buildSystemNoticeUpdate(input: SystemNoticeUpdateInput, now: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: now };
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.message !== undefined) patch.message = input.message;
  if (input.affected_areas !== undefined) patch.affected_areas = input.affected_areas;
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at;
  if (input.end) patch.ends_at = now;
  return patch;
}
