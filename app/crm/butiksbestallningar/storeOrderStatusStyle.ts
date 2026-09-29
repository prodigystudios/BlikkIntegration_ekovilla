import type { StoreOrderStatus } from '@/lib/domains/portal/storeOrders';

// Butiksbeställningarnas statusfärger, i samma familjer som arbetsorderns (crmTokens.ts): gult = väntar på Ekovilla,
// grönt = bekräftad, blått = på väg ut, mörkgrönt = klar, rött = makulerad av Ekovilla. Tillbakadragen är butikens eget
// beslut och står neutral i grått, skild från Ekovillas makulering (kontraktet håller isär dem).

export const storeOrderStatusClass: Record<StoreOrderStatus, string> = {
  received: 'border-yellow-200 bg-yellow-50 text-yellow-700',
  withdrawn: 'border-slate-200 bg-slate-100 text-slate-600',
  confirmed: 'border-green-200 bg-green-50 text-green-700',
  delivered: 'border-sky-200 bg-sky-50 text-sky-700',
  invoiced: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
};

/** Randen till vänster på en rad i listan, för att se läget i ett svep. */
export const storeOrderStatusAccent: Record<StoreOrderStatus, string> = {
  received: 'bg-yellow-400',
  withdrawn: 'bg-slate-300',
  confirmed: 'bg-green-400',
  delivered: 'bg-sky-400',
  invoiced: 'bg-emerald-700',
  cancelled: 'bg-rose-500',
};
