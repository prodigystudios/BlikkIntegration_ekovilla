import { Suspense } from 'react';
import QuoteFormClient from '../QuoteFormClient';

export const dynamic = 'force-dynamic';

export default function NyOffertPage() {
  return (
    <Suspense>
      <QuoteFormClient />
    </Suspense>
  );
}
