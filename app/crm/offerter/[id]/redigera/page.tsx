import { Suspense } from 'react';
import QuoteFormClient from '../../QuoteFormClient';

export const dynamic = 'force-dynamic';

export default async function RedigeraOffertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <QuoteFormClient quoteId={id} />
    </Suspense>
  );
}
