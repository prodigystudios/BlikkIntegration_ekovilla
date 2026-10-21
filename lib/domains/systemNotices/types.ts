// Driftmeddelanden — bannern överst i appen ("Uppdatering pågår", "Driftstörning" …).
//
// Bieffektsfri med flit: samma typer, etiketter och nycklar läses av servern, av bannern i klienten och av admin-fliken.

export const SYSTEM_NOTICE_KINDS = ['update', 'maintenance', 'disruption', 'info'] as const;
export type SystemNoticeKind = (typeof SYSTEM_NOTICE_KINDS)[number];

export const systemNoticeKindLabel: Record<SystemNoticeKind, string> = {
  update: 'Uppdatering pågår',
  maintenance: 'Planerat underhåll',
  disruption: 'Driftstörning',
  info: 'Information',
};

// 🧨 Samma nycklar som CHECK-villkoret app_system_notices_areas_chk i 20261021171355_app_system_notices.sql. En nyckel
// som bara finns här avvisas av databasen när admin sparar. Lägg till på båda ställena (testet jämför dem).
export const SYSTEM_NOTICE_AREAS = ['app', 'crm', 'quotes', 'work_orders', 'planning', 'time', 'fortnox', 'documents'] as const;
export type SystemNoticeArea = (typeof SYSTEM_NOTICE_AREAS)[number];

export const systemNoticeAreaLabel: Record<SystemNoticeArea, string> = {
  app: 'Hela appen',
  crm: 'CRM',
  quotes: 'Offerter',
  work_orders: 'Arbetsordrar',
  planning: 'Planering',
  time: 'Tidrapportering',
  fortnox: 'Fortnox-koppling',
  documents: 'Dokument',
};

export type SystemNoticeRow = {
  id: string;
  kind: string;
  message: string;
  affected_areas: string[] | null;
  starts_at: string;
  ends_at: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

export type SystemNoticeView = {
  id: string;
  kind: SystemNoticeKind;
  kind_label: string;
  message: string;
  areas: SystemNoticeArea[];
  starts_at: string;
  ends_at: string | null;
  created_by_name: string;
  updated_at: string;
};
