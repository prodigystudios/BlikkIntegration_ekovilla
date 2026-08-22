"use client";

import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { usePushSubscription } from './usePushSubscription';

// Diskret uppmaning om att slå på notiser på den här enheten.
//
// Varför den finns: appen bor numera på app.ekovilla.se, och notistillstånd är origin-scopat. Den
// som slog på notiser på den gamla adressen står som obeslutad här och kan inte flyttas över,
// eftersom requestPermission() kräver en användargest. Enda vägen är ett synligt val.
//
// Texten nämner MEDVETET inte domänbytet. Villkoret som visar rutan är "ingen prenumeration och
// obesvarat tillstånd", vilket också gäller en nyanställd som aldrig haft notiser någonstans — för
// hen vore en migreringsförklaring obegriplig. Formuleringen ska vara sann för båda.
//
// Renderar ingenting alls när den inte behövs (avfärdad, redan på, blockerad, eller enhet utan
// stöd), så anroparen kan montera den villkorslöst.
export default function PushReactivationNotice({ className }: { className?: string }) {
  const push = usePushSubscription();

  if (!push.supported || !push.needsReactivation) return null;

  return (
    <div className={cn(crm.cardInner, 'flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <p className={cn('m-0', crm.fieldValue, 'font-semibold')}>Notiser på den här enheten</p>
        <p className={cn('m-0 mt-0.5', crm.pageSubtitle)}>
          Få påminnelser och notiser direkt hit. Inställningen gäller per enhet och webbläsare.
        </p>
        {push.error && <p className="m-0 mt-1.5 text-[11px] text-red-600">{push.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={push.dismissReactivation} className={crm.ghostButton}>
          Inte nu
        </button>
        <button
          type="button"
          onClick={() => void push.enable()}
          disabled={push.loading}
          className={crm.formButton}
          // crm.formButton bär ingen egen bakgrund — utan den här blir knappen vit på vitt.
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          {push.loading ? 'Aktiverar…' : 'Slå på notiser'}
        </button>
      </div>
    </div>
  );
}
