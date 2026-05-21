type BuildPlanningNotificationSmsArgs = {
  projectName: string;
  orderNumber?: string | null;
  customerName?: string | null;
  startDay: string;
  endDay: string;
  truck?: string | null;
  salesResponsible?: string | null;
  sellerEmail?: string | null;
  sellerPhone?: string | null;
};

export function buildPlanningNotificationSms(args: BuildPlanningNotificationSmsArgs): string {
  const dateText = args.startDay === args.endDay
    ? args.startDay
    : `${args.startDay}-${args.endDay}`;

  const summaryLines = [
    'ORDERBEKRÄFTELSE',
    args.customerName ? `Hej ${args.customerName}.` : null,
    args.orderNumber ? `Order ${args.orderNumber}.` : null,
    `Projekt ${args.projectName}.`,
    'Vi vill informera om att arbetet är planerat.',
    `datum ${dateText}.`,
  ].filter((value): value is string => Boolean(value));

  const contactLines = [
    args.salesResponsible || args.sellerPhone || args.sellerEmail ? 'Kontakta' : null,
    args.salesResponsible || null,
    args.sellerPhone || null,
    args.sellerEmail || null,
    'om du har några frågor eller behöver justera något.',
    'Med vänliga hälsningar Ekovilla',
  ].filter((value): value is string => Boolean(value));



  return [
    summaryLines.join('\n'),
    contactLines.length ? contactLines.join('\n') : null,
  ].filter((value): value is string => Boolean(value)).join('\n\n');
}
