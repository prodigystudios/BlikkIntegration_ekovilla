type PlanningNotificationEmailInput = {
  recipientEmail: string;
  projectName: string;
  customerName: string | null;
  orderNumber: string | null;
  startDay: string;
  endDay: string;
  truck: string | null;
  salesResponsible: string | null;
  orderInDay?: number | null;
  totalInDay?: number | null;
  customMessage?: string | null;
  sellerEmail?: string | null;
  sellerPhone?: string | null;
  logoUrl?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateText(startDay: string, endDay: string): string {
  return startDay === endDay ? startDay : `${startDay} – ${endDay}`;
}

function buildOrderLine(orderInDay?: number | null, totalInDay?: number | null, truck?: string | null): string {
  if (orderInDay && totalInDay) {
    return `Du är planerad som nr ${orderInDay} av ${totalInDay} på lastbilen "${truck || 'Ej tilldelad'}". Installatören ringer på morgonen vid installationstillfället och meddelar ungefärlig ankomsttid.`;
  }
  return `Lastbil: ${truck || 'Ej tilldelad'}`;
}

function defaultCustomerMessage(orderNumber: string | null): string {
  return `Återkom gärna om något behöver justeras. Du kan svara på detta mail och ange gärna ordernummer${orderNumber ? ` ${orderNumber}` : ''} i ditt svar.`;
}

export function buildPlanningNotificationEmail(input: PlanningNotificationEmailInput) {
  const scheduleText = dateText(input.startDay, input.endDay);
  const orderLine = buildOrderLine(input.orderInDay, input.totalInDay, input.truck);
  const senderName = input.salesResponsible || 'Ekovilla';
  const customMessage = (input.customMessage || '').trim();
  const messageBody = customMessage || defaultCustomerMessage(input.orderNumber);
  const subject = `Planerad isolering ${scheduleText} (${input.projectName})${input.orderNumber ? ` Ordernummer #${input.orderNumber}` : ''}`;
  const text = [
    'ORDERBEKRÄFTELSE',
    '',
    'Hej,',
    '',
    'Vi vill informera att arbetet är planerat:',
    `Projekt: ${input.projectName}`,
    input.customerName ? `Kund: ${input.customerName}` : null,
    `Datum: ${scheduleText}`,
    input.orderNumber ? `Ordernummer: ${input.orderNumber}` : null,
    orderLine,
    '',
    input.salesResponsible || input.sellerPhone ? 'Ansvarig säljare:' : null,
    input.salesResponsible ? `Namn: ${input.salesResponsible}` : null,
    input.sellerEmail ? `E-post: ${input.sellerEmail}` : null,
    input.sellerPhone ? `Telefon: ${input.sellerPhone}` : null,
    '',
    messageBody,
    '',
    'Vänligen',
    'Ekovilla',
  ].filter(Boolean).join('\n');

  const summaryRows = [
    ['Projekt', input.projectName],
    ['Kund', input.customerName || 'Ej angiven'],
    ['Datum', scheduleText],
    ['Ordernummer', input.orderNumber || 'Ej angivet'],
    ['Mottagare', input.recipientEmail],
    ['Lastbil', input.truck || 'Ej tilldelad'],
  ];

  const html = `
    <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe4ef;border-radius:20px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,0.08);">
        <div style="padding:24px 28px 16px;background-color:#0a6a31;color:#ffffff;border-bottom:6px solid #84c11f;">
          ${input.logoUrl ? `<div style="margin:0 0 14px;"><img src="${escapeHtml(input.logoUrl)}" alt="Ekovilla" style="display:block;height:34px;width:auto;max-width:190px;" /></div>` : `<div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.84;">Ekovilla</div>`}
          <div style="display:inline-block;margin:0 0 10px;padding:6px 10px;background:#ffffff;color:#0a6a31;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Planering</div>
          <h1 style="margin:0;font-size:28px;line-height:1.1;color:#ffffff;">Orderbekräftelse</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.6;max-width:520px;color:#f0fdf4;">Hej${input.customerName ? ` ${escapeHtml(input.customerName)}` : ''}, vi vill informera att ert arbete nu är planerat.</p>
        </div>
        <div style="padding:24px 28px 10px;">
          <div style="display:grid;gap:12px;margin-bottom:18px;">
            ${summaryRows.map(([label, value]) => `<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;"><div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(label)}</div><div style="font-size:14px;color:#0f172a;">${escapeHtml(value)}</div></div>`).join('')}
            ${(input.salesResponsible || input.sellerEmail || input.sellerPhone) ? `<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;"><div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;">Ansvarig säljare</div><div style="display:grid;gap:4px;font-size:14px;color:#0f172a;"><div style="font-weight:600;">${escapeHtml(input.salesResponsible || 'Ekovilla')}</div>${input.sellerEmail ? `<div>E-post: <a href="mailto:${escapeHtml(input.sellerEmail)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(input.sellerEmail)}</a></div>` : ''}${input.sellerPhone ? `<div>Telefon: <a href="tel:${escapeHtml(input.sellerPhone)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(input.sellerPhone)}</a></div>` : ''}</div></div>` : ''}
          </div>
          <div style="padding:18px 18px 16px;background:#f8fafc;border:1px solid #dbe4ef;border-radius:16px;">
            <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">${escapeHtml(orderLine)}</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#334155;">${escapeHtml(messageBody)}</p>
          </div>
        </div>
        <div style="padding:18px 28px 26px;">
          <p style="margin:0;font-size:14px;line-height:1.7;">Vänligen<br /><strong>Ekovilla</strong></p>
          <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#64748b;">Detta mail skickades automatiskt från bokning@ekovilla.se via planeringen.</p>
        </div>
      </div>
    </div>
  `;

  return { subject, html, text };
}