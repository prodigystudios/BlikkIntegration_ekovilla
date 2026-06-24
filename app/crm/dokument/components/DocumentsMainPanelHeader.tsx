"use client";

import Input from '../../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm } from '../../lib/crmTokens';

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
  const allMode = fileSearchMode === 'all';

  return (
    <div className="grid gap-3 border-b border-[#e0e8dc] bg-[#f6f9f3] px-3.5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="text-sm font-bold tracking-tight text-slate-900">{currentFolderName || 'Rot'}</div>
          <div className="text-xs text-slate-400">{statusText}</div>
        </div>

        <button
          type="button"
          onClick={onToggleSearchMode}
          title={allMode ? 'Söker i alla mappar' : 'Söker i aktuell mapp'}
          className={cn(
            'inline-flex items-center rounded-xl border px-2.5 py-1 text-[13px] font-semibold transition',
            allMode ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
          )}
          style={allMode ? { backgroundColor: 'var(--crm-primary)' } : undefined}
        >
          {allMode ? 'Sök i alla mappar' : 'Sök i denna mapp'}
        </button>
      </div>

      <div className={isCompactViewport ? 'grid gap-2' : 'grid items-end gap-2 [grid-template-columns:minmax(0,1fr)_auto]'}>
        <label className="grid gap-1.5">
          <span className={crm.label}>{searchLabel}</span>
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
            <button type="button" onClick={onClearSearch} className={crm.ghostButton}>
              Rensa sökning
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
