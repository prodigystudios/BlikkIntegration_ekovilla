"use client";

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import CrmModal from '@/app/crm/components/CrmModal';
import EntityCombobox, { type EntityResult } from '@/app/crm/components/EntityCombobox';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { quoteLabel } from '@/app/crm/lib/quoteDisplay';
import {
  buildTaskSubmitPayload,
  draftForNewTask,
  draftFromTask,
  relatedTypeLabel,
  type LockedRelation,
  type TaskDraft,
  type TaskItem,
} from '@/app/crm/lib/taskForm';

// Uppgiftsformuläret — ETT formulär, två ingångar: uppgiftssidan och offertpanelens uppgiftskort.
//
// Låg tidigare inline i TasksClient. Flyttat hit när offerten behövde samma formulär: en andra,
// mindre kopia hade betytt att offertvägen tyst saknade mottagarväljaren (och därmed notisen),
// påminnelsen och beskrivningen — alltså precis de fält som gör uppgiften värd att skapa.
//
// Modalen äger sitt eget utkast, sin egen säljarkatalog och sin egen sparning. Konsumenten säger
// bara VAD som ska redigeras och tar emot resultatet.
//
// 📐 PORTALERAS TILL `body`. Offertpanelens uppgiftskort ligger inuti en `overflow-y-auto`-kropp
// under en förälder med `backdrop-filter` — och en förfader med filter eller transform gör
// `position: fixed` relativ mot FÖRFADERN i stället för fönstret, varpå varje scrollande mellanled
// klipper dialogen. Samma läxa står redan i SelectMenu.tsx, som nämner CrmModal vid namn.
//
// 📐 z-index: CrmModal bär 2800 och portalen hamnar efter offertpanelens överlägg i `body`, alltså
// ovanpå den. SelectMenu ligger på 3000 och syns därför inuti formuläret, notisen på 4000 och skyms
// inte.
//
// 🧨 `crm-shell`-svepet är INTE dekoration. `--crm-primary` är scopad till DEN klassen, inte till
// :root — en portal till `body` hamnar utanför skalet, variabeln blir odefinierad och
// "Skapa uppgift" blir vit text på ingen bakgrund. Osynlig knapp, inget felmeddelande, inget i
// konsolen. Exakt samma fälla och samma motmedel som ReportIssueLauncher.tsx; klassen bär bara
// variabler, ingen layout.

export default function TaskFormModal({
  task,
  lockedRelation,
  canDelegate,
  onClose,
  onSaved,
}: {
  /** Uppgiften som redigeras, eller null för en ny. */
  task: TaskItem | null;
  /**
   * En koppling som sammanhanget redan bestämt — offertpanelen vet vilken offert man står på.
   * Är den satt döljs kopplingsväljarna helt och visas som en fast rad i stället: att låta någon
   * peka om uppgiften till en annan offert inifrån en offert vore ett sätt att tappa bort den.
   */
  lockedRelation?: LockedRelation | null;
  /** crm.admin. Styr mottagarväljaren, alltså den väg som skickar notis. */
  canDelegate: boolean;
  onClose: () => void;
  /** Den sparade raden. `isEditing` avgör om konsumenten ska ersätta eller lägga till. */
  onSaved: (item: TaskItem, meta: { isEditing: boolean }) => void;
}) {
  const toast = useToast();
  const isEditing = Boolean(task);

  // Portalen får inte finnas vid serverrenderingen — `document` saknas då. Samma vakt som
  // ProfileMenu och NotificationBell använder.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [draft, setDraft] = useState<TaskDraft>(() =>
    task ? draftFromTask(task) : draftForNewTask(lockedRelation));
  const [submitting, setSubmitting] = useState(false);
  const [sellers, setSellers] = useState<{ id: string; full_name: string | null }[]>([]);

  // Bara den som får delegera behöver katalogen, och bara när en NY uppgift skapas — väljaren
  // visas inte i redigeringsläget.
  const needsSellers = canDelegate && !isEditing;
  useEffect(() => {
    if (!needsSellers) return;
    let cancelled = false;
    fetch('/api/crm/sellers', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (!cancelled && json?.ok) setSellers(json.data?.sellers || []); })
      .catch(() => { /* väljaren står kvar med "Jag själv", vilket är defaulten ändå */ });
    return () => { cancelled = true; };
  }, [needsSellers]);

  // Sidan bakom får inte gå att skrolla medan formuläret står öppet. Låset följde tidigare
  // uppgiftssidans modal-state; nu bor det hos formuläret, så det gäller båda ingångarna. Det
  // tidigare värdet återställs i stället för att nollas — offertpanelen kan ha satt sitt eget.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  // Serverside-sökning i kopplingsväljaren — skalar till valfri tabellstorlek, till skillnad från
  // att förladda varenda kund och offert i en <select>.
  async function searchRelated(query: string): Promise<EntityResult[]> {
    if (draft.related_type === 'crm_customer') {
      const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((c: { id: string; display_name: string; organization_number: string | null; city: string | null }) => ({
        id: c.id,
        label: c.display_name || 'Okänd kund',
        sublabel: [c.organization_number, c.city].filter(Boolean).join(' · ') || undefined,
      }));
    }
    if (draft.related_type === 'crm_quote') {
      const res = await fetch(`/api/crm/quotes?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((q: { id: string; project_name: string; quote_number: string | null; customer_name: string | null }) => ({
        id: q.id,
        label: quoteLabel(q),
        sublabel: q.customer_name || undefined,
      }));
    }
    if (draft.related_type === 'crm_prospect') {
      const res = await fetch(`/api/crm/prospects?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const items = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
      return items.map((p: { id: string; company_name: string; contact_name: string | null; city: string | null }) => ({
        id: p.id,
        label: p.company_name,
        sublabel: [p.contact_name, p.city].filter(Boolean).join(' · ') || undefined,
      }));
    }
    return [];
  }

  async function saveTask() {
    if (!draft.title.trim()) {
      toast.error('Uppgiftstitel krävs');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(isEditing ? `/api/crm/tasks/${task!.id}` : '/api/crm/tasks', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTaskSubmitPayload(draft, { isEditing, canDelegate })),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte spara uppgift');
        return;
      }

      const item = json?.data?.item as TaskItem | undefined;
      if (item) onSaved(item, { isEditing });
      onClose();
    } catch {
      toast.error('Fel vid sparande av uppgift');
    } finally {
      setSubmitting(false);
    }
  }

  // Efter alla hookar — rules-of-hooks.
  if (!mounted) return null;

  return createPortal(
    <div className="crm-shell">
    <CrmModal
      onClose={onClose}
      ariaLabel={isEditing ? 'Redigera uppgift' : 'Ny uppgift'}
      maxWidth="sm:max-w-[720px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">{isEditing ? 'Redigera uppgift' : 'Ny uppgift'}</h2>
          <p className={cn('mt-0.5', crm.pageSubtitle)}>Fånga uppföljningar utan att lämna CRM-flödet.</p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={saveTask}
            disabled={submitting}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {submitting ? 'Sparar…' : isEditing ? 'Spara ändringar' : 'Skapa uppgift'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <p className={cn('mb-1.5', crm.sectionTitle)}>Titel</p>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
            placeholder="Titel på uppgiften"
          />
        </div>

        {lockedRelation ? (
          // Kopplingen är given av var man står. Den visas ändå — utan raden ser formuläret ut
          // som en lös anteckning, och man ska kunna se att uppgiften hamnar på rätt post.
          <div className="rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4">
            <p className={cn('mb-1.5', crm.sectionTitle)}>Koppling</p>
            <p className="m-0 text-sm text-slate-700">
              <span className="font-semibold">{relatedTypeLabel[lockedRelation.type]}:</span> {lockedRelation.label}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Koppling</p>
              <Select
                value={draft.related_type}
                onChange={(e) => setDraft((c) => ({ ...c, related_type: e.target.value as TaskDraft['related_type'], related_id: '', related_label: '' }))}
              >
                <option value="">Ingen koppling</option>
                <option value="crm_customer">Kund</option>
                <option value="crm_quote">Offert</option>
                <option value="crm_prospect">Prospekt</option>
              </Select>
            </div>

            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>
                {draft.related_type ? relatedTypeLabel[draft.related_type] : 'Post'}
              </p>
              <EntityCombobox
                value={draft.related_id}
                valueLabel={draft.related_label}
                onChange={(id, label) => setDraft((c) => ({ ...c, related_id: id, related_label: label }))}
                onClear={() => setDraft((c) => ({ ...c, related_id: '', related_label: '' }))}
                search={searchRelated}
                disabled={!draft.related_type}
                placeholder={draft.related_type ? `Sök ${relatedTypeLabel[draft.related_type].toLowerCase()}…` : 'Välj koppling först'}
              />
            </div>
          </div>
        )}

        <div>
          <p className={cn('mb-1.5', crm.sectionTitle)}>Status</p>
          <Select
            value={draft.status}
            onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value as TaskDraft['status'] }))}
          >
            <option value="open">Öppen</option>
            <option value="done">Klar</option>
          </Select>
        </div>

        {/* Mottagare — bara vid skapandet, och bara för den som får delegera. En befintlig uppgift
            flyttas inte mellan personer, så väljaren döljs i redigeringsläget i stället för att stå
            där utan verkan.

            Riktig <label> och inte crm.sectionTitle som fälten ovan: den är ett <p> och binder
            alltså inte till kontrollen, vilket bryter mot WCAG. De befintliga fälten har samma
            brist men rättas inte här — det är en egen städning. */}
        {needsSellers ? (
          <div className="rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4">
            <label htmlFor="task-owner" className={cn('mb-1.5 block', crm.sectionTitle)}>Ansvarig</label>
            <Select
              id="task-owner"
              value={draft.user_id}
              onChange={(e) => setDraft((c) => ({ ...c, user_id: e.target.value }))}
            >
              <option value="">Jag själv</option>
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>{seller.full_name || seller.id}</option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-slate-500">
              {draft.user_id
                ? 'Uppgiften hamnar hos säljaren, som får en notis. Du hittar den under "Jag har lagt ut".'
                : 'Lägg uppgiften på en säljare i stället för dig själv.'}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 rounded-xl border border-[#e3e9df] bg-[#f6f9f3] p-4 sm:grid-cols-3">
          <div>
            <p className={cn('mb-1.5', crm.sectionTitle)}>Prioritet</p>
            <Select
              value={draft.priority}
              onChange={(e) => setDraft((c) => ({ ...c, priority: e.target.value as TaskItem['priority'] }))}
            >
              <option value="low">Låg</option>
              <option value="normal">Normal</option>
              <option value="high">Hög</option>
            </Select>
          </div>
          <div>
            <p className={cn('mb-1.5', crm.sectionTitle)}>Deadline</p>
            <Input
              value={draft.due_date}
              onChange={(e) => setDraft((c) => ({ ...c, due_date: e.target.value }))}
              type="date"
            />
          </div>
          <div>
            <p className={cn('mb-1.5', crm.sectionTitle)}>Påminnelse</p>
            <Input
              value={draft.remind_at}
              onChange={(e) => setDraft((c) => ({ ...c, remind_at: e.target.value }))}
              type="datetime-local"
            />
          </div>
          <div className="sm:col-span-3">
            <p className={cn('mb-1.5', crm.sectionTitle)}>Källa</p>
            <Input
              value={draft.source}
              onChange={(e) => setDraft((c) => ({ ...c, source: e.target.value }))}
              placeholder="t.ex. samtal eller manuell"
            />
          </div>
        </div>

        <div>
          <p className={cn('mb-1.5', crm.sectionTitle)}>Beskrivning</p>
          <Textarea
            value={draft.details}
            onChange={(e) => setDraft((c) => ({ ...c, details: e.target.value }))}
            placeholder="Vad ska följas upp och varför?"
            className="min-h-[120px]"
          />
        </div>
      </div>
    </CrmModal>
    </div>,
    document.body,
  );
}
