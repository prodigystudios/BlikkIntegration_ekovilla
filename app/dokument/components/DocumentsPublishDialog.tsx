"use client";

import Button from '../../../components/ui/Button';
import DialogShell from '../../../components/ui/DialogShell';
import Input from '../../../components/ui/Input';
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

  return <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-800">{count} valda</span>;
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
    <DialogShell
      eyebrow="Kvittensflöde"
      title="Publicera dokument för kvittens"
      description={publishUi.file.file_name}
      onClose={onClose}
      panelClassName="max-w-[860px]"
    >
      <div className="grid gap-3.5">
            <label className="grid gap-1.5">
              <span className="text-[13px] font-bold text-slate-700">Titel</span>
              <Input
                value={publishUi.title}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Ex. Arbetsmiljörutin april 2026"
              />
            </label>

            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              <label className="grid gap-1.5">
                <span className="text-[13px] font-bold text-slate-700">Version</span>
                <Input
                  value={publishUi.versionLabel}
                  onChange={(event) => onVersionLabelChange(event.target.value)}
                  placeholder="Ex. 2026-04"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[13px] font-bold text-slate-700">Deadline</span>
                <Input type="datetime-local" value={publishUi.dueAt} onChange={(event) => onDueAtChange(event.target.value)} />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-[13px] font-bold text-slate-700">Beskrivning</span>
              <textarea
                value={publishUi.description}
                onChange={(event) => onDescriptionChange(event.target.value)}
                className="min-h-24 w-full resize-y rounded-xl border border-ui-border bg-white px-3 py-2 text-sm text-ui-text-strong placeholder:text-ui-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20"
                placeholder="Kort beskrivning eller instruktion till personalen"
              />
            </label>

            <label className="flex items-center gap-2.5 rounded-[14px] border border-ui-border bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-3.5 py-3 font-semibold text-ui-text-strong">
              <input
                type="checkbox"
                checked={publishUi.requiresApproval}
                onChange={(event) => onRequiresApprovalChange(event.target.checked)}
              />
              Aktivt godkännande krävs
            </label>
          </div>

          <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            <section className="grid gap-3 rounded-[14px] border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between gap-2.5">
                <strong className="text-slate-900">Personer</strong>
                <PickerCount count={publishUi.selectedUserIds.length} />
              </div>

              {publishMetaLoading ? <div className="text-[13px] text-ui-text-soft">Laddar användare…</div> : null}
              {!publishMetaLoading && publishMeta?.users?.length === 0 ? <div className="text-[13px] text-ui-text-soft">Inga användare hittades.</div> : null}

              <div className="grid max-h-[260px] gap-2 overflow-auto">
                {(publishMeta?.users || []).map((user) => (
                  <label key={user.id} className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={publishUi.selectedUserIds.includes(user.id)}
                      onChange={() => onToggleUser(user.id)}
                    />
                    <span className="grid gap-0.5">
                      <span className="font-semibold text-ui-text-strong">{user.name}</span>
                      <span className="text-xs text-ui-text-soft">{user.role}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="grid gap-3 rounded-[14px] border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between gap-2.5">
                <strong className="text-slate-900">Grupper via taggar</strong>
                <PickerCount count={publishUi.selectedTags.length} />
              </div>

              {publishMetaLoading ? <div className="text-[13px] text-ui-text-soft">Laddar taggar…</div> : null}
              {!publishMetaLoading && publishMeta?.tags?.length === 0 ? <div className="text-[13px] text-ui-text-soft">Inga taggar hittades.</div> : null}

              <div className="grid max-h-[260px] gap-2 overflow-auto">
                {(publishMeta?.tags || []).map((tag) => (
                  <label key={tag} className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                    <input type="checkbox" checked={publishUi.selectedTags.includes(tag)} onChange={() => onToggleTag(tag)} />
                    <span className="font-semibold text-ui-text-strong">{tag}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>

          {publishMetaError ? <div className="text-sm text-red-800">{publishMetaError}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-ui-text-soft">
              Publiceringen skapar en egen kvittenscykel för den här dokumentversionen.
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" onClick={onClose}>
                Avbryt
              </Button>
              <Button variant="primary" onClick={onSubmit} disabled={isPublishing}>
                Publicera
              </Button>
            </div>
          </div>
    </DialogShell>
  );
}