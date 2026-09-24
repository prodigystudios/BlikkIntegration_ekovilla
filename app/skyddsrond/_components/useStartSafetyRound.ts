"use client";

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/Toast';

// Starta en skyddsrond på en arbetsorder och öppna den. Delas av listan på /skyddsrond och kortet
// på arbetsordern (kontorsvyn och fältvyn), så att starten svarar likadant överallt.
export function useStartSafetyRound() {
  const router = useRouter();
  const toast = useToast();
  const [startingFor, setStartingFor] = useState<string | null>(null);

  const start = useCallback(
    async (workOrderId: string) => {
      setStartingFor(workOrderId);
      try {
        const res = await fetch('/api/safety-rounds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_order_id: workOrderId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok || !json.data?.id) {
          toast.error(json?.error || 'Kunde inte starta skyddsronden');
          return false;
        }
        router.push(`/skyddsrond/${json.data.id}`);
        return true;
      } catch {
        toast.error('Kunde inte starta skyddsronden. Kontrollera uppkopplingen.');
        return false;
      } finally {
        setStartingFor(null);
      }
    },
    [router, toast],
  );

  return { start, startingFor };
}
