import { Suspense } from 'react';
import QuoteFormClient from '../../QuoteFormClient';
import { canReassignQuote } from '../../quotePermissions';

export const dynamic = 'force-dynamic';

export default async function RedigeraOffertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canReassign = await canReassignQuote();

  return (
    <Suspense>
      <QuoteFormClient quoteId={id} canReassign={canReassign} />
    </Suspense>
  );
}
