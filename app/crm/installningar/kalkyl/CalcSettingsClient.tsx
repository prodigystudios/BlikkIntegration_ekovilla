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

type ProductivityRate = { construction: string; material: string; m3PerHour: number };
type ConstructionOption = { slug: string; label: string };

type CalcSettingsClientProps = {
  tablesMissing: boolean;
  productivityMissing: boolean;
  initialLaborCostPerHour: number | null;
  initialTeamSize: number;
  initialMaterials: MaterialCostArticleView[];
  initialRates: ProductivityRate[];
  knownMaterials: string[];
  constructions: ConstructionOption[];
};

/** Nyckeln en ruta i produktivitetsrutnätet bor på. */
function rateKey(construction: string, material: string): string {
  return `${construction}|${material}`;
}

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
  productivityMissing,
  initialLaborCostPerHour,
  initialTeamSize,
  initialMaterials,
  initialRates,
  knownMaterials,
  constructions,
}: CalcSettingsClientProps) {
  const toast = useToast();
  const [materials, setMaterials] = useState<MaterialCostArticleView[]>(initialMaterials);
  const [rate, setRate] = useState(initialLaborCostPerHour != null ? String(initialLaborCostPerHour).replace('.', ',') : '');
  const [savedRate, setSavedRate] = useState(initialLaborCostPerHour);
  const [teamSize, setTeamSize] = useState(String(initialTeamSize));
  const [savedTeamSize, setSavedTeamSize] = useState(initialTeamSize);
  const [savingRate, setSavingRate] = useState(false);

  // Produktivitetsrutnätet: en ruta per konstruktion och material, som text tills den sparas.
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of initialRates) initial[rateKey(row.construction, row.material)] = String(row.m3PerHour).replace('.', ',');
    return initial;
  });
  const [savedRates, setSavedRates] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const row of initialRates) initial[rateKey(row.construction, row.material)] = String(row.m3PerHour).replace('.', ',');
    return initial;
  });
  const [savingRates, setSavingRates] = useState(false);

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
    // ⚠️ Ett TOMT fält blir `Number('') === 0`, inte NaN. Utan den första kontrollen sparades en
    // nolla — och en nollsats läses som "ingen sats", alltså försvann TB2 från varje arbetsorder
    // medan notisen sa att timkostnaden var sparad.
    const raw = rate.replace(',', '.').trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Skriv timkostnaden som ett tal större än noll, till exempel 650');
      return;
    }
    const parsedTeam = Number(teamSize.trim());
    if (!Number.isInteger(parsedTeam) || parsedTeam < 1) {
      toast.error('Teamstorleken anges i hela personer, minst 1');
      return;
    }
    setSavingRate(true);
    try {
      const saved = await apiRequest<{ team_size: number; team_size_saved?: boolean }>('/api/crm/calc-settings', {
        method: 'PUT',
        body: JSON.stringify({ labor_cost_per_hour: parsed, team_size: parsedTeam }),
      });
      setSavedRate(parsed);
      // ⚠️ SVARET, INTE DET INSKRIVNA. Går kolumnen inte att skriva (migreringen okörd) sparas bara
      // timkostnaden — och att då visa det inskrivna lagantalet som sparat är en tyst halvsanning
      // som nästa omladdning motsäger.
      setTeamSize(String(saved.team_size));
      setSavedTeamSize(saved.team_size);
      if (saved.team_size_saved === false) {
        toast.error('Timkostnaden sparad, men lagantalet kunde inte sparas — kör 20260829_crm_productivity_rates.sql.');
      } else {
        toast.success('Timkostnaden sparad');
      }
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
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara kostnadsartikeln');
      setBusyMaterial(null);
      return;
    }

    // ⚠️ OMHÄMTNINGEN LIGGER UTANFÖR SKRIVNINGENS try. Låg den innanför blev ett misslyckat
    // omläsningsanrop till "Kunde inte spara kostnadsartikeln" — om en ändring som FAKTISKT
    // sparades. Skrivningen är klar här; det som kan fela nu är bara bilden av den.
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[material];
      return next;
    });
    toast.success(draft ? `Kostnadsartikel sparad för ${material}` : `Kopplingen för ${material} borttagen`);
    try {
      await refresh();
    } catch {
      toast.error('Ändringen är sparad, men listan kunde inte uppdateras. Ladda om sidan.');
    } finally {
      setBusyMaterial(null);
    }
  }

  /**
   * Sparar rutnätet — en begäran per ÄNDRAD ruta.
   *
   * ⚠️ En tömd ruta skickas som `null`, alltså en borttagning. Att hoppa över tomma rutor hade
   * gjort det omöjligt att ta bort ett tal man ångrat: det gamla värdet hade legat kvar i databasen
   * medan rutan såg tom ut.
   */
  async function saveRates() {
    const changed = Object.keys({ ...rates, ...savedRates }).filter((key) => (rates[key] ?? '') !== (savedRates[key] ?? ''));
    if (changed.length === 0) return;

    for (const key of changed) {
      const raw = (rates[key] ?? '').replace(',', '.').trim();
      if (raw && !(Number(raw) > 0)) {
        toast.error('Takterna anges som tal större än noll, till exempel 22');
        return;
      }
    }

    setSavingRates(true);
    try {
      for (const key of changed) {
        const [construction, material] = key.split('|');
        const raw = (rates[key] ?? '').replace(',', '.').trim();
        await apiRequest('/api/crm/calc-settings/productivity', {
          method: 'PUT',
          body: JSON.stringify({ construction, material, m3_per_hour: raw ? Number(raw) : null }),
        });
      }
      setSavedRates({ ...rates });
      toast.success(changed.length === 1 ? 'Takten sparad' : `${changed.length} takter sparade`);
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte spara produktiviteten');
    } finally {
      setSavingRates(false);
    }
  }

  const ratesDirty = Object.keys({ ...rates, ...savedRates }).some((key) => (rates[key] ?? '') !== (savedRates[key] ?? ''));

  const rateDirty = (() => {
    // ⚠️ TEAMSTORLEKEN PRÖVAS FÖRST. Låg den efter den tomma-fält-grenen nedan gick den aldrig att
    // ändra på egen hand när timkostnadsrutan råkade vara tom — Spara satt kvar avstängd.
    if (Number(teamSize.trim()) !== savedTeamSize) return true;
    const raw = rate.replace(',', '.').trim();
    // Ett tomt fält är inte en ändring utan ett oskrivet fält — och `Number('')` är 0, som annars
    // hade sett ut som "ändrad från 650 till 0" och gjort Spara tryckbar.
    if (!raw) return false;
    const parsed = Number(raw);
    // Skräp gör knappen tryckbar med flit: felet ska sägas när man trycker, inte döljas som en
    // knapp som inte går att använda.
    if (!Number.isFinite(parsed)) return true;
    return parsed !== savedRate || Number(teamSize.trim()) !== savedTeamSize;
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
          {/* ⚠️ `w-auto` KRÄVS. globals.css:200 sätter `:where(label){width:100%}` på varje label i
              appen, och som 100 %-bred flex-post trycker den Spara-knappen ned på egen rad. Samma
              fälla som de inline-staplade kryssrutorna på arbetsordern. */}
          <label className="grid w-auto gap-1">
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
          {/* ⚠️ TEAMSTORLEKEN ÄR FAKTOR 2, GJORD SYNLIG. Produktivitetstalen nedan är per LAG, den
              här satsen per PERSON. Man-timmar = team-timmar × antal personer. Låg tvåan implicit i
              en formel var det precis så felet uppstod i modellen. */}
          <label className="grid w-auto gap-1">
            <span className={crm.sectionTitle}>Personer i laget</span>
            <div className="flex items-center gap-2">
              <Input
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                inputMode="numeric"
                placeholder="2"
                aria-label="Personer i laget"
                className="w-20"
              />
              <span className="text-sm text-slate-500">st</span>
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

      {/* ─── Produktivitet ───────────────────────────────────────────────── */}
      <div className={cn(crm.card, 'p-5')}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Produktivitet</h2>
            <p className="m-0 text-sm text-slate-500">
              Hur många kubik laget hinner på en timme. Offerten använder talen för att uppskatta arbetstiden och därmed
              TB2 — arbetsordern räknar på rapporterad tid och rör dem inte.
            </p>
          </div>
          <button
            type="button"
            onClick={saveRates}
            disabled={savingRates || !ratesDirty || productivityMissing}
            className={cn(crm.saveButton, 'h-11 w-auto px-4')}
          >
            {savingRates ? 'Sparar…' : 'Spara tabellen'}
          </button>
        </div>

        {productivityMissing ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Produktivitetstabellen saknas i databasen. Kör{' '}
            <code className="font-mono text-xs">20260829_crm_productivity_rates.sql</code> i Supabase.
          </div>
        ) : (
          <>
            {/* Rutnät: en rad per placering, en kolumn per material. Vågrät scroll på smal skärm —
                tabellen får inte tryckas ihop till oläsliga rutor. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-40 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Placering
                    </th>
                    {knownMaterials.map((material) => (
                      <th key={material} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {material}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {constructions.map((construction) => (
                    <tr key={construction.slug} className="border-t border-slate-100">
                      <th scope="row" className="px-2 py-2 text-left text-sm font-semibold text-slate-900">
                        {construction.label}
                      </th>
                      {knownMaterials.map((material) => {
                        const key = rateKey(construction.slug, material);
                        return (
                          <td key={material} className="px-2 py-2">
                            <Input
                              value={rates[key] ?? ''}
                              onChange={(e) => setRates((prev) => ({ ...prev, [key]: e.target.value }))}
                              inputMode="decimal"
                              placeholder="–"
                              aria-label={`Kubik per timme, ${construction.label} med ${material}`}
                              className="w-24"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ⚠️ TOM RUTA ÄR INTE NOLL. Utan den här meningen läses ett tomt fält som "går på
                nolltid", och en säljare undrar varför TB2 saknas i stället för att fylla i talet. */}
            <p className="m-0 mt-3 text-[11px] leading-snug text-slate-500">
              Kubik per timme och lag. En tom ruta betyder att vi inte har någon uppskattning — offerten säger då att
              arbetstiden inte går att räkna för den kombinationen, i stället för att gissa.
            </p>
            <p className="m-0 mt-1 text-[11px] leading-snug text-slate-500">
              Talen är lagets takt, inte en persons. Antalet personer sätts i Timkostnad ovan och multipliceras in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
