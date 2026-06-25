export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Egenkontroller</h1>
        <p aria-live="polite" className="m-0 mt-1 text-sm text-slate-400">Laddar arkiv…</p>
      </div>
      <div className="grid gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-[#e3e9df] bg-[#f9fbf7]" />
        ))}
      </div>
    </div>
  );
}
