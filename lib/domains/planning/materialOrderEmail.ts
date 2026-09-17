import { sacksPerPalletFor } from '@/lib/domains/crm/materials';

// Beställningsmailet till fabriken: mallen, dess platshållare och renderingen.
//
// Ren, utan sidoeffekter och utan databasanrop — samma modul används av förhandsvisningen i webbläsaren,
// testmailet och det riktiga utskicket. Skrivs renderingen en andra gång någonstans visar förhandsvisningen
// ett mail och fabriken får ett annat.
//
// Mallen bor på leverantören (ops_material_suppliers.order_email_*). null = standardtexten nedan för
// leverantörens språk. Beslutat med William 2026-09-17: vissa fabriker är engelskspråkiga.
//
// ⚠️ MALLEN BESTÄMMER TEXTEN, ALDRIG SIFFRORNA. Orderraderna (depå, adress, material, pall, säck, datum)
// genereras här ur datan och sätts in där {orderrader} står. En mall kan alltså inte skriva fel antal —
// och därför KRÄVS {orderrader}: ett mail utan den är en beställning utan beställning.
//
// ⚠️ ALDRIG I MAILET: saldon, run-out, underskott, förslag, priser, kund- eller jobbdata, interna uuid:er.
// OrderEmailData saknar de fälten med flit, och ett test vaktar det. Lägg inte till dem "för att det vore
// bra för fabriken att veta".

export const ORDER_EMAIL_LANGUAGES = ['sv', 'en'] as const;
export type OrderEmailLanguage = (typeof ORDER_EMAIL_LANGUAGES)[number];

export const ORDER_EMAIL_SUBJECT_MAX = 200;
export const ORDER_EMAIL_BODY_MAX = 5000;

export type OrderEmailTemplate = { subject: string; body: string };

/**
 * Platshållarna. Samma namn på båda språken — de är syntax, inte text. Ordningen är den som visas som
 * klickbara knappar i mallredigeraren.
 */
export const ORDER_EMAIL_PLACEHOLDERS = [
  'orderrader',
  'ordernummer',
  'leveransdatum',
  'totalt',
  'kontaktperson',
  'leverantör',
  'avsändare',
  'meddelande',
] as const;
export type OrderEmailPlaceholder = (typeof ORDER_EMAIL_PLACEHOLDERS)[number];

/** Vad varje platshållare blir, för hjälptexten i redigeraren. */
export const ORDER_EMAIL_PLACEHOLDER_HELP: Record<OrderEmailPlaceholder, string> = {
  orderrader: 'Beställningen per depå: leveransdatum, adress och material. Krävs i texten.',
  ordernummer: 'Beställningens nummer, t.ex. 14. Krävs i ämnet.',
  leveransdatum: 'Leveransdagen, eller första–sista dagen när depåerna har olika datum.',
  totalt: 'Summan av beställningen, t.ex. 12 pall (648 säck).',
  kontaktperson: 'Leverantörens kontaktperson, annars leverantörens namn.',
  leverantör: 'Leverantörens namn.',
  avsändare: 'Namnet på den som skickar beställningen.',
  meddelande: 'Meddelandet som skrivs på beställningen. En rad med bara den tas bort när det är tomt.',
};

export const DEFAULT_ORDER_EMAIL: Record<OrderEmailLanguage, OrderEmailTemplate> = {
  sv: {
    subject: 'Materialbeställning #{ordernummer} från Ekovilla – leverans {leveransdatum}',
    body: [
      'Hej {kontaktperson},',
      '',
      'Vi vill beställa följande:',
      '',
      '{orderrader}',
      '',
      '{meddelande}',
      '',
      'Totalt: {totalt}',
      '',
      'Bekräfta gärna leveransdag och antal genom att svara på det här mailet.',
      '',
      'Med vänliga hälsningar',
      '{avsändare}',
      'Ekovilla',
      'Beställning #{ordernummer}',
    ].join('\n'),
  },
  en: {
    subject: 'Material order #{ordernummer} from Ekovilla – delivery {leveransdatum}',
    body: [
      'Hello {kontaktperson},',
      '',
      'We would like to order the following:',
      '',
      '{orderrader}',
      '',
      '{meddelande}',
      '',
      'Total: {totalt}',
      '',
      'Please confirm the delivery date and quantities by replying to this email.',
      '',
      'Best regards,',
      '{avsändare}',
      'Ekovilla',
      'Order #{ordernummer}',
    ].join('\n'),
  },
};

/** Leverantörens mall som den ska användas: den anpassade, eller standardtexten för språket. */
export function effectiveOrderEmailTemplate(supplier: {
  order_email_language: OrderEmailLanguage;
  order_email_subject: string | null;
  order_email_body: string | null;
}): OrderEmailTemplate {
  // Båda eller ingen — databasen vaktar paret, men en halv mall ska inte heller här bli en blandning.
  if (supplier.order_email_subject !== null && supplier.order_email_body !== null) {
    return { subject: supplier.order_email_subject, body: supplier.order_email_body };
  }
  return DEFAULT_ORDER_EMAIL[supplier.order_email_language];
}

// ---------------------------------------------------------------------------
// Validering
// ---------------------------------------------------------------------------

export type OrderEmailTemplateProblem =
  | { kind: 'subject_empty' }
  | { kind: 'body_empty' }
  | { kind: 'subject_too_long' }
  | { kind: 'body_too_long' }
  | { kind: 'subject_multiline' }
  | { kind: 'unknown_placeholder'; field: 'subject' | 'body'; name: string }
  | { kind: 'lines_missing' }
  | { kind: 'lines_repeated' }
  | { kind: 'lines_in_subject' }
  | { kind: 'order_number_missing_in_subject' };

/**
 * `{namn}` där namnet är bokstäver. Klamrar kring något annat (siffror, mellanslag, skiljetecken) lämnas
 * som text: "{12 st}" är inte ett försök att skriva en platshållare.
 */
const PLACEHOLDER_RE = /\{([A-Za-zÅÄÖåäö]+)\}/g;

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

function isKnown(name: string): name is OrderEmailPlaceholder {
  return (ORDER_EMAIL_PLACEHOLDERS as readonly string[]).includes(name);
}

/**
 * Alla problem med en mall, tomt när den går att använda.
 *
 * 🧨 En OKÄND platshållare är ett fel, inte text. Annars hade en felstavning som {ordernumer} gått iväg
 * till fabriken ordagrant — och ingenting hade sett fel ut förrän någon läste mailet.
 */
export function validateOrderEmailTemplate(template: OrderEmailTemplate): OrderEmailTemplateProblem[] {
  const problems: OrderEmailTemplateProblem[] = [];
  const { subject, body } = template;

  if (subject.trim() === '') problems.push({ kind: 'subject_empty' });
  if (body.trim() === '') problems.push({ kind: 'body_empty' });
  if (subject.length > ORDER_EMAIL_SUBJECT_MAX) problems.push({ kind: 'subject_too_long' });
  if (body.length > ORDER_EMAIL_BODY_MAX) problems.push({ kind: 'body_too_long' });
  // Ett radbrytningstecken i ämnet är en header-injektion, inte en formgivning.
  if (/[\r\n]/.test(subject)) problems.push({ kind: 'subject_multiline' });

  const inSubject = placeholdersIn(subject);
  const inBody = placeholdersIn(body);
  for (const name of new Set(inSubject)) {
    if (!isKnown(name)) problems.push({ kind: 'unknown_placeholder', field: 'subject', name });
  }
  for (const name of new Set(inBody)) {
    if (!isKnown(name)) problems.push({ kind: 'unknown_placeholder', field: 'body', name });
  }

  const lines = inBody.filter((n) => n === 'orderrader').length;
  if (lines === 0) problems.push({ kind: 'lines_missing' });
  if (lines > 1) problems.push({ kind: 'lines_repeated' });
  if (inSubject.includes('orderrader')) problems.push({ kind: 'lines_in_subject' });
  // Ordernumret i ämnet är det som parar ihop fabrikens svar och kopian i order@ med beställningen.
  if (!inSubject.includes('ordernummer')) problems.push({ kind: 'order_number_missing_in_subject' });

  return problems;
}

/** Svensk text för ett problem — samma ord i redigeraren och i API-svaret. */
export function describeOrderEmailTemplateProblem(p: OrderEmailTemplateProblem): string {
  switch (p.kind) {
    case 'subject_empty':
      return 'Ämnet är tomt';
    case 'body_empty':
      return 'Texten är tom';
    case 'subject_too_long':
      return `Ämnet får vara högst ${ORDER_EMAIL_SUBJECT_MAX} tecken`;
    case 'body_too_long':
      return `Texten får vara högst ${ORDER_EMAIL_BODY_MAX} tecken`;
    case 'subject_multiline':
      return 'Ämnet måste vara en rad';
    case 'unknown_placeholder':
      return `Okänd platshållare {${p.name}} i ${p.field === 'subject' ? 'ämnet' : 'texten'}`;
    case 'lines_missing':
      return 'Texten måste innehålla {orderrader} — annars står ingen beställning i mailet';
    case 'lines_repeated':
      return '{orderrader} får bara stå en gång i texten';
    case 'lines_in_subject':
      return '{orderrader} kan inte stå i ämnet';
    case 'order_number_missing_in_subject':
      return 'Ämnet måste innehålla {ordernummer}, så att svaret går att koppla till beställningen';
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** En rad på en depå: material och antal säckar. */
export type OrderEmailItem = { material: string; sacks: number };

export type OrderEmailDepot = {
  depotName: string;
  /** Leveransadressen (ops_depots.location). */
  address: string;
  /** 'YYYY-MM-DD'. */
  deliveryDate: string;
  items: OrderEmailItem[];
};

/**
 * Allt mailet får veta. Med flit INTE mer — se filhuvudet.
 */
export type OrderEmailData = {
  orderNumber: number;
  supplierName: string;
  contactName: string | null;
  senderName: string;
  message: string | null;
  depots: OrderEmailDepot[];
  /** "Övrigt på lasset": fri text som följer med lasset men inte rör lagret. */
  otherLines: { text: string; depotName: string | null }[];
};

export type RenderedOrderEmail = { subject: string; text: string };

const WORDS = {
  sv: {
    locale: 'sv-SE',
    deliveryBy: 'leverans senast',
    address: 'Leveransadress',
    pallet: (n: number) => 'pall',
    sacks: (n: number) => 'säck',
    other: 'Övrigt på lasset',
  },
  en: {
    locale: 'en-GB',
    deliveryBy: 'delivery by',
    address: 'Delivery address',
    pallet: (n: number) => (n === 1 ? 'pallet' : 'pallets'),
    sacks: (n: number) => (n === 1 ? 'bag' : 'bags'),
    other: 'Also on this load',
  },
} as const;

/**
 * Datum på mottagarens språk, t.ex. "torsdag 24 september" / "Thursday 24 September".
 *
 * ⚠️ `timeZone: 'Europe/Stockholm'` är det som bär: utan den formateras dagen i PROCESSENS zon, och
 * `2026-10-25` blir lördagen före på en server väster om Greenwich (testat i America/Los_Angeles). Middag
 * UTC i stället för midnatt är extra marginal — ingen zon ligger tolv timmar ifrån den.
 */
export function formatOrderDate(iso: string, language: OrderEmailLanguage, withWeekday = true): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(WORDS[language].locale, {
    ...(withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Stockholm',
  }).format(date);
}

/** "4 pall (216 säck)" när antalet är hela pallar av en känd storlek, annars "87 säck". */
function formatQuantity(material: string, sacks: number, language: OrderEmailLanguage): string {
  const w = WORDS[language];
  const perPallet = sacksPerPalletFor(material);
  if (perPallet && sacks > 0 && sacks % perPallet === 0) {
    const pallets = sacks / perPallet;
    return `${pallets} ${w.pallet(pallets)} (${sacks} ${w.sacks(sacks)})`;
  }
  return `${sacks} ${w.sacks(sacks)}`;
}

function renderLines(data: OrderEmailData, language: OrderEmailLanguage): string {
  const w = WORDS[language];
  const blocks = data.depots.map((d) => {
    const head = `${d.depotName.toLocaleUpperCase(w.locale)} – ${w.deliveryBy} ${formatOrderDate(d.deliveryDate, language)}`;
    const rows = d.items.map((i) => `- ${i.material}: ${formatQuantity(i.material, i.sacks, language)}`);
    return [head, `${w.address}: ${d.address}`, ...rows].join('\n');
  });
  if (data.otherLines.length > 0) {
    blocks.push(
      [`${w.other}:`, ...data.otherLines.map((o) => `- ${o.text}${o.depotName ? ` (${o.depotName})` : ''}`)].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

function renderDeliveryDate(data: OrderEmailData, language: OrderEmailLanguage): string {
  const dates = [...new Set(data.depots.map((d) => d.deliveryDate))].sort();
  if (dates.length === 0) return '';
  if (dates.length === 1) return formatOrderDate(dates[0], language);
  return `${formatOrderDate(dates[0], language, false)}–${formatOrderDate(dates[dates.length - 1], language, false)}`;
}

function renderTotal(data: OrderEmailData, language: OrderEmailLanguage): string {
  const w = WORDS[language];
  const items = data.depots.flatMap((d) => d.items);
  const sacks = items.reduce((s, i) => s + i.sacks, 0);
  // Pall bara när VARJE rad är hela pallar av känd storlek. En summa där en del räknats i pall och en
  // del inte hade sett exakt ut och varit fel.
  let pallets = 0;
  for (const i of items) {
    const perPallet = sacksPerPalletFor(i.material);
    if (!perPallet || i.sacks % perPallet !== 0) return `${sacks} ${w.sacks(sacks)}`;
    pallets += i.sacks / perPallet;
  }
  return `${pallets} ${w.pallet(pallets)} (${sacks} ${w.sacks(sacks)})`;
}

/**
 * Rendera mailet. Vägrar en ogiltig mall i stället för att skicka ut den halvfärdig.
 *
 * ⚠️ Ämnets värden rensas från radbrytningar: en kontaktperson eller ett meddelande med en ny rad får
 * aldrig kunna bli en extra header.
 */
export function renderOrderEmail(
  template: OrderEmailTemplate,
  language: OrderEmailLanguage,
  data: OrderEmailData,
): { ok: true; email: RenderedOrderEmail } | { ok: false; problems: OrderEmailTemplateProblem[] } {
  const problems = validateOrderEmailTemplate(template);
  if (problems.length > 0) return { ok: false, problems };

  const message = (data.message ?? '').trim();
  const values: Record<OrderEmailPlaceholder, string> = {
    orderrader: renderLines(data, language),
    ordernummer: String(data.orderNumber),
    leveransdatum: renderDeliveryDate(data, language),
    totalt: renderTotal(data, language),
    kontaktperson: (data.contactName ?? '').trim() || data.supplierName,
    leverantör: data.supplierName,
    avsändare: data.senderName,
    meddelande: message,
  };
  const fill = (text: string, oneLine: boolean) =>
    text.replace(PLACEHOLDER_RE, (_, name: OrderEmailPlaceholder) =>
      oneLine ? values[name].replace(/[\r\n]+/g, ' ') : values[name],
    );

  const subject = fill(template.subject, true).trim();

  // En rad som BARA består av {meddelande} försvinner när meddelandet är tomt, i stället för att lämna
  // ett hål. Därefter slås tre eller fler radbrytningar ihop till en tom rad.
  const bodyTemplate = message === '' ? template.body.replace(/^[ \t]*\{meddelande\}[ \t]*(\r?\n|$)/gm, '') : template.body;
  const text = fill(bodyTemplate, false)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { ok: true, email: { subject, text } };
}

/**
 * Exempeldata för förhandsvisningen och testmailet. Realistisk nog att läsa som ett riktigt mail, men
 * med ordernummer 0 så att ett testmail aldrig kan förväxlas med en beställning.
 */
export function exampleOrderEmailData(supplier: { name: string; contactName: string | null }, senderName: string): OrderEmailData {
  return {
    orderNumber: 0,
    supplierName: supplier.name,
    contactName: supplier.contactName,
    senderName,
    message: null,
    depots: [
      {
        depotName: 'Exempeldepå Syd',
        address: 'Industrivägen 1, 811 00 Sandviken',
        deliveryDate: '2026-10-01',
        items: [{ material: 'EKOVILLA', sacks: 216 }],
      },
      {
        depotName: 'Exempeldepå Norr',
        address: 'Lagergatan 2, 784 00 Borlänge',
        deliveryDate: '2026-10-02',
        items: [
          { material: 'EKOVILLA', sacks: 108 },
          { material: 'PAROC', sacks: 87 },
        ],
      },
    ],
    otherLines: [],
  };
}
