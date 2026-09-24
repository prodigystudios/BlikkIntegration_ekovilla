import type {
  SafetyRound,
  SafetyRoundAction,
  SafetyRoundBundle,
  SafetyRoundItem,
  SafetyRoundParticipant,
} from '@/lib/domains/safetyRounds/types';

// Påhittade rader — inga riktiga kunder eller personer (skyddsrondsmallen och kunddata hör aldrig
// hemma i repot).

export const ROUND_ID = '11111111-1111-4111-8111-111111111111';
export const WORK_ORDER_ID = '22222222-2222-4222-8222-222222222222';

export function makeRound(overrides: Partial<SafetyRound> = {}): SafetyRound {
  return {
    id: ROUND_ID,
    work_order_id: WORK_ORDER_ID,
    round_number: 2,
    status: 'draft',
    order_number: 'AO-20260924-AB12CD',
    fortnox_order_number: '6579',
    project_name: 'Vindsbjälklag Hus A–C',
    client_name: 'Testfastigheter AB',
    site_address: 'Testgatan 1, 811 21 Sandviken',
    object_label: 'Hus B',
    held_on: '2026-09-24',
    held_at: '09:30:00',
    client_label: 'Testfastigheter AB',
    contract_step: 'Isolering vindsbjälklag',
    employer: 'Isoleringslandslaget AB',
    work_type: 'Tilläggsisolering / lösull / cellulosaisolering',
    weather: 'Mulet, +8',
    leader_id: 'user-leader',
    leader_name: 'Rolf Rondledare',
    safety_rep_name: 'Sara Skyddsombud',
    next_round_due: '2026-10-01',
    previous_followed_up: true,
    created_by: 'user-leader',
    created_by_name: 'Rolf Rondledare',
    created_at: '2026-09-24T07:30:00Z',
    updated_at: '2026-09-24T07:30:00Z',
    completed_at: null,
    completed_by: null,
    ...overrides,
  };
}

let itemSeq = 0;
export function makeItem(overrides: Partial<SafetyRoundItem> = {}): SafetyRoundItem {
  itemSeq += 1;
  return {
    id: `item-${itemSeq}`,
    round_id: ROUND_ID,
    catalog_item_id: `catalog-${itemSeq}`,
    category_code: 'A',
    category_label: 'Tillträde, ordning och allmän säkerhet',
    number: itemSeq,
    text: `Kontrollpunkt ${itemSeq}?`,
    position: itemSeq,
    status: 'ok',
    risk: null,
    description: null,
    fixed_on_site: null,
    to_action_plan: null,
    comment: null,
    ...overrides,
  };
}

let actionSeq = 0;
export function makeAction(overrides: Partial<SafetyRoundAction> = {}): SafetyRoundAction {
  actionSeq += 1;
  return {
    id: `action-${actionSeq}`,
    round_id: ROUND_ID,
    item_id: null,
    position: actionSeq,
    finding: 'Räcke saknas vid taklucka',
    risk: 'high',
    action: 'Sätt räcke vid taklucka hus 3',
    responsible_name: 'Arne Arbetsledare',
    responsible_id: null,
    due_on: '2026-09-26',
    status: 'not_started',
    followed_up_on: null,
    effect: null,
    cost_note: null,
    ...overrides,
  };
}

let participantSeq = 0;
export function makeParticipant(overrides: Partial<SafetyRoundParticipant> = {}): SafetyRoundParticipant {
  participantSeq += 1;
  return {
    id: `participant-${participantSeq}`,
    round_id: ROUND_ID,
    profile_id: null,
    name: `Deltagare ${participantSeq}`,
    role: 'installer',
    company: null,
    present: true,
    initials: null,
    comment: null,
    position: participantSeq,
    ...overrides,
  };
}

/** En rond som går att slutföra: allt bedömt, en brist med åtgärd. */
export function completeBundle(): SafetyRoundBundle {
  const defect = makeItem({
    category_code: 'B',
    category_label: 'Fallrisk och arbete på höjd',
    number: 4,
    status: 'defect',
    risk: 'high',
    description: 'Räcke saknas vid taklucka',
    to_action_plan: 'yes',
  });
  return {
    round: makeRound(),
    participants: [makeParticipant({ name: 'Rolf Rondledare', role: 'leader' }), makeParticipant({ name: 'Sara Skyddsombud', role: 'safety_rep' })],
    items: [makeItem({ number: 1 }), makeItem({ number: 2, status: 'na' }), defect],
    actions: [makeAction({ item_id: defect.id })],
  };
}
