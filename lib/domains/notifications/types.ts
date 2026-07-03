// Generic in-app notification types. Kept feature-agnostic — `type`/`entity_type` are open
// strings so any feature can emit notifications. Felanmälan is the first producer.

export type NotificationType = 'fault_report.created' | 'fault_report.updated' | (string & {});

// Raw row as stored in public.notifications.
export type NotificationRow = {
  id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

// View model returned to the client. `read` is derived from read_at.
export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

// Payload for a new notification (recipient set by the fan-out caller, one row per recipient).
export type NotificationInsert = {
  recipient_user_id: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
};

// Shape produced by the pure payload builders (recipient is added per-recipient at fan-out).
export type NotificationContent = {
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
};
