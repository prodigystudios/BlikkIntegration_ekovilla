"use client";

import { cn } from '@/lib/shared/cn';
import { usePushSubscription } from './usePushSubscription';

// Diskret uppmaning om att slå på notiser på den här adressen.
//
// Varför den finns: appen bor numera på app.ekovilla.se. Notistillstånd är origin-scopat, så den
// som slog på notiser på den gamla adressen står som obeslutad här — och kan inte flyttas över,
// eftersom requestPermission() kräver en användargest. Enda vägen är ett synligt val.
//
// Tonen är medvetet neutral. Ingenting är trasigt: notiser är en ny inställning på en ny adress,
// och texten ska inte antyda ett fel som användaren behöver oroa sig för.
//
// Renderar ingenting alls när den inte behövs (avfärdad, redan på, blockerad, eller enhet utan
// stöd), så anroparen kan montera den villkorslöst.
export default function PushReactivationNotice({ className }: { className?: string }) {
  const push = usePushSubscription();

  if (!push.supported || !push.needsReactivation) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] px-3.5 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-semibold text-slate-900">Notiser på den här adressen</p>
        <p className="m-0 mt-0.5 text-[12px] text-slate-500">
          Notisinställningen följer adressen appen körs på. Slå på den här för att få påminnelser och
          notiser till den här enheten.
        </p>
        {push.error && <p className="m-0 mt-1.5 text-[11px] text-red-600">{push.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={push.dismissReactivation}
          className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-500 transition hover:text-slate-700"
        >
          Inte nu
        </button>
        <button
          type="button"
          onClick={() => void push.enable()}
          disabled={push.loading}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          {push.loading ? 'Aktiverar…' : 'Slå på notiser'}
        </button>
      </div>
    </div>
  );
}
