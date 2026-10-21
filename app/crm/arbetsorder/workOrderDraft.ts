import type { WorkOrderStatus } from '@/app/crm/lib/crmTokens';

// Översiktens redigeringsutkast och dess sparade utgångsläge.
//
// En enda definition av "så ser ordern ut i formuläret" — Avbryt återställer till den, och
// osparat-kontrollen jämför mot den. Två uppsättningar hade förr eller senare sagt olika: ett fält
// som Avbryt återställer men kontrollen inte känner till är ett fält vars ändring går förlorad utan
// fråga.

export type WorkOrderDraft = {
  // Orderns titel. Blir textraden `Projekt: X` på Fortnox-ordern — se workOrderDocumentNoteChanged.
  project_name: string;
  status: WorkOrderStatus;
  assigned_to: string;
  desired_installation_date: string;
  street_address: string;
  postal_code: string;
  city: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  // Slutkunden på plats — en ANNAN person än kundens kontakt, fångad utanför kundkortet.
  // Vinner över kundkontakten i det installatörerna ser (getWorkOrderCustomerContact).
  end_contact_name: string;
  end_contact_phone: string;
  end_contact_email: string;
  your_reference: string;
  // Märkning → Fortnox YourOrderNumber. Bara företagskund, som i offerten.
  label: string;
  // ROT-uppgifterna. Arbetsordern ÄGER dem — offerten är låst när ordern finns, och ordern är
  // sanningen om vad vi fakturerar (resolveOrderRotDetails).
  rot_enabled: boolean;
  rot_property_designation: string;
  rot_percent: string;
  rot_max_deduction: string;
  rot_brf_org_number: string;
  work_scope: string;
  handoff_notes: string;
  notes: string;
};

/** Det ur arbetsordern som utkastet byggs av. */
export type WorkOrderDraftSource = {
  project_name: string | null;
  status: WorkOrderStatus;
  assigned_to: string | null;
  desired_installation_date: string | null;
  work_address: { street_address?: string | null; postal_code?: string | null; city?: string | null } | null;
  customer_snapshot: Record<string, any> | null;
  rot_details: Record<string, any> | null;
  internal_handoff: { work_scope?: string | null; handoff_notes?: string | null } | null;
  notes: string | null;
};

export function workOrderDraftFrom(item: WorkOrderDraftSource): WorkOrderDraft {
  return {
    project_name: item.project_name || '',
    status: item.status,
    assigned_to: item.assigned_to || '',
    desired_installation_date: item.desired_installation_date || '',
    street_address: item.work_address?.street_address || '',
    postal_code: item.work_address?.postal_code || '',
    city: item.work_address?.city || '',
    contact_name: item.customer_snapshot?.contact_name || '',
    contact_phone: item.customer_snapshot?.phone || '',
    contact_email: item.customer_snapshot?.email || '',
    end_contact_name: item.customer_snapshot?.end_contact_name || '',
    end_contact_phone: item.customer_snapshot?.end_contact_phone || '',
    end_contact_email: item.customer_snapshot?.end_contact_email || '',
    // Ordrar skapade innan Er referens blev ett eget fält har den kvar i contact_name — visa den
    // därifrån, annars ser fältet tomt ut fast Fortnox har ett värde.
    your_reference: item.customer_snapshot?.your_reference ?? item.customer_snapshot?.contact_name ?? '',
    label: item.customer_snapshot?.label || '',
    rot_enabled: item.rot_details?.enabled === true,
    rot_property_designation: item.rot_details?.property_designation || '',
    // Tomt fält när värdet saknas, ALDRIG en påhittad default. En ruta som visar "30" på en order
    // vars rot_details aldrig burit någon procent påstår ett värde vi inte har.
    rot_percent: item.rot_details?.rot_percent != null ? String(item.rot_details.rot_percent) : '',
    rot_max_deduction: item.rot_details?.max_deduction != null ? String(item.rot_details.max_deduction) : '',
    rot_brf_org_number: item.rot_details?.brf_org_number || '',
    work_scope: item.internal_handoff?.work_scope || '',
    handoff_notes: item.internal_handoff?.handoff_notes || '',
    notes: item.notes || '',
  };
}

/** Är reglaget "Slutkund på plats" påslaget i utgångsläget? Ja så fort ordern bär någon av uppgifterna. */
export function workOrderHasEndContact(item: Pick<WorkOrderDraftSource, 'customer_snapshot'>): boolean {
  return Boolean(
    item.customer_snapshot?.end_contact_name
    || item.customer_snapshot?.end_contact_phone
    || item.customer_snapshot?.end_contact_email,
  );
}

/**
 * Skiljer sig utkastet från den sparade ordern — alltså: hade Spara ändrat något?
 *
 * ⚠️ Slutkunden jämförs som Spara SKICKAR den, inte som fälten står. Ett avslaget reglage skickar tomt
 * (och rensar en sparad slutkund) hur fälten under än ser ut; ett påslaget reglage utan ifyllda fält
 * skickar också tomt. Att bara slå på reglaget är alltså ingen ändring, men att slå av det på en order
 * som har en slutkund är det.
 */
export function workOrderDraftChanged(
  draft: WorkOrderDraft,
  endContactOpen: boolean,
  item: WorkOrderDraftSource,
): boolean {
  const saved = workOrderDraftFrom(item);
  const effective: WorkOrderDraft = endContactOpen
    ? draft
    : { ...draft, end_contact_name: '', end_contact_phone: '', end_contact_email: '' };
  return (Object.keys(saved) as Array<keyof WorkOrderDraft>).some((key) => effective[key] !== saved[key]);
}
