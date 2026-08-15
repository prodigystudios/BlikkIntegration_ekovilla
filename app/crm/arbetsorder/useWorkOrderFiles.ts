"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// `enabled: false` hoppar över hämtningen helt — samma mönster som `includeTimeEntries` i
// useWorkOrderActivity, och av samma skäl: en lista som ingenting renderar kostar en extra
// rundtur på en telefon i fält varje gång ett jobb öppnas, och listsvaret signerar dessutom en URL
// per bild på servern. Så fort fliken öppnats en gång stannar hämtningen på (fliken ska vara
// omedelbar när man växlar tillbaka).
export function useWorkOrderFiles(workOrderId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const toast = useToast();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [files, setFiles] = useState<WorkOrderFileView[]>([]);
  const [loading, setLoading] = useState(true);
  const [canUpload, setCanUpload] = useState(false);
  const [canMarkInternal, setCanMarkInternal] = useState(false);
  const [canDeleteAny, setCanDeleteAny] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const [activated, setActivated] = useState(enabled);
  useEffect(() => { if (enabled) setActivated(true); }, [enabled]);

  // ⚠️ SEKVENSNUMMER, inte bara en `active`-vakt.
  //
  // Listan hämtas om i bakgrunden (intervall + visibilitychange), och OS:ets filväljare utlöser
  // FAKTISKT visibilitychange när man kommer tillbaka från den. Utan det här numret ser flödet ut
  // så här: användaren väljer filer → vi startar en GET → uppladdningen blir klar och lägger till
  // raden lokalt → den gamla GET:en landar och skriver över med en lista utan den nyss uppladdade
  // filen. Användaren ser en grön toast och en fil som försvann.
  //
  // Varje lokal ändring (uppladdning, radering) räknar också upp numret, så ett svar som hunnits
  // om av en mutation kasseras — inte bara ett som hunnits om av en nyare GET.
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`/api/crm/work-orders/${workOrderId}/files`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) return;
      if (seq !== requestSeq.current) return; // omsprungen — kasta svaret
      const data = json.data as {
        items: WorkOrderFileView[];
        can_upload: boolean;
        can_mark_internal: boolean;
        can_delete_any: boolean;
      };
      setFiles(data.items || []);
      setCanUpload(!!data.can_upload);
      setCanMarkInternal(!!data.can_mark_internal);
      setCanDeleteAny(!!data.can_delete_any);
    } catch {
      /* non-fatal */
    }
  }, [workOrderId]);

  useEffect(() => {
    if (!activated) return;
    let active = true;
    setLoading(true);

    refresh().finally(() => { if (active) setLoading(false); });

    // Miniatyrernas URL:er är signerade i 30 minuter (SIGNED_URL_TTL_SECONDS). En arbetsorder ligger
    // ofta uppe längre än så — kontoret har den öppen halva förmiddagen — och utan omhämtning möts
    // man då av en flik full av trasiga bilder utan något sätt att få tillbaka dem.
    // Hämtas om var 25:e minut, med marginal före utgången.
    const interval = setInterval(() => { refresh(); }, 25 * 60 * 1000);

    // Fliken kan ha legat i bakgrunden längre än så (en telefon som sovit över natten). Timers
    // stryps eller pausas då, så vi hämtar också om när användaren kommer tillbaka till fliken.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, activated]);

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
      // Ogiltigförklara varje GET som är i luften — annars kan filväljarens visibilitychange-hämtning
      // landa efter det här och radera de nyss uppladdade raderna ur listan.
      requestSeq.current += 1;
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
      // Samma skäl som vid uppladdning: en GET i luften får inte återuppliva den raderade raden.
      requestSeq.current += 1;
      setFiles((current) => current.filter((file) => file.id !== id));
      toast.success('Filen borttagen');
      return true;
    } catch { toast.error('Kunde inte ta bort filen'); return false; }
  }

  return { files, loading, canUpload, canMarkInternal, canDeleteAny, uploadProgress, uploadFiles, deleteFile };
}
