import { describe, it, expect } from 'vitest';
import {
  workOrderDraftChanged,
  workOrderDraftFrom,
  workOrderHasEndContact,
  type WorkOrderDraftSource,
} from '@/app/crm/arbetsorder/workOrderDraft';

// Arbetsorderns översiktsutkast: Avbryt återställer till workOrderDraftFrom, och stoppet för osparade
// ändringar frågar när workOrderDraftChanged säger ja.

function order(overrides: Partial<WorkOrderDraftSource> = {}): WorkOrderDraftSource {
  return {
    project_name: 'Vindsisolering Storgatan',
    status: 'scheduled',
    assigned_to: 'u-1',
    desired_installation_date: '2026-11-03',
    work_address: { street_address: 'Storgatan 1', postal_code: '123 45', city: 'Ort' },
    customer_snapshot: { contact_name: 'Anna', phone: '070-1', email: 'anna@example.test', your_reference: 'Anna', label: 'P-12' },
    rot_details: { enabled: true, property_designation: 'Ort 1:2', rot_percent: 30, max_deduction: 50000 },
    internal_handoff: { work_scope: 'Vind', handoff_notes: 'Vägg – 162 m² × 190 mm' },
    notes: 'Ring innan',
    ...overrides,
  };
}

describe('workOrderDraftFrom', () => {
  it('tomma värden blir tomma fält, aldrig en påhittad default', () => {
    const draft = workOrderDraftFrom(order({
      project_name: null,
      assigned_to: null,
      desired_installation_date: null,
      work_address: null,
      customer_snapshot: null,
      rot_details: null,
      internal_handoff: null,
      notes: null,
    }));
    expect(draft.rot_percent).toBe('');
    expect(draft.rot_max_deduction).toBe('');
    expect(draft.rot_enabled).toBe(false);
    expect(draft.project_name).toBe('');
    expect(draft.street_address).toBe('');
  });

  it('Er referens faller tillbaka på kontaktnamnet på äldre ordrar', () => {
    const draft = workOrderDraftFrom(order({ customer_snapshot: { contact_name: 'Bertil' } }));
    expect(draft.your_reference).toBe('Bertil');
  });

  it('ROT-talen blir text för fälten', () => {
    const draft = workOrderDraftFrom(order());
    expect(draft.rot_percent).toBe('30');
    expect(draft.rot_max_deduction).toBe('50000');
  });
});

describe('workOrderHasEndContact', () => {
  it('påslaget så fort någon av slutkundens uppgifter finns', () => {
    expect(workOrderHasEndContact(order())).toBe(false);
    expect(workOrderHasEndContact(order({ customer_snapshot: { end_contact_phone: '070-2' } }))).toBe(true);
  });
});

describe('workOrderDraftChanged', () => {
  it('ett orört utkast är inte ändrat', () => {
    const item = order();
    expect(workOrderDraftChanged(workOrderDraftFrom(item), workOrderHasEndContact(item), item)).toBe(false);
  });

  it('varje fält räknas', () => {
    const item = order();
    const draft = workOrderDraftFrom(item);
    for (const key of Object.keys(draft) as Array<keyof typeof draft>) {
      const changed = { ...draft, [key]: typeof draft[key] === 'boolean' ? !draft[key] : `${draft[key]} ändrat` };
      expect(workOrderDraftChanged(changed, true, item), key).toBe(true);
    }
  });

  it('att skriva och sedan sudda tillbaka är ingen ändring', () => {
    const item = order();
    const draft = { ...workOrderDraftFrom(item), notes: 'Ring innan' };
    expect(workOrderDraftChanged(draft, false, item)).toBe(false);
  });

  it('att bara slå på slutkundsreglaget är ingen ändring — Spara skickar tomt ändå', () => {
    const item = order();
    expect(workOrderDraftChanged(workOrderDraftFrom(item), true, item)).toBe(false);
  });

  it('att slå av reglaget på en order som har en slutkund ÄR en ändring — Spara rensar den', () => {
    const item = order({ customer_snapshot: { end_contact_name: 'Fastighetsägaren', end_contact_phone: '070-9' } });
    expect(workOrderDraftChanged(workOrderDraftFrom(item), false, item)).toBe(true);
  });

  it('ifyllda slutkundsfält under ett avslaget reglage är ingen ändring', () => {
    const item = order();
    const draft = { ...workOrderDraftFrom(item), end_contact_name: 'Någon' };
    expect(workOrderDraftChanged(draft, false, item)).toBe(false);
    expect(workOrderDraftChanged(draft, true, item)).toBe(true);
  });
});
