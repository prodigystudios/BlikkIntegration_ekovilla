import { describe, it, expect } from 'vitest';
import { completionProblems, describeItem, summarizeItems } from '@/lib/domains/safetyRounds/completion';
import { completeBundle, makeAction, makeItem } from './helpers/fixtures';

// Reglerna för att få slutföra en rond. Samma lista visas i formuläret och nekar i rutten, så varje
// regel prövas här — både att den slår till och att den släpper när felet är rättat.

describe('summarizeItems', () => {
  it('räknar mallens summering: status, Hög+Allvarlig och till handlingsplan', () => {
    const summary = summarizeItems([
      makeItem({ status: 'ok' }),
      makeItem({ status: 'ok' }),
      makeItem({ status: 'partial', risk: 'medium', to_action_plan: 'no' }),
      makeItem({ status: 'defect', risk: 'severe', to_action_plan: 'yes' }),
      makeItem({ status: 'defect', risk: 'high', to_action_plan: 'fixed' }),
      makeItem({ status: 'na' }),
      makeItem({ status: null }),
    ]);
    expect(summary).toEqual({ ok: 2, partial: 1, defect: 2, na: 1, unassessed: 1, highOrSevere: 2, toActionPlan: 1 });
  });
});

describe('completionProblems', () => {
  it('en ifylld rond har inga hinder', () => {
    expect(completionProblems(completeBundle())).toEqual([]);
  });

  it('obedömda punkter räknas i ETT meddelande, inte ett per punkt', () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ status: null }), makeItem({ status: null }), makeItem({ status: null }));
    const problems = completionProblems(bundle).filter((p) => p.step === 'checklist');
    expect(problems).toEqual([{ step: 'checklist', message: '3 punkter är inte bedömda.' }]);
  });

  it('Delvis och Brist kräver ett svar på "Förs till handlingsplan?"', () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ number: 36, status: 'partial', to_action_plan: null }));
    expect(completionProblems(bundle)).toEqual([{ step: 'checklist', message: 'Punkt 36: svara om den förs till handlingsplanen.' }]);
  });

  it('OK och Ej relevant behöver inget svar om handlingsplanen', () => {
    const bundle = completeBundle();
    bundle.items.push(makeItem({ status: 'ok', to_action_plan: null }), makeItem({ status: 'na', to_action_plan: null }));
    expect(completionProblems(bundle)).toEqual([]);
  });

  it('"Ja" utan rad i handlingsplanen nekas; med raden släpper det', () => {
    const bundle = completeBundle();
    const item = makeItem({ number: 41, status: 'defect', to_action_plan: 'yes' });
    bundle.items.push(item);
    expect(completionProblems(bundle)).toEqual([{ step: 'actions', message: 'Punkt 41 ska till handlingsplanen men saknar åtgärd.' }]);

    bundle.actions.push(makeAction({ item_id: item.id }));
    expect(completionProblems(bundle)).toEqual([]);
  });

  it('en åtgärd måste ha åtgärd, ansvarig och datum ("en person per åtgärd, riktigt datum")', () => {
    const bundle = completeBundle();
    bundle.actions.push(makeAction({ action: '  ', responsible_name: null, due_on: null }));
    expect(completionProblems(bundle)).toEqual([{ step: 'actions', message: 'Åtgärd 2: ange åtgärd, ansvarig, klart senast.' }]);
  });

  it('rondledaren och minst en närvarande deltagare krävs', () => {
    const bundle = completeBundle();
    bundle.round.leader_name = ' ';
    bundle.participants = bundle.participants.map((p) => ({ ...p, present: false }));
    expect(completionProblems(bundle)).toEqual([
      { step: 'info', message: 'Ange rondledare.' },
      { step: 'participants', message: 'Minst en deltagare ska vara närvarande.' },
    ]);
  });
});

describe('describeItem', () => {
  it('en katalogpunkt heter sitt nummer', () => {
    expect(describeItem({ number: 36, text: 'Andningsskydd?' })).toBe('Punkt 36');
  });

  it('en egen punkt (utan nummer) beskrivs med början av texten', () => {
    expect(describeItem({ number: null, text: 'Takluckan på hus 3 saknar räcke och står öppen hela dagen?' })).toBe(
      '"Takluckan på hus 3 saknar räcke och står…"',
    );
    expect(describeItem({ number: null, text: 'Kort punkt' })).toBe('"Kort punkt"');
  });
});
