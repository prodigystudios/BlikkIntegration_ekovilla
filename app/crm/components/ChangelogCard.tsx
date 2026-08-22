"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import { changelogCategoryMeta, formatChangelogDay, formatChangelogStamp } from '@/app/_lib/changelogTokens';
import {
  FIRST_VISIT_WINDOW_DAYS,
  groupChangelogByDay,
  latestPublishedAt,
  newSince,
  publishedWithin,
} from '@/lib/domains/changelog/merge';
import type { ChangelogItemView } from '@/lib/domains/changelog/types';

// "Nytt i appen" på CRM-översikten.
//
// PROBLEMET: ändringar går ut utan att någon vet om dem. En sida man måste hitta till löser det
// inte — därför ligger de senaste raderna på ytan man ändå landar på, och modalen slår upp EN gång
// när något tillkommit sedan sist.
//
// "Sedan sist" spåras i localStorage, inte i databasen. Det är per webbläsare i stället för per
// användare, men det räcker för ett "har du sett det här?" och slipper en tabell + en skrivning vid
// varje sidladdning. Samma val som nyhetsmodalen på dashboarden gjorde.
//
// FÖRSTA BESÖKET har inget "sedan sist" att jämföra mot — ingen har besökt listan innan den fanns.
// Där avgör FÄRSKHET i stället (publishedWithin): vid lansering är allt nytt och alla ser det, medan
// en nyanställd om ett år bara möts av det som faktiskt hänt nyligen. Regeln var först "stämpla tyst
// vid första besöket", vilket hade gjort själva lanseringen osynlig för alla utom den som råkade
// titta efter nästa publicering.
//
const SEEN_KEY = 'crm.changelog.seenAt';
const CARD_ITEM_COUNT = 3;

export default function ChangelogCard() {
  const [items, setItems] = useState<ChangelogItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // 'first' och 'new' visar samma urval men olika rubrik: "sedan du var här" är fel ord för någon
  // som aldrig varit här.
  const [modal, setModal] = useState<null | 'all' | 'new' | 'first'>(null);
  const [unseen, setUnseen] = useState<ChangelogItemView[]>([]);

  // Stämplingen får bara ske en gång per laddning, annars kan en omrendering hinna nolla "nytt"
  // innan modalen ens visats.
  const stamped = useRef(false);

  const markSeen = useCallback((list: ChangelogItemView[]) => {
    // Nyaste postens tidsstämpel, inte `now`: webbläsarklockan kan gå fel, och `now` skulle då
    // kunna hoppa över en post som publiceras strax efter.
    const latest = latestPublishedAt(list);
    if (!latest || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SEEN_KEY, latest);
    } catch {
      /* privat läge / full kvot — inte värt ett felmeddelande */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/changelog?limit=100', { cache: 'no-store', credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);

        const list = (body.data.items || []) as ChangelogItemView[];
        setItems(list);

        if (stamped.current) return;
        stamped.current = true;

        let lastSeen: string | null = null;
        try {
          lastSeen = window.localStorage.getItem(SEEN_KEY);
        } catch {
          lastSeen = null;
        }

        // Första besöket har inget "sedan sist" att jämföra mot — ingen har besökt listan innan den
        // fanns. Då avgör färskhet i stället: vid lansering är allt nytt och visas, senare möts en
        // ny användare bara av det som faktiskt hänt nyligen.
        const fresh =
          lastSeen === null ? publishedWithin(list, FIRST_VISIT_WINDOW_DAYS) : newSince(list, lastSeen);

        if (fresh.length > 0) {
          setUnseen(fresh);
          setModal(lastSeen === null ? 'first' : 'new');
        } else {
          // Inget att visa — stämpla ändå, så nästa post räknas som ny i stället för att jämföras
          // mot ingenting.
          markSeen(list);
        }
      } catch {
        // Changeloggen är en trevlighet på en sida full av annat — den ska aldrig kunna ge ett
        // felmeddelande som ser ut att gälla översikten. Kortet döljer sig i stället.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [markSeen]);

  const closeModal = () => {
    markSeen(items);
    setUnseen([]);
    setModal(null);
  };

  if (loading || failed || items.length === 0) return null;

  const preview = items.slice(0, CARD_ITEM_COUNT);

  return (
    <section className={cn(crm.cardInner, 'grid grid-cols-1 gap-2.5')} aria-labelledby="changelog-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="changelog-heading" className={crm.sectionTitle}>Nytt i appen</h2>
          {unseen.length > 0 && (
            <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
              {unseen.length} {unseen.length === 1 ? 'ny' : 'nya'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setModal('all')}
          className="border-0 bg-transparent p-0 text-[12px] font-semibold text-emerald-800 underline-offset-2 hover:underline"
        >
          Visa alla
        </button>
      </div>

      <ul role="list" className="m-0 grid list-none gap-1.5 p-0">
        {preview.map((item) => (
          <li key={`${item.source}-${item.id}`} className="flex items-start gap-2">
            <CategoryGlyph item={item} />
            <span className="min-w-0 flex-1 text-xs leading-snug text-slate-800">{item.title}</span>
            <span className="shrink-0 text-[11px] text-slate-500">{formatChangelogStamp(item.published_at)}</span>
          </li>
        ))}
      </ul>

      {modal && (
        <CrmModal
          onClose={closeModal}
          ariaLabel="Nytt i appen"
          maxWidth="sm:max-w-[560px]"
          header={
            <div className="grid gap-0.5">
              <h2 className="m-0 text-base font-bold text-slate-900">
                {modal === 'new' ? 'Nytt sedan du var här' : 'Nytt i appen'}
              </h2>
              <p className="m-0 text-[12px] text-slate-500">
                {modal === 'new'
                  ? 'Det här har ändrats sedan du senast öppnade CRM.'
                  : modal === 'first'
                    ? 'Härifrån kan du följa vad som fixats och tillkommit. Det här är det senaste.'
                    : 'Allt som fixats, tillkommit och förbättrats.'}
              </p>
            </div>
          }
          footer={
            modal === 'new' || modal === 'first' ? (
              <>
                <button
                  type="button"
                  onClick={() => setModal('all')}
                  className={cn(crm.ghostButton, 'flex-1 sm:flex-none sm:px-5')}
                >
                  Visa allt
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className={cn(crm.formButton, 'flex-1 sm:flex-none sm:px-5')}
                  style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
                >
                  Okej
                </button>
              </>
            ) : (
              <button type="button" onClick={closeModal} className={cn(crm.ghostButton, 'flex-1 sm:flex-none sm:px-5')}>
                Stäng
              </button>
            )
          }
        >
          <ChangelogList items={modal === 'all' ? items : unseen} />
        </CrmModal>
      )}
    </section>
  );
}

function CategoryGlyph({ item }: { item: ChangelogItemView }) {
  const meta = changelogCategoryMeta[item.category];
  return (
    <span
      // Etiketten läses upp för skärmläsare; tecknet ensamt säger inget.
      title={item.category_label}
      className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-bold', meta.glyphClass)}
    >
      <span aria-hidden>{meta.glyph}</span>
      <span className="sr-only">{item.category_label}</span>
    </span>
  );
}

function ChangelogList({ items }: { items: ChangelogItemView[] }) {
  if (items.length === 0) {
    return <p className="m-0 text-sm text-slate-500">Inget att visa ännu.</p>;
  }

  const groups = groupChangelogByDay(items);

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.day} className="grid gap-1.5">
          <h3 className={crm.sectionTitle}>{formatChangelogDay(group.day)}</h3>
          <ul role="list" className="m-0 grid list-none gap-2 p-0">
            {group.items.map((item) => (
              <li key={`${item.source}-${item.id}`} className="flex items-start gap-2">
                <CategoryGlyph item={item} />
                <div className="min-w-0 flex-1 grid gap-0.5">
                  <span className="text-[13px] font-semibold leading-snug text-slate-900">{item.title}</span>
                  {item.body && (
                    <span className="whitespace-pre-wrap text-[12px] leading-snug text-slate-600">{item.body}</span>
                  )}
                  {/* Loopen tillbaka till den som rapporterade: hen ser att just deras grej kom med. */}
                  {item.reported_by && (
                    <span className="text-[11px] text-slate-500">Rapporterat av {item.reported_by}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
