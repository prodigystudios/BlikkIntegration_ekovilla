'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import type { DepotBalance } from '@/lib/domains/planning/depotStock';

const STOCK_API = '/api/crm/planering/depot-stock';
const DELIVERIES_API = '/api/crm/planering/depot-deliveries';
const FIELD = 'h-9 w-full rounded-lg border border-[#dce4d8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15';
const PRIMARY = 'inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50';

function balanceClass(balance: number): string {
  if (balance < 0) return 'text-rose-600';
  if (balance === 0) return 'text-amber-600';
  return 'text-emerald-700';
}

// Depot stock view: per-depot, per-material balance (deliveries − derived consumption) + a form to
// record a new delivery. Consumption stays 0 until the installer sack-reporting flow populates it.
export default function DepotStockModal({ canWrite, onClose }: { canWrite: boolean; onClose: () => void }) {
  const toast = useToast();
  const [depots, setDepots] = useState<DepotBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [depotId, setDepotId] = useState('');
  const [material, setMaterial] = useState(MATERIAL_SHORTS[0] ?? '');
  const [sacks, setSacks] = useState('');
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [note, setNote] = useState('');

  async function load() {
    const r = await fetch(STOCK_API, { cache: 'no-store' });
    const j = await r.json();
    if (j.ok) {
      const list = j.data.depots as DepotBalance[];
      setDepots(list);
      if (!depotId && list.length) setDepotId(list[0].depot_id);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function record(e: FormEvent) {
    e.preventDefault();
    if (!depotId || !material || !(Number(sacks) > 0)) return;
    setBusy(true);
    try {
      const r = await fetch(DELIVERIES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depot_id: depotId, material, sacks: Number(sacks), delivered_on: deliveredOn, note: note.trim() || null }),
      });
      const j = await r.json();
      if (!j.ok) return toast.error(j.error || 'Kunde inte registrera leveransen');
      toast.success('Leverans registrerad');
      setSacks('');
      setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Lager"
      maxWidth="sm:max-w-[600px]"
      header={
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Lager</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Saldo per depå och material (leveranser − förbrukning).</p>
        </div>
      }
      footer={
        <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'ml-auto')}>
          Stäng
        </button>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Laddar…</p>
      ) : (
        <div className="grid gap-4">
          {canWrite && (
            <form onSubmit={record} className="grid gap-2.5 rounded-xl border border-dashed border-[#c8d4c3] bg-[#f9fbf7] p-3">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Registrera leverans</p>
              <div className="grid grid-cols-2 gap-2.5">
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)} aria-label="Depå" className={FIELD}>
                  {depots.length === 0 && <option value="">Ingen depå</option>}
                  {depots.map((d) => (
                    <option key={d.depot_id} value={d.depot_id}>{d.depot_name}</option>
                  ))}
                </select>
                <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material" className={FIELD}>
                  {MATERIAL_SHORTS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input type="number" min={1} value={sacks} onChange={(e) => setSacks(e.target.value)} placeholder="Antal säckar" aria-label="Antal säckar" className={FIELD} />
                <input type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} aria-label="Datum" className={cn(FIELD, 'tabular-nums')} />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2.5">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notering (valfritt)" aria-label="Notering" className={FIELD} />
                <button
                  type="submit"
                  disabled={busy || !depotId || !(Number(sacks) > 0)}
                  className={PRIMARY}
                  style={{ backgroundColor: 'var(--crm-primary)' }}
                >
                  Registrera
                </button>
              </div>
            </form>
          )}

          {depots.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-slate-400">Inga depåer upplagda än. Lägg till under Depåer.</p>
          ) : (
            <div className="grid gap-2.5">
              {depots.map((d) => (
                <div key={d.depot_id} className="rounded-xl border border-[#e0e8dc] bg-white p-3">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-800">{d.depot_name}</span>
                      {d.rows.some((r) => r.balance < 0) && (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-px text-[9px] font-bold text-rose-700">Underskott</span>
                      )}
                    </span>
                    <span className={cn('shrink-0 text-[12px] font-bold tabular-nums', balanceClass(d.total_balance))}>{d.total_balance} säck</span>
                  </div>
                  {d.rows.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Inga rörelser än.</p>
                  ) : (
                    <table className="w-full text-[11.5px]">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="font-semibold">Material</th>
                          <th className="text-right font-semibold">Levererat</th>
                          <th className="text-right font-semibold">Förbrukat</th>
                          <th className="text-right font-semibold">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.rows.map((r) => (
                          <tr key={r.material} className="border-t border-[#eef3eb]">
                            <td className="py-1 font-semibold text-slate-700">{r.material}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.delivered}</td>
                            <td className="py-1 text-right tabular-nums text-slate-500">{r.consumed}</td>
                            <td className={cn('py-1 text-right font-bold tabular-nums', balanceClass(r.balance))}>{r.balance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
              <p className="text-[10.5px] text-slate-400">
                Förbrukning fylls i automatiskt när installatörernas säckrapportering är på plats.
              </p>
            </div>
          )}
        </div>
      )}
    </CrmModal>
  );
}
