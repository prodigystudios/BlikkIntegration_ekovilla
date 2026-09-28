import type { EntityResult } from '@/app/crm/components/EntityCombobox';

/**
 * Kundsökningen bakom kundväljarna (EntityCombobox): `/api/crm/customers/search`, som namn med org.nr och ort under.
 * Delad av "Ny order", uppgiftsformulärets koppling och portalorderns koppling av butikens kort, som tidigare hade
 * var sin kopia av samma anrop.
 *
 * `businessOnly` visar bara företag: en portalorder kopplas till butikens kort, och butiken är ett företag (fas 3c).
 */
type SearchItem = {
  id: string;
  display_name: string;
  customer_type: 'private' | 'business';
  organization_number: string | null;
  city: string | null;
};

export async function searchCustomerOptions(query: string, options: { businessOnly?: boolean } = {}): Promise<EntityResult[]> {
  const res = await fetch(`/api/crm/customers/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  const items: SearchItem[] = json?.ok && Array.isArray(json?.data?.items) ? json.data.items : [];
  return items
    .filter((c) => !options.businessOnly || c.customer_type === 'business')
    .map((c) => ({
      id: c.id,
      label: c.display_name || 'Okänd kund',
      sublabel: [c.organization_number, c.city].filter(Boolean).join(' · ') || undefined,
    }));
}
