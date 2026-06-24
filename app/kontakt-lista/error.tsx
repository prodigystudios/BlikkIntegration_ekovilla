"use client";
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Kontakt & adresser</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Kunde inte ladda kontaktlistan.</p>
      </div>
      <pre className="m-0 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error.message}</pre>
    </div>
  );
}
