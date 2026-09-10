'use client';

import { useState } from 'react';
import { crm } from '@/app/crm/lib/crmTokens';
import { stockholmTodayISO } from './planningDates';
import type { DeliveryChip } from '@/lib/domains/planning/deliveryStrip';

// Kvittera att en väntad leverans kommit fram. Först här blir den lager.
//
// ⚠️ ANTALET ÄR REDIGERBART, och det är inte en bekvämlighet. Kommer 120 av 180 säck är det 120 som
// ska in i saldot; skrivs 180 in ändå tror lagret att det finns 60 säckar som inte existerar, och
// det upptäcks när en bil står tom. Fältet är förifyllt med det beställda eftersom det är det
// vanliga fallet, inte för att det är sanningen.
export default function ReceiveDeliveryModal({
  chip,
  onClose,
  onConfirm,
}: {
  chip: DeliveryChip;
  onClose: () => void;
  onConfirm: (input: { delivered_on: string; sacks: number; note: string | null }) => Promise<void>;
}) {
  // Svensk kalenderdag, inte UTC: toISOString() bokför ankomsten på gårdagen mellan midnatt och
  // 02:00. Samma not som leveransformuläret bär.
  const today = stockholmTodayISO();
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [sacks, setSacks] = useState(String(chip.sacks));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const count = Number(sacks);
  const valid = count > 0 && Number.isInteger(count) && deliveredOn.length === 10 && deliveredOn <= today;
  const short = count > 0 && count < chip.sacks;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onConfirm({ delivered_on: deliveredOn, sacks: count, note: note.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  const field =
    'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-2.5 text-[12.5px] text-slate-700 outline-none transition focus:border-[color:var(--ek-accent)]';
  const label = 'mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400';

  return (
    <div className="fixed inset-0 z-[2800] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bekräfta ankomst"
        className="w-full max-w-[420px] rounded-2xl border border-[#e0e8dc] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-extrabold text-[#142c1b]">Bekräfta ankomst</h2>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {chip.sacks} säck {chip.material} till <span className="font-semibold text-slate-700">{chip.depot_name}</span>.
          Först nu räknas materialet i lagersaldot.
        </p>

        <div className="mt-4 grid gap-3">
          <div>
            <span className={label}>Ankomstdatum</span>
            <input
              type="date"
              value={deliveredOn}
              max={today}
              onChange={(e) => setDeliveredOn(e.target.value)}
              className={`${field} tabular-nums`}
              aria-label="Ankomstdatum"
            />
          </div>
          <div>
            <span className={label}>Antal säckar som kom</span>
            <input
              type="number"
              min={1}
              value={sacks}
              onChange={(e) => setSacks(e.target.value)}
              className={field}
              aria-label="Antal säckar som kom"
            />
            {short && (
              <p className="mt-1 text-[11px] text-amber-700">
                Färre än de {chip.sacks} som väntades. Bara {count} räknas in i lagret — lägg in en ny väntad
                leverans om resten kommer senare.
              </p>
            )}
          </div>
          <div>
            <span className={label}>Notering (valfritt)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={field} aria-label="Notering" />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={crm.ghostButton}>
            Avbryt
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || saving}
            className={crm.formButton}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {saving ? 'Sparar…' : 'Bekräfta ankomst'}
          </button>
        </div>
      </div>
    </div>
  );
}
