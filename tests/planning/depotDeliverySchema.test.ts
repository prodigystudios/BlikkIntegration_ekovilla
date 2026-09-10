import { describe, it, expect } from 'vitest';
import { createDeliverySchema } from '@/app/api/crm/planering/_lib';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

// Vakt för framtidsdaterade leveranser.
//
// listDeliveryRows (lib/domains/planning/depotStock.ts) summerar hela ops_depot_deliveries utan
// datumfilter, så en rad daterad framåt räknas som lager REDAN IDAG. `shortfall` faller till 0 och
// bristbanderollen tystnar på en depå som i verkligheten är tom — utan att något felar.

// UTC-förankrad dagförskjutning, samma idiom som insights.addDaysISO. Att i stället lägga 24 h på en
// LOKAL midnatt hade gett samma datum tillbaka över höstens sommartidsväxling (25/10 00:00 + 24 h →
// 25/10 23:00), och testet hade tyst prövat ingenting den dagen.
function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const base = {
  depot_id: '11111111-1111-4111-8111-111111111111',
  material: MATERIAL_SHORTS[0],
  sacks: 180,
  note: null,
};

describe('createDeliverySchema — delivered_on', () => {
  // Taket ankras i svensk tid, inte i runnerns zon, så testet prövar samma gräns under TZ=UTC
  // (CI och Vercel) som lokalt.
  const today = stockholmTodayISO();

  it('godtar dagens datum', () => {
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: today });
    expect(parsed.success).toBe(true);
  });

  it('godtar ett passerat datum — en leverans får registreras i efterhand', () => {
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: shiftISO(today, -30) });
    expect(parsed.success).toBe(true);
  });

  it('avvisar morgondagen', () => {
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: shiftISO(today, 1) });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.delivered_on?.[0]).toMatch(/framtiden/);
    }
  });

  it('avvisar ett datum långt fram — det är beställningens plats, inte lagrets', () => {
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: shiftISO(today, 400) });
    expect(parsed.success).toBe(false);
  });

  it('behåller formatkravet: ett ogiltigt datum avvisas före jämförelsen', () => {
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: '2026-9-1' });
    expect(parsed.success).toBe(false);
  });
});
