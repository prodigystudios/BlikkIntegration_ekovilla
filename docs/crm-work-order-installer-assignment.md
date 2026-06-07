# Arbetsorder ↔ installatörer (tilldelning via planeringen)

Status: **planerad framtida integration — ej implementerad.** Byggs när CRM:et känns klart
och säljarna börjar arbeta i det. Detta dokument beskriver den avsedda modellen så att
arbetsorder-RLS och fält-vyn (`/arbetsorder/[id]`) kan färdigställas korrekt sen.

## Avsedd modell

Installatörer tilldelas inte arbetsordrar direkt i CRM:et. Tilldelningen sker via
**planeringen**:

1. Installatörer är kopplade till **fordon/bilar** i planeringen (befintligt:
   `planning_truck_assignments`, lag-/crew-kopplingar).
2. När en arbetsorder läggs ut i planeringsschemat och en **specifik bil** sätts på den,
   blir bilens installatörer **tilldelade den arbetsordern** och ser den i sitt
   arbetsorder-schema.
3. Installatören öppnar sin arbetsorder via **direktlänk** → `/arbetsorder/[id]`
   (fält-vyn: läs essentials + skriv tid/kommentar).

Därför finns `member` (installatör) medvetet **inte** i CRM:ets ansvarig-väljare
(`listAssignableCrmUsers` = sales/admin/konsult) — installatörstilldelning är inte ett
CRM-handgrepp utan ett planeringssteg.

## RLS-beroende (viktigt för integrationen)

Arbetsorder-vyn för installatörer vilar på att de kan **läsa** arbetsordern och **skriva**
tid/kommentar. Nuvarande RLS (dashboard-skapad) är tilldelnings-baserad:

- `crm_work_orders` SELECT: `assigned_to = auth.uid()` eller CRM-roll (sales/admin/konsult).
- `crm_work_order_time_entries` / `_comments`: egna rader eller (WO:ns `assigned_to` =
  auth.uid()) eller admin. INSERT kräver att man är WO:ns `assigned_to` (eller admin).

→ En installatör kan alltså läsa/logga på en arbetsorder **endast om hen är `assigned_to`**.

### Konsekvens: `assigned_to` är ETT fält, men en bil har flera installatörer
Dagens `crm_work_orders.assigned_to` rymmer en (1) användare. En bil-crew är flera. Den
framtida integrationen behöver därför ett av:
- en **koppling arbetsorder ↔ installatör(er)** (egen tabell, likt `planning_truck_assignments`), och RLS som kontrollerar den kopplingen istället för/utöver `assigned_to`, **eller**
- sätta `assigned_to` per installatör (fungerar bara för en person per order — otillräckligt för crew).

Rekommendation: en mappningstabell (work_order ↔ user) som planeringen fyller när bil sätts
på ordern, och som arbetsorder-/tid-/kommentar-RLS:en läser för "är jag på den här ordern".

## Tills integrationen finns
- Installatörstilldelning sätts **manuellt** (DB / `assigned_to`) för test.
- Fält-vyn (`/arbetsorder/[id]`), kundkontakt-endpointen och tid/kommentar-CRUD är redan
  byggda och fungerar så fort en installatör är tilldelad.
