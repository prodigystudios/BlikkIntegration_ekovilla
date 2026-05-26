import SectionCard from '../../../components/ui/SectionCard';

export default function CrmPlaceholder({
  eyebrow,
  title,
  description,
  bullets,
}: {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <div className="grid gap-4">
      <SectionCard className="grid gap-3 p-5 md:p-6">
        <div className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">{eyebrow}</span>
          <h1 className="m-0 text-2xl font-bold tracking-[-0.03em] text-slate-900 md:text-3xl">{title}</h1>
          <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">{description}</p>
        </div>
      </SectionCard>

      <SectionCard className="grid gap-3 p-5 md:p-6">
        <strong className="text-base font-bold text-slate-900">Planerad första implementation</strong>
        <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-slate-600">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}