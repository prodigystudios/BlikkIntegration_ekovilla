import { Suspense } from 'react';
import CustomerDetailClient from '../CustomerDetailClient';

export const dynamic = 'force-dynamic';

export default async function KundProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CustomerDetailClient customerId={id} />
    </Suspense>
  );
}
