"use client";

import Input from '../../../../components/ui/Input';
import CrmModal from '../../components/CrmModal';
import { crm } from '../../lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import type { PublishMeta, PublishUiState } from '../types';

type DocumentsPublishDialogProps = {
  publishUi: PublishUiState | null;
  publishMeta: PublishMeta | null;
  publishMetaLoading: boolean;
  publishMetaError: string | null;
  isPublishing: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onTitleChange: (value: string) => void;
  onVersionLabelChange: (value: string) => void;
  onDueAtChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRequiresApprovalChange: (checked: boolean) => void;
  onToggleUser: (userId: string) => void;
  onToggleTag: (tag: string) => void;
};

function PickerCount({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{count} valda</span>;
}

export default function DocumentsPublishDialog({
  publishUi,
  publishMeta,
  publishMetaLoading,
  publishMetaError,
  isPublishing,
  onClose,
  onSubmit,
  onTitleChange,
  onVersionLabelChange,
  onDueAtChange,
  onDescriptionChange,
  onRequiresApprovalChange,
  onToggleUser,
  onToggleTag,
}: DocumentsPublishDialogProps) {
  if (!publishUi) {
    return null;
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Publicera dokument för kvittens"
      maxWidth="sm:max-w-[860px]"
      header={
        <div className="grid gap-1">
          <span className={crm.sectionTitle}>Kvittensflöde</span>
          <strong className="text-lg font-bold tracking-tight text-slate-900">Publicera dokument</strong>
          <p className="m-0 truncate text-sm text-slate-500">{publishUi.file.file_name}</p>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'flex-1 sm:flex-none')}>
            Avbryt
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPublishing}
            className={cn(crm.formButton, 'flex-1 sm:ml-auto sm:flex-none')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {isPublishing ? 'Publicerar…' : 'Publicera'}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3.5">
          <label className="grid gap-1.5">
            <span className={crm.label}>Titel</span>
            <Input
              value={publishUi.title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Ex. Arbetsmiljörutin april 2026"
            />
          </label>

          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <label className="grid gap-1.5">
              <span className={crm.label}>Version</span>
              <Input
                value={publishUi.versionLabel}
                onChange={(event) => onVersionLabelChange(event.target.value)}
                placeholder="Ex. 2026-04"
              />
            </label>

            <label className="grid gap-1.5">
              <span className={crm.label}>Deadline</span>
              <Input type="datetime-local" value={publishUi.dueAt} onChange={(event) => onDueAtChange(event.target.value)} />
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className={crm.label}>Beskrivning</span>
            <textarea
              value={publishUi.description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              className="min-h-24 w-full resize-y rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
              placeholder="Kort beskrivning eller instruktion till personalen"
            />
          </label>

          <label className="flex items-center gap-2.5 rounded-xl border border-[#e0e8dc] bg-[#f6f9f3] px-3.5 py-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={publishUi.requiresApproval}
              onChange={(event) => onRequiresApprovalChange(event.target.checked)}
            />
            Aktivt godkännande krävs
          </label>
        </div>

        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <section className="grid gap-3 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3.5">
            <div className="flex items-center justify-between gap-2.5">
              <strong className="text-sm font-semibold text-slate-800">Personer</strong>
              <PickerCount count={publishUi.selectedUserIds.length} />
            </div>

            {publishMetaLoading ? <div className="text-[13px] text-slate-400">Laddar användare…</div> : null}
            {!publishMetaLoading && publishMeta?.users?.length === 0 ? <div className="text-[13px] text-slate-400">Inga användare hittades.</div> : null}

            <div className="grid max-h-[260px] gap-2 overflow-auto">
              {(publishMeta?.users || []).map((user) => (
                <label key={user.id} className="flex items-start gap-2.5 rounded-lg border border-[#e3e9df] bg-white px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-emerald-600"
                    checked={publishUi.selectedUserIds.includes(user.id)}
                    onChange={() => onToggleUser(user.id)}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-semibold text-slate-800">{user.name}</span>
                    <span className="text-xs text-slate-400">{user.role}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3.5">
            <div className="flex items-center justify-between gap-2.5">
              <strong className="text-sm font-semibold text-slate-800">Grupper via taggar</strong>
              <PickerCount count={publishUi.selectedTags.length} />
            </div>

            {publishMetaLoading ? <div className="text-[13px] text-slate-400">Laddar taggar…</div> : null}
            {!publishMetaLoading && publishMeta?.tags?.length === 0 ? <div className="text-[13px] text-slate-400">Inga taggar hittades.</div> : null}

            <div className="grid max-h-[260px] gap-2 overflow-auto">
              {(publishMeta?.tags || []).map((tag) => (
                <label key={tag} className="flex items-start gap-2.5 rounded-lg border border-[#e3e9df] bg-white px-2.5 py-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={publishUi.selectedTags.includes(tag)} onChange={() => onToggleTag(tag)} />
                  <span className="text-sm font-semibold text-slate-800">{tag}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        {publishMetaError ? <div className="text-sm text-rose-700">{publishMetaError}</div> : null}

        <p className="m-0 text-[13px] text-slate-400">
          Publiceringen skapar en egen kvittenscykel för den här dokumentversionen.
        </p>
      </div>
    </CrmModal>
  );
}
