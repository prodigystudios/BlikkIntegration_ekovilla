"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { ADMIN_CARD, ADMIN_EMPTY_BOX, ADMIN_ERROR_BOX, ADMIN_INSET, ADMIN_LABEL, ADMIN_NOTICE_BOX } from '../components/adminUi';
import AdminPromptDialog from '../components/AdminPromptDialog';
import { normalizeBlocks, type Block } from '@/lib/domains/info-page/blocks';
import { resolveUploadKind } from '@/lib/domains/info-page/storage';
import type { InfoGroup, InfoSection } from '@/lib/domains/info-page/queries';
import BlockContent from '@/app/dokument-information/BlockContent';
import { blocksToFragment, editorToBlocks } from './richText';

// Redigeraren för /dokument-information.
//
// ⚠️ crm.formButton BÄR INGEN BAKGRUND. Den sätter text-white och förutsätter att anroparen
// parar ihop den med style={{ backgroundColor: 'var(--ek-green)' }} — se
// AdminNews.tsx. Utan den blir knappen vit text på vitt kort: den finns, den går att klicka,
// men den syns inte. Det var precis så de här fyra skapa-knapparna såg ut i första versionen,
// och symptomet var "man kan bara redigera, inte lägga till".
//
// ⚠️ INGEN window.prompt / window.confirm HÄR. Allt som skapar något gick först via dem, och
// det gjorde skapa-knapparna tyst döda: en webbläsare får undertrycka dialogrutor (Chrome har
// kryssrutan "hindra sidan från att skapa fler dialogrutor"), och då returnerar prompt() null
// utan att visa något. Resultatet var en yta där redigera fungerade men lägga till inte gjorde
// det, utan ett enda felmeddelande någonstans. AdminPromptDialog är appens egen dialog och kan
// inte tystas av webbläsaren.
//
// Förhandsvisningen renderar med SAMMA komponent som den publika sidan och samma
// normalizeBlocks emellan. Det som visas är inte en approximation av resultatet, det ÄR
// resultatet — en egen förhandsvisningsrenderare hade drivit isär vid första ändringen.

type Status = { kind: 'error' | 'notice'; text: string } | null;

type DialogSpec = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Sätt (även till '') för ett fält i dialogen; utelämna för en ren bekräftelse. */
  defaultValue?: string;
  inputLabel?: string;
  placeholder?: string;
  okText?: string;
  run: (value: string) => Promise<void>;
};

async function callApi(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Anropet misslyckades (${res.status})`);
  return json.data;
}

export default function AdminInfoSections() {
  const [groups, setGroups] = useState<InfoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  // Två PATCH:ar i följd; ett andra klick under tiden hade räknat på ordningen före reload.
  const [reordering, setReordering] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  // Vilket val rutan senast fylldes för. Utan den skrev varje reload() över det som just
  // skrivits: effekten nedan måste lyssna på `groups` för att alls hinna köra efter att rutan
  // monterats, men den ska bara FYLLA när valet faktiskt bytts.
  const filledFor = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Markeringen i rutan försvinner när dialogen tar fokus, så den läggs undan innan den öppnas
  // och läggs tillbaka precis före createLink.
  const savedRange = useRef<Range | null>(null);

  const allSections = groups.flatMap((g) => g.sections);
  const selected = allSections.find((s) => s.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi('/api/admin/info');
      setGroups((data?.groups ?? []) as InfoGroup[]);
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.message || 'Kunde inte hämta innehållet.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Fyller rutan när en annan flik väljs. Rutan är avsiktligt OKONTROLLERAD: skulle React
  // rendera om dess innehåll vid varje tangenttryck skulle markören hoppa till slutet.
  //
  // `groups` MÅSTE ligga i deps — rutan renderas först när något är valt, så vid första valet
  // finns ingen ref att fylla förrän nästa rendering. Men en oskyddad effekt hade då fyllt om
  // rutan vid varje reload() (filuppladdning, omordning, ny flik) och tyst ätit upp det som
  // just skrivits. Vakten gör allt utom ett faktiskt byte till en no-op.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || filledFor.current === selectedId) return;
    const section = groups.flatMap((g) => g.sections).find((s) => s.id === selectedId) ?? null;
    filledFor.current = selectedId;
    setTitle(section?.title ?? '');
    setBlocks(section?.body ?? []);
    el.replaceChildren(blocksToFragment(section?.body ?? [], document));
  }, [selectedId, groups]);

  // Läser rutan här och nu. Sparningen använder den här och inte `blocks`, så en fördröjd
  // synk aldrig kan göra att det sista tecknet uteblir ur det som sparas.
  const readEditor = useCallback((): Block[] => {
    const el = editorRef.current;
    return el ? normalizeBlocks(editorToBlocks(el)) : [];
  }, []);

  const syncFromEditor = useCallback(() => {
    if (editorRef.current) setBlocks(readEditor());
  }, [readEditor]);

  // Fördröjd med flit: varje tecken hade annars vandrat hela DOM-trädet, byggt om hela
  // blockmodellen och renderat om förhandsvisningen. Det enda som läser `blocks` är
  // förhandsvisningen, och den behöver inte hänga med per tangenttryck.
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(syncFromEditor, 200);
  }, [syncFromEditor]);

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

  // execCommand är utfasat men är fortfarande det enda som fungerar i alla webbläsare utan en
  // editor-motor. Det som lämnar rutan whitelistas ändå av normalizeBlocks, så vad kommandot
  // råkar producera för markup spelar ingen roll för vad som sparas.
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* ignorera */
    }
    syncFromEditor();
  };

  const runTask = async (fn: () => Promise<void>, okText?: string) => {
    setStatus(null);
    try {
      await fn();
      if (okText) setStatus({ kind: 'notice', text: okText });
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.message || 'Något gick fel.' });
    }
  };

  const openLinkDialog = () => {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed || !editorRef.current?.contains(range.commonAncestorContainer)) {
      setStatus({ kind: 'error', text: 'Markera först texten i rutan som ska bli en länk.' });
      return;
    }
    savedRange.current = range.cloneRange();
    setDialog({
      title: 'Lägg till länk',
      message: 'Ett telefonnummer eller en e-postadress räcker — den blir klickbar av sig själv.',
      confirmLabel: 'Lägg till',
      defaultValue: '',
      inputLabel: 'Adress, telefonnummer eller e-post',
      placeholder: 'ekovilla.se eller 08-410 637 00',
      run: async (value) => {
        const el = editorRef.current;
        const stored = savedRange.current;
        if (!el || !stored) return;
        el.focus();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(stored);
        // Adressen normaliseras inte här utan i blockmodellen, så det spelar ingen roll att
        // createLink lägger in den råa texten som href.
        exec('createLink', value);
      },
    });
  };

  const addGroup = () => setDialog({
    title: 'Nytt avsnitt',
    message: 'Avsnittet är den grå rubriken på sidan. Flikarna läggs till under den.',
    confirmLabel: 'Lägg till',
    defaultValue: '',
    inputLabel: 'Namn på avsnittet',
    placeholder: 't.ex. Arbetsmiljö',
    okText: 'Avsnittet skapades.',
    run: async (name) => {
      await callApi('/api/admin/info/groups', { method: 'POST', body: JSON.stringify({ title: name }) });
      await reload();
    },
  });

  const renameGroup = (group: InfoGroup) => setDialog({
    title: 'Byt namn på avsnittet',
    confirmLabel: 'Spara',
    defaultValue: group.title,
    inputLabel: 'Namn på avsnittet',
    okText: 'Namnet sparades.',
    run: async (name) => {
      if (name === group.title) return;
      await callApi(`/api/admin/info/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ title: name }) });
      await reload();
    },
  });

  const deleteGroup = (group: InfoGroup) => setDialog({
    title: `Ta bort "${group.title}"?`,
    message: group.sections.length > 0
      ? `Avsnittet och dess ${group.sections.length} flik${group.sections.length === 1 ? '' : 'ar'} tas bort. Det går inte att ångra.`
      : 'Avsnittet tas bort. Det går inte att ångra.',
    confirmLabel: 'Ta bort',
    danger: true,
    okText: 'Avsnittet togs bort.',
    run: async () => {
      await callApi(`/api/admin/info/groups/${group.id}`, { method: 'DELETE' });
      setSelectedId(null);
      await reload();
    },
  });

  const addSection = (group: InfoGroup) => setDialog({
    title: 'Ny flik',
    message: `Fliken hamnar under "${group.title}".`,
    confirmLabel: 'Lägg till',
    defaultValue: '',
    inputLabel: 'Rubrik på fliken',
    placeholder: 't.ex. Skyddsutrustning',
    okText: 'Fliken skapades.',
    run: async (name) => {
      const data = await callApi('/api/admin/info/sections', {
        method: 'POST',
        body: JSON.stringify({ groupId: group.id, title: name, body: [] }),
      });
      await reload();
      // Väljs direkt så man kan börja skriva i den utan ett extra klick.
      setSelectedId(data?.section?.id ?? null);
    },
  });

  const deleteSection = (section: InfoSection) => setDialog({
    title: `Ta bort "${section.title}"?`,
    message: 'Fliken och dess filer tas bort. Det går inte att ångra.',
    confirmLabel: 'Ta bort',
    danger: true,
    okText: 'Fliken togs bort.',
    run: async () => {
      await callApi(`/api/admin/info/sections/${section.id}`, { method: 'DELETE' });
      setSelectedId(null);
      await reload();
    },
  });

  const deleteFile = (imageId: string, label: string) => setDialog({
    title: `Ta bort filen "${label}"?`,
    confirmLabel: 'Ta bort',
    danger: true,
    okText: 'Filen togs bort.',
    run: async () => {
      await callApi(`/api/admin/info/images/${imageId}`, { method: 'DELETE' });
      await reload();
    },
  });

  // Byter plats på två grannars LAGRADE sort_order.
  //
  // 🧨 Första versionen skrev radens index i listan. Index är samma sak som lagrad ordning bara
  // så länge värdena råkar vara 0..n-1, och det slutar de vara så fort något raderats — då
  // flyttade ett klick på pilen en helt annan rad. Därför bär läsvägen numera med sortOrder.
  //
  // Skulle två rader redan ha samma nummer (en tidigare halvfallen omordning) byter ett byte
  // ingenting, så då särskiljs de på index i stället.
  const swapOrder = async (url: string, aId: string, aOrder: number, bId: string, bOrder: number, aIdx: number, bIdx: number) => {
    const [next, prev] = aOrder === bOrder ? [bIdx, aIdx] : [bOrder, aOrder];
    await callApi(`${url}/${aId}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: next }) });
    await callApi(`${url}/${bId}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: prev }) });
    await reload();
  };

  const moveGroup = (index: number, delta: number) => runTask(async () => {
    const from = groups[index];
    const target = groups[index + delta];
    if (!from || !target) return;
    setReordering(true);
    try {
      await swapOrder('/api/admin/info/groups', from.id, from.sortOrder, target.id, target.sortOrder, index, index + delta);
    } finally {
      setReordering(false);
    }
  });

  const moveSection = (group: InfoGroup, index: number, delta: number) => runTask(async () => {
    const from = group.sections[index];
    const target = group.sections[index + delta];
    if (!from || !target) return;
    setReordering(true);
    try {
      await swapOrder('/api/admin/info/sections', from.id, from.sortOrder, target.id, target.sortOrder, index, index + delta);
    } finally {
      setReordering(false);
    }
  });

  const saveSection = () => runTask(async () => {
    // Kastar i stället för att returnera tyst: runTask sätter annars sin gröna notis på en
    // sparning som aldrig lämnade webbläsaren.
    if (!selected) throw new Error('Ingen flik är vald.');
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Rubriken kan inte vara tom.');
    setSaving(true);
    try {
      await callApi(`/api/admin/info/sections/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: trimmed, body: readEditor() }),
      });
      await reload();
    } finally {
      setSaving(false);
    }
  }, 'Sparat.');

  const uploadFile = (file: File) => runTask(async () => {
    if (!selected) throw new Error('Ingen flik är vald.');
    // Servern gatar samma sak på båda stegen — den här kontrollen finns för svarstiden: en
    // avvisad fil ska säga varför direkt, inte efter en tur till API:et. accept-attributet
    // nedan räcker inte, filväljaren kan ställas om till "alla filer".
    if (resolveUploadKind(file.type, file.name) === 'other') {
      throw new Error('Bara bilder och PDF-filer kan läggas till här.');
    }
    setUploading(true);
    try {
      // Två steg: servern reserverar sökvägen och signerar, klienten lägger filen direkt i
      // storage, och först därefter registreras raden. Filen går aldrig genom rutthanteraren.
      const signed = await callApi(`/api/admin/info/sections/${selected.id}/images/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type || undefined }),
      });

      const supabase = createClientComponentClient();
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
      if (error) throw new Error(error.message);

      // Samma contentType som objektet lades upp med. Sparas på raden så läsvägen slipper
      // gissa på filändelsen när den väljer mellan <img> och den inbäddade PDF-visaren.
      await callApi(`/api/admin/info/sections/${selected.id}/images`, {
        method: 'POST',
        body: JSON.stringify({
          bucket: signed.bucket,
          path: signed.path,
          fileName: file.name,
          contentType: file.type || null,
        }),
      });
      await reload();
    } finally {
      setUploading(false);
    }
  }, 'Filen laddades upp.');

  return (
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Dokument &amp; information</h2>
        <p className="m-0 text-sm text-slate-600">
          Avsnitt och flikar på sidan <span className="font-semibold">Dokument &amp; information</span>. Ändringar syns direkt för alla.
        </p>
      </div>

      {status?.kind === 'error' && <div className={ADMIN_ERROR_BOX}>{status.text}</div>}
      {status?.kind === 'notice' && <div className={ADMIN_NOTICE_BOX}>{status.text}</div>}

      <section className="grid items-start gap-4 xl:[grid-template-columns:minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        {/* Trädet */}
        <div className={cn(ADMIN_CARD, 'grid gap-3 p-4')}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-base font-bold text-slate-900">Innehåll</h3>
            <button type="button" onClick={addGroup} className={crm.formButton} style={{ backgroundColor: 'var(--ek-green)' }}>Nytt avsnitt</button>
          </div>

          {loading && <p className="m-0 text-sm text-slate-500">Hämtar…</p>}

          {!loading && groups.length === 0 && (
            <div className={cn(ADMIN_EMPTY_BOX, 'grid gap-3')}>
              <p className="m-0 text-sm text-slate-500">Inga avsnitt ännu.</p>
              <button type="button" onClick={addGroup} className={cn(crm.formButton, 'justify-self-center')} style={{ backgroundColor: 'var(--ek-green)' }}>Skapa det första avsnittet</button>
            </div>
          )}

          {groups.map((group, groupIndex) => (
            <div key={group.id} className={cn(ADMIN_INSET, 'grid gap-2 p-3')}>
              <div className="flex items-center justify-between gap-2">
                <span className={ADMIN_LABEL}>{group.title}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => moveGroup(groupIndex, -1)} disabled={reordering || groupIndex === 0} aria-label={`Flytta ${group.title} upp`} className={cn(crm.ghostButton, 'px-2 disabled:opacity-40')}>↑</button>
                  <button type="button" onClick={() => moveGroup(groupIndex, 1)} disabled={reordering || groupIndex === groups.length - 1} aria-label={`Flytta ${group.title} ner`} className={cn(crm.ghostButton, 'px-2 disabled:opacity-40')}>↓</button>
                  <button type="button" onClick={() => renameGroup(group)} className={cn(crm.ghostButton, 'px-2')}>Byt namn</button>
                  <button type="button" onClick={() => deleteGroup(group)} className={cn(crm.dangerButton, 'px-2')}>Ta bort</button>
                </div>
              </div>

              {group.sections.length === 0 && (
                <p className="m-0 text-[13px] text-slate-500">Inga flikar ännu.</p>
              )}

              <ul role="list" className="m-0 grid list-none gap-1 p-0">
                {group.sections.map((section, sectionIndex) => (
                  <li key={section.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedId(section.id)}
                      className={cn(
                        'min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        section.id === selectedId ? 'bg-emerald-700 font-semibold text-white' : 'text-slate-700 hover:bg-white',
                      )}
                    >
                      {section.title}
                      {section.images.length > 0 && (
                        <span className={cn('ml-2 text-[11px]', section.id === selectedId ? 'text-emerald-100' : 'text-slate-400')}>
                          {section.images.length} fil{section.images.length === 1 ? '' : 'er'}
                        </span>
                      )}
                    </button>
                    <button type="button" onClick={() => moveSection(group, sectionIndex, -1)} disabled={reordering || sectionIndex === 0} aria-label={`Flytta ${section.title} upp`} className={cn(crm.ghostButton, 'px-2 disabled:opacity-40')}>↑</button>
                    <button type="button" onClick={() => moveSection(group, sectionIndex, 1)} disabled={reordering || sectionIndex === group.sections.length - 1} aria-label={`Flytta ${section.title} ner`} className={cn(crm.ghostButton, 'px-2 disabled:opacity-40')}>↓</button>
                  </li>
                ))}
              </ul>

              <button type="button" onClick={() => addSection(group)} className={cn(crm.formButton, 'justify-self-start')} style={{ backgroundColor: 'var(--ek-green)' }}>Ny flik</button>
            </div>
          ))}
        </div>

        {/* Redigeraren */}
        <div className={cn(ADMIN_CARD, 'grid gap-3 p-4')}>
          {!selected && (
            <div className={cn(ADMIN_EMPTY_BOX, 'text-sm text-slate-500')}>
              Välj en flik till vänster för att redigera den, eller skapa en ny.
            </div>
          )}

          {selected && (
            <>
              <label className="grid gap-1.5">
                <span className={ADMIN_LABEL}>Rubrik</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl border border-[#d5e0cf] px-3 py-2 text-sm" />
              </label>

              <div className="grid gap-1.5">
                <span className={ADMIN_LABEL}>Text</span>
                {/* onMouseDown-preventDefault på varje knapp: annars tappar rutan markeringen
                    i samma ögonblick knappen tar fokus, och kommandot får inget att verka på. */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-t-xl border border-b-0 border-[#d5e0cf] bg-[#f9fbf7] px-2 py-1.5">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} className={cn(crm.ghostButton, 'px-2.5 font-bold')}>F</button>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} className={cn(crm.ghostButton, 'px-2.5')}>Punktlista</button>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} className={cn(crm.ghostButton, 'px-2.5')}>Numrerad</button>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={openLinkDialog} className={cn(crm.ghostButton, 'px-2.5')}>Länk</button>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} className={cn(crm.ghostButton, 'px-2.5')}>Rensa format</button>
                </div>
                {/* Utan children i JSX med flit: React får aldrig röra innehållet, se effekten ovan. */}
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Brödtext"
                  onInput={scheduleSync}
                  onBlur={syncFromEditor}
                  className="min-h-[200px] rounded-b-xl border border-[#d5e0cf] bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-emerald-500 [&_a]:text-emerald-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                />
              </div>

              <div className="grid gap-2">
                <span className={ADMIN_LABEL}>Bilder och PDF:er</span>
                {selected.images.length === 0 && <p className="m-0 text-[13px] text-slate-500">Inga filer i den här fliken.</p>}
                {selected.images.map((file) => (
                  <div key={file.id} className={cn(ADMIN_INSET, 'flex items-center gap-3 p-2')}>
                    {/* En pdf i en <img> blir en trasig bildikon — därför en egen ruta i stället
                        för en miniatyr. Rutan säger dessutom vad raden är, vilket miniatyren
                        aldrig gjorde. */}
                    {file.kind === 'pdf'
                      ? <div className="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-[#e3e9df] bg-white text-[11px] font-bold text-rose-700">PDF</div>
                      : file.url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={file.url} alt="" className="h-12 w-16 shrink-0 rounded-md border border-[#e3e9df] object-cover" />
                        : <div className="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-dashed border-amber-300 bg-amber-50 text-[10px] text-amber-800">saknas</div>}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{file.caption?.trim() || file.fileName}</span>
                    <button type="button" onClick={() => deleteFile(file.id, file.caption?.trim() || file.fileName)} className={cn(crm.dangerButton, 'shrink-0 px-2')}>Ta bort</button>
                  </div>
                ))}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Nollställs direkt så samma fil går att välja igen efter ett misslyckat försök.
                    e.target.value = '';
                    if (file) uploadFile(file);
                  }}
                />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={cn(crm.formButton, 'justify-self-start')} style={{ backgroundColor: 'var(--ek-green)' }}>
                  {uploading ? 'Laddar upp…' : 'Ladda upp bild eller PDF'}
                </button>
                <p className="m-0 text-[12px] text-slate-500">
                  PDF:er visas inbäddade på sidan, så installatörerna kan läsa dem direkt utan att lämna appen.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[#e0e8dc] pt-3">
                <button type="button" onClick={saveSection} disabled={saving || !title.trim()} className={crm.saveButton}>
                  {saving ? 'Sparar…' : 'Spara'}
                </button>
                <button type="button" onClick={() => deleteSection(selected)} className={crm.dangerButton}>Ta bort fliken</button>
              </div>

              <div className="grid gap-2 border-t border-[#e0e8dc] pt-3">
                <span className={ADMIN_LABEL}>Så här ser den ut</span>
                <div className={cn(crm.card, 'px-3.5 py-3')}>
                  <p className="m-0 mb-2 text-sm font-bold tracking-tight text-slate-900">{title.trim() || 'Utan rubrik'}</p>
                  <BlockContent blocks={blocks} />
                  {blocks.length === 0 && selected.images.length === 0 && (
                    <p className="m-0 text-[13px] text-slate-400">Tom flik.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {dialog && (
        <AdminPromptDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          defaultValue={dialog.defaultValue}
          inputLabel={dialog.inputLabel}
          placeholder={dialog.placeholder}
          busy={dialogBusy}
          onClose={() => { if (!dialogBusy) setDialog(null); }}
          onConfirm={async (value) => {
            setDialogBusy(true);
            setStatus(null);
            try {
              await dialog.run(value);
              if (dialog.okText) setStatus({ kind: 'notice', text: dialog.okText });
              setDialog(null);
            } catch (e: any) {
              // Dialogen stängs även vid fel: felrutan ligger bakom den, och en dialog som
              // står kvar över ett osynligt felmeddelande läser som att inget hände.
              setStatus({ kind: 'error', text: e?.message || 'Något gick fel.' });
              setDialog(null);
            } finally {
              setDialogBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
