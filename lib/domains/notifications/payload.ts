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
