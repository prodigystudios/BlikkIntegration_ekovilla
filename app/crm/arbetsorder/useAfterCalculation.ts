"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AfterCalculation } from '@/lib/domains/crm/afterCalculation';

// Efterkalkylen för en arbetsorder — hämtning.
//
// Egen rutt, inte ett fält på arbetsordern: kostnadsdata får aldrig ligga i den nyttolast fältvyn
// läser. Se app/api/crm/work-orders/[id]/after-calculation/route.ts för hela skälet.
//
// ⚠️ 403 ÄR INTE ETT FEL HÄR. Rutten gatar på crm.report.read, och den som saknar nyckeln ska se
// blocket försvinna — inte en röd ruta som ser ut som ett driftfel. `forbidden` skiljs därför från
// `loadError`.
//
// ⚠️ Ett misslyckat anrop får ALDRIG se ut som ett jobb utan utfall. Utan `loadError` hade blocket
// renderat "ingen rapport har kommit in" — ett påstående om JOBBET — när sanningen är att vi inte
// vet. Samma förväxling som "Ej rapporterat" kontra "0 st".

export function useAfterCalculation(workOrderId: string) {
  const [result, setResult] = useState<AfterCalculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // Svaren kommer inte nödvändigtvis i frågornas ordning: kortet hämtar om efter varje sparad
  // artikelrad, och landar en tidigare hämtning sist skriver den tillbaka gamla tal.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    const isLatest = () => seq === seqRef.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/after-calculation`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!isLatest()) return;
      if (res.status === 403) {
        setForbidden(true);
        setLoadError(false);
        return;
      }
      if (!res.ok || !json.ok) {
        setLoadError(true);
        return;
      }
      setResult(json.data as AfterCalculation);
      setLoadError(false);
    } catch {
      if (isLatest()) setLoadError(true);
    } finally {
      // Ovillkorligt: `loading` går bara från true till false, och första hämtningen ska släppa
      // skelettet även om en nyare hunnit förbi den.
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { result, loading, loadError, forbidden, refresh };
}
