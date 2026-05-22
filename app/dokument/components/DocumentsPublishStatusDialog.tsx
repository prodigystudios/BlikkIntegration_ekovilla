"use client";

import Button from '../../../components/ui/Button';
import DialogShell from '../../../components/ui/DialogShell';
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
  switch (tone) {
    case 'danger':
      return 'inline-flex items-center rounded-full bg-red-100 px-2.5 py-1.5 text-xs font-bold text-red-800';
    case 'warning':
      return 'inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-800';
    case 'success':
      return 'inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1.5 text-xs font-bold text-emerald-800';
    default:
      return 'inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700';
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
    <DialogShell
      eyebrow="Uppföljning"
      title="Kvittensstatus"
      description={publishStatusUi.file.file_name}
      onClose={onClose}
      panelClassName="max-w-[1100px]"
    >
      {publishStatusUi.loadingPublications ? <div className="text-ui-text-soft">Laddar publiceringar…</div> : null}

      {!publishStatusUi.loadingPublications && publishStatusUi.publications.length === 0 ? (
        <div className="rounded-[14px] border border-slate-200 bg-white p-3.5">
          Inga publiceringar finns ännu för det här dokumentet.
        </div>
      ) : null}

      {!publishStatusUi.loadingPublications && publishStatusUi.publications.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            {publishStatusUi.publications.map((publication) => {
              const active = publication.id === publishStatusUi.selectedPublicationId;

              return (
                <Button
                  key={publication.id}
                  variant={active ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onSelectPublication(publication.id)}
                >
                  {publication.title}
                  {publication.version_label ? ` • ${publication.version_label}` : ''}
                </Button>
              );
            })}
          </div>

          {publishStatusUi.error ? <div className="text-red-800">{publishStatusUi.error}</div> : null}
          {publishStatusUi.loadingStatus ? <div className="text-ui-text-soft">Laddar mottagarstatus…</div> : null}

          {publishStatusUi.status && !publishStatusUi.loadingStatus ? (
            (() => {
              const status = publishStatusUi.status;
              const requiresApproval = status.publication.requires_approval;

              return (
                <div className="grid gap-4">
                  <div className="flex flex-wrap gap-2.5">
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
                        className="grid gap-2.5 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#fbfdff)] px-3.5 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2.5">
                          <strong className="text-slate-900">{item.name}</strong>
                          <span className="text-[13px] text-ui-text-soft">{item.role}</span>
                          <span className={recipientStatusClasses(item, requiresApproval)}>
                            {completionLabel(item, requiresApproval)}
                          </span>
                          {item.sourceType === 'tag' && item.sourceValue ? (
                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700">
                              Grupp: {item.sourceValue}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ui-text-soft">
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
        </>
      ) : null}
    </DialogShell>
  );
}