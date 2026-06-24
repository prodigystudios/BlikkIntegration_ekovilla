"use client";

import CrmModal from '../../components/CrmModal';
import { crm } from '../../lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import type { PublicationStatusItem, PublishStatusUiState } from '../types';

type DocumentsPublishStatusDialogProps = {
  publishStatusUi: PublishStatusUiState | null;
  onClose: () => void;
  onSelectPublication: (publicationId: string) => void;
};

function isPublicationStatusComplete(item: PublicationStatusItem, requiresApproval: boolean) {
  return !!item.approvedAt || (!requiresApproval && !!item.firstOpenedAt);
}

function completionLabel(item: PublicationStatusItem, requiresApproval: boolean) {
  if (isPublicationStatusComplete(item, requiresApproval)) {
    return requiresApproval ? 'Godkänt' : 'Klart';
  }

  return item.firstOpenedAt ? 'Läst' : 'Ej läst';
}

function summaryPillClasses(tone: 'danger' | 'warning' | 'success' | 'neutral') {
  const base = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold';
  switch (tone) {
    case 'danger':
      return cn(base, 'border-rose-200 bg-rose-50 text-rose-700');
    case 'warning':
      return cn(base, 'border-amber-200 bg-amber-50 text-amber-700');
    case 'success':
      return cn(base, 'border-emerald-200 bg-emerald-50 text-emerald-700');
    default:
      return cn(base, 'border-slate-200 bg-slate-50 text-slate-600');
  }
}

function recipientStatusClasses(item: PublicationStatusItem, requiresApproval: boolean) {
  if (isPublicationStatusComplete(item, requiresApproval)) {
    return summaryPillClasses('success');
  }

  if (item.firstOpenedAt) {
    return summaryPillClasses('warning');
  }

  return summaryPillClasses('danger');
}

export default function DocumentsPublishStatusDialog({
  publishStatusUi,
  onClose,
  onSelectPublication,
}: DocumentsPublishStatusDialogProps) {
  if (!publishStatusUi) {
    return null;
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Kvittensstatus"
      maxWidth="sm:max-w-[1100px]"
      header={
        <div className="grid gap-1">
          <span className={crm.sectionTitle}>Uppföljning</span>
          <strong className="text-lg font-bold tracking-tight text-slate-900">Kvittensstatus</strong>
          <p className="m-0 truncate text-sm text-slate-500">{publishStatusUi.file.file_name}</p>
        </div>
      }
    >
      {publishStatusUi.loadingPublications ? <div className="text-sm text-slate-400">Laddar publiceringar…</div> : null}

      {!publishStatusUi.loadingPublications && publishStatusUi.publications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
          Inga publiceringar finns ännu för det här dokumentet.
        </div>
      ) : null}

      {!publishStatusUi.loadingPublications && publishStatusUi.publications.length > 0 ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] px-3 py-2.5">
            {publishStatusUi.publications.map((publication) => {
              const active = publication.id === publishStatusUi.selectedPublicationId;

              return (
                <button
                  key={publication.id}
                  type="button"
                  onClick={() => onSelectPublication(publication.id)}
                  className={cn(
                    'inline-flex items-center rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
                    active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                  style={active ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                >
                  {publication.title}
                  {publication.version_label ? ` • ${publication.version_label}` : ''}
                </button>
              );
            })}
          </div>

          {publishStatusUi.error ? <div className="text-sm text-rose-700">{publishStatusUi.error}</div> : null}
          {publishStatusUi.loadingStatus ? <div className="text-sm text-slate-400">Laddar mottagarstatus…</div> : null}

          {publishStatusUi.status && !publishStatusUi.loadingStatus ? (
            (() => {
              const status = publishStatusUi.status;
              const requiresApproval = status.publication.requires_approval;

              return (
                <div className="grid gap-4">
                  <div className="flex flex-wrap gap-2">
                    <span className={summaryPillClasses('danger')}>Ej läst: {status.summary.unread}</span>
                    <span className={summaryPillClasses('warning')}>Läst: {status.summary.read}</span>
                    <span className={summaryPillClasses('success')}>
                      {requiresApproval ? 'Godkänt' : 'Klart'}: {status.summary.approved}
                    </span>
                    <span className={summaryPillClasses('neutral')}>Totalt: {status.summary.total}</span>
                  </div>

                  <div className="grid gap-2">
                    {status.items.map((item) => (
                      <div
                        key={item.userId}
                        className="grid gap-2.5 rounded-xl border border-[#e3e9df] bg-white px-3.5 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <strong className="text-sm font-semibold text-slate-900">{item.name}</strong>
                          <span className="text-[13px] text-slate-400">{item.role}</span>
                          <span className={recipientStatusClasses(item, requiresApproval)}>
                            {completionLabel(item, requiresApproval)}
                          </span>
                          {item.sourceType === 'tag' && item.sourceValue ? (
                            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                              Grupp: {item.sourceValue}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-slate-400">
                          <span>Tilldelad: {new Date(item.assignedAt).toLocaleString('sv-SE')}</span>
                          <span>Öppnad: {item.firstOpenedAt ? new Date(item.firstOpenedAt).toLocaleString('sv-SE') : 'Nej'}</span>
                          <span>
                            {requiresApproval ? 'Godkänd' : 'Klar'}:{' '}
                            {item.approvedAt
                              ? new Date(item.approvedAt).toLocaleString('sv-SE')
                              : item.firstOpenedAt
                                ? new Date(item.firstOpenedAt).toLocaleString('sv-SE')
                                : 'Nej'}
                          </span>
                        </div>

                        {item.approvalNote ? <div className="text-[13px] text-slate-700">Kommentar: {item.approvalNote}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>
      ) : null}
    </CrmModal>
  );
}
