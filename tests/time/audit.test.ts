import { describe, it, expect } from 'vitest';
import {
  auditActionLabel,
  auditInRange,
  auditWorkDate,
  describeAuditChange,
  type TimeEntryAuditRow,
} from '@/lib/domains/time/audit';

// Revisionsloggens läsning. Skrivningen sköts av en databastrigger som ingen väg går förbi; det som
// prövas här är att före/efter blir begripligt — en logg man inte kan läsa är inte en logg.

const base = {
  kind: 'work_order',
  work_date: '2026-08-14',
  work_order_id: 'wo-1',
  internal_project_id: null,
  absence_type_id: null,
  start_time: '07:00:00',
  end_time: '16:00:00',
  break_minutes: 30,
  minutes_worked: 510,
  note: null,
};

const row = (over: Partial<TimeEntryAuditRow> = {}): TimeEntryAuditRow => ({
  id: 'a1',
  entry_id: 'e1',
  user_id: 'anna',
  changed_by: 'admin',
  action: 'update',
  before_data: { ...base },
  after_data: { ...base },
  created_at: '2026-08-15T09:00:00Z',
  ...over,
});

describe('describeAuditChange', () => {
  it('visar klockslag som ändrats, och bara dem', () => {
    const changes = describeAuditChange(row({ after_data: { ...base, end_time: '17:00:00', minutes_worked: 570 } }));
    expect(changes.map((change) => change.label)).toEqual(['Sluttid', 'Arbetad tid']);
    expect(changes[0]).toEqual({ label: 'Sluttid', from: '16:00', to: '17:00' });
    expect(changes[1]).toEqual({ label: 'Arbetad tid', from: '8,50 h', to: '9,50 h' });
  });

  it('säger ingenting när ingenting ändrats', () => {
    expect(describeAuditChange(row())).toEqual([]);
  });

  // En radering har inget efteråt och en ny rad inget innan — där är själva handlingen svaret,
  // och en fältdiff hade bara listat hela raden som "ändrad".
  it('beskriver inte fält för radering och tillägg', () => {
    expect(describeAuditChange(row({ action: 'delete', after_data: null }))).toEqual([]);
    expect(describeAuditChange(row({ action: 'insert', before_data: null }))).toEqual([]);
  });

  // ⚠️ Mål-id:n översätts INTE till namn: uppslaget hade beskrivit nuet i stället för vad som hände,
  // eftersom ordern kan ha ändrats sedan dess. Bytet redovisas som ett faktum.
  it('redovisar ett jobbyte utan att låtsas namnge det', () => {
    const changes = describeAuditChange(row({ after_data: { ...base, work_order_id: 'wo-2' } }));
    expect(changes).toEqual([{ label: 'Jobb eller orsak', from: 'ändrat', to: null }]);
  });

  it('namnger sorten på svenska när den bytts', () => {
    const changes = describeAuditChange(row({
      after_data: { ...base, kind: 'absence', work_order_id: null, absence_type_id: 'vab' },
    }));
    expect(changes.find((change) => change.label === 'Sort')).toEqual({
      label: 'Sort', from: 'Arbetsorder', to: 'Frånvaro',
    });
  });

  it('visar en tillagd och en borttagen anteckning', () => {
    expect(describeAuditChange(row({ after_data: { ...base, note: 'Rättat efter samtal' } }))[0])
      .toEqual({ label: 'Anteckning', from: null, to: 'Rättat efter samtal' });
    expect(describeAuditChange(row({ before_data: { ...base, note: 'Fel' }, after_data: { ...base } }))[0])
      .toEqual({ label: 'Anteckning', from: 'Fel', to: null });
  });
});

describe('auditWorkDate och auditInRange', () => {
  // Intervallet gäller radens ARBETSDATUM, inte när ändringen gjordes: frågan är "har någon rört
  // augusti?", inte "vad hände i augusti". En rättelse i september av en augustidag hör till augusti.
  it('läser datumet ur efteråt, och ur innan när raden togs bort', () => {
    expect(auditWorkDate(row())).toBe('2026-08-14');
    expect(auditWorkDate(row({ action: 'delete', after_data: null }))).toBe('2026-08-14');
  });

  it('placerar en rättelse gjord i september på augustidagen den gäller', () => {
    const september = row({ created_at: '2026-09-02T08:00:00Z' });
    expect(auditInRange(september, { from: '2026-08-01', to: '2026-08-31' })).toBe(true);
    expect(auditInRange(september, { from: '2026-09-01', to: '2026-09-30' })).toBe(false);
  });

  it('utesluter en rad utan läsbart datum i stället för att gissa', () => {
    expect(auditInRange(row({ before_data: null, after_data: null }), { from: '2026-08-01', to: '2026-08-31' })).toBe(false);
  });
});

describe('auditActionLabel', () => {
  it('säger vad som hände på svenska', () => {
    expect(auditActionLabel('update')).toBe('Raden ändrades');
    expect(auditActionLabel('delete')).toBe('Raden togs bort');
    expect(auditActionLabel('insert')).toBe('Raden lades till');
  });
});
