import { describe, it, expect } from 'vitest';
import {
  validateSupplier,
  suppliersForMaterial,
  defaultSupplierForMaterial,
  roundUpToMultiple,
  type MaterialSupplier,
} from '@/lib/domains/planning/materialSuppliers';
import { createSupplierSchema, updateSupplierSchema } from '@/app/api/crm/planering/_lib';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

// Leverantörsregistret bestämmer VEM materialbeställningen mailas till. Felen som vaktas här är
// alla av samma slag: de ser ut som ingenting i UI:t och kostar ett lass säckar hos fel fabrik.

const EKOVILLA = MATERIAL_SHORTS[0];
const KNAUF = MATERIAL_SHORTS[1];

// 🧨 FIXTURERNA HÄNGER PÅ KATALOGENS ORDNING. MATERIAL_SHORTS härleds ur MATERIALS
// insättningsordning, så ett nytt material överst byter betydelse på [0] och [1] — tyst, och utan
// att något failar. Den här förutsättningen får det att smälla högt i stället.
describe('fixturernas förutsättningar', () => {
  it('katalogen har minst två skilda koder, och de är versaler', () => {
    expect(MATERIAL_SHORTS.length).toBeGreaterThanOrEqual(2);
    expect(EKOVILLA).not.toBe(KNAUF);
    // Skiftlägestestet nedan är tomt om koden redan är gemener.
    expect(EKOVILLA).not.toBe(EKOVILLA.toLowerCase());
  });
});

function supplier(over: Partial<MaterialSupplier> = {}): MaterialSupplier {
  return {
    id: 's1',
    name: 'Fabriken',
    email: 'order@fabriken.se',
    contact_name: null,
    phone: null,
    materials: [EKOVILLA],
    lead_time_days: 5,
    round_up_to: 1,
    note: null,
    active: true,
    ...over,
  };
}

describe('validateSupplier', () => {
  it('godtar en komplett leverantör', () => {
    expect(validateSupplier({ name: 'Ekovilla AB', email: 'order@ekovilla.se', materials: [EKOVILLA], leadTimeDays: 7 })).toBeNull();
  });

  it('kräver ett namn', () => {
    expect(validateSupplier({ name: '   ', email: 'a@b.se', materials: [EKOVILLA] })).toBe('name_required');
  });

  it('avvisar ett för långt namn — och mäter EFTER trim, som schemat', () => {
    expect(validateSupplier({ name: 'x'.repeat(121), email: 'a@b.se', materials: [EKOVILLA] })).toBe('name_too_long');
    expect(validateSupplier({ name: 'x'.repeat(120), email: 'a@b.se', materials: [EKOVILLA] })).toBeNull();
    expect(validateSupplier({ name: '  ' + 'x'.repeat(120) + '  ', email: 'a@b.se', materials: [EKOVILLA] })).toBeNull();
  });

  it('kräver en adress — utan den kan beställningen inte skickas', () => {
    expect(validateSupplier({ name: 'X', email: '  ', materials: [EKOVILLA] })).toBe('email_required');
    expect(validateSupplier({ name: 'X', email: 'inte-en-adress', materials: [EKOVILLA] })).toBe('email_invalid');
  });

  it('kräver minst ett material — annars kan leverantören aldrig bli mottagare', () => {
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [] })).toBe('materials_required');
  });

  it('avvisar ett material som inte finns i katalogen', () => {
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: ['EKOVILA'] })).toBe('material_unknown');
  });

  it('avvisar en orimlig ledtid — siffran går rakt in i en datumuträkning', () => {
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [EKOVILLA], leadTimeDays: -1 })).toBe('lead_time_invalid');
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [EKOVILLA], leadTimeDays: 3650 })).toBe('lead_time_invalid');
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [EKOVILLA], leadTimeDays: 1.5 })).toBe('lead_time_invalid');
  });

  it('avvisar en ogiltig beställningsstorlek — noll är division med noll, inte "ingen avrundning"', () => {
    const base = { name: 'X', email: 'a@b.se', materials: [EKOVILLA] };
    expect(validateSupplier({ ...base, roundUpTo: 0 })).toBe('round_up_invalid');
    expect(validateSupplier({ ...base, roundUpTo: -1 })).toBe('round_up_invalid');
    expect(validateSupplier({ ...base, roundUpTo: 2.5 })).toBe('round_up_invalid');
    expect(validateSupplier({ ...base, roundUpTo: 5000 })).toBe('round_up_invalid');
    expect(validateSupplier({ ...base, roundUpTo: 1 })).toBeNull();
    expect(validateSupplier({ ...base, roundUpTo: 24 })).toBeNull();
  });

  it('godtar noll dagars ledtid — det är ett svar, inte ett tomt fält', () => {
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [EKOVILLA], leadTimeDays: 0 })).toBeNull();
  });
});

describe('roundUpToMultiple', () => {
  it('avrundar upp till närmaste hela pall', () => {
    expect(roundUpToMultiple(187, 24)).toBe(192);
    expect(roundUpToMultiple(1, 24)).toBe(24);
  });

  it('lämnar ett exakt jämnt tal orört', () => {
    expect(roundUpToMultiple(192, 24)).toBe(192);
    expect(roundUpToMultiple(24, 24)).toBe(24);
  });

  it('multipel 1 betyder ingen avrundning — måste fungera', () => {
    // Defaulten. En leverantör som säljer lösa säckar ska gå att lägga upp, och ett obesatt fält
    // får aldrig tyst börja avrunda.
    expect(roundUpToMultiple(187, 1)).toBe(187);
  });

  it('noll behov blir noll, inte en pall', () => {
    expect(roundUpToMultiple(0, 24)).toBe(0);
    expect(roundUpToMultiple(-5, 24)).toBe(0);
  });

  // 🧨 En nolla eller ett trasigt tal som multipel hade gett Infinity respektive NaN och tyst
  // förstört förslaget. Faller tillbaka på 1 (ingen avrundning) i stället.
  it('en trasig multipel avrundar inte, i stället för att ge Infinity eller NaN', () => {
    for (const bad of [0, -1, 0.5, NaN, undefined as unknown as number]) {
      expect(roundUpToMultiple(187, bad)).toBe(187);
    }
  });

  /**
   * ⚠️ REGELN SOM PLANEN VARNAR FÖR: avrunda EN gång, på totalen — aldrig per delbehov.
   *
   * Underskottet är sanningen om vad som behövs; pallen är en leveransform. Avrundas varje dags
   * rörelse för sig växer förslaget med antalet HÄNDELSER i stället för med behovet.
   */
  it('avrundning per delbehov staplar felen — därför en gång, på totalen', () => {
    const perDag = [1, 1, 1];
    const felaktigt = perDag.reduce((sum, d) => sum + roundUpToMultiple(d, 24), 0);
    const rätt = roundUpToMultiple(
      perDag.reduce((sum, d) => sum + d, 0),
      24,
    );
    expect(felaktigt).toBe(72); // tre pallar för tre säckar
    expect(rätt).toBe(24); // en pall, vilket är svaret
  });
});

describe('suppliersForMaterial', () => {
  it('tar bara med den som faktiskt levererar materialet', () => {
    const list = [supplier({ id: 'a', materials: [EKOVILLA] }), supplier({ id: 'b', materials: [KNAUF] })];
    expect(suppliersForMaterial(list, EKOVILLA).map((s) => s.id)).toEqual(['a']);
  });

  it('utesluter INAKTIVA — annars vore avaktiveringen verkningslös', () => {
    const list = [supplier({ id: 'a', active: false }), supplier({ id: 'b', active: true })];
    expect(suppliersForMaterial(list, EKOVILLA).map((s) => s.id)).toEqual(['b']);
  });

  // Varianten HÄRLEDS ur konstanten. Skrevs 'ekovilla' ut för hand jämfördes den mot MATERIAL_SHORTS[0]
  // — och byter katalogen ordning är det två helt orelaterade strängar, så testet passerar av fel
  // skäl och prövar inte längre skiftläge alls.
  it('matchar tecken för tecken — ingen normalisering', () => {
    const list = [supplier({ materials: [EKOVILLA.toLowerCase()] })];
    expect(suppliersForMaterial(list, EKOVILLA)).toEqual([]);
  });

  // 🧨 Namnen är omvänt sorterade mot inmatningsordningen MED FLIT. Hette båda likadant vore en
  // namnsortering en no-op på just de raderna — och namnsortering är precis den sortering någon
  // skulle råka lägga till här, eftersom listAllSuppliers redan ordnar på name.
  it('behåller anroparens ordning — sorterar aldrig om', () => {
    const list = [supplier({ id: 'b', name: 'Ö-fabriken' }), supplier({ id: 'a', name: 'A-fabriken' })];
    expect(suppliersForMaterial(list, EKOVILLA).map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('defaultSupplierForMaterial', () => {
  it('förväljer när det bara finns en', () => {
    expect(defaultSupplierForMaterial([supplier({ id: 'a' })], EKOVILLA)?.id).toBe('a');
  });

  // Kärnan i hela funktionen: ett förval som tar den första i listan ser ut som ett svar men är ett
  // myntkast, och priset är ett lass säckar hos fel fabrik.
  it('GISSAR INTE mellan två fabriker — returnerar null vid tvetydighet', () => {
    const list = [supplier({ id: 'a' }), supplier({ id: 'b' })];
    expect(defaultSupplierForMaterial(list, EKOVILLA)).toBeNull();
  });

  it('räknar inte inaktiva som tvetydighet', () => {
    const list = [supplier({ id: 'a' }), supplier({ id: 'b', active: false })];
    expect(defaultSupplierForMaterial(list, EKOVILLA)?.id).toBe('a');
  });

  it('returnerar null när ingen levererar materialet', () => {
    expect(defaultSupplierForMaterial([supplier({ materials: [KNAUF] })], EKOVILLA)).toBeNull();
  });
});

describe('createSupplierSchema', () => {
  const base = { name: 'Ekovilla AB', email: 'order@ekovilla.se', materials: [EKOVILLA] };

  it('godtar minimum och defaultar ledtiden till 0', () => {
    const parsed = createSupplierSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lead_time_days).toBe(0);
  });

  // 🧨 Materialet väljer MOTTAGARE. En kod som inte ligger tecken för tecken i katalogen matchar
  // aldrig ett behov — eller matchar fel fabrik. Enda stället vokabulären prövas (ingen CHECK i SQL).
  it('avvisar ett material utanför katalogen', () => {
    expect(createSupplierSchema.safeParse({ ...base, materials: ['LÖSULL'] }).success).toBe(false);
  });

  it('avvisar en tom materiallista', () => {
    expect(createSupplierSchema.safeParse({ ...base, materials: [] }).success).toBe(false);
  });

  it('deduplicerar material', () => {
    const parsed = createSupplierSchema.safeParse({ ...base, materials: [EKOVILLA, EKOVILLA] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.materials).toEqual([EKOVILLA]);
  });

  it('kräver en giltig adress', () => {
    expect(createSupplierSchema.safeParse({ ...base, email: 'inte-en-adress' }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ name: base.name, materials: base.materials }).success).toBe(false);
  });

  it('taket på ledtiden biter — 3650 dagar klampar annars varje förslag till "beställ idag"', () => {
    expect(createSupplierSchema.safeParse({ ...base, lead_time_days: 3650 }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, lead_time_days: -1 }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, lead_time_days: 365 }).success).toBe(true);
  });

  // 🧨 z.coerce.number() är Number(v), och det gör null, '' och [] till 0 samt true till 1 — alltså
  // en GILTIG ledtid ur skräp. `sacks` slipper undan med .positive(), men 0 är ett legitimt värde
  // här ("levererar samma dag"), så noll-fallet har inget nät under sig.
  it('avvisar skräp i ledtiden i stället för att tolka det som noll', () => {
    for (const junk of [null, '', '   ', true, [], {}, 'abc']) {
      expect(createSupplierSchema.safeParse({ ...base, lead_time_days: junk }).success).toBe(false);
    }
  });

  it('tar emot en numerisk sträng — ett formulärfält skickar text', () => {
    const parsed = createSupplierSchema.safeParse({ ...base, lead_time_days: '14' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lead_time_days).toBe(14);
  });

  // 🧨 String(v) gjorde vilket JSON-värde som helst till en giltig sträng: ett objekt landade som
  // "[object Object]" som kontaktperson. Ett fel av fel typ ska nekas, inte tolkas.
  it('avvisar fel typ i fritextfälten i stället för att stringifiera den', () => {
    expect(createSupplierSchema.safeParse({ ...base, contact_name: {} }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, phone: 12345 }).success).toBe(false);
    expect(createSupplierSchema.safeParse({ ...base, note: ['a', 'b'] }).success).toBe(false);
  });

  it('pekar ut rätt fält när kontaktpersonens namn är för långt', () => {
    const parsed = createSupplierSchema.safeParse({ ...base, contact_name: 'x'.repeat(121) });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      expect(errors.contact_name?.[0]).toMatch(/Kontaktperson/);
      // Samma sträng på två fält gör att felet pekar ut fel ruta.
      expect(errors.contact_name?.[0]).not.toBe('Namnet är för långt');
    }
  });

  it('tomma valfria fält blir null, inte blanksträng', () => {
    const parsed = createSupplierSchema.safeParse({ ...base, contact_name: '  ', phone: '', note: '   ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contact_name).toBeNull();
      expect(parsed.data.phone).toBeNull();
      expect(parsed.data.note).toBeNull();
    }
  });
});

describe('updateSupplierSchema', () => {
  it('avvisar en tom patch — en UPDATE utan kolumner är ett databasfel på en meningslös begäran', () => {
    expect(updateSupplierSchema.safeParse({}).success).toBe(false);
  });

  // ⚠️ SYMMETRIN ÄR POÄNGEN. En lösare grind vid ändring än vid inläggning gör att en leverantör
  // kan RÄTTAS till ett okänt material — och då möts behov och mottagare aldrig. Samma vakt finns
  // på väntade leveranser av exakt samma skäl.
  it('håller samma materialgrind som inläggningen', () => {
    expect(updateSupplierSchema.safeParse({ materials: ['EKOVILA'] }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ materials: [] }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ materials: [KNAUF] }).success).toBe(true);
  });

  it('håller samma ledtidstak som inläggningen', () => {
    expect(updateSupplierSchema.safeParse({ lead_time_days: 3650 }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ lead_time_days: 30 }).success).toBe(true);
  });

  // Den farligaste varianten av coerce-fällan: `null` i en PATCH hade nollställt en inställd ledtid
  // tyst, och därmed tidigarelagt varje framtida beställningsförslag.
  it('nollställer INTE ledtiden på ett null — den avvisas', () => {
    expect(updateSupplierSchema.safeParse({ lead_time_days: null }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ lead_time_days: '' }).success).toBe(false);
    // Att uttryckligen sätta noll ska däremot gå: "levererar samma dag" är ett svar.
    const parsed = updateSupplierSchema.safeParse({ lead_time_days: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lead_time_days).toBe(0);
  });

  /**
   * 🧨 EN RAD MED EN OKÄND MATERIALKOD MÅSTE GÅ ATT RÄDDA I ETT STEG.
   *
   * En kod utanför katalogen kan komma från en SQL-seed (det finns med flit ingen CHECK) eller bli
   * kvar den dag ett `short` döps om i materials.ts. Renderade checklistan bara katalogen saknade
   * koden kryssruta: osynlig, omöjlig att kryssa ur, men skickad vid varje sparning — där schemat
   * nekade den. Leverantören gick då varken att rätta eller att AVAKTIVERA.
   *
   * Vakten är därför tvådelad: koden får ALDRIG godtas, men listan utan den måste godtas.
   */
  it('en okänd kod nekas, men samma patch utan den godtas', () => {
    expect(updateSupplierSchema.safeParse({ materials: ['KNAUF', EKOVILLA] }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ materials: [EKOVILLA] }).success).toBe(true);
  });

  it('håller samma adressgrind som inläggningen', () => {
    expect(updateSupplierSchema.safeParse({ email: 'inte-en-adress' }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ email: 'ny@fabriken.se' }).success).toBe(true);
  });

  it('kan avaktivera', () => {
    expect(updateSupplierSchema.safeParse({ active: false }).success).toBe(true);
  });
});

// Regressionsvakt för hela kopplingen: domänens validering och routens schema måste hålla exakt
// samma materialvokabulär. Glider de isär godtas en kod i det ena ledet och tappas i det andra —
// tyst, och först synligt när ingen mottagare hittas.
describe('materialvokabulären är EN', () => {
  it('varje kod i katalogen godtas av både validateSupplier och schemat', () => {
    for (const m of MATERIAL_SHORTS) {
      expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [m] })).toBeNull();
      expect(createSupplierSchema.safeParse({ name: 'X', email: 'a@b.se', materials: [m] }).success).toBe(true);
    }
  });

  it('hela katalogen på en gång ryms — .max() får inte vara satt under kataloglängden', () => {
    expect(createSupplierSchema.safeParse({ name: 'X', email: 'a@b.se', materials: [...MATERIAL_SHORTS] }).success).toBe(true);
  });
});
