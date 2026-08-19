"use client";
import CrmModal from '@/app/crm/components/CrmModal';
import { cn } from '@/lib/shared/cn';

// Bekräftelsedialog i CRM:s egen yta, i stället för webbläsarens window.confirm.
//
// Skälet är inte bara utseendet. `window.confirm` fryser hela fliken, kan inte bära formaterad
// text, och ser ut som ett systemvarningsfönster — i en app som annars äger sina dialoger läser
// det som att något gått fel. Den här delar CrmModal med appens övriga tolv modaler, så
// tangentbord, Escape, mobilens bottenark och överlagringen beter sig likadant överallt.
//
// Anropas genom att lägga undan det som ska ske och rendera dialogen; window.confirm blockerar,
// det här gör det inte.
export default function CrmConfirmDialog({
  title,
  message,
  confirmLabel = 'Bekräfta',
  cancelLabel = 'Avbryt',
  busy = false,
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  title: string;
  /** Bryts ut på egen rad under rubriken. Håll den till konsekvensen av att fortsätta. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Håller knapparna låsta medan åtgärden pågår, så den inte kan startas två gånger. */
  busy?: boolean;
  /**
   * 'danger' för åtgärder som tar bort något. Två skillnader mot 'primary', båda avsiktliga:
   * bekräftelseknappen bär rött i stället för CRM:ets primärgröna (grönt läser som "fortsätt,
   * det här är bra"), och autofokus flyttas till Avbryt — en dialog som finns för att fånga
   * felklick ska inte utföra åtgärden på ett reflexmässigt Enter.
   */
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dangerous = tone === 'danger';
  return (
    <CrmModal
      onClose={onCancel}
      ariaLabel={title}
      maxWidth="sm:max-w-[420px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {message ? <p className="m-0 mt-0.5 text-sm text-slate-500">{message}</p> : null}
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            autoFocus={dangerous}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:px-5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus={!dangerous}
            className={cn(
              'flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5',
              dangerous && 'bg-rose-600',
            )}
            style={dangerous ? undefined : { backgroundColor: 'var(--crm-primary)' }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {/* Kroppen är tom med flit: rubriken och meningen under den bär hela frågan, och en tom
          kropp håller dialogen på höjden av det den faktiskt frågar. */}
      <span className="sr-only">{message ?? title}</span>
    </CrmModal>
  );
}
