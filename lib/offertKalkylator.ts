export type AreaTier = '15-65' | '66-100' | '101-150' | '151+';

export type IsoleringHojd = '' | '25-35' | '45-55';
export type UtsugningHojd = '' | '20' | '21-40';

export type OffertKalkylatorState = {
  isoleringKvm: number;
  isoleringHojd: IsoleringHojd;

  utsugningKvm: number;
  utsugningHojd: UtsugningHojd;

  mogelbehandlingKvm: number;
  tatskiktKvm: number;

  landgangM: number;

  sargSt: number;
  tatningslistTakluckaSt: number;
  brandmattaSt: number;
  rorIsolering30mmSt: number;
  elverkSt: number;
  takfotsTattingVindavledareSt: number;

  etableringKr: number;
  marginalKr: number;
};

export const OFFERT_KALKYLATOR_DEFAULT_STATE: OffertKalkylatorState = {
  isoleringKvm: 0,
  isoleringHojd: '25-35',
  utsugningKvm: 0,
  utsugningHojd: '20',
  mogelbehandlingKvm: 0,
  tatskiktKvm: 0,
  landgangM: 0,
  sargSt: 0,
  tatningslistTakluckaSt: 0,
  brandmattaSt: 0,
  rorIsolering30mmSt: 0,
  elverkSt: 0,
  takfotsTattingVindavledareSt: 0,

  etableringKr: 4500,
  marginalKr: 10_000,
};

export type OffertKalkylatorLine = {
  key: string;
  label: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
};

export type OffertKalkylatorTotals = {
  lines: OffertKalkylatorLine[];
  subtotal: number; // summering av valda rader (exkl etablering/marginal)
  etablering: number;
  marginal: number;
  totalBeforeRot: number;
  rotAmount: number;
  totalAfterRot: number;
};

function clamp0(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

export function getTierByAreaKvm(kvm: number): AreaTier {
  const a = clamp0(kvm);
  if (a >= 151) return '151+';
  if (a >= 101) return '101-150';
  if (a >= 66) return '66-100';
  return '15-65';
}

const PRIS = {
  // per kvm
  isolering: {
    '15-65': { '25-35': 270, '45-55': 450 },
    '66-100': { '25-35': 255, '45-55': 425 },
    '101-150': { '25-35': 255, '45-55': 425 },
    '151+': { '25-35': 240, '45-55': 400 },
  },
  utsugning: {
    '15-65': { '20': 500, '21-40': 1000 },
    '66-100': { '20': 480, '21-40': 960 },
    '101-150': { '20': 440, '21-40': 880 },
    '151+': { '20': 400, '21-40': 800 },
  },
  mogelbehandling: {
    '15-65': 150,
    '66-100': 140,
    '101-150': 130,
    '151+': 120,
  },
  tatskikt: {
    '15-65': 300,
    '66-100': 280,
    '101-150': 270,
    '151+': 260,
  },

  // per meter
  landgang: {
    '15-65': 1200,
    '66-100': 1100,
    '101-150': 1000,
    '151+': 900,
  },

  // övrigt (per st)
  sarg: 2500,
  tatningslistTaklucka: 800,
  brandmatta: 3500,
  rorIsolering30mm: 2500,
  elverk: 850,
  takfotsTattingVindavledare: 250,
} as const;

export function computeOffertKalkylator(state: OffertKalkylatorState): OffertKalkylatorTotals {
  const lines: OffertKalkylatorLine[] = [];

  // Isolering
  {
    const qty = clamp0(state.isoleringKvm);
    const hojd = state.isoleringHojd;
    if (qty > 0 && (hojd === '25-35' || hojd === '45-55')) {
      const tier = getTierByAreaKvm(qty);
      const unitPrice = PRIS.isolering[tier][hojd];
      lines.push({
        key: 'isolering',
        label: `Isolering (Ekovilla ${hojd} cm)`,
        qty,
        unit: 'kvm',
        unitPrice,
        lineTotal: qty * unitPrice,
      });
    }
  }

  // Utsugning
  {
    const qty = clamp0(state.utsugningKvm);
    const hojd = state.utsugningHojd;
    if (qty > 0 && (hojd === '20' || hojd === '21-40')) {
      const tier = getTierByAreaKvm(qty);
      const unitPrice = PRIS.utsugning[tier][hojd];
      lines.push({
        key: 'utsugning',
        label: `Utsugning (${hojd === '20' ? '20 cm' : '21–40 cm'})`,
        qty,
        unit: 'kvm',
        unitPrice,
        lineTotal: qty * unitPrice,
      });
    }
  }

  // Mögelbehandling
  {
    const qty = clamp0(state.mogelbehandlingKvm);
    if (qty > 0) {
      const tier = getTierByAreaKvm(qty);
      const unitPrice = PRIS.mogelbehandling[tier];
      lines.push({
        key: 'mogelbehandling',
        label: 'Mögelbehandling (eliminerar/förebygger)',
        qty,
        unit: 'kvm',
        unitPrice,
        lineTotal: qty * unitPrice,
      });
    }
  }

  // Tätskikt
  {
    const qty = clamp0(state.tatskiktKvm);
    if (qty > 0) {
      const tier = getTierByAreaKvm(qty);
      const unitPrice = PRIS.tatskikt[tier];
      lines.push({
        key: 'tatskikt',
        label: 'Montering nytt tätskikt (inkl material)',
        qty,
        unit: 'kvm',
        unitPrice,
        lineTotal: qty * unitPrice,
      });
    }
  }

  // Landgång
  {
    const qty = clamp0(state.landgangM);
    if (qty > 0) {
      const tier = getTierByAreaKvm(Math.max(state.isoleringKvm, state.utsugningKvm, state.mogelbehandlingKvm, state.tatskiktKvm, 0));
      const unitPrice = PRIS.landgang[tier];
      lines.push({
        key: 'landgang',
        label: 'Landgång',
        qty,
        unit: 'm',
        unitPrice,
        lineTotal: qty * unitPrice,
      });
    }
  }

  // Övrigt (per st)
  const addSt = (key: string, label: string, qty: number, unitPrice: number) => {
    const q = clamp0(qty);
    if (q <= 0) return;
    lines.push({ key, label, qty: q, unit: 'st', unitPrice, lineTotal: q * unitPrice });
  };

  addSt('sarg', 'Sarg runt inv. taklucka', state.sargSt, PRIS.sarg);
  addSt('tatningslistTaklucka', 'Tätningslist runt taklucka', state.tatningslistTakluckaSt, PRIS.tatningslistTaklucka);
  addSt('brandmatta', 'Brandmatta', state.brandmattaSt, PRIS.brandmatta);
  addSt('rorIsolering30mm', 'Rörisolering 30mm', state.rorIsolering30mmSt, PRIS.rorIsolering30mm);
  addSt('elverk', 'Elverk', state.elverkSt, PRIS.elverk);
  addSt('takfotsTattingVindavledare', 'Takfots tätning / vindavledare (per takstolsfack)', state.takfotsTattingVindavledareSt, PRIS.takfotsTattingVindavledare);

  const subtotal = clamp0(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const etablering = clamp0(state.etableringKr);
  const marginal = clamp0(state.marginalKr);
  const totalBeforeRot = subtotal + etablering + marginal;

  // ROT beräknas utan etablering (ej avdragsgill): (delsumma + marginal) x 0.6 x 0.3
  const rotBase = Math.max(0, subtotal + marginal);
  const rotAmount = Math.max(0, rotBase * 0.6 * 0.3);
  const totalAfterRot = Math.max(0, (rotBase - rotAmount) + etablering);

  return { lines, subtotal, etablering, marginal, totalBeforeRot, rotAmount, totalAfterRot };
}
