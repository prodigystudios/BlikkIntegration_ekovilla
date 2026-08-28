"use client";

import { useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDateTime } from '@/app/crm/lib/format';
import MentionTextarea, { type MentionUser } from '@/app/crm/components/MentionTextarea';
import { splitLinkParts } from '@/lib/shared/linkify';

// Kommentarstexten, med adresserna klickbara och radbrytningarna kvar.
//
// Båda halvorna löser ett riktigt fel, inte en finess. Egenkontrollen skriver in en permanent
// nedladdningslänk i en kommentar på ordern när rapporten lämnas in — den renderades som ren text,
// så kontoret fick markera och kopiera den för hand. Och kommentaren är fyrradig (RAPPORTERING →
// antal säckar → datum → länk), medan default-CSS:en kollapsar radbrytningar: hela stycket lades
// ut som en enda löpande rad.
//
// ⚠️ DELAR, INTE HTML-STRÄNG. splitLinkParts returnerar bitar som React renderar som element, så
// texten escapas av React. Bygg aldrig om det här till dangerouslySetInnerHTML — kommentarerna är
// användarskriven text.
//
// target="_blank": den som öppnar en egenkontroll vill ha kvar arbetsordern bakom sig. rel bär
// noopener av säkerhetsskäl (den öppnade sidan får inte nå window.opener).
function CommentBody({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-slate-600">
      {splitLinkParts(body).map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-700 underline underline-offset-2 transition hover:text-emerald-800"
          >
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </div>
  );
}

export type CommentItem = {
  id: string;
  work_order_id: string;
  created_by: string;
  body: string;
  created_at: string;
  author?: { full_name?: string | null } | null;
};

type Props = {
  comments: CommentItem[];
  loading: boolean;
  currentUserId: string | null;
  mentionUsers: MentionUser[];
  /** Namn per användar-id, från useWorkOrderActivity — `author` är null för kollegors rader. */
  namesById: Map<string, string>;
  onCreate: (body: string, mentionedUserIds: string[]) => Promise<boolean>;
  onUpdate: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

export default function WorkOrderCommentsTab({ comments, loading, currentUserId, mentionUsers, namesById, onCreate, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  // Ids picked from the @-autocomplete for the new comment (id → full_name). The id is otherwise
  // lost (the body only has plain "@Name" text); at submit we keep only those still present.
  const mentionedRef = useRef<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function submitCreate() {
    setCreating(true);
    // Only notify people whose @mention is still in the text (a removed mention shouldn't notify).
    const mentionedIds = [...mentionedRef.current.entries()]
      .filter(([, name]) => draft.includes(`@${name}`))
      .map(([id]) => id);
    const ok = await onCreate(draft, mentionedIds);
    if (ok) {
      setDraft('');
      mentionedRef.current.clear();
    }
    setCreating(false);
  }

  function startEdit(item: CommentItem) {
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditBody(item.body);
  }

  async function submitEdit(id: string) {
    setBusyId(id);
    const ok = await onUpdate(id, editBody);
    if (ok) setEditingId(null);
    setBusyId(null);
  }

  async function confirmDelete(id: string) {
    setBusyId(id);
    await onDelete(id);
    setBusyId(null);
    setConfirmDeleteId(null);
  }

  return (
    <div className={cn(crm.cardInner, 'grid gap-4')}>
      <p className={crm.cardTitle}>Projektkommentarer</p>

      {/* Thread first */}
      <div className="grid gap-2">
        {loading ? <div className="text-sm text-slate-500">Laddar kommentarer…</div> : null}
        {!loading && comments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">
            Inga kommentarer ännu. Skriv den första nedan — skriv @ och ett namn så får personen en notis.
          </div>
        ) : null}
        {!loading ? comments.map((item) => {
          const isOwn = !!currentUserId && item.created_by === currentUserId;
          if (editingId === item.id) {
            return (
              <div key={item.id} className="grid gap-2 rounded-xl border border-emerald-200 bg-[#f1f5ee] px-3 py-3">
                <MentionTextarea value={editBody} onChange={setEditBody} users={mentionUsers} rows={3} />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setEditingId(null)} className={crm.ghostButton}>Avbryt</button>
                  <button type="button" onClick={() => submitEdit(item.id)} disabled={busyId === item.id} className={cn(crm.saveButton, 'h-9 w-auto px-4')}>
                    {busyId === item.id ? 'Sparar…' : 'Spara'}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={item.id} className="grid gap-1 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Registret först, den joinade profilen som reserv: joinen bär bara ens EGET
                    namn (profiles är self-read-only), registret bär allas. */}
                <strong className="text-slate-900">{namesById.get(item.created_by) || item.author?.full_name || 'Okänd medarbetare'}</strong>
                <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
              </div>
              <CommentBody body={item.body} />
              {isOwn ? (
                <div className="flex items-center justify-end gap-3 pt-0.5">
                  {confirmDeleteId === item.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Ta bort?</span>
                      <button type="button" onClick={() => confirmDelete(item.id)} disabled={busyId === item.id} className="font-semibold text-rose-600 hover:text-rose-700">Ja</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-slate-400 hover:text-slate-600">Nej</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 text-xs">
                      <button type="button" onClick={() => startEdit(item)} className="font-medium text-slate-500 hover:text-slate-800">Redigera</button>
                      <button type="button" onClick={() => setConfirmDeleteId(item.id)} className="font-medium text-slate-400 hover:text-rose-500">Ta bort</button>
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          );
        }) : null}
      </div>

      {/* Composer at the bottom, below the thread. */}
      <div className="grid gap-2 border-t border-[#e0e8dc] pt-4">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          onMention={(u) => { if (u.full_name) mentionedRef.current.set(u.id, u.full_name); }}
          users={mentionUsers}
          rows={2}
          placeholder="Skriv en kommentar… använd @ för att tagga någon"
        />
        <button type="button" onClick={submitCreate} disabled={creating || !draft.trim()} className={cn(crm.saveButton, 'h-9 w-auto justify-self-end px-5')}>
          {creating ? 'Sparar kommentar…' : 'Spara kommentar'}
        </button>
      </div>
    </div>
  );
}
