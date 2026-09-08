import { describe, it, expect } from 'vitest';
import { placeholderChanges, type PlaceholderInput } from '@/app/crm/planering/placeholderForm';
import type { OpsSegment } from '@/lib/domains/planning/types';

// Redigeringsmodalen skickar bara ändrade fält. Skickar den hela formuläret skriver varje sparning
// tillbaka de värden som gällde när modalen öppnades — och två planerare på samma platshållare
// backar varandra tyst. Värst på field_visible: bokningen försvinner ur besättningens feed och
// loggen pekar ut fel person.

const segment = (over: Partial<OpsSegment> = {}): OpsSegment =>
  ({
    id: 'seg-1',
    work_order_id: null,
    truck_id: 'truck-1',
    start_day: '2026-09-14',
    end_day: '2026-09-14',
    sort_index: 0,
    job_type: null,
    on_hold: false,
    created_by: null,
    created_by_name: 'Klas',
    created_at: '2026-09-08T06:00:00Z',
    updated_at: '2026-09-08T06:00:00Z',
    placeholder_title: 'Service av blåsmaskin',
    placeholder_customer: null,
    field_visible: false,
    work_description: null,
    job: null,
    sacks_reported: 0,
    sacks_final: false,
    crew: [],
    confirmation: { email_sent_at: null, sms_sent_at: null, sms_status: null, email_recipient: null, sms_recipient: null },
    ...over,
  }) as OpsSegment;

const formFor = (seg: OpsSegment, over: Partial<PlaceholderInput> = {}): PlaceholderInput => ({
  title: seg.placeholder_title ?? '',
  customer: seg.placeholder_customer ?? null,
  truck_id: seg.truck_id,
  start_day: seg.start_day,
  end_day: seg.end_day,
  job_type: seg.job_type ?? null,
  field_visible: seg.field_visible,
  work_description: seg.work_description ?? null,
  ...over,
});

describe('placeholderChanges', () => {
  it('ger en tom patch när ingenting rörts', () => {
    const seg = segment();
    expect(placeholderChanges(formFor(seg), seg)).toEqual({});
  });

  it('tar bara med det fält som faktiskt ändrats', () => {
    const seg = segment();
    expect(placeholderChanges(formFor(seg, { title: 'Service av blåsmaskin 2' }), seg)).toEqual({
      title: 'Service av blåsmaskin 2',
    });
  });

  it('skickar INTE med field_visible när bara texten rättats', () => {
    // Kärnan i skyddet: någon annan hann publicera platshållaren medan modalen stod öppen. Följer
    // det gamla `false` med tystas bokningen för hela besättningen — och aktivitetsloggen säger
    // att den som rättade stavfelet dolde den.
    const seg = segment();
    const patch = placeholderChanges(formFor(seg, { work_description: 'Filterbyte.' }), seg);
    expect(patch).toEqual({ work_description: 'Filterbyte.' });
    expect('field_visible' in patch).toBe(false);
  });

  it('tar med field_visible när det är just den som ändrats', () => {
    const seg = segment();
    expect(placeholderChanges(formFor(seg, { field_visible: true }), seg)).toEqual({ field_visible: true });
  });

  it('jämför tomma fält mot null, inte mot tom sträng', () => {
    // Formuläret håller '' i en tom ruta och skickar null. Utan normaliseringen hade varje
    // sparning sett en tom kundruta som en ändring och skickat med den i onödan.
    const seg = segment({ placeholder_customer: null, work_description: null });
    expect(placeholderChanges(formFor(seg), seg)).toEqual({});
  });

  it('tar med en rensning — från text till tomt är en riktig ändring', () => {
    const seg = segment({ work_description: 'Filterbyte.' });
    expect(placeholderChanges(formFor(seg, { work_description: null }), seg)).toEqual({ work_description: null });
  });

  it('tar med flytt av bil och datum', () => {
    const seg = segment();
    expect(
      placeholderChanges(formFor(seg, { truck_id: 'truck-2', start_day: '2026-09-15', end_day: '2026-09-16' }), seg),
    ).toEqual({ truck_id: 'truck-2', start_day: '2026-09-15', end_day: '2026-09-16' });
  });
});
