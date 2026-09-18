"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/shared/cn';

// Flikraden på ekonomiytan.
//
// Ytan bar länge EN sak (löneunderlaget) och behövde ingen navigering. Med fakturaunderlaget blev
// den två, och de två är olika arbetsuppgifter vid olika tillfällen i månaden — därför egna adresser
// med egna flikar, inte en sida som byter innehåll. Lönebyrån ska kunna bokmärka den de använder.
//
// Rader man inte har åtkomst till ritas inte alls. En avstängd flik hade ställt en fråga ("varför
// får jag inte?") som ytan inte kan svara på, och för den som bara har den ena halvan är den andra
// inte en begränsning utan något som inte finns.
//
// ⚠️ Visas inte alls när bara EN flik är kvar: en ensam flik är ingen navigering, bara en rubrik som
// upprepar sidans egen. Det är dagens läge för en ekonomianvändare utan fakturaunderlag, alltså
// exakt som ytan såg ut före den här ändringen.

export type EkonomiTab = { href: string; label: string };

export default function EkonomiTabs({ tabs }: { tabs: EkonomiTab[] }) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Ekonomi">
      {tabs.map((tab) => {
        // Detaljvyn (/ekonomi/arbetsorder/<id>) ska hålla sin flik tänd, så jämförelsen är ett
        // prefix — men `/ekonomi` är prefix till ALLT här, så den kräver exakt träff.
        const active = tab.href === '/ekonomi'
          ? pathname === '/ekonomi'
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            // Samma pillerform som arbetsorderns egna flikar, så de två ytorna inte har var sitt
            // flikspråk. 🧨 `p-0` behövs inte här: <a> träffas inte av husets globala button-regel.
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-semibold no-underline transition',
              active
                ? 'text-white'
                : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600 hover:border-[#cfdcc9]',
            )}
            style={active ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
