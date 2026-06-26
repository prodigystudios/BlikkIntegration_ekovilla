-- Goals become MONTHLY budgets (set once per month) while the leaderboard derives the
-- weekly target as budget ÷ 4. Also adds order-count and order-value budget metrics.
-- Additive + non-destructive: existing weekly rows stay valid; the app now reads/writes
-- period_type = 'month' (period_start = first of month).

-- Allow 'month' alongside the existing 'week'.
ALTER TABLE public.crm_goals
  DROP CONSTRAINT IF EXISTS crm_goals_period_type_check;
ALTER TABLE public.crm_goals
  ADD CONSTRAINT crm_goals_period_type_check CHECK (period_type IN ('week', 'month'));

-- New budget metrics: antal ordrar + ordervärde.
ALTER TABLE public.crm_goals
  ADD COLUMN IF NOT EXISTS order_count_target integer NOT NULL DEFAULT 0 CHECK (order_count_target >= 0),
  ADD COLUMN IF NOT EXISTS order_value_target numeric(12,2) NOT NULL DEFAULT 0 CHECK (order_value_target >= 0);
