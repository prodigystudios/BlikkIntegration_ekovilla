"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from "react";
import { useUserProfile } from "@/lib/UserProfileContext";
import { cn } from "@/lib/shared/cn";
import { crm } from "@/app/crm/lib/crmTokens";
import { buildOrderSummary, type SectionState } from "./order";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"] as const;
const SIZESPants = ["40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60", "62"] as const;

const initialSection = (key: string, title: string, sizes: readonly string[] = SIZES): SectionState => ({
  key,
  title,
  rows: sizes.map((s) => ({ size: s, selected: false })),
  qty: 1,
});

const makeSections = (): SectionState[] => [
  initialSection("tshirt", "T-shirt"),
  initialSection("tjocktroja", "Tjocktröja"),
  initialSection("byxor", "Byxor", SIZESPants),
  initialSection("shorts", "Shorts", SIZESPants),
  initialSection("jacka", "Jacka"),
  initialSection("vinterjacka", "Vinterjacka"),
];

export default function BestallningKladerPage() {
  const profile = useUserProfile();
  const [title, setTitle] = useState("Beställning kläder");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState(profile?.full_name ?? "");
  const [dueDate, setDueDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sections, setSections] = useState<SectionState[]>(makeSections);

  useEffect(() => {
    if (!comment && profile?.full_name) setComment(profile.full_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.full_name]);

  function setSectionSelectedSize(sectionIndex: number, size: string | '') {
    setSections((prev) =>
      prev.map((sec, si) =>
        si === sectionIndex ? { ...sec, rows: sec.rows.map((r) => ({ ...r, selected: r.size === size && size !== '' })) } : sec,
      ),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const orderSummary = buildOrderSummary(sections);
      const finalDescription = [description?.trim(), orderSummary].filter(Boolean).join("\n\n");
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: finalDescription,
          dueDate: dueDate || undefined,
          requesterName: comment || undefined,
          source: 'clothing_order',
          metadata: { sections },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message || json?.legacyError || json?.error || "Misslyckades att skapa uppgift");
      const createdId = json?.data?.createdId || json?.createdId;
      setResult({ ok: true, message: `Uppgift skapad (ID: ${createdId}).` });
      setDescription("");
      setSections(makeSections());
    } catch (err: any) {
      setResult({ ok: false, message: err?.message || "Något gick fel" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[800px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Beställning kläder</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Skicka in behov av kläder så skapas en intern uppgift till ansvarig.</p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className={crm.label}>Titel</span>
          <input className={crm.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" required />
        </label>

        <div className={cn(crm.cardInner, 'grid gap-3')}>
          <p className={crm.sectionTitle}>Plagg & storlekar</p>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {sections.map((sec, si) => {
              const picked = sec.rows.find((r) => r.selected)?.size || '';
              return (
                <div key={sec.key} className="grid gap-1.5 rounded-xl border border-[#e3e9df] bg-white px-3 py-2.5">
                  <span className="text-[13px] font-semibold text-slate-900">{sec.title}</span>
                  <div className="flex items-center gap-2">
                    <select className={cn(crm.select, 'flex-1')} value={picked} onChange={(e) => setSectionSelectedSize(si, e.target.value)}>
                      <option value="">Välj storlek…</option>
                      {sec.rows.map((r) => (
                        <option key={`${sec.key}-${r.size}`} value={r.size}>{r.size}</option>
                      ))}
                    </select>
                    {picked && (
                      <button type="button" onClick={() => setSectionSelectedSize(si, '')} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800">
                        Rensa
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <label className="grid gap-1.5">
          <span className={crm.label}>Övrig beskrivning (valfritt)</span>
          <textarea
            className="min-h-24 w-full resize-y appearance-none rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 hover:border-[#c8d4c3] focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ev. extra detaljer (färg, modell, leveransinfo, mm)"
            rows={5}
          />
        </label>

        <label className="grid gap-1.5">
          <span className={crm.label}>Namn på beställaren</span>
          <input className={crm.input} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tex Jonas Svensson" autoComplete="name" required />
        </label>

        <label className="grid gap-1.5 sm:max-w-[260px]">
          <span className={crm.label}>Förfallodatum (valfritt)</span>
          <input className={crm.input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {submitting ? "Skickar…" : "Skicka beställning"}
          </button>
          {result && <div className={cn('text-sm font-medium', result.ok ? 'text-emerald-700' : 'text-rose-700')}>{result.message}</div>}
        </div>
      </form>
    </div>
  );
}
