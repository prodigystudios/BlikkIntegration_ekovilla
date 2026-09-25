"use client";

import { useId, useMemo, useState } from 'react';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import {
  actionsForItem,
  defaultFindingForItem,
  groupItemsByCategory,
  needsDetails,
  withEmptyCategories,
  type ItemGroup,
} from '@/lib/domains/safetyRounds/form';
import {
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  RISK_LABELS,
  RISK_LEVELS,
  TO_ACTION_PLAN,
  TO_ACTION_PLAN_LABELS,
  type ItemStatus,
  type RiskLevel,
  type SafetyRoundAction,
  type SafetyRoundItem,
  type SafetyRoundPhoto,
  type ToActionPlan,
} from '@/lib/domains/safetyRounds/types';
import { MAX_PHOTOS_PER_ROUND, photosByItem as groupPhotosByItem } from '@/lib/domains/safetyRounds/photoRules';
import PhotoStrip, { INLINE_ACTION_CLASS } from '../_components/PhotoStrip';
import { TextAreaField, TextField } from '../_components/fields';
import SegmentedChoice from '../_components/SegmentedChoice';
import { ITEM_STATUS_RAIL, ITEM_STATUS_SELECTED, RISK_SELECTED } from '../_components/safetyUi';
import type { ChecklistCategory, PhotoUploadProgress } from './useSafetyRound';

// Steg 3 — Checklistan, som mallens flik 2: kategori för kategori, en rad per kontrollpunkt.
//
// Huvudvalet (OK / Delvis / Brist / Ej relevant) är fyra stora knappar, och det valda färgar radens
// räls till vänster — så syns det i ögonvrån vilka punkter som är kvar medan man scrollar. Delvis och
// Brist fäller ut resten av mallens kolumner: risknivå, beskrivning, åtgärd på plats och "Förs till
// handlingsplan?". OK och Ej relevant behöver inget mer än en valfri kommentar.

type Props = {
  items: SafetyRoundItem[];
  actions: SafetyRoundAction[];
  categories: ChecklistCategory[];
  readOnly: boolean;
  onPatchItem: (id: string, patch: Partial<SafetyRoundItem>) => void;
  onAddCustomItem: (categoryCode: string, text: string) => Promise<boolean>;
  onRemoveCustomItem: (id: string) => void;
  onAddAction: (input: { finding: string; item_id: string; risk: RiskLevel | null }) => Promise<unknown>;
  onGoToActions: () => void;
  photos: SafetyRoundPhoto[];
  photoUrls: Record<string, string | null>;
  photoUploads: Record<string, PhotoUploadProgress>;
  onUploadPhotos: (itemId: string, files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
};

const STATUS_OPTIONS = ITEM_STATUSES.map((value) => ({
  value,
  label: ITEM_STATUS_LABELS[value],
  selectedClassName: ITEM_STATUS_SELECTED[value],
}));

// "–" är mallens förval och sparas som null — samma som i Excel, där cellen står på "–" tills någon
// väljer en nivå.
const RISK_OPTIONS = [
  { value: 'none' as const, label: '–', selectedClassName: RISK_SELECTED.none },
  ...RISK_LEVELS.map((value) => ({ value, label: RISK_LABELS[value], selectedClassName: RISK_SELECTED[value] })),
];

const PLAN_OPTIONS = TO_ACTION_PLAN.map((value) => ({
  value,
  label: TO_ACTION_PLAN_LABELS[value],
  selectedClassName: value === 'yes' ? 'border-rose-700 bg-rose-700 text-white' : 'border-slate-600 bg-slate-600 text-white',
}));

const YES_NO = [
  { value: 'yes' as const, label: 'Ja', selectedClassName: 'border-emerald-700 bg-emerald-700 text-white' },
  { value: 'no' as const, label: 'Nej', selectedClassName: 'border-slate-600 bg-slate-600 text-white' },
];

function DetailLabel({ children }: { children: string }) {
  return <p className={cn('m-0 mb-1', crm.label)}>{children}</p>;
}

function ItemRow({
  item,
  actions,
  readOnly,
  onPatchItem,
  onRemoveCustomItem,
  onAddAction,
  onGoToActions,
  itemPhotos,
  photoUrls,
  upload,
  photoLimitReached,
  onUploadPhotos,
  onRemovePhoto,
}: {
  item: SafetyRoundItem;
  actions: SafetyRoundAction[];
  itemPhotos: SafetyRoundPhoto[];
  upload: PhotoUploadProgress | undefined;
  photoLimitReached: boolean;
} & Pick<
  Props,
  'readOnly' | 'onPatchItem' | 'onRemoveCustomItem' | 'onAddAction' | 'onGoToActions' | 'photoUrls' | 'onUploadPhotos' | 'onRemovePhoto'
>) {
  const [showComment, setShowComment] = useState(false);
  const [creatingAction, setCreatingAction] = useState(false);
  const details = needsDetails(item);
  const itemActions = actionsForItem(actions, item.id);
  const numberLabel = item.number != null ? `Punkt ${item.number}` : 'Egen punkt';
  const patch = (next: Partial<SafetyRoundItem>) => onPatchItem(item.id, next);
  const text = (key: 'description' | 'comment') => (next: string) => patch({ [key]: next.trim() || null });

  async function addToPlan() {
    setCreatingAction(true);
    await onAddAction({ finding: defaultFindingForItem(item), item_id: item.id, risk: item.risk });
    setCreatingAction(false);
  }

  return (
    <li className="relative grid gap-3 py-4 pl-5 pr-4">
      {/* Rälsen: tom (ljus) tills punkten är bedömd. */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', item.status ? ITEM_STATUS_RAIL[item.status] : 'bg-[#e0e8dc]')} />

      <div className="flex items-start gap-3">
        <span className="w-7 shrink-0 pt-px text-right text-sm font-bold tabular-nums text-slate-500" aria-hidden>
          {item.number ?? '+'}
        </span>
        <p className="m-0 min-w-0 flex-1 text-[15px] leading-snug text-slate-900">
          <span className="sr-only">{numberLabel}: </span>
          {item.text}
        </p>
      </div>

      <SegmentedChoice<ItemStatus>
        label={`Status för ${numberLabel.toLowerCase()}`}
        size="lg"
        options={STATUS_OPTIONS}
        value={item.status}
        onChange={(status) => patch({ status })}
        disabled={readOnly}
        className="sm:ml-10"
      />

      {details ? (
        <div className="grid gap-4 rounded-xl border border-solid border-[#e0e8dc] bg-white p-3 sm:ml-10">
          <div>
            <DetailLabel>Risknivå</DetailLabel>
            <SegmentedChoice<'none' | RiskLevel>
              label={`Risknivå för ${numberLabel.toLowerCase()}`}
              options={RISK_OPTIONS}
              value={item.risk ?? 'none'}
              onChange={(value) => patch({ risk: value === 'none' ? null : value })}
              disabled={readOnly}
              columnsClassName="grid-cols-3 sm:grid-cols-5"
            />
            {item.risk === 'high' || item.risk === 'severe' ? (
              <p className="m-0 mt-2 text-xs font-semibold text-rose-800">Hög eller allvarlig risk åtgärdas omgående eller samma dag.</p>
            ) : null}
          </div>

          <TextAreaField
            label="Beskrivning av brist / observation"
            value={item.description}
            onCommit={text('description')}
            readOnly={readOnly}
            placeholder="Vad såg ni? Skriv kort, gärna med var på platsen."
          />

          <div>
            <DetailLabel>Åtgärdat på plats?</DetailLabel>
            <SegmentedChoice
              label={`Åtgärdat på plats för ${numberLabel.toLowerCase()}`}
              options={YES_NO}
              value={item.fixed_on_site === null ? null : item.fixed_on_site ? 'yes' : 'no'}
              onChange={(value) => patch({ fixed_on_site: value === 'yes' })}
              disabled={readOnly}
            />
          </div>

          <div>
            <DetailLabel>Förs till handlingsplan?</DetailLabel>
            <SegmentedChoice<ToActionPlan>
              label={`Förs till handlingsplan för ${numberLabel.toLowerCase()}`}
              options={PLAN_OPTIONS}
              value={item.to_action_plan}
              onChange={(value) => patch({ to_action_plan: value })}
              disabled={readOnly}
            />
          </div>

          {item.to_action_plan === 'yes' ? (
            itemActions.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f1f5ef] px-3 py-2">
                <p className={cn('m-0', crm.meta)}>
                  {itemActions.length === 1 ? 'Finns i handlingsplanen.' : `${itemActions.length} åtgärder i handlingsplanen.`}
                </p>
                <button type="button" onClick={onGoToActions} className={cn(crm.ghostButton, 'h-9')}>
                  Visa handlingsplanen
                </button>
              </div>
            ) : !readOnly ? (
              <button type="button" onClick={() => void addToPlan()} disabled={creatingAction} className={cn(crm.saveButton, 'min-h-11')}>
                {creatingAction ? 'Lägger till…' : 'Lägg till i handlingsplanen'}
              </button>
            ) : null
          ) : null}

          <TextField label="Kommentar" value={item.comment} onCommit={text('comment')} readOnly={readOnly} maxLength={500} />
        </div>
      ) : item.comment || showComment ? (
        <div className="sm:ml-10">
          <TextField label="Kommentar" value={item.comment} onCommit={text('comment')} readOnly={readOnly} maxLength={500} />
        </div>
      ) : null}

      {/* Foton — på varje punkt, oavsett status: mallen har Foto-nr på alla rader. "+ Kommentar" står
          på samma rad som "+ Foto" när punkten inte har några detaljer att visa. */}
      <PhotoStrip
        addonBefore={
          !details && !item.comment && !showComment ? (
            <button type="button" onClick={() => setShowComment(true)} className={INLINE_ACTION_CLASS}>
              + Kommentar
            </button>
          ) : null
        }
        photos={itemPhotos}
        urls={photoUrls}
        readOnly={readOnly}
        itemLabel={numberLabel.toLowerCase()}
        uploading={upload}
        limitReached={photoLimitReached}
        onUpload={(files) => onUploadPhotos(item.id, files)}
        onRemove={onRemovePhoto}
      />

      {item.catalog_item_id === null && !readOnly ? (
        <button type="button" onClick={() => onRemoveCustomItem(item.id)} className={cn(crm.dangerButton, 'w-fit sm:ml-10')}>
          Ta bort punkten
        </button>
      ) : null}
    </li>
  );
}

function AddCustomItem({ group, onAdd }: { group: ItemGroup; onAdd: Props['onAddCustomItem'] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    const added = await onAdd(group.code, trimmed);
    setSaving(false);
    if (added) {
      setText('');
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 w-full border-0 border-t border-solid border-[#e8eee4] p-0 px-4 text-left text-sm font-semibold text-slate-600 hover:bg-white hover:text-slate-900"
      >
        + Lägg till egen punkt
      </button>
    );
  }

  return (
    <div className="grid gap-2 border-0 border-t border-solid border-[#e8eee4] p-4">
      <label htmlFor={id} className={cn('m-0', crm.label)}>
        Egen kontrollpunkt i {group.code}
      </label>
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        maxLength={300}
        placeholder="T.ex. Takluckan på hus 3 saknar räcke?"
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={saving || !text.trim()} className={cn(crm.saveButton, 'min-h-11 w-auto px-5')}>
          {saving ? 'Lägger till…' : 'Lägg till'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={cn(crm.ghostButton, 'min-h-11')}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

export default function ChecklistStep({
  items,
  actions,
  categories,
  readOnly,
  onPatchItem,
  onAddCustomItem,
  onRemoveCustomItem,
  onAddAction,
  onGoToActions,
  photos,
  photoUrls,
  photoUploads,
  onUploadPhotos,
  onRemovePhoto,
}: Props) {
  const groups = useMemo(() => {
    const own = groupItemsByCategory(items);
    return readOnly ? own : withEmptyCategories(own, categories);
  }, [items, categories, readOnly]);
  const photosByItem = useMemo(() => groupPhotosByItem(photos), [photos]);
  // Uppladdningar som pågår räknas in, så att två punkter samtidigt inte kan gå förbi taket.
  const photoLimitReached = photos.length + Object.values(photoUploads).reduce((n, u) => n + (u.total - u.done), 0) >= MAX_PHOTOS_PER_ROUND;

  return (
    <div className="grid gap-4">
      {!readOnly ? (
        <p className={cn('m-0', crm.pageSubtitle)}>
          Gå ronden område för område. Kritiska fel – saknat räcke, öppen schakt, saknad dammsugning vid kvarts – åtgärdas direkt. Vänta inte på protokollet.
        </p>
      ) : null}

      {groups.map((group) => {
        const assessed = group.items.filter((item) => item.status !== null).length;
        return (
          <section key={group.code} className={cn(crm.card, 'overflow-hidden')} aria-labelledby={`category-${group.code}`}>
            <header className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-4">
              <h2 id={`category-${group.code}`} className={cn('m-0', crm.cardTitle)}>
                {group.code}. {group.label}
              </h2>
              {group.items.length > 0 ? (
                <span className={cn('shrink-0 tabular-nums', crm.meta)}>
                  {assessed} av {group.items.length}
                </span>
              ) : null}
            </header>
            {group.items.length > 0 ? (
              <ul className="m-0 grid list-none divide-y divide-[#e8eee4] p-0">
                {group.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    actions={actions}
                    readOnly={readOnly}
                    onPatchItem={onPatchItem}
                    onRemoveCustomItem={onRemoveCustomItem}
                    onAddAction={onAddAction}
                    onGoToActions={onGoToActions}
                    itemPhotos={photosByItem.get(item.id) ?? []}
                    photoUrls={photoUrls}
                    upload={photoUploads[item.id]}
                    photoLimitReached={photoLimitReached}
                    onUploadPhotos={onUploadPhotos}
                    onRemovePhoto={onRemovePhoto}
                  />
                ))}
              </ul>
            ) : (
              <p className={cn('m-0 px-4 pb-3', crm.meta)}>Objektsspecifika risker som inte står i listan ovan.</p>
            )}
            {!readOnly ? <AddCustomItem group={group} onAdd={onAddCustomItem} /> : null}
          </section>
        );
      })}
    </div>
  );
}
