import { describe, it, expect } from 'vitest';
import { canReceiveExpected } from '@/lib/domains/planning/expectedDeliveries';
import { createExpectedDeliverySchema, createDeliverySchema } from '@/app/api/crm/planering/_lib';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';

function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

describe('canReceiveExpected', () => {
  it('bara en öppen rad kan tas emot', () => {
    expect(canReceiveExpected('expected')).toBe('ok');
  });

  it('skiljer på redan kvitterad och avbruten', () => {
    // De betyder olika saker för den som tryckte: en kvitterad rad är någon annans arbete som just
    // blev klart, en avbruten är ett aktivt beslut. Speglar `expected_not_open` i databasen, som är
    // grinden som faktiskt räknas.
    expect(canReceiveExpected('arrived')).toBe('already_arrived');
    expect(canReceiveExpected('cancelled')).toBe('cancelled');
  });
});

describe('datumreglerna för de två leveranssorterna', () => {
  const today = stockholmTodayISO();
  const base = { depot_id: '11111111-1111-4111-8111-111111111111', material: MATERIAL_SHORTS[0], sacks: 180, note: null };

  it('en VÄNTAD leverans får ligga i framtiden — det är hela poängen med tabellen', () => {
    const parsed = createExpectedDeliverySchema.safeParse({ ...base, expected_on: shiftISO(today, 14) });
    expect(parsed.success).toBe(true);
  });

  it('en REGISTRERAD leverans får det inte — den räknas i saldot direkt', () => {
    // 🧨 Spegelvänt par. Släpps framtida datum in i ops_depot_deliveries höjs saldot idag och
    // bristvarningen tystnar; vägras de i ops_expected_deliveries går det inte att säga att något
    // är på väg. Testet står här för att de två reglerna ska läsas ihop.
    const parsed = createDeliverySchema.safeParse({ ...base, delivered_on: shiftISO(today, 14) });
    expect(parsed.success).toBe(false);
  });

  it('en väntad leverans får också ligga bakåt — en försenad leverans är fortfarande väntad', () => {
    const parsed = createExpectedDeliverySchema.safeParse({ ...base, expected_on: shiftISO(today, -3) });
    expect(parsed.success).toBe(true);
  });

  it('avvisar okänt material och noll säckar', () => {
    expect(createExpectedDeliverySchema.safeParse({ ...base, material: 'GLASULL', expected_on: today }).success).toBe(false);
    expect(createExpectedDeliverySchema.safeParse({ ...base, sacks: 0, expected_on: today }).success).toBe(false);
  });
});
