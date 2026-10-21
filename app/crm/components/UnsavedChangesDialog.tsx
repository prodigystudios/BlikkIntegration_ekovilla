"use client";
import CrmConfirmDialog from '@/app/crm/components/CrmConfirmDialog';

// Frågan innan osparade ändringar lämnas. Samma rubrik och samma två val överallt — offerten och
// arbetsordern ska inte fråga på två olika sätt om samma sak. Bara meningen under rubriken skiljer:
// den säger vad som händer med just den ytans ändringar.
//
// 'danger': "Stanna kvar" har fokus, så ett reflexmässigt Enter behåller arbetet i stället för att
// kasta det.
export default function UnsavedChangesDialog({
  message,
  confirmLabel = 'Lämna utan att spara',
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <CrmConfirmDialog
      title="Osparade ändringar"
      message={message}
      cancelLabel="Stanna kvar"
      confirmLabel={confirmLabel}
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
