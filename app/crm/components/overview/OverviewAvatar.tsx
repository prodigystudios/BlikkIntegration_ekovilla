import { cn } from '@/lib/shared/cn';
import { initials } from './scoreboardView';

// Initialer i stället för profilbild — appen har inga profilbilder, och att införa dem rör
// profiles, som är ett pausat område. En ton för alla: en färg per person hade lagt sex nya
// hues på en sida där färgen redan betyder framsteg, stjärna och status. Spårets salvia och inte
// --ek-accent-soft: den tonen är reserverad för interaktiva ytor (en vald flik), och en avatar
// bredvid topplistans flikar hade då sett klickbar ut.
export default function OverviewAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--crm-track)] text-[11px] font-bold leading-none text-[color:var(--ek-green)]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
