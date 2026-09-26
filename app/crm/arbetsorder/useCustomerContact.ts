"use client";

import { useEffect, useState } from 'react';

export type CustomerContact = {
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Kundens EGEN adress. Bara för utskick — visa den aldrig som kontaktpersonens. */
  customerEmail?: string | null;
  /** Sant när uppgifterna är slutkundens på plats, alltså en ANNAN person än kundens kontakt. */
  isOnSiteContact?: boolean;
  /**
   * Sant när `phone` är LÅNAT av kunden för att slutkunden saknar eget nummer. Numret går att
   * ringa — det är hela poängen med lånet — men det tillhör någon annan än `contactName`, och en
   * vy som skriver namnet över numret utan att säga det skickar besättningen till fel person.
   */
  phoneFromCustomer?: boolean;
};

// Loads the customer contact (name/phone/email) to show on a work order. Goes through the
// work-order-scoped endpoint rather than the CRM-gated customer endpoint, so the crew (installers,
// member) also get the contact — and only these three fields are exposed, not the full customer
// record. The endpoint answers only for an order the reader can see under their own RLS (crew policy
// or crm.workorder.read); otherwise `null`, same as an order without a contact. Shared by editor +
// installer view.
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
