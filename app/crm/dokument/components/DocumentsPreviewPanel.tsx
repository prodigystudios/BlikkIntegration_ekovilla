"use client";

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

const buttonClass =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800';

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
    <div className="border-b border-[#e0e8dc] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-sm font-bold text-slate-900">
          Förhandsvisning
          {preview?.fileName ? <span className="font-semibold text-slate-400"> {'—'} {preview.fileName}</span> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {preview?.id ? (
            <button type="button" className={buttonClass} onClick={() => onDownloadFile(preview.id)}>
              Ladda ner
            </button>
          ) : null}
          <button type="button" className={buttonClass} onClick={onClose}>
            Stäng
          </button>
        </div>
      </div>

      {previewLoading ? <div className="mt-2.5 text-[13px] text-slate-400">Laddar förhandsvisning…</div> : null}
      {!previewLoading && previewError ? <div className="mt-2.5 text-[13px] text-rose-700">{previewError}</div> : null}

      {!previewLoading && preview ? (
        <div className="mt-2.5">
          {preview.contentType?.startsWith('image/') ? (
            <div className="grid place-items-center rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-2.5">
              <img
                src={preview.url}
                alt={preview.fileName}
                className="max-h-[520px] max-w-full rounded-lg object-contain"
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#e0e8dc] bg-white">
              <iframe title={preview.fileName} src={preview.url} className="block h-[520px] w-full border-0" />
            </div>
          )}

          <div className="mt-2 text-xs text-slate-400">Om förhandsvisningen inte fungerar för filtypen, använd ”Ladda ner”.</div>
        </div>
      ) : null}
    </div>
  );
}
