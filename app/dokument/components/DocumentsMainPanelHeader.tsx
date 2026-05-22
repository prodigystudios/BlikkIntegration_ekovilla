"use client";

import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

type DocumentsMainPanelHeaderProps = {
  currentFolderName: string | null;
  statusText: string;
  fileSearchMode: 'folder' | 'all';
  fileSearch: string;
  isCompactViewport: boolean;
  onToggleSearchMode: () => void;
  onFileSearchChange: (value: string) => void;
  onClearSearch: () => void;
};

export default function DocumentsMainPanelHeader({
  currentFolderName,
  statusText,
  fileSearchMode,
  fileSearch,
  isCompactViewport,
  onToggleSearchMode,
  onFileSearchChange,
  onClearSearch,
}: DocumentsMainPanelHeaderProps) {
  const searchLabel = fileSearchMode === 'all' ? 'Sök i hela dokumentarkivet' : 'Sök i aktuell mapp';
  const searchPlaceholder = fileSearchMode === 'all' ? 'Sök filer i alla mappar…' : 'Sök filer…';

  return (
    <div
      className="grid gap-3 border-b border-slate-200 bg-[linear-gradient(180deg,#fbfdff,#f8fafc)]"
      style={{ padding: isCompactViewport ? '14px 12px' : '14px 14px' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-lg font-extrabold text-ui-text-strong">{currentFolderName || 'Rot'}</div>
          <div className="text-xs text-ui-text-soft">{statusText}</div>
        </div>

        <Button
          variant={fileSearchMode === 'all' ? 'accent' : 'secondary'}
          size={isCompactViewport ? 'sm' : 'md'}
          onClick={onToggleSearchMode}
          title={fileSearchMode === 'all' ? 'Söker i alla mappar' : 'Söker i aktuell mapp'}
        >
          {fileSearchMode === 'all' ? 'Sök i alla mappar' : 'Sök i denna mapp'}
        </Button>
      </div>

      <div className={isCompactViewport ? 'grid gap-2' : 'grid items-end gap-2 [grid-template-columns:minmax(0,1fr)_auto]'}>
        <label className="grid gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">{searchLabel}</span>
          <Input
            value={fileSearch}
            onChange={(event) => onFileSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClearSearch();
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {fileSearch.trim() ? (
            <Button variant="secondary" size={isCompactViewport ? 'sm' : 'md'} onClick={onClearSearch}>
              Rensa sökning
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}