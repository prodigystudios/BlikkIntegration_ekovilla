"use client";

import { useEffect, useState } from 'react';

export type AssigneeContact = {
  /** Den ansvariges namn. Null när profilen saknar ett — då bär raden bara numret. */
  name: string | null;
  phone: string | null;
};

// Loads the work order's assignee (name + phone) — the person on the office side the crew calls
// when something on the order doesn't add up. Goes through a work-order-scoped endpoint because
// `profiles` is self-read-only, so the `assignee` embed on the order itself is null for everyone
// but yourself, and /work-orders/assignees is CRM-gated and closed to member.
//
// ⚠️ ÄNDPUNKTEN ÄR RLS-GRINDAD, inte öppen för vem som helst med länken: läsaren måste kunna se
// arbetsordern under sin egen RLS (besättningen via crm_work_orders_select_crew, kontoret via
// crm.workorder.read; `konsult` nekas som extern part). Hela modellen står i
// app/api/crm/work-orders/[id]/assignee-contact/route.ts — läs den innan du hänger något nytt här.
//
// 🧨 ETT NEKAT SVAR SER UT SOM EN OTILLDELAD ORDER: båda ger null, med flit. Bygg alltså inget som
// tolkar null som "ordern saknar ansvarig" — det enda null betyder är "inget kort att visa".
//
// null = inget att visa (otilldelad order, order läsaren inte når, eller en profil utan uppgifter).
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
