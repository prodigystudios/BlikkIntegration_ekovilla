"use client";

import { useEffect, useState } from 'react';

export type CustomerContact = { contactName: string | null; phone: string | null; email: string | null };

// Loads the customer contact (name/phone/email) to show on a work order. Goes through the
// work-order-scoped endpoint (open to any signed-in user) rather than the CRM-gated
// customer endpoint, so installers/member also get the contact — and only these three
// fields are exposed, not the full customer record. Shared by editor + installer view.
export function useCustomerContact(workOrderId: string | null | undefined): CustomerContact | null {
  const [contact, setContact] = useState<CustomerContact | null>(null);

  useEffect(() => {
    if (!workOrderId) { setContact(null); return; }
    let active = true;
    fetch(`/api/crm/work-orders/${workOrderId}/customer-contact`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setContact(json?.ok ? (json.data?.contact ?? null) : null); })
      .catch(() => { if (active) setContact(null); });
    return () => { active = false; };
  }, [workOrderId]);

  return contact;
}
