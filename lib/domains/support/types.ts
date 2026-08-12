// Appärenden — domäntyper. DB lagrar stabila engelska nycklar (text + CHECK); de svenska
// etiketterna bor här så listan, formuläret och notiserna renderar samma ord.
//
// Skilt från lib/domains/fault-reports/* med flit: felanmälan gäller företagets utrustning och
// fan-outar till flera arbetsledare, det här gäller appen och går till utvecklaren. Se
// supabase/sql/20260812_app_tickets.sql för resonemanget.

export const TICKET_KINDS = ['bug', 'idea'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_AREAS = [
  'crm',
  'planning',
  'field',
  'self_check',
  'time',
  'documents',
  'korjournal',
  'account',
  'other',
] as const;
export type TicketArea = (typeof TICKET_AREAS)[number];

// Backlog-flödet. 'declined' är den ärliga utgången för ett ärende som inte blir av — utan den
// hamnar sådana i 'new' för alltid och backloggen slutar gå att lita på.
export const TICKET_STATUSES = ['new', 'planned', 'in_progress', 'done', 'declined'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// Statusar som räknas som avslutade — de göms bakom ett filter i backloggen så listan visar det
// som återstår. Delas av admin-vyn och räknarna.
export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = ['done', 'declined'];

export function isClosedTicketStatus(status: TicketStatus): boolean {
  return CLOSED_TICKET_STATUSES.includes(status);
}

export const kindLabel: Record<TicketKind, string> = {
  bug: 'Bugg',
  idea: 'Förslag',
};

export const areaLabel: Record<TicketArea, string> = {
  crm: 'CRM, offerter & ordrar',
  planning: 'Planering',
  field: 'Mina jobb & arbetsorder',
  self_check: 'Egenkontroll',
  time: 'Tidrapport',
  documents: 'Dokument',
  korjournal: 'Körjournal',
  account: 'Inloggning & konto',
  other: 'Annat / vet inte',
};

export const statusLabel: Record<TicketStatus, string> = {
  new: 'Ny',
  planned: 'Planerad',
  in_progress: 'Pågår',
  done: 'Klar',
  declined: 'Blir inte av',
};

export function toTicketKind(value: unknown): TicketKind | null {
  return TICKET_KINDS.includes(value as TicketKind) ? (value as TicketKind) : null;
}

export function toTicketArea(value: unknown): TicketArea {
  return TICKET_AREAS.includes(value as TicketArea) ? (value as TicketArea) : 'other';
}

export function toTicketStatus(value: unknown): TicketStatus {
  return TICKET_STATUSES.includes(value as TicketStatus) ? (value as TicketStatus) : 'new';
}

export type AppTicketRow = {
  id: string;
  reporter_id: string | null;
  reporter_name: string;
  kind: string;
  area: string;
  title: string;
  description: string;
  page_path: string | null;
  status: string;
  resolution: string | null;
  screenshot_bucket: string | null;
  screenshot_path: string | null;
  changelog_note: string | null;
  changelog_published_at: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppTicketView = {
  id: string;
  reporter_id: string | null;
  reporter_name: string;
  kind: TicketKind;
  kind_label: string;
  area: TicketArea;
  area_label: string;
  title: string;
  description: string;
  page_path: string | null;
  status: TicketStatus;
  status_label: string;
  is_closed: boolean;
  resolution: string | null;
  // Sant när raden bär en skärmbild. Själva URL:en är signerad och kortlivad, så den skickas bara
  // med i detaljsvaret (screenshot_url) — aldrig i listan, som annars hade signerat N filer per
  // laddning för bilder ingen tittar på.
  has_screenshot: boolean;
  changelog_note: string | null;
  changelog_published_at: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
};

// Detaljsvaret: vyn + en färsk signerad URL till skärmbilden, när det finns en.
export type AppTicketDetailView = AppTicketView & { screenshot_url: string | null };
