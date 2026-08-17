import type { NotificationContent } from './types';

// Pure notification-content builders (no I/O — unit tested). The fault-reports fan-out passes
// the minimal fields these need; the recipient is attached per-recipient at insert time.

export type FaultReportNotificationInput = {
  reportId: string;
  categoryLabel: string; // Swedish label, e.g. "Isoleringsmaskin"
  reporterName: string;
  statusLabel?: string; // Swedish status label, e.g. "Pågår" (for the updated builder)
};

// Sent to each supervisor when a new fault report is filed.
export function buildFaultReportCreatedNotification(input: FaultReportNotificationInput): NotificationContent {
  return {
    type: 'fault_report.created',
    title: `Ny felanmälan: ${input.categoryLabel}`,
    body: `${input.reporterName} har gjort en felanmälan.`,
    href: `/felanmalan?arende=${input.reportId}&scope=inbox`,
    entity_type: 'fault_report',
    entity_id: input.reportId,
  };
}

// Sent to each user @-mentioned in a work order comment.
//
// `audience` routes the link to a view the recipient can actually open: office roles (sales/admin/
// konsult) get the full CRM detail view; everyone else (installers = member, leader, readonly) gets
// the open field view at /arbetsorder/<id>. Both mount the same comments tab, so the mention is
// readable either way. Without this split an installer would land on /crm/* and be bounced to '/'
// by the CRM access gate. Defaults to 'crm' for callers that don't distinguish.
export function buildWorkOrderCommentMentionNotification(input: {
  workOrderId: string;
  orderNumber?: string | null;
  projectName?: string | null;
  commenterName?: string | null;
  audience?: 'crm' | 'field';
}): NotificationContent {
  const ref = input.orderNumber ? `#${input.orderNumber}` : 'en arbetsorder';
  const where = input.projectName ? `${ref} · ${input.projectName}` : ref;
  const basePath = input.audience === 'field' ? '/arbetsorder' : '/crm/arbetsorder';
  return {
    type: 'work_order.mention',
    title: `${input.commenterName || 'Någon'} nämnde dig i en kommentar`,
    body: `Arbetsorder ${where}`,
    href: `${basePath}/${input.workOrderId}`,
    entity_type: 'work_order',
    entity_id: input.workOrderId,
  };
}

// Sent to the reporter when a supervisor updates status / writes a reply.
export function buildFaultReportUpdatedNotification(input: FaultReportNotificationInput): NotificationContent {
  const status = input.statusLabel ? ` (${input.statusLabel})` : '';
  return {
    type: 'fault_report.updated',
    title: `Din felanmälan har uppdaterats${status}`,
    body: `${input.categoryLabel}: en arbetsledare har återkopplat.`,
    href: `/felanmalan?arende=${input.reportId}`,
    entity_type: 'fault_report',
    entity_id: input.reportId,
  };
}

// Sent to the admins when someone files an app ticket (bug report / feature request).
//
// The href deep-links straight into the backlog tab with the ärende pre-opened — the point of the
// notification is to get from "phone buzzed" to "reading the report" in one tap.
export function buildAppTicketCreatedNotification(input: {
  ticketId: string;
  kindLabel: string; // "Bugg" / "Förslag"
  areaLabel: string; // e.g. "CRM, offerter & ordrar"
  title: string;
  reporterName: string;
}): NotificationContent {
  return {
    type: 'app_ticket.created',
    title: `${input.kindLabel}: ${input.title}`,
    body: `${input.reporterName} · ${input.areaLabel}`,
    href: `/admin?tab=arenden&arende=${input.ticketId}`,
    entity_type: 'app_ticket',
    entity_id: input.ticketId,
  };
}

// Skickas till säljaren när någon annan lagt upp en CRM-uppgift åt hen.
//
// Vem som gett uppgiften är själva poängen med notisen och står därför i body:n — utan avsändare
// blir det en uppgift man inte minns att man skrivit. Förfallodatumet följer med när det finns,
// eftersom "gör det här" och "till när" är samma fråga för mottagaren.
//
// href går till uppgiftslistan med uppgiften öppnad. Mottagaren är alltid en säljare eller admin
// (rutten validerar det mot säljarkatalogen), så /crm är en yta hen kan öppna — till skillnad
// från arbetsorder-omnämnandena, som måste rollstyra sin länk.
export function buildCrmTaskAssignedNotification(input: {
  taskId: string;
  title: string;
  assignerName: string;
  dueDate: string | null; // ISO-datum (YYYY-MM-DD)
}): NotificationContent {
  return {
    type: 'crm_task.assigned',
    title: `Ny uppgift: ${input.title}`,
    body: input.dueDate
      ? `${input.assignerName} har lagt en uppgift på dig · senast ${input.dueDate}`
      : `${input.assignerName} har lagt en uppgift på dig`,
    href: `/crm/uppgifter?task_id=${input.taskId}`,
    entity_type: 'crm_task',
    entity_id: input.taskId,
  };
}
