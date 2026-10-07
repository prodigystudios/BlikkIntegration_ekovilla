// Hur en kund visas: namnet och initialerna i rutan framför det. Delas av kundregistret och
// offertformulärets kundkort, så samma kund ser likadan ut på båda ställena. Ren logik, enhetstestad.

export type CustomerNameFields = {
  customer_type: 'business' | 'private';
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

export function customerDisplayName(item: CustomerNameFields): string {
  if (item.customer_type === 'business') return item.company_name?.trim() || 'Okänt företag';
  const parts = [item.first_name?.trim(), item.last_name?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Okänd kund';
}

// Första TECKNET, inte första UTF-16-enheten: ett "Å" inklistrat som A + ring, eller en emoji först i
// namnet, hade annars gett ett halvt tecken i rutan.
function firstChar(word: string | null | undefined): string {
  return Array.from((word ?? '').trim().normalize('NFC'))[0] ?? '';
}

// Initialerna följer SAMMA namn som står bredvid dem: ett företag utan företagsnamn heter "Okänt
// företag" och får "?", inte initialer ur ett för- och efternamn som inte syns.
export function customerInitials(item: CustomerNameFields): string {
  if (item.customer_type === 'business') {
    const words = (item.company_name ?? '').trim().normalize('NFC').split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    return (words.length >= 2
      ? firstChar(words[0]) + firstChar(words[1])
      : Array.from(words[0]).slice(0, 2).join('')).toUpperCase();
  }
  return (firstChar(item.first_name) + firstChar(item.last_name)).toUpperCase() || '?';
}
