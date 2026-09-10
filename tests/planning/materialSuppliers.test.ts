import { describe, it, expect } from 'vitest';
import {
  validateSupplier,
  suppliersForMaterial,
  defaultSupplierForMaterial,
  type MaterialSupplier,
} from '@/lib/domains/planning/materialSuppliers';
import { createSupplierSchema, updateSupplierSchema } from '@/app/api/crm/planering/_lib';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

// Leverantörsregistret bestämmer VEM materialbeställningen mailas till. Felen som vaktas här är
// alla av samma slag: de ser ut som ingenting i UI:t och kostar ett lass säckar hos fel fabrik.

const EKOVILLA = MATERIAL_SHORTS[0];
const KNAUF = MATERIAL_SHORTS[1];

function supplier(over: Partial<MaterialSupplier> = {}): MaterialSupplier {
  return {
    id: 's1',
    name: 'Fabriken',
    email: 'order@fabriken.se',
    contact_name: null,
    phone: null,
    materials: [EKOVILLA],
    lead_time_days: 5,
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

  it('godtar noll dagars ledtid — det är ett svar, inte ett tomt fält', () => {
    expect(validateSupplier({ name: 'X', email: 'a@b.se', materials: [EKOVILLA], leadTimeDays: 0 })).toBeNull();
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

  it('matchar tecken för tecken — ingen normalisering', () => {
    const list = [supplier({ materials: ['ekovilla'] })];
    expect(suppliersForMaterial(list, EKOVILLA)).toEqual([]);
  });

  it('behåller anroparens ordning', () => {
    const list = [supplier({ id: 'b' }), supplier({ id: 'a' })];
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
