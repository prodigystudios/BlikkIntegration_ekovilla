"use client";

import { useEffect, useState } from 'react';

export type AssigneeContact = {
  /** Den ansvariges namn. Null när profilen saknar ett — då bär raden bara numret. */
  name: string | null;
  phone: string | null;
};

// Loads the work order's assignee (name + phone) — who sold the job, i.e. who the crew calls when
// something on the order doesn't add up. Goes through the work-order-scoped endpoint (open to any
// signed-in user) because `profiles` is self-read-only, so the `assignee` embed on the order itself
// is null for everyone but yourself, and /work-orders/assignees is CRM-gated and closed to member.
// See app/api/crm/work-orders/[id]/assignee-contact/route.ts for the access model.
//
// null = ingen ansvarig att visa (otilldelad order, eller en profil utan både namn och nummer).
// Ett laddningsläge saknas med flit: kortet är en tillägsuppgift, och en skelettruta som blinkar
// förbi ovanför arbetsbeskrivningen hade flyttat sidans innehåll efter första rendern.
export function useAssigneeContact(workOrderId: string | null | undefined): AssigneeContact | null {
  const [contact, setContact] = useState<AssigneeContact | null>(null);

  useEffect(() => {
    // 🧨 NOLLSTÄLL FÖRE HÄMTNINGEN, inte bara när id:t försvinner. Byter ordern utan att
    // komponenten monteras om står FÖRRA orderns säljare kvar tills svaret kommer — med ett
    // ringbart nummer under sig. Att ringa fel person står det ingenstans i kortet att man gör.
    setContact(null);
    if (!workOrderId) return;
    let active = true;
    fetch(`/api/crm/work-orders/${workOrderId}/assignee-contact`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setContact(json?.ok ? (json.data?.contact ?? null) : null); })
      .catch(() => { if (active) setContact(null); });
    return () => { active = false; };
  }, [workOrderId]);

  return contact;
}
