// Hur en kund visas: namnet och initialerna i rutan framför det. Delas av kundregistret och
// offertformulärets kundkort, så samma kund ser likadan ut på båda ställena. Ren logik, enhetstestad.

export type CustomerNameFields = {
  customer_type: 'business' | 'private';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

export function customerDisplayName(item: CustomerNameFields): string {
  if (item.customer_type === 'business') return item.company_name || 'Okänt företag';
  const parts = [item.first_name, item.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}

export function customerInitials(item: CustomerNameFields): string {
  if (item.customer_type === 'business' && item.company_name) {
    const words = item.company_name.trim().split(/\s+/);
    return words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : words[0].slice(0, 2).toUpperCase();
  }
  const f = item.first_name?.[0] ?? '';
  const l = item.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || '?';
}
