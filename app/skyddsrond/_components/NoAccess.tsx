import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

// Den som saknar båda skyddsrondsnycklarna. Säger vad som saknas och vem som kan ge det — inte bara
// "403".
export default function NoAccess() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <h1 className={cn('m-0', crm.pageTitle)}>Skyddsronder</h1>
      <div className={cn(crm.cardInner, 'grid gap-2 p-4')}>
        <p className={cn('m-0', crm.bodyStrong)}>Du har inte behörighet till skyddsronder</p>
        <p className={cn('m-0', crm.meta)}>
          Rondledare får behörigheten av en administratör. Kontakta kontoret om du ska leda skyddsronder.
        </p>
      </div>
    </div>
  );
}
