import type { SafetyRoundBundle, SafetyRoundItem } from './types';

// Summeringen (mallens rad "SUMMERING (räknas automatiskt)") och reglerna för att få slutföra en
// rond. Ren modul — formuläret visar samma lista som rutten nekar med, så knappen och servern aldrig
// säger olika saker.
//
// Reglerna kommer ur mallen, inte ur luften:
//   * Varje punkt bedöms — "Ej relevant" finns för det som inte gäller.
//   * Delvis/Brist ska ha ett svar på "Förs till handlingsplan?" (Ja / Nej / Direkt åtgärdad).
//   * "Ja" betyder att en rad finns i handlingsplanen för punkten.
//   * Handlingsplanen: "En person per åtgärd, riktigt datum" — åtgärd, ansvarig och klart senast.

export type SafetyRoundSummary = {
  ok: number;
  partial: number;
  defect: number;
  na: number;
  unassessed: number;
  /** Punkter med risknivå Hög eller Allvarlig. */
  highOrSevere: number;
  /** Punkter med "Förs till handlingsplan?" = Ja. */
  toActionPlan: number;
};

export function summarizeItems(items: readonly SafetyRoundItem[]): SafetyRoundSummary {
  const summary: SafetyRoundSummary = { ok: 0, partial: 0, defect: 0, na: 0, unassessed: 0, highOrSevere: 0, toActionPlan: 0 };
  for (const item of items) {
    if (item.status === null) summary.unassessed += 1;
    else summary[item.status] += 1;
    if (item.risk === 'high' || item.risk === 'severe') summary.highOrSevere += 1;
    if (item.to_action_plan === 'yes') summary.toActionPlan += 1;
  }
  return summary;
}

/**
 * Punkten i ett meddelande: "Punkt 36", eller början av texten för en egen punkt (som saknar
 * nummer — "Punkt I" hade inte sagt vilken av dem).
 */
export function describeItem(item: Pick<SafetyRoundItem, 'number' | 'text'>): string {
  if (item.number != null) return `Punkt ${item.number}`;
  const text = item.text.trim();
  return `"${text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text}"`;
}

export type CompletionProblem = {
  /** Var i formuläret: steget som ska öppnas. */
  step: 'info' | 'participants' | 'checklist' | 'actions';
  message: string;
};

/**
 * Det som hindrar ronden från att slutföras, i formulärets ordning. Tom lista = klar att slutföra.
 * Obedömda punkter räknas i ETT meddelande — tjugo rader om samma sak hade inte gått att läsa i
 * mobilen.
 */
export function completionProblems(bundle: Pick<SafetyRoundBundle, 'round' | 'participants' | 'items' | 'actions'>): CompletionProblem[] {
  const problems: CompletionProblem[] = [];
  const { round, participants, items, actions } = bundle;

  if (!round.leader_name?.trim()) problems.push({ step: 'info', message: 'Ange rondledare.' });
  if (!participants.some((p) => p.present)) problems.push({ step: 'participants', message: 'Minst en deltagare ska vara närvarande.' });

  const unassessed = items.filter((item) => item.status === null);
  if (unassessed.length > 0) {
    problems.push({
      step: 'checklist',
      message: unassessed.length === 1 ? 'En punkt är inte bedömd.' : `${unassessed.length} punkter är inte bedömda.`,
    });
  }

  for (const item of items) {
    if ((item.status === 'partial' || item.status === 'defect') && item.to_action_plan === null) {
      problems.push({ step: 'checklist', message: `${describeItem(item)}: svara om den förs till handlingsplanen.` });
    }
    if (item.to_action_plan === 'yes' && !actions.some((a) => a.item_id === item.id)) {
      problems.push({ step: 'actions', message: `${describeItem(item)} ska till handlingsplanen men saknar åtgärd.` });
    }
  }

  for (const [index, action] of actions.entries()) {
    const missing = [
      !action.action?.trim() && 'åtgärd',
      !action.responsible_name?.trim() && 'ansvarig',
      !action.due_on && 'klart senast',
    ].filter(Boolean);
    if (missing.length > 0) {
      problems.push({ step: 'actions', message: `Åtgärd ${index + 1}: ange ${missing.join(', ')}.` });
    }
  }

  return problems;
}
