import { describe, it, expect } from 'vitest';
import {
  isCalendarDate,
  actionCreateSchema,
  actionPatchSchema,
  customItemCreateSchema,
  itemPatchSchema,
  participantCreateSchema,
  roundPatchSchema,
} from '@/lib/domains/safetyRounds/schemas';

// Rutternas scheman. Det viktiga: tom text blir null, okända nycklar (order, status, rondnummer)
// faller bort, och databasens värdeuppsättningar gäller redan här.

describe('roundPatchSchema', () => {
  it('trimmar, och tom text blir null', () => {
    const parsed = roundPatchSchema.parse({ weather: '  Mulet  ', object_label: '   ', next_round_due: '' });
    expect(parsed).toEqual({ weather: 'Mulet', object_label: null, next_round_due: null });
  });

  it('släpper aldrig igenom status, order eller rondnummer — de sätts av databasen', () => {
    const parsed = roundPatchSchema.parse({
      weather: 'Sol',
      status: 'completed',
      work_order_id: '22222222-2222-4222-8222-222222222222',
      round_number: 9,
      created_by: 'någon',
      leader_id: 'någon',
    });
    expect(parsed).toEqual({ weather: 'Sol' });
  });

  it('en tom kropp nekas ("Inget att spara")', () => {
    expect(roundPatchSchema.safeParse({}).success).toBe(false);
    expect(roundPatchSchema.safeParse({ status: 'completed' }).success).toBe(false);
  });

  it('datumet är obligatoriskt och i ISO-form; klockslaget TT:MM', () => {
    expect(roundPatchSchema.safeParse({ held_on: '' }).success).toBe(false);
    expect(roundPatchSchema.safeParse({ held_on: '24/9 2026' }).success).toBe(false);
    expect(roundPatchSchema.parse({ held_on: '2026-09-24', held_at: '09:30' })).toEqual({ held_on: '2026-09-24', held_at: '09:30' });
    expect(roundPatchSchema.parse({ held_at: '' })).toEqual({ held_at: null });
    expect(roundPatchSchema.safeParse({ held_at: '9.30' }).success).toBe(false);
  });
});

describe('datum som inte finns i kalendern', () => {
  it('nekas i schemat — annars blev de ett 500 från Postgres (22008)', () => {
    expect(roundPatchSchema.safeParse({ held_on: '2026-02-30' }).success).toBe(false);
    expect(roundPatchSchema.safeParse({ next_round_due: '2026-13-01' }).success).toBe(false);
    expect(actionPatchSchema.safeParse({ due_on: '2026-04-31' }).success).toBe(false);
    expect(actionPatchSchema.safeParse({ followed_up_on: '2026-00-10' }).success).toBe(false);
  });

  it('skottdagen finns bara på skottår', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-12-31')).toBe(true);
  });
});

describe('itemPatchSchema', () => {
  it('bara databasens värden: OK/Delvis/Brist/Ej relevant och Låg/Medel/Hög/Allvarlig', () => {
    expect(itemPatchSchema.parse({ status: 'defect', risk: 'severe', to_action_plan: 'fixed' })).toEqual({
      status: 'defect',
      risk: 'severe',
      to_action_plan: 'fixed',
    });
    expect(itemPatchSchema.safeParse({ status: 'nej' }).success).toBe(false);
    expect(itemPatchSchema.safeParse({ risk: 'kritisk' }).success).toBe(false);
    expect(itemPatchSchema.parse({ risk: null })).toEqual({ risk: null });
  });

  it('texten i en katalogpunkt går inte att skriva om härifrån', () => {
    expect(itemPatchSchema.safeParse({ text: 'Något annat?' }).success).toBe(false);
  });
});

describe('participantCreateSchema', () => {
  it('fyller i standardvärden och kräver namn', () => {
    expect(participantCreateSchema.parse({ name: ' Anna ', role: 'installer' })).toEqual({
      name: 'Anna',
      role: 'installer',
      profile_id: null,
      present: true,
      company: null,
      initials: null,
      comment: null,
    });
    expect(participantCreateSchema.safeParse({ name: '  ', role: 'installer' }).success).toBe(false);
    expect(participantCreateSchema.safeParse({ name: 'Anna', role: 'chef' }).success).toBe(false);
  });
});

describe('customItemCreateSchema', () => {
  it('kräver text och en kategorikod', () => {
    expect(customItemCreateSchema.parse({ category_code: 'I', text: ' Takluckan? ' })).toEqual({ category_code: 'I', text: 'Takluckan?' });
    expect(customItemCreateSchema.safeParse({ category_code: 'I', text: '' }).success).toBe(false);
  });
});

describe('actionCreateSchema / actionPatchSchema', () => {
  it('en ny åtgärd kräver "Risk / brist" och resten är valfritt', () => {
    expect(actionCreateSchema.parse({ finding: 'Räcke saknas' })).toEqual({
      finding: 'Räcke saknas',
      item_id: null,
      risk: null,
      action: null,
      responsible_name: null,
      due_on: null,
    });
    expect(actionCreateSchema.safeParse({ finding: ' ' }).success).toBe(false);
  });

  it('uppföljningens värden följer mallen', () => {
    expect(actionPatchSchema.parse({ status: 'delayed', effect: 'not_assessed', followed_up_on: '2026-10-01' })).toEqual({
      status: 'delayed',
      effect: 'not_assessed',
      followed_up_on: '2026-10-01',
    });
    expect(actionPatchSchema.safeParse({ status: 'klar' }).success).toBe(false);
    expect(actionPatchSchema.safeParse({ round_id: 'x' }).success).toBe(false);
  });
});
