export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Kontakt & adresser</h1>
        <p className="m-0 mt-1 text-sm text-slate-400">Laddar kontakter…</p>
      </div>
      <div className="grid gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7]" />
        ))}
      </div>
    </div>
  );
}
