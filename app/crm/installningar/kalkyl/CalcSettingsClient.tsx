"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import Input from '@/components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import type { MaterialCostArticleView } from '@/lib/domains/crm/calcSettings';

// Kalkylinställningarna — de två talen efterkalkylen på arbetsordern vilar på.
//
// Sidan är avsiktligt två kort och ingenting annat: en sats och en kopplingslista. Allt som räknas
// med dem bor på arbetsordern, och en förhandsvisning här hade bara varit en andra plats där samma
// siffra kan visas fel.
//
// ⚠️ VARJE RAD SÄGER VAD FORTNOX FAKTISKT SVARADE. Ett artikelnummer utan pris ser identiskt ut med
// ett som har pris så länge man bara visar numret — och den skillnaden är hela skälet till att
// efterkalkylen ibland säger "kostnadsartikel saknas". Statusraden under varje fält är alltså inte
// dekoration, den är svaret på varför kalkylen ser ut som den gör.

type CalcSettingsClientProps = {
  tablesMissing: boolean;
  initialLaborCostPerHour: number | null;
  initialMaterials: MaterialCostArticleView[];
  knownMaterials: string[];
};

type MaterialRow = {
  material: string;
  /** false = kortkoden går inte att rapportera i fält än (seedad i förväg, t.ex. ROCKWOOL). */
  reportable: boolean;
  view: MaterialCostArticleView | null;
};

async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Begäran misslyckades (${res.status})`);
  return json.data as T;
}

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} kr`;
}

/** Vad Fortnox svarade om den kopplade artikeln, i klartext. */
function ArticleStatus({ view }: { view: MaterialCostArticleView | null }) {
  if (!view) {
    return (
      <p className="m-0 text-[11px] leading-snug text-slate-500">
        Ingen artikel kopplad. Säckarna räknas fortfarande, men de prissätts inte.
      </p>
    );
  }
  if (view.missing) {
    return (
      <p className="m-0 text-[11px] leading-snug text-amber-800">
        Artikel {view.article_number} finns inte i artikelregistret. Kontrollera numret, eller synka artiklarna från
        Fortnox.
      </p>
    );
  }
  if (view.purchase_price == null) {
    return (
      <p className="m-0 text-[11px] leading-snug text-amber-800">
        {view.description || `Artikel ${view.article_number}`} saknar inköpspris i Fortnox. Sätt priset där, så räknas
        materialet med.
      </p>
    );
  }
  return (
    <p className="m-0 text-[11px] leading-snug text-slate-600">
      {view.description || `Artikel ${view.article_number}`} · <strong className="font-semibold text-slate-800">{formatPrice(view.purchase_price)} per säck</strong>
      {view.unit ? <span className="text-slate-400"> · enhet i Fortnox: {view.unit}</span> : null}
      {view.active ? null : <span className="text-amber-800"> · avaktiverad i Fortnox</span>}
    </p>
  );
}

export default function CalcSettingsClient({
  tablesMissing,
  initialLaborCostPerHour,
  initialMaterials,
  knownMaterials,
}: CalcSettingsClientProps) {
  const toast = useToast();
  const [materials, setMaterials] = useState<MaterialCostArticleView[]>(initialMaterials);
  const [rate, setRate] = useState(initialLaborCostPerHour != null ? String(initialLaborCostPerHour).replace('.', ',') : '');
  const [savedRate, setSavedRate] = useState(initialLaborCostPerHour);
  const [savingRate, setSavingRate] = useState(false);

  // Utkast per material. Tomt fält = kopplingen tas bort.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyMaterial, setBusyMaterial] = useState<string | null>(null);

  // Vokabulären leder ordningen; kopplingar för material som ännu inte går att rapportera hamnar
  // sist, märkta. De är inte fel — de ligger och väntar på att materialet läggs till.
  const rows: MaterialRow[] = useMemo(() => {
    const byMaterial = new Map(materials.map((view) => [view.material, view]));
    const known = knownMaterials.map((material) => ({
      material,
      reportable: true,
      view: byMaterial.get(material) ?? null,
    }));
    const extra = materials
      .filter((view) => !knownMaterials.includes(view.material))
      .map((view) => ({ material: view.material, reportable: false, view }));
    return [...known, ...extra];
  }, [materials, knownMaterials]);

  async function refresh() {
    const data = await apiRequest<{ labor_cost_per_hour: number | null; materials: MaterialCostArticleView[] }>(
      '/api/crm/calc-settings',
    );
    setMaterials(data.materials);
    setSavedRate(data.labor_cost_per_hour);
  }

  async function saveRate() {
    const parsed = Number(rate.replace(',', '.').trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Skriv timkostnaden som ett tal, till exempel 650');
      return;
    }
    setSavingRate(true);
    try {
      await apiRequest('/api/crm/calc-settings', {
        method: 'PUT',
        body: JSON.stringify({ labor_cost_per_hour: parsed }),
      });
      setSavedRate(parsed);
      toast.success('Timkostnaden sparad');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara timkostnaden');
    } finally {
      setSavingRate(false);
    }
  }

  async function saveMaterial(material: string) {
    const draft = (drafts[material] ?? '').trim();
    setBusyMaterial(material);
    try {
      if (draft) {
        await apiRequest('/api/crm/calc-settings/materials', {
          method: 'PUT',
          body: JSON.stringify({ material, article_number: draft }),
        });
      } else {
        await apiRequest(`/api/crm/calc-settings/materials?material=${encodeURIComponent(material)}`, {
          method: 'DELETE',
        });
      }
      await refresh();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[material];
        return next;
      });
      toast.success(draft ? `Kostnadsartikel sparad för ${material}` : `Kopplingen för ${material} borttagen`);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara kostnadsartikeln');
    } finally {
      setBusyMaterial(null);
    }
  }

  const rateDirty = (() => {
    const parsed = Number(rate.replace(',', '.').trim());
    if (!Number.isFinite(parsed)) return rate.trim().length > 0;
    return parsed !== savedRate;
  })();

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Kalkyl</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">
            Underlaget till efterkalkylen på arbetsordern: vad en timme kostar och vad en säck kostar.
          </p>
        </div>
        <Link href="/crm/installningar" className={cn(crm.link, 'text-sm')}>
          ← Inställningar
        </Link>
      </div>

      {tablesMissing ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Kalkyltabellerna saknas i databasen. Kör <code className="font-mono text-xs">20260828_crm_cost_settings.sql</code>{' '}
          i Supabase, så går inställningarna att spara.
        </div>
      ) : null}

      {/* ─── Timkostnad ──────────────────────────────────────────────────── */}
      <div className={cn(crm.card, 'p-5')}>
        <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Timkostnad</h2>
        <p className="m-0 mb-4 text-sm text-slate-500">
          Vad en arbetad timme kostar oss. Efterkalkylen multiplicerar den med varje persons rapporterade tid på jobbet.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className={crm.sectionTitle}>Kronor per man-timme</span>
            <div className="flex items-center gap-2">
              <Input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                placeholder="650"
                aria-label="Kronor per man-timme"
                className="w-32"
              />
              <span className="text-sm text-slate-500">kr/h</span>
            </div>
          </label>
          <button
            type="button"
            onClick={saveRate}
            disabled={savingRate || !rateDirty}
            className={cn(crm.saveButton, 'h-11 w-auto px-4')}
          >
            {savingRate ? 'Sparar…' : 'Spara'}
          </button>
        </div>

        {/* ⚠️ Per PERSON, inte per team. Lönsamhetsmodellen anger 1 300 kr/h för ett team om två,
            och skrivs det talet in här blir varje arbetskostnad dubbelt så hög — utan att något ser
            fel ut, för resultatet är fortfarande ett rimligt tal. */}
        <p className="m-0 mt-3 text-[11px] leading-snug text-slate-500">
          Satsen gäller per person och timme. Lönsamhetsmodellens 1 300 kr/h avser ett team om två — här skriver du
          hälften, alltså 650.
        </p>
        <p className="m-0 mt-1 text-[11px] leading-snug text-slate-500">
          Ändringen gäller alla jobb, även avslutade. Ett jobb från i fjol räknas om med den nya satsen nästa gång någon
          öppnar det.
        </p>
      </div>

      {/* ─── Kostnadsartiklar ────────────────────────────────────────────── */}
      <div className={cn(crm.card, 'p-5')}>
        <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Kostnadsartiklar</h2>
        <p className="m-0 mb-4 text-sm text-slate-500">
          Vilken Fortnox-artikel som bär inköpspriset per säck för varje material. Efterkalkylen prissätter de
          rapporterade säckarna med den.
        </p>

        <div className="grid gap-2">
          {rows.map((row) => {
            const draft = drafts[row.material];
            const current = row.view?.article_number ?? '';
            const value = draft ?? current;
            const dirty = draft != null && draft.trim() !== current;
            const busy = busyMaterial === row.material;
            return (
              <div key={row.material} className="grid gap-2 rounded-xl border border-slate-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-semibold text-slate-900">{row.material}</strong>
                    {row.reportable ? null : (
                      <span className={cn(crm.badge, 'border-slate-200 bg-white text-slate-500')}>
                        Rapporteras inte i fält än
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={value}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.material]: e.target.value }))}
                    placeholder="Artikelnummer i Fortnox"
                    aria-label={`Kostnadsartikel för ${row.material}`}
                    className="w-52"
                  />
                  <button
                    type="button"
                    onClick={() => saveMaterial(row.material)}
                    disabled={busy || !dirty}
                    className={cn(crm.saveButton, 'h-11 w-auto px-4')}
                  >
                    {busy ? 'Sparar…' : 'Spara'}
                  </button>
                  {/* Tömma fältet och spara är samma sak som att koppla bort — den vägen står i
                      hjälptexten nedan i stället för som en egen knapp, så raden har EN åtgärd. */}
                </div>

                {/* ⚠️ Statusraden beskriver den SPARADE kopplingen. Under en osparad ändring hade
                    den påstått något om ett nummer som ännu inte slagits upp — och "ingen artikel
                    kopplad" bredvid ett ifyllt fält läses som att sparningen misslyckades. */}
                {dirty ? (
                  <p className="m-0 text-[11px] leading-snug text-slate-500">
                    {value.trim() ? 'Spara för att hämta artikeln från Fortnox.' : 'Spara för att koppla bort materialet.'}
                  </p>
                ) : (
                  <ArticleStatus view={row.view} />
                )}
              </div>
            );
          })}
        </div>

        <p className="m-0 mt-3 text-[11px] leading-snug text-slate-500">
          Töm fältet och spara för att koppla bort ett material. Priset läses ur artikelns inköpspris i Fortnox och antas
          gälla per säck.
        </p>
      </div>
    </div>
  );
}
