import type { QuoteStatus, WorkOrderStatus } from '@/app/crm/lib/crmTokens';

// Raderna som översiktens listhämtningar lämnar ut. Siffrorna finns inte här — de kommer
// färdigräknade från /api/crm/overview, se CrmOverviewSummary.

export type ProspectStatus = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';

export type CallProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  source: string | null;
  status: ProspectStatus;
};

export type CallItem = {
  id: string;
  prospect_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  city: string | null;
  source: string | null;
  user_id: string;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  call_at: string;
  prospect: CallProspect | CallProspect[] | null;
};

export type TaskItem = {
  id: string;
  prospect_id: string | null;
  title: string;
  details: string | null;
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  remind_at: string | null;
  source: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

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
