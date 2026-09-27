/**
 * Exemplen ur kontraktet, RESELLER_PORTAL_INTEGRATION_PLAN.md, ordagrant. Portalen genererade dem ur
 * sin egen kod (`toEkovillaOrder()`, `toEkovillaStoreOrder()`); kundnumret är påhittat. Ändras
 * kontraktet ändras de här — de är CRM:ets bild av vad portalen skickar.
 *
 * Frysta, så att ett test inte kan ändra dem för nästa. Behövs en variant: `structuredClone(CONTRACT_JOB)`.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** "Flöde 1: prislistan" — CRM → portal. */
export const CONTRACT_PRICELIST = deepFreeze({
  validFrom: '2026-10-01',
  resellerId: null,
  articles: [
    {
      articleNumber: '2410509',
      name: 'EKOVILLA cellulosa 0,038W/mK vind',
      customerName: 'Lösull på vinden',
      note: '',
      category: 'losull',
      unit: 'm3',
      unitCost: 342,
      laborShare: 0.45,
      sortOrder: 10,
    },
  ],
});

/** "Flöde 2: jobb" — portal → CRM, `POST /api/portal/jobs`. */
export const CONTRACT_JOB = deepFreeze({
  quoteId: 'q-2026-015',
  quoteNumber: '2026-015',
  store: {
    resellerId: 'res-norrbygg',
    name: 'Norrbygg AB',
    address: { street: 'Verkstadsgatan 8', postalCode: '802 91', city: 'Gävle' },
    ekovillaCustomerNumber: '1043',
  },
  workplace: {
    address: { street: 'Rönnvägen 18', postalCode: '806 28', city: 'Gävle' },
    propertyDesignation: 'Gävle Rönnen 3:2',
    desiredPeriod: 'Vecka 42',
    atticHatch: 'inside',
    contactName: 'Ingrid Palm',
    contactPhone: '070-555 12 34',
    notes: '',
  },
  lines: [
    {
      articleNumber: '2410509',
      name: 'EKOVILLA cellulosa lösull 0,038 – vind',
      construction: 'vind',
      unit: 'm3',
      quantity: { kind: 'volume', areaM2: 95, thicknessMm: 400 },
      unitCost: 310,
      lineCost: 11780,
    },
    {
      articleNumber: '1010',
      name: 'Etablering',
      construction: 'ovrigt',
      unit: 'st',
      quantity: { kind: 'count', value: 1 },
      unitCost: 2490,
      lineCost: 2490,
    },
  ],
  costTotal: 14270,
});

/** "Flöde 3: butiksbeställningar" — portal → CRM, `POST /api/portal/store-orders`. */
export const CONTRACT_STORE_ORDER = deepFreeze({
  orderId: 'so-b-2026-003',
  orderNumber: 'B-2026-003',
  store: {
    resellerId: 'res-norrbygg',
    name: 'Norrbygg AB',
    address: { street: 'Verkstadsgatan 8', postalCode: '802 91', city: 'Gävle' },
    ekovillaCustomerNumber: '1043',
  },
  delivery: {
    address: { street: 'Verkstadsgatan 8', postalCode: '802 91', city: 'Gävle' },
    desiredPeriod: 'Vecka 41',
    reference: 'Inköp 4471',
    contactName: 'David Kron',
    contactPhone: '070-234 56 78',
    message: '',
  },
  lines: [
    { articleNumber: '13003', name: 'EKOVILLA LEVY 70MM 3,93M2/PKT', unit: 'pkt', quantity: 12, unitCost: 335.3, lineCost: 4023.6 },
    { articleNumber: '13102', name: 'ISOLERINGSSÅG EKOVILLA LEVY', unit: 'st', quantity: 2, unitCost: 195.3, lineCost: 390.6 },
  ],
  costTotal: 4414.2,
});

/**
 * En signatur räknad med Pythons `hmac` (inte med CRM:ets kod), så att testet prövar kontraktet och
 * inte bara att koden stämmer med sig själv. Kroppen har å, ä, ö och ett tankstreck: 126 tecken men
 * 130 byte i UTF-8, så en signatur över tecken i stället för byte blir fel. Portalen kan pröva sin
 * halva mot samma vektor.
 *
 * Att räkna om den, med värdena nedan:
 *
 *   python3 - <<'PY'
 *   import hmac, hashlib
 *   secret = "portal-kontraktsvektor-0123456789abcdef0123456789abcdef"
 *   timestamp = "1790000000"
 *   body = '{"messageId":"msg-1","authorName":"Sara Ek","body":"Hej från Gävle – vindsluckan sitter ute.","sentAt":"2026-09-27T12:00:00Z"}'
 *   print("v1=" + hmac.new(secret.encode(), (timestamp + "." + body).encode("utf-8"), hashlib.sha256).hexdigest())
 *   PY
 */
export const SIGNATURE_VECTOR = deepFreeze({
  secret: 'portal-kontraktsvektor-0123456789abcdef0123456789abcdef',
  timestamp: '1790000000',
  body: '{"messageId":"msg-1","authorName":"Sara Ek","body":"Hej från Gävle – vindsluckan sitter ute.","sentAt":"2026-09-27T12:00:00Z"}',
  signature: 'v1=d5d87ef08b18bb2d5286335a54405c2b79f80fb291fc1640e32f746b9f2a3c30',
});
