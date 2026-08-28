import { describe, it, expect } from 'vitest';
import { documentRef, orderLookupRef } from '@/app/crm/lib/format';

// orderLookupRef bygger numret som går ut i en URL och slås upp med `.eq` mot crm_work_orders
// (lookupCrmWorkOrderByNumber). Den bor bredvid documentRef, som gör nästan samma sak åt andra
// hållet — och det är just närheten som är risken: tar man fel av dem hittar uppslaget ingenting.
//
// Testet är därför skrivet som en vakt mot EN specifik förväxling, inte som en genomgång av en
// trivial funktion.

describe('orderLookupRef', () => {
  // 🧨 Kärnan. documentRef ger '#6579'; uppslaget matchar exakt och '#6579' finns inte i någon
  // kolumn. Skulle någon "förenkla" den här funktionen till documentRef går det här sönder — och
  // det går sönder på de synkade ordrarna, alltså de flesta.
  it('ger Fortnox-numret RÅTT, utan brädgården documentRef sätter dit', () => {
    expect(orderLookupRef('6579', 'AO-1234')).toBe('6579');
    expect(documentRef('6579', 'AO-1234')).toBe('#6579');
  });

  it('faller tillbaka på det interna numret när ordern inte hunnit synkas', () => {
    expect(orderLookupRef(null, 'AO-1234')).toBe('AO-1234');
    expect(orderLookupRef(undefined, 'AO-1234')).toBe('AO-1234');
  });

  // Precedensen speglar mapCrmWorkOrderToEgenkontrollProject med flit: den svarar med samma val av
  // nummer, och egenkontrollen skriver in det i sitt filnamn. Går de isär slås ordern upp på ett
  // nummer och arkiveras under ett annat.
  it('låter Fortnox-numret vinna över det interna när båda finns', () => {
    expect(orderLookupRef('6579', 'AO-1234')).toBe('6579');
  });

  // null och inte '–': anroparen ska kunna se skillnad på ett nummer och inget nummer utan att
  // jämföra mot documentRefs visningssträng. Utan nummer ska ingen länk renderas alls — en länk
  // som garanterat svarar "Ordern hittades inte" är värre än ingen länk.
  it('ger null när det inte finns något att slå upp på', () => {
    expect(orderLookupRef(null, null)).toBeNull();
    expect(orderLookupRef(undefined, undefined)).toBeNull();
    expect(orderLookupRef('', '')).toBeNull();
  });

  // Tomma strängar är inte samma sak som saknade värden i JS, men de ska bete sig likadant här:
  // ett blanksteg i kolumnen får inte bli ett ordernummer som URL:en bär vidare.
  it('behandlar blanktecken som inget nummer', () => {
    expect(orderLookupRef('   ', 'AO-1234')).toBe('AO-1234');
    expect(orderLookupRef('   ', '  ')).toBeNull();
  });
});
