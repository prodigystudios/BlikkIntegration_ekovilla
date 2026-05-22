"use client";

import Button from '../../../components/ui/Button';

type PreviewState = {
  id: string;
  url: string;
  fileName: string;
  contentType: string | null;
};

type DocumentsPreviewPanelProps = {
  previewLoading: boolean;
  previewError: string | null;
  preview: PreviewState | null;
  onDownloadFile: (fileId: string) => void;
  onClose: () => void;
};

export default function DocumentsPreviewPanel({
  previewLoading,
  previewError,
  preview,
  onDownloadFile,
  onClose,
}: DocumentsPreviewPanelProps) {
  if (!previewLoading && !previewError && !preview) {
    return null;
  }

  return (
    <div className="border-b border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="font-extrabold text-ui-text-strong">
          Förhandsvisning
          {preview?.fileName ? <span className="font-bold text-ui-text-soft"> {'—'} {preview.fileName}</span> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {preview?.id ? (
            <Button variant="secondary" size="sm" onClick={() => onDownloadFile(preview.id)}>
              Ladda ner
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Stäng
          </Button>
        </div>
      </div>

      {previewLoading ? <div className="mt-2.5 text-[13px] text-ui-text-soft">Laddar förhandsvisning…</div> : null}
      {!previewLoading && previewError ? <div className="mt-2.5 text-[13px] text-red-700">{previewError}</div> : null}

      {!previewLoading && preview ? (
        <div className="mt-2.5">
          {preview.contentType?.startsWith('image/') ? (
            <div className="grid place-items-center rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <img
                src={preview.url}
                alt={preview.fileName}
                style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 10 }}
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <iframe title={preview.fileName} src={preview.url} style={{ width: '100%', height: 520, border: 'none', display: 'block' }} />
            </div>
          )}

          <div className="mt-2 text-xs text-ui-text-soft">Om förhandsvisningen inte fungerar för filtypen, använd “Ladda ner”.</div>
        </div>
      ) : null}
    </div>
  );
}