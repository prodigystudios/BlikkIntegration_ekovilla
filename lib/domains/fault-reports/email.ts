import type { FaultReportView } from './types';

// Pure builder for the internal "ny felanmälan" email to arbetsledare (unit tested). No I/O —
// the route resolves recipients and calls sendEmail with this.
export function buildFaultReportEmail(report: FaultReportView, appBaseUrl?: string): { subject: string; html: string; text: string } {
  const base = (appBaseUrl || '').replace(/\/$/, '');
  const link = `${base}/felanmalan?arende=${report.id}&scope=inbox`;
  const subject = `Ny felanmälan: ${report.category_label}`;

  const text = [
    'En ny felanmälan har registrerats.',
    '',
    `Utrustning: ${report.category_label}`,
    `Anmäld av: ${report.reporter_name}`,
    '',
    'Beskrivning:',
    report.comment,
    '',
    base ? `Öppna ärendet: ${link}` : 'Öppna Felanmälan i appen för att ta vid.',
  ].join('\n');

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
      <h2 style="margin:0 0 12px">Ny felanmälan</h2>
      <p style="margin:0 0 4px"><strong>Utrustning:</strong> ${esc(report.category_label)}</p>
      <p style="margin:0 0 12px"><strong>Anmäld av:</strong> ${esc(report.reporter_name)}</p>
      <p style="margin:0 0 4px"><strong>Beskrivning:</strong></p>
      <p style="margin:0 0 16px;white-space:pre-wrap">${esc(report.comment)}</p>
      ${base ? `<p style="margin:0"><a href="${link}" style="color:#1a3f26;font-weight:bold">Öppna ärendet</a></p>` : '<p style="margin:0">Öppna Felanmälan i appen för att ta vid.</p>'}
    </div>
  `.trim();

  return { subject, html, text };
}
