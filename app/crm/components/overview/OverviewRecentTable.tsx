// Översiktens två tabeller, Senaste offerter och Senaste ordrar, står på CRM:ets delade CrmTable
// (app/crm/components/CrmTable.tsx) i tätheten `compact`. Här bor bara deras kolumnbredder.

// Bredderna, samma i båda tabellerna så att de står i linje bredvid varandra. Numret göms under
// 640 px och datumet under 768 px: på telefon räcker kund, belopp och status.
export const recentWidth = {
  // Bryts i stället för att kortas: ett osynkat ordernummer ('AO-20261005-3AA748', 18 tecken) är
  // det längsta, och de skiljer sig först i slutet — bindestrecken är brytpunkterna.
  number: 'hidden w-[6.5rem] break-words tabular-nums text-slate-500 sm:table-cell',
  name: '',
  // Smalare på telefon, så att kundnamnet får plats vid 360 px. "1 250 000 kr" ryms i båda.
  amount: 'w-[5.5rem] whitespace-nowrap text-right tabular-nums sm:w-[6.25rem]',
  date: 'hidden w-[5.75rem] whitespace-nowrap tabular-nums text-slate-500 md:table-cell',
  status: 'w-[6.75rem] text-right',
} as const;
