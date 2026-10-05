import type { QuoteStatus, WorkOrderStatus } from '@/app/crm/lib/crmTokens';
import type { QuoteNameFields } from '@/app/crm/lib/quoteDisplay';
import type { NetAmountRow } from '@/lib/domains/crm/pricing';

// Raderna som översiktens två tabeller läser ur list-API:erna — bara fälten tabellerna använder.
// Siffrorna finns inte här: de kommer färdigräknade från /api/crm/overview, se CrmOverviewSummary.

export type QuoteItem = NetAmountRow & QuoteNameFields & {
  id: string;
  quote_number: string | null;
  fortnox_offer_number: string | null;
  currency_code: string;
  status: QuoteStatus;
  updated_at: string;
};

export type WorkOrderItem = NetAmountRow & {
  id: string;
  order_number: string | null;
  fortnox_order_number: string | null;
  client_name: string;
  currency_code: string;
  status: WorkOrderStatus;
  created_at: string;
};
