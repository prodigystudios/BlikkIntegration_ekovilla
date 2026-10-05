import type { QuoteStatus, WorkOrderStatus } from '@/app/crm/lib/crmTokens';

// Raderna som översiktens listhämtningar lämnar ut. Siffrorna finns inte här — de kommer
// färdigräknade från /api/crm/overview, se CrmOverviewSummary.

export type ProspectStatus = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';

export type QuoteProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: ProspectStatus;
};

export type QuoteItem = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  project_name: string;
  amount: number | string;
  currency_code: string;
  status: QuoteStatus;
  quote_date: string;
  follow_up_date: string | null;
  assigned_to: string;
  updated_at: string;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

export type WorkOrderItem = {
  id: string;
  project_name: string;
  client_name: string;
  amount: number | string;
  currency_code: string;
  status: WorkOrderStatus;
  assigned_to: string;
  created_at: string;
  fortnox_invoiced_at: string | null;
};
