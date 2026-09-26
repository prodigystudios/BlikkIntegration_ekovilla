"use client";
// Sidan hämtar listan från /api/storage/list-all och kastar när svaret inte är ok. Utan den här
// gränsen blev ett sådant fel en naken 500 — nu står det vad som gick fel, på sidans plats.
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Egenkontroller</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Kunde inte ladda arkivet.</p>
      </div>
      <pre className="m-0 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error.message}</pre>
    </div>
  );
}
