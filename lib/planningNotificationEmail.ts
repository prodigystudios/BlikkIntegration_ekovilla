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

  const summaryRowsHtml = summaryRows.map(([label, value]) => `
    <tr>
      <td style="padding:0 0 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="width:100%;background-color:#f8fafc;border:1px solid #dbe4ef;border-radius:14px;">
          <tr>
            <td width="140" valign="top" style="width:140px;padding:14px 16px 14px 16px;font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">${escapeHtml(label)}</td>
            <td valign="top" style="padding:14px 16px 14px 0;font-size:15px;line-height:24px;color:#0f172a;">${escapeHtml(value)}</td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const sellerRowHtml = (input.salesResponsible || input.sellerEmail || input.sellerPhone) ? `
    <tr>
      <td style="padding:0 0 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="width:100%;background-color:#f8fafc;border:1px solid #dbe4ef;border-radius:14px;">
          <tr>
            <td width="140" valign="top" style="width:140px;padding:14px 16px 14px 16px;font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">Ansvarig säljare</td>
            <td valign="top" style="padding:14px 16px 14px 0;font-size:15px;line-height:24px;color:#0f172a;">
              <div style="font-weight:600;color:#0f172a;">${escapeHtml(input.salesResponsible || 'Ekovilla')}</div>
              ${input.sellerEmail ? `<div style="margin-top:6px;color:#334155;">E-post: <a href="mailto:${escapeHtml(input.sellerEmail)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(input.sellerEmail)}</a></div>` : ''}
              ${input.sellerPhone ? `<div style="margin-top:6px;color:#334155;">Telefon: <a href="tel:${escapeHtml(input.sellerPhone)}" style="color:#0f766e;text-decoration:none;">${escapeHtml(input.sellerPhone)}</a></div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : '';

  const html = `
    <!DOCTYPE html>
    <html lang="sv">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f4f7fb;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f7fb" style="width:100%;background-color:#f4f7fb;margin:0;padding:0;">
          <tr>
            <td align="center" style="padding:32px 24px;">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #dbe4ef;border-radius:20px;overflow:hidden;">
                <tr>
                  <td bgcolor="#0a6a31" style="padding:30px 32px 24px;background-color:#0a6a31;border-bottom:6px solid #84c11f;">
                    ${input.logoUrl ? `<div style="margin:0 0 18px;"><img src="${escapeHtml(input.logoUrl)}" alt="Ekovilla" style="display:block;height:34px;width:auto;max-width:190px;border:0;" /></div>` : `<div style="font-size:12px;line-height:18px;letter-spacing:0.16em;text-transform:uppercase;color:#d1fae5;">Ekovilla</div>`}
                    <div style="margin:0 0 14px;">
                      <span style="display:inline-block;padding:6px 10px;background-color:#ffffff;color:#0a6a31;border-radius:999px;font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Planering</span>
                    </div>
                    <div style="font-size:28px;line-height:34px;font-weight:700;color:#ffffff;">Orderbekräftelse</div>
                    <div style="margin-top:14px;font-size:15px;line-height:26px;color:#f0fdf4;max-width:520px;">Hej${input.customerName ? ` ${escapeHtml(input.customerName)}` : ''}, vi vill informera att ert arbete nu är planerat.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 20px 16px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                      ${summaryRowsHtml}
                      ${sellerRowHtml}
                      <tr>
                        <td style="padding:8px 0 0;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="width:100%;background-color:#f8fafc;border:1px solid #dbe4ef;border-radius:16px;">
                            <tr>
                              <td style="padding:22px 22px 20px;font-size:15px;line-height:27px;color:#334155;">
                                <div style="margin:0 0 14px;color:#0f172a;">${escapeHtml(orderLine)}</div>
                                <div style="color:#334155;">${escapeHtml(messageBody)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 32px 30px;">
                    <div style="font-size:14px;line-height:27px;color:#0f172a;">Vänligen<br /><strong>Ekovilla</strong></div>
                    <div style="margin-top:16px;font-size:12px;line-height:21px;color:#64748b;">Detta mail skickades automatiskt från <a href="mailto:bokning@ekovilla.se" style="color:#2563eb;text-decoration:none;">bokning@ekovilla.se</a> via planeringen.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, html, text };
}