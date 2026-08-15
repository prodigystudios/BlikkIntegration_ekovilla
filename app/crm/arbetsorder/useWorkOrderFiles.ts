"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useToast } from '@/lib/Toast';
import { prepareFileForUpload } from '@/lib/shared/imageCompression';
import type { WorkOrderFileCategory, WorkOrderFileView } from '@/lib/domains/crm/workOrderFiles/types';

// Filer på en arbetsorder — hämtning, uppladdning och radering. Delas av kontorsvyn (/crm) och
// fältvyn (/arbetsorder) så skrivlogiken bor på ett ställe, precis som useWorkOrderActivity.
//
// Uppladdningen går i tre steg och byten passerar ALDRIG en route handler:
//   1. be servern om en signerad uppladdningslänk (den gatar skrivrätten),
//   2. ladda upp direkt till lagringen,
//   3. bekräfta, varpå servern läser filens faktiska storlek/typ och skapar raden.
// Skälet är ritningarna: en PDF på 20 MB är vanlig och ska inte behöva rymmas i en request-kropp.
//
// Som överallt annars i modulen: alla toasts ligger HÄR, aldrig i flikkomponenten, och varje
// mutation returnerar en boolean så anroparen kan nollställa sitt eget formulär vid framgång.
export function useWorkOrderFiles(workOrderId: string) {
  const toast = useToast();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [files, setFiles] = useState<WorkOrderFileView[]>([]);
  const [loading, setLoading] = useState(true);
  const [canUpload, setCanUpload] = useState(false);
  const [canMarkInternal, setCanMarkInternal] = useState(false);
  const [canDeleteAny, setCanDeleteAny] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/work-orders/${workOrderId}/files`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) return null;
    return json.data as {
      items: WorkOrderFileView[];
      can_upload: boolean;
      can_mark_internal: boolean;
      can_delete_any: boolean;
    };
  }, [workOrderId]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const apply = (data: Awaited<ReturnType<typeof load>>) => {
      if (!active || !data) return;
      setFiles(data.items || []);
      setCanUpload(!!data.can_upload);
      setCanMarkInternal(!!data.can_mark_internal);
      setCanDeleteAny(!!data.can_delete_any);
    };

    load().then(apply).catch(() => { /* non-fatal */ }).finally(() => { if (active) setLoading(false); });

    // Miniatyrernas URL:er är signerade i 30 minuter (SIGNED_URL_TTL_SECONDS). En arbetsorder ligger
    // ofta uppe längre än så — kontoret har den öppen halva förmiddagen — och utan omhämtning möts
    // man då av en flik full av trasiga bilder utan något sätt att få tillbaka dem.
    // Hämtas om var 25:e minut, med marginal före utgången.
    const interval = setInterval(() => { load().then(apply).catch(() => { /* non-fatal */ }); }, 25 * 60 * 1000);

    // Fliken kan ha legat i bakgrunden längre än så (en telefon som sovit över natten). Timers
    // stryps eller pausas då, så vi hämtar också om när användaren kommer tillbaka till fliken.
    const onVisible = () => { if (document.visibilityState === 'visible') load().then(apply).catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // En fil hela vägen genom de tre stegen. Kastar vid fel så anroparen kan räkna misslyckanden
  // per fil utan att en trasig fil stoppar de övriga.
  async function uploadOne(file: File, meta: { category: WorkOrderFileCategory; isInternal: boolean }) {
    const prepared = await prepareFileForUpload(file);

    const urlRes = await fetch(`/api/crm/work-orders/${workOrderId}/files/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: prepared.fileName,
        content_type: prepared.contentType,
        size_bytes: prepared.blob.size,
      }),
    });
    const urlJson = await urlRes.json().catch(() => ({}));
    if (!urlRes.ok || !urlJson.ok) throw new Error(urlJson?.error || 'Kunde inte förbereda uppladdningen');

    const { bucket, path, token } = urlJson.data as { bucket: string; path: string; token: string };

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(path, token, prepared.blob);
    if (uploadError) throw new Error(uploadError.message || 'Uppladdningen misslyckades');

    // Bekräftelsen. Servern litar inte på något härifrån utom sökvägen (som den kontrollerar mot
    // ordern) — storlek och mimetype läser den ur lagringen.
    const confirmRes = await fetch(`/api/crm/work-orders/${workOrderId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storage_path: path,
        file_name: prepared.fileName,
        category: meta.category,
        is_internal: meta.isInternal,
      }),
    });
    const confirmJson = await confirmRes.json().catch(() => ({}));
    if (!confirmRes.ok || !confirmJson.ok) throw new Error(confirmJson?.error || 'Kunde inte spara filen');

    return confirmJson.data?.item as WorkOrderFileView;
  }

  async function uploadFiles(
    selected: File[],
    meta: { category: WorkOrderFileCategory; isInternal: boolean },
  ): Promise<boolean> {
    if (selected.length === 0) return false;

    const total = selected.length;
    let completed = 0;
    const uploaded: WorkOrderFileView[] = [];
    const failures: string[] = [];
    setUploadProgress({ current: 0, total });

    // Concurrency 3, som dokumentbiblioteket. Fel samlas in per fil i stället för att kasta —
    // att nio av tio bilder kom fram är ett bättre utfall än att allt rullas tillbaka.
    const queue = [...selected];
    const workers = Array.from({ length: Math.min(3, total) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          uploaded.push(await uploadOne(next, meta));
        } catch (e: any) {
          failures.push(next.name);
          if (failures.length === 1 && e?.message) toast.error(e.message);
        } finally {
          completed += 1;
          setUploadProgress({ current: completed, total });
        }
      }
    });
    await Promise.all(workers);
    setUploadProgress(null);

    if (uploaded.length > 0) {
      setFiles((current) => [...uploaded, ...current]);
      toast.success(uploaded.length === 1 ? 'Filen uppladdad' : `${uploaded.length} filer uppladdade`);
    }
    if (failures.length > 0 && uploaded.length > 0) {
      toast.error(`Kunde inte ladda upp: ${failures.join(', ')}`);
    }
    return failures.length === 0;
  }

  async function deleteFile(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/files/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort filen'); return false; }
      setFiles((current) => current.filter((file) => file.id !== id));
      toast.success('Filen borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort filen'); return false; }
  }

  return { files, loading, canUpload, canMarkInternal, canDeleteAny, uploadProgress, uploadFiles, deleteFile };
}
