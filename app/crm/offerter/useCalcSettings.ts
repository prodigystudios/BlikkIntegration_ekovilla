"use client";

import { useEffect, useState } from 'react';
import type { MaterialSackPrice, ProductivityRate } from '@/lib/domains/crm/preCalculation';

// Kalkylinställningarna som offertens förkalkyl behöver: timkostnad, teamstorlek, produktivitet och
// materialens pris per säck.
//
// Hämtas EN gång per formulär och räknas sedan om i klienten vid varje radändring — säljaren ska se
// TB röra sig medan hen prissätter, och ett serveranrop per tangenttryck vore både långsamt och
// onödigt: talen är samma för alla offerter.
//
// ⚠️ Ett misslyckat anrop ger `loaded: false`, inte tomma listor. Skillnaden är hela poängen: tomma
// listor hade fått panelen att påstå "produktivitet saknas för Vind × EKOVILLA" när sanningen är
// att vi inte kunde läsa inställningarna. Samma felklass som "ej rapporterat" kontra "0 st".

export type QuoteCalcSettings = {
  laborCostPerHour: number | null;
  teamSize: number;
  rates: ProductivityRate[];
  sackPrices: MaterialSackPrice[];
};

export function useCalcSettings() {
  const [settings, setSettings] = useState<QuoteCalcSettings | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/crm/calc-settings', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active || !res.ok || !json.ok) return;
        const data = json.data ?? {};
        setSettings({
          laborCostPerHour: data.labor_cost_per_hour ?? null,
          teamSize: Number(data.team_size ?? 2) || 2,
          rates: (data.productivity_rates ?? []) as ProductivityRate[],
          sackPrices: ((data.materials ?? []) as Array<{ material: string; purchase_price: number | null }>).map((m) => ({
            material: m.material,
            purchasePrice: m.purchase_price,
          })),
        });
      } catch {
        // Tyst: panelen visar ingenting hellre än ett påstående byggt på tomma inställningar.
      }
    })();
    return () => { active = false; };
  }, []);

  return settings;
}
