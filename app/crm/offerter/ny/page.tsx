import { Suspense } from 'react';
import QuoteFormClient from '../QuoteFormClient';
import { canReassignQuote } from '../quotePermissions';

export const dynamic = 'force-dynamic';

export default async function NyOffertPage() {
  const canReassign = await canReassignQuote();

  return (
    <Suspense>
      <QuoteFormClient canReassign={canReassign} />
    </Suspense>
  );
}
