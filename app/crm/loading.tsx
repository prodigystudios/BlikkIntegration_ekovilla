import SectionCard from '../../components/ui/SectionCard';

export default function CrmLoading() {
  return (
    <div className="grid gap-3">
      <SectionCard className="grid gap-2.5 overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.12),_transparent_28%),linear-gradient(135deg,_#f6fbf4,_#e4f4e8_52%,_#f3faf4)] p-3 md:p-3.5 xl:p-4">
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.76fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.78fr)]">
          <div className="grid gap-2.5">
            <div className="grid gap-2">
              <div className="h-3 w-24 animate-pulse rounded-full bg-emerald-200/80" />
              <div className="h-10 w-72 max-w-full animate-pulse rounded-[18px] bg-white/70" />
              <div className="h-4 w-full max-w-2xl animate-pulse rounded-full bg-white/65" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <LoadingPanel key={index} className="h-24 rounded-[16px] border border-white/70 bg-white/80 p-3" />
              ))}
            </div>
          </div>
          <div className="grid gap-2 rounded-[22px] border border-slate-200/60 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(30,41,59,0.96))] p-2.5 shadow-[0_24px_44px_rgba(15,23,42,0.22)]">
            <div className="h-4 w-28 animate-pulse rounded-full bg-white/10" />
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {Array.from({ length: 3 }).map((_, index) => (
                <LoadingPanel key={index} className="h-20 rounded-[16px] border border-white/10 bg-white/5" dark />
              ))}
            </div>
            <LoadingPanel className="h-28 rounded-[18px] border border-white/10 bg-white/5" dark />
          </div>
        </div>
      </SectionCard>

      <div className="grid items-start gap-2.5 2xl:grid-cols-[minmax(0,1.16fr)_minmax(300px,0.62fr)]">
        <div className="grid gap-2.5">
          <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.92fr)]">
            <LoadingSectionCard />
            <LoadingSectionCard />
          </div>
          <div className="grid gap-x-2.5 gap-y-4 xl:grid-cols-2">
            <LoadingSectionCard />
            <LoadingSectionCard />
            <LoadingSectionCard />
            <LoadingSectionCard />
          </div>
        </div>
        <div className="hidden 2xl:block">
          <LoadingSectionCard tall />
        </div>
      </div>
    </div>
  );
}

function LoadingSectionCard({ tall = false }: { tall?: boolean }) {
  return (
    <SectionCard className="grid gap-2.5 rounded-[22px] border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-3 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
          <div className="h-6 w-40 animate-pulse rounded-full bg-slate-200" />
        </div>
        <div className="h-5 w-16 animate-pulse rounded-full bg-slate-200" />
      </div>
      <div className="grid gap-2.5">
        {Array.from({ length: tall ? 5 : 3 }).map((_, index) => (
          <LoadingPanel key={index} className="h-20 rounded-[18px] border border-slate-200 bg-white" />
        ))}
      </div>
    </SectionCard>
  );
}

function LoadingPanel({ className, dark = false }: { className: string; dark?: boolean }) {
  return <div className={`${className} animate-pulse ${dark ? 'bg-white/5' : 'bg-slate-100'}`} />;
}