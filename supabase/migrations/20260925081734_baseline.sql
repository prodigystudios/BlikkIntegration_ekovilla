SET local check_function_bodies = off;

CREATE EXTENSION "hypopg" SCHEMA "extensions";

CREATE EXTENSION "index_advisor" SCHEMA "extensions";

CREATE EXTENSION "pg_cron";

CREATE EXTENSION "pg_net" SCHEMA "extensions";

CREATE EXTENSION "pg_trgm" SCHEMA "public";

CREATE TABLE "public"."addresses" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "address"    text                     NOT NULL,
  "sort"       integer                  NOT NULL DEFAULT 100,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "addresses_name_key" UNIQUE (name),
  CONSTRAINT "addresses_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."addresses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."app_changelog_entries" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "category"        text                     NOT NULL,
  "title"           text                     NOT NULL,
  "body"            text,
  "published_at"    timestamp with time zone,
  "created_by"      uuid,
  "created_by_name" text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "app_changelog_category_chk" CHECK ((category = ANY (ARRAY['fixed'::text, 'new'::text, 'improved'::text]))),
  CONSTRAINT "app_changelog_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "app_changelog_title_chk" CHECK ((length(btrim(title)) > 0))
);

ALTER TABLE "public"."app_changelog_entries"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."app_tickets" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "reporter_id"            uuid,
  "reporter_name"          text                     NOT NULL,
  "kind"                   text                     NOT NULL,
  "area"                   text                     NOT NULL,
  "title"                  text                     NOT NULL,
  "description"            text                     NOT NULL,
  "page_path"              text,
  "status"                 text                     NOT NULL DEFAULT 'new'::text,
  "resolution"             text,
  "screenshot_bucket"      text,
  "screenshot_path"        text,
  "changelog_note"         text,
  "changelog_published_at" timestamp with time zone,
  "handled_by"             uuid,
  "handled_at"             timestamp with time zone,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "handled_by_name"        text,
  CONSTRAINT "app_tickets_area_chk"
    CHECK
    ((area = ANY (ARRAY['crm'::text, 'planning'::text, 'field'::text, 'self_check'::text, 'time'::text, 'documents'::text, 'korjournal'::text, 'account'::text, 'other'::text]))),
  CONSTRAINT "app_tickets_kind_chk" CHECK ((kind = ANY (ARRAY['bug'::text, 'idea'::text]))),
  CONSTRAINT "app_tickets_pkey" PRIMARY KEY (id),
  CONSTRAINT "app_tickets_screenshot_chk" CHECK ((((screenshot_bucket IS NULL) AND (screenshot_path IS NULL)) OR ((screenshot_bucket IS NOT NULL) AND (screenshot_path IS
    NOT NULL)))),
  CONSTRAINT "app_tickets_status_chk" CHECK ((status = ANY (ARRAY['new'::text, 'planned'::text, 'in_progress'::text, 'done'::text, 'declined'::text])))
);

ALTER TABLE "public"."app_tickets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."blikk_activities" (
  "id"         text                     NOT NULL,
  "code"       text,
  "name"       text,
  "billable"   boolean,
  "active"     boolean,
  "source"     jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "blikk_activities_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."blikk_timecodes" (
  "id"         text                     NOT NULL,
  "code"       text,
  "name"       text,
  "billable"   boolean,
  "active"     boolean,
  "source"     jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "blikk_timecodes_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."contact_categories" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "sort"       integer                  NOT NULL DEFAULT 100,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contact_categories_name_key" UNIQUE (name),
  CONSTRAINT "contact_categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."contact_categories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."contacts" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "category_id" uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "phone"       text,
  "location"    text,
  "role"        text,
  "sort"        integer                  NOT NULL DEFAULT 100,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contacts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."contacts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_absence_types" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"          text,
  "name"          text                     NOT NULL,
  "payroll_code"  text,
  "requires_note" boolean                  NOT NULL DEFAULT false,
  "sort_index"    integer                  NOT NULL DEFAULT 0,
  "is_active"     boolean                  NOT NULL DEFAULT true,
  "blikk_id"      text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_absence_types_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_absence_types"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_ai_prospect_suggestions" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_name"         text                     NOT NULL,
  "organization_number"  text,
  "contact_name"         text,
  "phone"                text,
  "email"                text,
  "city"                 text,
  "website"              text,
  "source"               text,
  "rationale"            text,
  "notes"                text,
  "status"               text                     NOT NULL DEFAULT 'pending'::text,
  "created_by"           uuid                     NOT NULL,
  "reviewed_by"          uuid,
  "approved_customer_id" uuid,
  "review_note"          text,
  "reviewed_at"          timestamp with time zone,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_ai_prospect_suggestions_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_ai_prospect_suggestions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE "public"."crm_ai_prospect_suggestions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_calc_settings" (
  "id"                  boolean                  NOT NULL DEFAULT true,
  "labor_cost_per_hour" numeric(10,2)            NOT NULL,
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"          uuid,
  "team_size"           integer                  NOT NULL DEFAULT 2,
  CONSTRAINT "crm_calc_settings_id_check" CHECK (id),
  CONSTRAINT "crm_calc_settings_labor_cost_per_hour_check" CHECK ((labor_cost_per_hour >= (0)::numeric)),
  CONSTRAINT "crm_calc_settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_calc_settings_team_size_check" CHECK ((team_size >= 1))
);

ALTER TABLE "public"."crm_calc_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_calls" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "prospect_id"         uuid,
  "user_id"             uuid                     NOT NULL,
  "outcome"             text                     NOT NULL,
  "summary"             text                     NOT NULL,
  "next_step"           text,
  "call_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "company_name"        text,
  "organization_number" text,
  "contact_name"        text,
  "phone"               text,
  "email"               text,
  "city"                text,
  "source"              text,
  "customer_id"         uuid,
  "quote_id"            uuid,
  CONSTRAINT "crm_calls_outcome_check" CHECK ((outcome = ANY (ARRAY['no_answer'::text, 'follow_up'::text, 'positive'::text, 'negative'::text]))),
  CONSTRAINT "crm_calls_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_calls_reference_or_company_check" CHECK (((prospect_id IS NOT NULL) OR (customer_id IS NOT NULL) OR (company_name IS NOT NULL)))
);

ALTER TABLE "public"."crm_calls"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_customer_contacts" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" uuid                     NOT NULL,
  "name"        text                     NOT NULL,
  "role"        text,
  "phone"       text,
  "email"       text,
  "is_primary"  boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_customer_contacts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_customer_contacts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_customers" (
  "id"                           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "customer_type"                text                     NOT NULL DEFAULT 'business'::text,
  "company_name"                 text,
  "organization_number"          text,
  "first_name"                   text,
  "last_name"                    text,
  "personal_number"              text,
  "visit_address"                jsonb,
  "invoice_address"              jsonb,
  "fortnox_customer_id"          text,
  "sync_status"                  text                     NOT NULL DEFAULT 'not_synced'::text,
  "last_synced_at"               timestamp with time zone,
  "status"                       text                     NOT NULL DEFAULT 'active'::text,
  "assigned_to"                  uuid                     NOT NULL,
  "created_by"                   uuid                     NOT NULL,
  "created_at"                   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                   timestamp with time zone NOT NULL DEFAULT now(),
  "customer_stage"               text                     NOT NULL DEFAULT 'customer'::text,
  "source"                       text,
  "notes"                        text,
  "email"                        text,
  "phone"                        text,
  "mobile"                       text,
  "delivery_address"             jsonb,
  "invoice_email"                text,
  "payment_terms"                text,
  "price_list"                   text,
  "discount"                     numeric(5,2),
  "vat_number"                   text,
  "reverse_vat"                  boolean                  NOT NULL DEFAULT false,
  "annual_revenue"               numeric,
  "number_of_employees"          integer,
  "legal_entity_type"            text,
  "sni_code"                     text,
  "sni_name"                     text,
  "operating_profit"             numeric,
  "profit_after_financial_items" numeric,
  "total_assets"                 numeric,
  "operating_margin"             numeric,
  "equity_ratio"                 numeric,
  "financial_year"               integer,
  "risk_indicators"              jsonb,
  "customer_type_verified"       boolean                  NOT NULL DEFAULT true,
  "tic_company_id"               integer,
  "credit_report"                jsonb,
  "credit_report_fetched_at"     timestamp with time zone,
  "account_manager_id"           uuid,
  CONSTRAINT "crm_customers_customer_stage_check" CHECK ((customer_stage = ANY (ARRAY['prospect'::text, 'customer'::text, 'fortnox_customer'::text]))),
  CONSTRAINT "crm_customers_customer_type_check" CHECK ((customer_type = ANY (ARRAY['business'::text, 'private'::text]))),
  CONSTRAINT "crm_customers_fortnox_customer_id_key" UNIQUE (fortnox_customer_id),
  CONSTRAINT "crm_customers_identity_check" CHECK (((company_name IS NOT NULL) OR (first_name IS NOT NULL) OR (last_name IS NOT NULL))),
  CONSTRAINT "crm_customers_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_customers_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'churned'::text]))),
  CONSTRAINT "crm_customers_sync_status_check" CHECK ((sync_status = ANY (ARRAY['not_synced'::text, 'pending'::text, 'synced'::text, 'failed'::text])))
);

ALTER TABLE "public"."crm_customers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_goals" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            uuid                     NOT NULL,
  "period_type"        text                     NOT NULL,
  "period_start"       date                     NOT NULL,
  "calls_target"       integer                  NOT NULL DEFAULT 0,
  "quotes_target"      integer                  NOT NULL DEFAULT 0,
  "quote_value_target" numeric(12,2)            NOT NULL DEFAULT 0,
  "created_by"         uuid                     NOT NULL,
  "updated_by"         uuid                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "order_count_target" integer                  NOT NULL DEFAULT 0,
  "order_value_target" numeric(12,2)            NOT NULL DEFAULT 0,
  CONSTRAINT "crm_goals_calls_target_check" CHECK ((calls_target >= 0)),
  CONSTRAINT "crm_goals_order_count_target_check" CHECK ((order_count_target >= 0)),
  CONSTRAINT "crm_goals_order_value_target_check" CHECK ((order_value_target >= (0)::numeric)),
  CONSTRAINT "crm_goals_period_type_check" CHECK ((period_type = ANY (ARRAY['week'::text, 'month'::text]))),
  CONSTRAINT "crm_goals_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_goals_quote_value_target_check" CHECK ((quote_value_target >= (0)::numeric)),
  CONSTRAINT "crm_goals_quotes_target_check" CHECK ((quotes_target >= 0)),
  CONSTRAINT "crm_goals_user_id_period_type_period_start_key" UNIQUE (user_id, period_type, period_start)
);

ALTER TABLE "public"."crm_goals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_internal_projects" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"          text,
  "name"          text                     NOT NULL,
  "payroll_code"  text,
  "requires_note" boolean                  NOT NULL DEFAULT false,
  "sort_index"    integer                  NOT NULL DEFAULT 0,
  "is_active"     boolean                  NOT NULL DEFAULT true,
  "blikk_id"      text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_internal_projects_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_internal_projects"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_material_cost_articles" (
  "material"       text                     NOT NULL,
  "article_number" text                     NOT NULL,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"     uuid,
  CONSTRAINT "crm_material_cost_articles_pkey" PRIMARY KEY (material)
);

ALTER TABLE "public"."crm_material_cost_articles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_productivity_rates" (
  "construction" text                     NOT NULL,
  "material"     text                     NOT NULL,
  "m3_per_hour"  numeric(10,2)            NOT NULL,
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"   uuid,
  CONSTRAINT "crm_productivity_rates_construction_chk" CHECK ((construction = ANY (ARRAY['vagg'::text, 'snedtak'::text, 'vind'::text, 'golv'::text, 'mellanbjalklag'::text]))),
  CONSTRAINT "crm_productivity_rates_m3_per_hour_check" CHECK ((m3_per_hour > (0)::numeric)),
  CONSTRAINT "crm_productivity_rates_pkey" PRIMARY KEY (construction, material)
);

ALTER TABLE "public"."crm_productivity_rates"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_quotes" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "prospect_id"                uuid,
  "customer_name"              text,
  "project_name"               text                     NOT NULL,
  "description"                text,
  "amount"                     numeric(12,2)            NOT NULL,
  "currency_code"              text                     NOT NULL DEFAULT 'SEK'::text,
  "status"                     text                     NOT NULL DEFAULT 'draft'::text,
  "quote_date"                 date                     NOT NULL DEFAULT CURRENT_DATE,
  "follow_up_date"             date,
  "notes"                      text,
  "created_by"                 uuid                     NOT NULL,
  "assigned_to"                uuid                     NOT NULL,
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "quote_type"                 text                     NOT NULL DEFAULT 'business'::text,
  "customer_snapshot"          jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "pricing_summary"            jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "rot_details"                jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "internal_handoff"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "vat_percent"                numeric(5,2),
  "valid_until"                date,
  "line_items"                 jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "work_order_id"              uuid,
  "work_order_number"          text,
  "converted_to_work_order_at" timestamp with time zone,
  "converted_to_work_order_by" uuid,
  "customer_source"            jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "customer_id"                uuid,
  "fortnox_offer_number"       text,
  "fortnox_sync_status"        text                     NOT NULL DEFAULT 'not_synced'::text,
  "fortnox_synced_at"          timestamp with time zone,
  "fortnox_offer_claimed_at"   timestamp with time zone,
  CONSTRAINT "crm_quotes_amount_check" CHECK ((amount >= (0)::numeric)),
  CONSTRAINT "crm_quotes_fortnox_sync_status_check" CHECK ((fortnox_sync_status = ANY (ARRAY['not_synced'::text, 'pending'::text, 'synced'::text, 'failed'::text]))),
  CONSTRAINT "crm_quotes_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_quotes_quote_type_check" CHECK ((quote_type = ANY (ARRAY['private'::text, 'business'::text]))),
  CONSTRAINT "crm_quotes_reference_or_customer_check" CHECK (((prospect_id IS NOT NULL) OR (customer_name IS NOT NULL))),
  CONSTRAINT "crm_quotes_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'follow_up'::text, 'won'::text, 'lost'::text])))
);

ALTER TABLE "public"."crm_quotes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_routing_rules" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "county"     text                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "priority"   integer                  NOT NULL DEFAULT 0,
  "created_by" uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_routing_rules_county_unique" UNIQUE (county),
  CONSTRAINT "crm_routing_rules_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_routing_rules"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_time_approvals" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      uuid                     NOT NULL,
  "period_start" date                     NOT NULL,
  "status"       text                     NOT NULL DEFAULT 'open'::text,
  "submitted_at" timestamp with time zone,
  "approved_at"  timestamp with time zone,
  "approved_by"  uuid,
  "reopened_at"  timestamp with time zone,
  "note"         text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_time_approvals_period_start_check" CHECK ((period_start = (date_trunc('month'::text, (period_start)::timestamp without time zone))::date)),
  CONSTRAINT "crm_time_approvals_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_time_approvals_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'submitted'::text, 'approved'::text])))
);

ALTER TABLE "public"."crm_time_approvals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_time_codes" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"          text,
  "name"          text                     NOT NULL,
  "payroll_code"  text,
  "billable"      boolean,
  "requires_note" boolean                  NOT NULL DEFAULT false,
  "sort_index"    integer                  NOT NULL DEFAULT 0,
  "is_active"     boolean                  NOT NULL DEFAULT true,
  "blikk_id"      text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_time_codes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_time_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_time_compensations" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"              uuid                     NOT NULL,
  "entry_date"           date                     NOT NULL,
  "kind"                 text                     NOT NULL,
  "quantity"             numeric(8,1),
  "amount"               numeric(10,2)            NOT NULL,
  "note"                 text,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "vat_amount"           numeric(10,2),
  "receipt_bucket"       text,
  "receipt_path"         text,
  "receipt_name"         text,
  "receipt_content_type" text,
  "receipt_size_bytes"   bigint,
  "receipt_uploaded_at"  timestamp with time zone,
  CONSTRAINT "crm_time_compensations_amount_check" CHECK ((amount >= (0)::numeric)),
  CONSTRAINT "crm_time_compensations_kind_check" CHECK ((kind = ANY (ARRAY['travel'::text, 'per_diem'::text, 'expense'::text]))),
  CONSTRAINT "crm_time_compensations_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_time_compensations_quantity_check" CHECK (((quantity IS NULL) OR (quantity >= (0)::numeric))),
  CONSTRAINT "crm_time_compensations_vat_amount_chk" CHECK (((vat_amount IS NULL) OR ((vat_amount >= (0)::numeric) AND (vat_amount <= amount))))
);

ALTER TABLE "public"."crm_time_compensations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_time_entries" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"       uuid,
  "user_id"             uuid                     NOT NULL,
  "work_date"           date                     NOT NULL DEFAULT CURRENT_DATE,
  "hours"               numeric(6,2)             NOT NULL,
  "note"                text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "kind"                text                     NOT NULL,
  "internal_project_id" uuid,
  "absence_type_id"     uuid,
  "start_time"          time without time zone,
  "end_time"            time without time zone,
  "break_minutes"       integer                  NOT NULL DEFAULT 0,
  "minutes_worked"      integer,
  "time_code_id"        uuid,
  "travel_km"           numeric(7,1),
  "travel_km_billable"  numeric(7,1),
  "travel_to_salary"    boolean                  NOT NULL DEFAULT false,
  "travel_note"         text,
  "source"              text                     NOT NULL DEFAULT 'crm'::text,
  CONSTRAINT "crm_time_entries_clock_check" CHECK (((source <> 'crm'::text) OR (kind = 'absence'::text) OR ((start_time IS NOT NULL) AND (end_time IS
    NOT NULL) AND (minutes_worked IS NOT NULL)))),
  CONSTRAINT "crm_work_order_time_entries_hours_check" CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric))),
  CONSTRAINT "crm_work_order_time_entries_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_time_entries"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_time_entry_audit" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "entry_id"    uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "changed_by"  uuid,
  "action"      text                     NOT NULL,
  "before_data" jsonb,
  "after_data"  jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_time_entry_audit_action_check" CHECK ((action = ANY (ARRAY['update'::text, 'delete'::text, 'insert'::text]))),
  CONSTRAINT "crm_time_entry_audit_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_time_entry_audit"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."crm_time_entry_audit"
  FORCE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_comments" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id" uuid                     NOT NULL,
  "created_by"    uuid                     NOT NULL,
  "body"          text                     NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_work_order_comments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_work_order_comments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_files" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"   uuid                     NOT NULL,
  "category"        text                     NOT NULL DEFAULT 'other'::text,
  "is_internal"     boolean                  NOT NULL DEFAULT false,
  "file_name"       text                     NOT NULL,
  "storage_bucket"  text                     NOT NULL,
  "storage_path"    text                     NOT NULL,
  "content_type"    text,
  "size_bytes"      bigint,
  "created_by"      uuid,
  "created_by_name" text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_work_order_files_category_chk" CHECK ((category = ANY (ARRAY['drawing'::text, 'preparation'::text, 'photo_before'::text, 'photo_after'::text, 'other'::text]))),
  CONSTRAINT "crm_work_order_files_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_work_order_files"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_invoices" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"          uuid                     NOT NULL,
  "round_number"           integer                  NOT NULL,
  "fortnox_invoice_number" text,
  "fortnox_sync_status"    text                     NOT NULL DEFAULT 'pending'::text,
  "amount"                 numeric(14,2)            NOT NULL DEFAULT 0,
  "line_quantities"        jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "created_by"             uuid,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_work_order_invoices_fortnox_sync_status_check" CHECK ((fortnox_sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text]))),
  CONSTRAINT "crm_work_order_invoices_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_work_order_invoices_work_order_id_round_number_key" UNIQUE (work_order_id, round_number)
);

ALTER TABLE "public"."crm_work_order_invoices"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_kma_plans" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"   uuid                     NOT NULL,
  "revision"        integer                  NOT NULL,
  "issued_on"       date                     NOT NULL,
  "project_name"    text                     NOT NULL,
  "input"           jsonb                    NOT NULL,
  "document"        jsonb                    NOT NULL,
  "created_by"      uuid,
  "created_by_name" text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_wo_kma_created_by_name_chk" CHECK ((btrim(created_by_name) <> ''::text)),
  CONSTRAINT "crm_wo_kma_document_chk" CHECK ((jsonb_typeof(document) = 'object'::text)),
  CONSTRAINT "crm_wo_kma_input_chk" CHECK ((jsonb_typeof(input) = 'object'::text)),
  CONSTRAINT "crm_wo_kma_project_name_chk" CHECK ((btrim(project_name) <> ''::text)),
  CONSTRAINT "crm_wo_kma_revision_chk" CHECK ((revision >= 1)),
  CONSTRAINT "crm_wo_kma_revision_uniq" UNIQUE (work_order_id, revision),
  CONSTRAINT "crm_work_order_kma_plans_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_work_order_kma_plans"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_progress_reports" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"   uuid                     NOT NULL,
  "report_day"      date                     NOT NULL,
  "line_item_id"    text,
  "work_item"       text                     NOT NULL,
  "quantity"        numeric(10,2)            NOT NULL,
  "unit"            text,
  "location"        text,
  "note"            text,
  "created_by"      uuid,
  "created_by_name" text                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_wo_progress_quantity_chk" CHECK ((quantity >= (0)::numeric)),
  CONSTRAINT "crm_wo_progress_work_item_chk" CHECK ((btrim(work_item) <> ''::text)),
  CONSTRAINT "crm_work_order_progress_reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."crm_work_order_progress_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_order_stages" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"    uuid                     NOT NULL,
  "stage_number"     integer                  NOT NULL,
  "title"            text                     NOT NULL,
  "line_quantities"  jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "work_description" text,
  "job_type"         text,
  "created_by"       uuid,
  "created_by_name"  text                     NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "crm_wo_stages_lines_chk" CHECK ((jsonb_typeof(line_quantities) = 'array'::text)),
  CONSTRAINT "crm_wo_stages_number_chk" CHECK ((stage_number > 0)),
  CONSTRAINT "crm_wo_stages_title_chk" CHECK ((btrim(title) <> ''::text)),
  CONSTRAINT "crm_work_order_stages_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_work_order_stages_work_order_id_stage_number_key" UNIQUE (work_order_id, stage_number)
);

ALTER TABLE "public"."crm_work_order_stages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."crm_work_orders" (
  "id"                            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "quote_id"                      uuid,
  "prospect_id"                   uuid,
  "order_number"                  text                     NOT NULL,
  "project_name"                  text                     NOT NULL,
  "client_name"                   text                     NOT NULL,
  "quote_type"                    text                     NOT NULL,
  "customer_snapshot"             jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "work_address"                  jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "pricing_summary"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "line_items"                    jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "rot_details"                   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "internal_handoff"              jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "currency_code"                 text                     NOT NULL DEFAULT 'SEK'::text,
  "amount"                        numeric(12,2)            NOT NULL DEFAULT 0,
  "vat_percent"                   numeric(5,2)             NOT NULL DEFAULT 25,
  "desired_installation_date"     date,
  "source_status"                 text                     NOT NULL DEFAULT 'won'::text,
  "status"                        text                     NOT NULL DEFAULT 'draft'::text,
  "notes"                         text,
  "created_by"                    uuid                     NOT NULL,
  "assigned_to"                   uuid                     NOT NULL,
  "created_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "customer_id"                   uuid,
  "fortnox_order_number"          text,
  "fortnox_order_sync_status"     text                     NOT NULL DEFAULT 'not_synced'::text,
  "fortnox_order_synced_at"       timestamp with time zone,
  "fortnox_invoice_number"        text,
  "fortnox_invoice_sync_status"   text                     NOT NULL DEFAULT 'not_synced'::text,
  "fortnox_invoiced_at"           timestamp with time zone,
  "fortnox_order_claimed_at"      timestamp with time zone,
  "fortnox_invoice_claimed_at"    timestamp with time zone,
  "line_items_invoicing_snapshot" jsonb,
  "partial_invoicing_started_at"  timestamp with time zone,
  CONSTRAINT "crm_work_orders_amount_check" CHECK ((amount >= (0)::numeric)),
  CONSTRAINT "crm_work_orders_order_number_key" UNIQUE (order_number),
  CONSTRAINT "crm_work_orders_pkey" PRIMARY KEY (id),
  CONSTRAINT "crm_work_orders_quote_id_key" UNIQUE (quote_id),
  CONSTRAINT "crm_work_orders_quote_type_check" CHECK ((quote_type = ANY (ARRAY['private'::text, 'business'::text]))),
  CONSTRAINT "crm_work_orders_status_check"
    CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'in_progress'::text, 'completed'::text, 'partially_invoiced'::text, 'invoiced'::text, 'cancelled'::text])))
);

ALTER TABLE "public"."crm_work_orders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."dashboard_notes" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          uuid                     NOT NULL,
  "text"             text                     NOT NULL,
  "done"             boolean                  NOT NULL DEFAULT false,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "reminder_at"      timestamp with time zone,
  "reminder_sent_at" timestamp with time zone,
  CONSTRAINT "dashboard_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."dashboard_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."dashboard_push_subscriptions" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         uuid                     NOT NULL,
  "endpoint"        text                     NOT NULL,
  "p256dh"          text                     NOT NULL,
  "auth"            text                     NOT NULL,
  "user_agent"      text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "last_error"      text,
  "origin"          text,
  CONSTRAINT "dashboard_push_subscriptions_endpoint_key" UNIQUE (endpoint),
  CONSTRAINT "dashboard_push_subscriptions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."dashboard_push_subscriptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."dashboard_work_items" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          uuid                     NOT NULL,
  "kind"             text                     NOT NULL DEFAULT 'note'::text,
  "title"            text                     NOT NULL,
  "body"             text,
  "status"           text                     NOT NULL DEFAULT 'active'::text,
  "starts_at"        timestamp with time zone,
  "ends_at"          timestamp with time zone,
  "due_at"           timestamp with time zone,
  "remind_at"        timestamp with time zone,
  "reminder_sent_at" timestamp with time zone,
  "location"         text,
  "link_url"         text,
  "related_type"     text,
  "related_id"       text,
  "metadata"         jsonb,
  "completed_at"     timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"       uuid,
  CONSTRAINT "dashboard_work_items_kind_check" CHECK ((kind = ANY (ARRAY['note'::text, 'meeting'::text]))),
  CONSTRAINT "dashboard_work_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "dashboard_work_items_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'done'::text, 'cancelled'::text])))
);

ALTER TABLE "public"."dashboard_work_items"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."dashboard_work_items"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."document_publication_receipts" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "publication_id"  uuid                     NOT NULL,
  "user_id"         uuid                     NOT NULL,
  "first_opened_at" timestamp with time zone,
  "last_opened_at"  timestamp with time zone,
  "approved_at"     timestamp with time zone,
  "approval_note"   text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_publication_receipts_pkey" PRIMARY KEY (id),
  CONSTRAINT "document_publication_receipts_publication_id_user_id_key" UNIQUE (publication_id, user_id)
);

ALTER TABLE "public"."document_publication_receipts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."document_publication_recipients" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "publication_id"    uuid                     NOT NULL,
  "recipient_user_id" uuid                     NOT NULL,
  "source_type"       text                     NOT NULL DEFAULT 'user'::text,
  "source_value"      text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_publication_recipien_publication_id_recipient_user_key" UNIQUE (publication_id, recipient_user_id),
  CONSTRAINT "document_publication_recipients_pkey" PRIMARY KEY (id),
  CONSTRAINT "document_publication_recipients_source_type_check" CHECK ((source_type = ANY (ARRAY['user'::text, 'tag'::text])))
);

ALTER TABLE "public"."document_publication_recipients"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."document_publications" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "file_id"           uuid                     NOT NULL,
  "title"             text                     NOT NULL,
  "description"       text,
  "version_label"     text,
  "due_at"            timestamp with time zone,
  "requires_approval" boolean                  NOT NULL DEFAULT true,
  "published_by"      uuid,
  "archived_at"       timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_publications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."document_publications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."documents_files" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "folder_id"      uuid,
  "file_name"      text                     NOT NULL,
  "storage_bucket" text                     NOT NULL,
  "storage_path"   text                     NOT NULL,
  "content_type"   text,
  "size_bytes"     bigint,
  "created_by"     uuid,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "documents_files_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."documents_files"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."documents_folders" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "parent_id"  uuid,
  "name"       text                     NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "color"      text,
  CONSTRAINT "documents_folders_color_chk"
    CHECK (((color IS NULL) OR (color = ANY (ARRAY['gray'::text, 'blue'::text, 'green'::text, 'yellow'::text, 'red'::text, 'purple'::text])))),
  CONSTRAINT "documents_folders_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."documents_folders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employee_profile_details" (
  "user_id"               uuid                     NOT NULL,
  "job_title"             text,
  "department"            text,
  "manager_name"          text,
  "employment_start_date" date,
  "employment_type"       text,
  "certifications"        text,
  "admin_notes"           text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_profile_details_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."employee_profile_details"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employee_sensitive_details" (
  "user_id"                  uuid                     NOT NULL,
  "personal_identity_number" text,
  "bank_account_name"        text,
  "bank_clearing_number"     text,
  "bank_account_number"      text,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_sensitive_details_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."employee_sensitive_details"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fault_report_recipients" (
  "user_id"    uuid                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fault_report_recipients_pkey" PRIMARY KEY (user_id)
);

ALTER TABLE "public"."fault_report_recipients"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fault_report_updates" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "report_id"      uuid                     NOT NULL,
  "status"         text                     NOT NULL,
  "reply"          text,
  "responder_id"   uuid,
  "responder_name" text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fault_report_updates_pkey" PRIMARY KEY (id),
  CONSTRAINT "fault_report_updates_status_chk" CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text])))
);

ALTER TABLE "public"."fault_report_updates"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fault_reports" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "reporter_id"    uuid,
  "reporter_name"  text                     NOT NULL,
  "category"       text                     NOT NULL,
  "comment"        text                     NOT NULL,
  "status"         text                     NOT NULL DEFAULT 'new'::text,
  "reply"          text,
  "responder_id"   uuid,
  "responder_name" text,
  "responded_at"   timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fault_reports_category_chk" CHECK ((category = ANY (ARRAY['truck'::text, 'lager'::text, 'lastbil'::text, 'isoleringsmaskin'::text, 'maskiner'::text]))),
  CONSTRAINT "fault_reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "fault_reports_status_chk" CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text])))
);

ALTER TABLE "public"."fault_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fortnox_article_favorites" (
  "article_number" text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"     uuid,
  CONSTRAINT "fortnox_article_favorites_pkey" PRIMARY KEY (article_number)
);

ALTER TABLE "public"."fortnox_article_favorites"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fortnox_article_work_description_defaults" (
  "article_number" text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"     uuid,
  CONSTRAINT "fortnox_article_work_description_defaults_pkey" PRIMARY KEY (article_number)
);

ALTER TABLE "public"."fortnox_article_work_description_defaults"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fortnox_articles_cache" (
  "article_number"  text                     NOT NULL,
  "description"     text,
  "sales_price"     numeric,
  "purchase_price"  numeric,
  "unit"            text,
  "article_type"    text,
  "active"          boolean                  NOT NULL DEFAULT true,
  "raw"             jsonb,
  "last_fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "note"            text,
  "note_synced_at"  timestamp with time zone,
  CONSTRAINT "fortnox_articles_cache_pkey" PRIMARY KEY (article_number)
);

ALTER TABLE "public"."fortnox_articles_cache"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fortnox_integrations" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "provider"      text                     NOT NULL DEFAULT 'fortnox'::text,
  "access_token"  text                     NOT NULL,
  "refresh_token" text                     NOT NULL,
  "expires_at"    timestamp with time zone NOT NULL,
  "scope"         text,
  "connected_by"  uuid,
  "connected_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fortnox_integrations_pkey" PRIMARY KEY (id),
  CONSTRAINT "fortnox_integrations_provider_unique" UNIQUE (PROVIDER)
);

ALTER TABLE "public"."fortnox_integrations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."info_groups" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"      text                     NOT NULL,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "info_groups_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."info_groups"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."info_section_images" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "section_id"     uuid                     NOT NULL,
  "caption"        text,
  "sort_order"     integer                  NOT NULL DEFAULT 0,
  "storage_bucket" text,
  "storage_path"   text,
  "public_path"    text,
  "file_name"      text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "content_type"   text,
  CONSTRAINT "info_section_images_one_source" CHECK ((((storage_bucket IS NOT NULL) AND (storage_path IS
    NOT NULL) AND (public_path IS NULL)) OR ((storage_bucket IS NULL) AND (storage_path IS NULL) AND (public_path IS NOT NULL)))),
  CONSTRAINT "info_section_images_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."info_section_images"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."info_sections" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "group_id"   uuid                     NOT NULL,
  "title"      text                     NOT NULL,
  "body"       jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "info_sections_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."info_sections"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."korjournal_trips" (
  "id"            bigint                   GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"       text,
  "date"          date,
  "start_address" text,
  "end_address"   text,
  "start_km"      integer,
  "end_km"        integer,
  "note"          text,
  "sales_person"  text,
  CONSTRAINT "korjournal_trips_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."korjournal_trips"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."material_quality_samples" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"           uuid,
  "order_id"          text,
  "project_number"    text,
  "installation_date" date,
  "material_used"     text,
  "batch_number"      text,
  "dammighet"         smallint,
  "klumpighet"        smallint,
  "etapp_name"        text,
  "densitet"          numeric,
  "source_type"       text,
  "source_row_index"  smallint,
  "fluffer_used"      boolean,
  CONSTRAINT "material_quality_samples_dammighet_check" CHECK (((dammighet >= 1) AND (dammighet <= 10))),
  CONSTRAINT "material_quality_samples_klumpighet_check" CHECK (((klumpighet >= 1) AND (klumpighet <= 10))),
  CONSTRAINT "material_quality_samples_pkey" PRIMARY KEY (id),
  CONSTRAINT "material_quality_samples_source_type_check" CHECK ((source_type = ANY (ARRAY['open'::text, 'closed'::text])))
);

CREATE TABLE "public"."news_items" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "headline"   text                     NOT NULL,
  "body"       text                     NOT NULL,
  "image_url"  text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" uuid,
  CONSTRAINT "news_items_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."news_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."notifications" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" uuid                     NOT NULL,
  "type"              text                     NOT NULL,
  "title"             text                     NOT NULL,
  "body"              text,
  "href"              text,
  "entity_type"       text,
  "entity_id"         uuid,
  "read_at"           timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."notifications"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."offert_calculations" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"            uuid                     NOT NULL,
  "name"               text                     NOT NULL,
  "payload"            jsonb                    NOT NULL,
  "subtotal"           numeric(12,2)            NOT NULL DEFAULT 0,
  "total_before_rot"   numeric(12,2)            NOT NULL DEFAULT 0,
  "rot_amount"         numeric(12,2)            NOT NULL DEFAULT 0,
  "total_after_rot"    numeric(12,2)            NOT NULL DEFAULT 0,
  "address"            text                     NOT NULL DEFAULT ''::text,
  "city"               text                     NOT NULL DEFAULT ''::text,
  "quote_date"         date                     NOT NULL DEFAULT CURRENT_DATE,
  "salesperson"        text                     NOT NULL DEFAULT ''::text,
  "phone"              text                     NOT NULL DEFAULT ''::text,
  "status"             text                     NOT NULL DEFAULT 'Återkoppling'::text,
  "next_meeting_date"  date,
  "salesperson_phone"  text                     NOT NULL DEFAULT ''::text,
  "offert_number_year" integer                  NOT NULL,
  "offert_number_seq"  integer                  NOT NULL,
  "internal_note"      text                     NOT NULL DEFAULT ''::text,
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "offert_calculations_pkey" PRIMARY KEY (id),
  CONSTRAINT "offert_calculations_status_check" CHECK ((status = ANY (ARRAY['Återkoppling'::text, 'Bekräftad'::text, 'Förlorad'::text])))
);

ALTER TABLE "public"."offert_calculations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."offert_customer_requests" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "offert_id"      uuid                     NOT NULL,
  "seller_user_id" uuid                     NOT NULL,
  "seller_email"   text                     NOT NULL DEFAULT ''::text,
  "token_hash"     text                     NOT NULL,
  "status"         text                     NOT NULL DEFAULT 'pending'::text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "submitted_at"   timestamp with time zone,
  "revoked_at"     timestamp with time zone,
  "expires_at"     timestamp with time zone,
  CONSTRAINT "offert_customer_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "offert_customer_requests_token_hash_key" UNIQUE (token_hash)
);

ALTER TABLE "public"."offert_customer_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."offert_customer_responses" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"           uuid                     NOT NULL,
  "person1_name"         text                     NOT NULL DEFAULT ''::text,
  "person1_personnummer" text                     NOT NULL DEFAULT ''::text,
  "person2_name"         text                     NOT NULL DEFAULT ''::text,
  "person2_personnummer" text                     NOT NULL DEFAULT ''::text,
  "delivery_address"     text                     NOT NULL DEFAULT ''::text,
  "postal_code"          text                     NOT NULL DEFAULT ''::text,
  "city"                 text                     NOT NULL DEFAULT ''::text,
  "property_designation" text                     NOT NULL DEFAULT ''::text,
  "phone"                text                     NOT NULL DEFAULT ''::text,
  "email"                text                     NOT NULL DEFAULT ''::text,
  "existing_insulation"  text                     NOT NULL DEFAULT ''::text,
  "attic_hatch_type"     text                     NOT NULL DEFAULT ''::text,
  "other_info"           text                     NOT NULL DEFAULT ''::text,
  "signature_data_url"   text                     NOT NULL DEFAULT ''::text,
  "signature_signed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "submitted_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "offert_customer_responses_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."offert_customer_responses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."offert_number_counters" (
  "year"       integer                  NOT NULL,
  "last_seq"   integer                  NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "offert_number_counters_pkey" PRIMARY KEY (year)
);

CREATE TABLE "public"."ops_activity_events" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "actor_id"      uuid,
  "actor_name"    text,
  "action"        text                     NOT NULL,
  "entity_type"   text                     NOT NULL,
  "entity_id"     uuid,
  "work_order_id" uuid,
  "segment_id"    uuid,
  "summary"       text,
  "details"       jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "ops_activity_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_activity_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ops_day_notes" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "note_day"   date                     NOT NULL,
  "body"       text                     NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_day_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_day_notes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_day_notes"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_depot_deliveries" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "depot_id"     uuid                     NOT NULL,
  "material"     text                     NOT NULL,
  "sacks"        integer                  NOT NULL,
  "delivered_on" date                     NOT NULL,
  "note"         text,
  "created_by"   uuid,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_depot_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_depot_deliveries_sacks_check" CHECK ((sacks > 0))
);

ALTER TABLE "public"."ops_depot_deliveries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_depot_deliveries"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_depot_stock_counts" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "depot_id"        uuid                     NOT NULL,
  "material"        text                     NOT NULL,
  "counted_sacks"   integer                  NOT NULL,
  "counted_on"      date                     NOT NULL,
  "note"            text,
  "created_by"      uuid,
  "created_by_name" text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_depot_stock_counts_counted_sacks_check" CHECK ((counted_sacks >= 0)),
  CONSTRAINT "ops_depot_stock_counts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_depot_stock_counts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ops_depots" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "location"   text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_depots_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_depots"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_depots"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_expected_deliveries" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "depot_id"        uuid                     NOT NULL,
  "material"        text                     NOT NULL,
  "sacks"           integer                  NOT NULL,
  "expected_on"     date                     NOT NULL,
  "note"            text,
  "status"          text                     NOT NULL DEFAULT 'expected'::text,
  "delivery_id"     uuid,
  "arrived_at"      timestamp with time zone,
  "arrived_by"      uuid,
  "arrived_by_name" text,
  "created_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "order_id"        uuid,
  CONSTRAINT "ops_expected_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_expected_deliveries_sacks_check" CHECK ((sacks > 0)),
  CONSTRAINT "ops_expected_deliveries_status_check" CHECK ((status = ANY (ARRAY['expected'::text, 'arrived'::text, 'cancelled'::text])))
);

ALTER TABLE "public"."ops_expected_deliveries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_expected_deliveries"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_job_types" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "key"        text                     NOT NULL,
  "label"      text                     NOT NULL,
  "color"      text                     NOT NULL,
  "sort_index" integer                  NOT NULL DEFAULT 0,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_job_types_key_key" UNIQUE (key),
  CONSTRAINT "ops_job_types_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_job_types"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_job_types"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_material_orders" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "order_no"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "supplier_id"         uuid,
  "status"              text                     NOT NULL DEFAULT 'draft'::text,
  "lines"               jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "other_lines"         jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "message"             text,
  "revision"            integer                  NOT NULL DEFAULT 1,
  "supplier_name"       text,
  "recipient_email"     text,
  "from_address"        text,
  "reply_to"            text,
  "bcc"                 text,
  "email_language"      text,
  "email_subject"       text,
  "email_text"          text,
  "composed_by_name"    text,
  "send_attempt"        integer                  NOT NULL DEFAULT 1,
  "attempt_started_at"  timestamp with time zone,
  "last_try_at"         timestamp with time zone,
  "send_error"          text,
  "send_error_code"     text,
  "provider_message_id" text,
  "sent_at"             timestamp with time zone,
  "sent_by"             uuid,
  "sent_by_name"        text,
  "verified_by"         uuid,
  "verified_by_name"    text,
  "created_by"          uuid,
  "created_by_name"     text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_material_orders_order_no_key" UNIQUE (order_no),
  CONSTRAINT "ops_material_orders_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_material_orders_shape_check"
    CHECK
    (((jsonb_typeof(lines) = 'array'::text) AND (jsonb_typeof(other_lines) = 'array'::text) AND (jsonb_array_length(other_lines) <= 20) AND ((message IS NULL) OR
    (char_length(message) <= 1000)) AND ((email_language IS NULL) OR (email_language = ANY (ARRAY['sv'::text, 'en'::text]))) AND (revision >= 1) AND (send_attempt >= 1))),
  CONSTRAINT "ops_material_orders_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'sent'::text])))
);

ALTER TABLE "public"."ops_material_orders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ops_material_suppliers" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                 text                     NOT NULL,
  "email"                text                     NOT NULL,
  "contact_name"         text,
  "phone"                text,
  "materials"            text[]                   NOT NULL DEFAULT '{}'::text[],
  "lead_time_days"       integer                  NOT NULL DEFAULT 0,
  "note"                 text,
  "active"               boolean                  NOT NULL DEFAULT true,
  "created_by"           uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "round_up_to"          integer                  NOT NULL DEFAULT 1,
  "order_email_language" text                     NOT NULL DEFAULT 'sv'::text,
  "order_email_subject"  text,
  "order_email_body"     text,
  CONSTRAINT "ops_material_suppliers_lead_time_days_check" CHECK (((lead_time_days >= 0) AND (lead_time_days <= 365))),
  CONSTRAINT "ops_material_suppliers_order_email_body_check"
    CHECK (((order_email_body IS NULL) OR ((char_length(order_email_body) >= 1) AND (char_length(order_email_body) <= 5000)))),
  CONSTRAINT "ops_material_suppliers_order_email_language_check" CHECK ((order_email_language = ANY (ARRAY['sv'::text, 'en'::text]))),
  CONSTRAINT "ops_material_suppliers_order_email_pair_check" CHECK (((order_email_subject IS NULL) = (order_email_body IS NULL))),
  CONSTRAINT "ops_material_suppliers_order_email_subject_check"
    CHECK
    (((order_email_subject IS NULL) OR (((char_length(order_email_subject) >= 1) AND (char_length(order_email_subject) <= 200)) AND (POSITION((chr(10)) IN (order_email_subject)) =
    0) AND (POSITION((chr(13)) IN (order_email_subject)) = 0)))),
  CONSTRAINT "ops_material_suppliers_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_material_suppliers_round_up_to_check" CHECK (((round_up_to >= 1) AND (round_up_to <= 1000)))
);

ALTER TABLE "public"."ops_material_suppliers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ops_segment_crew" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "segment_id"  uuid                     NOT NULL,
  "member_id"   uuid,
  "member_name" text                     NOT NULL,
  "created_by"  uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_segment_crew_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_segment_crew"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_segment_crew"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_segment_reports" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "segment_id"      uuid                     NOT NULL,
  "work_order_id"   uuid                     NOT NULL,
  "report_day"      date                     NOT NULL,
  "sacks_blown"     numeric(10,2)            NOT NULL,
  "note"            text,
  "created_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "kind"            text                     NOT NULL DEFAULT 'partial'::text,
  "material"        text,
  "construction"    text,
  "created_by_name" text,
  CONSTRAINT "ops_segment_reports_construction_chk"
    CHECK (((construction IS NULL) OR (construction = ANY (ARRAY['vagg'::text, 'snedtak'::text, 'vind'::text, 'golv'::text, 'mellanbjalklag'::text])))),
  CONSTRAINT "ops_segment_reports_kind_chk" CHECK ((kind = ANY (ARRAY['partial'::text, 'final'::text]))),
  CONSTRAINT "ops_segment_reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_segment_reports_sacks_blown_check" CHECK ((sacks_blown >= (0)::numeric))
);

ALTER TABLE "public"."ops_segment_reports"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_segment_reports"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_segments" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"        uuid,
  "truck_id"             uuid                     NOT NULL,
  "start_day"            date                     NOT NULL,
  "end_day"              date                     NOT NULL,
  "sort_index"           integer                  NOT NULL DEFAULT 0,
  "created_by"           uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "job_type"             text,
  "on_hold"              boolean                  NOT NULL DEFAULT false,
  "created_by_name"      text,
  "placeholder_title"    text,
  "placeholder_customer" text,
  "field_visible"        boolean                  NOT NULL DEFAULT false,
  "work_description"     text,
  "stage_id"             uuid,
  CONSTRAINT "ops_segments_day_range_check" CHECK ((end_day >= start_day)),
  CONSTRAINT "ops_segments_job_or_placeholder" CHECK (((work_order_id IS NOT NULL) OR (placeholder_title IS NOT NULL))),
  CONSTRAINT "ops_segments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_segments"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_segments"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_truck_crew" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "truck_id"    uuid                     NOT NULL,
  "member_id"   uuid,
  "member_name" text                     NOT NULL,
  "start_day"   date                     NOT NULL,
  "end_day"     date                     NOT NULL,
  "created_by"  uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "role"        text                     NOT NULL DEFAULT 'member'::text,
  CONSTRAINT "ops_truck_crew_day_range_check" CHECK ((end_day >= start_day)),
  CONSTRAINT "ops_truck_crew_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_truck_crew_role_check" CHECK ((role = ANY (ARRAY['leader'::text, 'member'::text])))
);

ALTER TABLE "public"."ops_truck_crew"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_truck_crew"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_truck_default_crew" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "truck_id"    uuid                     NOT NULL,
  "member_id"   uuid,
  "member_name" text                     NOT NULL,
  "role"        text                     NOT NULL DEFAULT 'member'::text,
  "created_by"  uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_truck_default_crew_pkey" PRIMARY KEY (id),
  CONSTRAINT "ops_truck_default_crew_role_check" CHECK ((role = ANY (ARRAY['leader'::text, 'member'::text])))
);

ALTER TABLE "public"."ops_truck_default_crew"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_truck_default_crew"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_trucks" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "color"      text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "depot_id"   uuid,
  CONSTRAINT "ops_trucks_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_trucks"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_trucks"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."ops_work_order_confirmations" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"       uuid                     NOT NULL,
  "segment_id"          uuid,
  "channel"             text                     NOT NULL,
  "recipient"           text                     NOT NULL,
  "start_day"           date                     NOT NULL,
  "end_day"             date                     NOT NULL,
  "provider_message_id" text,
  "status"              text,
  "created_by"          uuid,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ops_work_order_confirmations_channel_check" CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text]))),
  CONSTRAINT "ops_work_order_confirmations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ops_work_order_confirmations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ops_work_order_confirmations"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."permissions" (
  "key"         text                     NOT NULL,
  "description" text                     NOT NULL DEFAULT ''::text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "permissions_pkey" PRIMARY KEY (key)
);

ALTER TABLE "public"."permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."planning_activity_events" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "actor_id"    uuid,
  "actor_name"  text,
  "action"      text                     NOT NULL,
  "entity_type" text                     NOT NULL,
  "entity_id"   text                     NOT NULL,
  "project_id"  text,
  "segment_id"  uuid,
  "details"     jsonb,
  CONSTRAINT "planning_activity_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_activity_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."planning_day_notes" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "note_day"        date                     NOT NULL,
  "text"            text                     NOT NULL,
  "created_by"      text,
  "created_by_name" text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "planning_day_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_day_notes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_day_notes"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_depot_deliveries" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "depot_id"      uuid                     NOT NULL,
  "material_kind" text                     NOT NULL,
  "amount"        integer                  NOT NULL,
  "delivery_date" date                     NOT NULL,
  "created_by"    uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at"  timestamp with time zone,
  CONSTRAINT "planning_depot_deliveries_amount_check" CHECK ((amount > 0)),
  CONSTRAINT "planning_depot_deliveries_material_kind_check" CHECK ((material_kind = ANY (ARRAY['Ekovilla'::text, 'Vitull'::text]))),
  CONSTRAINT "planning_depot_deliveries_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_depot_deliveries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_depot_deliveries"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_depot_usage" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "project_id"        text                     NOT NULL,
  "installation_date" date,
  "depot_id"          uuid                     NOT NULL,
  "bags_used"         integer                  NOT NULL,
  "source_key"        text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "material_kind"     text,
  "order_number"      text,
  CONSTRAINT "planning_depot_usage_bags_used_check" CHECK ((bags_used > 0)),
  CONSTRAINT "planning_depot_usage_material_kind_check" CHECK ((material_kind = ANY (ARRAY['Ekovilla'::text, 'Vitull'::text]))),
  CONSTRAINT "planning_depot_usage_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_depot_usage"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."planning_depots" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                    text                     NOT NULL,
  "material_total"          integer,
  "created_by"              uuid,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "material_ekovilla_total" integer,
  "material_vitull_total"   integer,
  CONSTRAINT "planning_depots_name_key" UNIQUE (name),
  CONSTRAINT "planning_depots_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_depots"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_depots"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_job_type_colors" (
  "job_type"   text                     NOT NULL,
  "color_hex"  text                     NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "planning_job_type_colors_pkey" PRIMARY KEY (job_type)
);

ALTER TABLE "public"."planning_job_type_colors"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."planning_project_meta" (
  "project_id"              text                     NOT NULL,
  "truck"                   text,
  "bag_count"               integer,
  "job_type"                text,
  "color"                   text,
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "client_notified"         boolean,
  "client_notified_at"      timestamp with time zone,
  "client_notified_by"      text,
  "actual_bags_used"        integer,
  "actual_bags_set_at"      timestamp with time zone,
  "actual_bags_set_by"      text,
  "address_street"          text,
  "address_postal"          text,
  "address_city"            text,
  "delivery_sent"           boolean,
  "delivery_sent_at"        timestamp with time zone,
  "delivery_sent_by"        text,
  "status_label"            text,
  "status_color"            text,
  "sms_notified"            boolean,
  "sms_notified_at"         timestamp with time zone,
  "sms_notified_by"         text,
  "sms_recipient_phone"     text,
  "sms_provider_message_id" text,
  "sms_delivery_status"     text,
  "sms_last_error"          text,
  CONSTRAINT "planning_project_meta_pkey" PRIMARY KEY (project_id),
  CONSTRAINT "planning_project_meta_project_id_key" UNIQUE (project_id)
);

ALTER TABLE "public"."planning_project_meta"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_project_meta"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_segment_reports" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "segment_id"      uuid,
  "report_day"      date                     NOT NULL,
  "amount"          integer                  NOT NULL,
  "created_by"      uuid,
  "created_by_name" text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "project_id"      text,
  CONSTRAINT "planning_segment_reports_amount_check" CHECK ((amount > 0)),
  CONSTRAINT "planning_segment_reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_segment_reports"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_segment_reports"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_segment_team_members" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "segment_id"  uuid                     NOT NULL,
  "member_id"   uuid,
  "member_name" text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "planning_segment_team_members_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_segment_team_members"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_segment_team_members"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_segments" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "project_id"      text                     NOT NULL,
  "project_name"    text                     NOT NULL,
  "customer"        text,
  "order_number"    text,
  "source"          text                     NOT NULL,
  "is_manual"       boolean                  NOT NULL DEFAULT false,
  "start_day"       date                     NOT NULL,
  "end_day"         date                     NOT NULL,
  "created_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_name" text,
  "depot_id"        uuid,
  "sort_index"      integer,
  "truck"           text,
  "job_type"        text,
  "on_hold"         boolean                  NOT NULL DEFAULT false,
  "on_hold_at"      timestamp with time zone,
  "on_hold_by"      uuid,
  CONSTRAINT "planning_segments_pkey" PRIMARY KEY (id),
  CONSTRAINT "planning_segments_source_check" CHECK ((source = ANY (ARRAY['blikk'::text, 'manual'::text])))
);

ALTER TABLE "public"."planning_segments"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_segments"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."planning_truck_assignments" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "truck_id"          text                     NOT NULL,
  "start_day"         date                     NOT NULL,
  "end_day"           date                     NOT NULL,
  "team1_id"          uuid,
  "team2_id"          uuid,
  "team_member1_name" text,
  "team_member2_name" text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"        uuid,
  CONSTRAINT "planning_truck_assignments_day_range_check" CHECK ((end_day >= start_day)),
  CONSTRAINT "planning_truck_assignments_pkey" PRIMARY KEY (id)
);

CREATE TABLE "public"."planning_trucks" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"              text                     NOT NULL,
  "color"             text,
  "team_member1"      uuid,
  "team_member2"      uuid,
  "created_by"        uuid,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "team_member1_name" text,
  "team_member2_name" text,
  "depot_id"          uuid,
  "team1_id"          uuid,
  "team2_id"          uuid,
  CONSTRAINT "planning_trucks_name_key" UNIQUE (name),
  CONSTRAINT "planning_trucks_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."planning_trucks"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."planning_trucks"
  REPLICA IDENTITY FULL;

CREATE TABLE "public"."profiles" (
  "id"                      uuid                     NOT NULL,
  "full_name"               text,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "tags"                    text[]                   NOT NULL DEFAULT '{}'::text[],
  "blikk_id"                bigint,
  "phone"                   text,
  "private_email"           text,
  "address_line1"           text,
  "postal_code"             text,
  "city"                    text,
  "emergency_contact_name"  text,
  "emergency_contact_phone" text,
  "clothing_size"           text,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."role_permissions" (
  "permission_key" text NOT NULL
);

ALTER TABLE "public"."role_permissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_checklist_categories" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"       text                     NOT NULL,
  "label"      text                     NOT NULL,
  "position"   integer                  NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "safety_checklist_categories_code_uniq" UNIQUE (code),
  CONSTRAINT "safety_checklist_categories_label_chk" CHECK ((btrim(label) <> ''::text)),
  CONSTRAINT "safety_checklist_categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."safety_checklist_categories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_checklist_items" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "category_id" uuid                     NOT NULL,
  "number"      integer                  NOT NULL,
  "text"        text                     NOT NULL,
  "position"    integer                  NOT NULL,
  "active"      boolean                  NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "safety_checklist_items_number_uniq" UNIQUE (number),
  CONSTRAINT "safety_checklist_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_checklist_items_text_chk" CHECK ((btrim(text) <> ''::text))
);

ALTER TABLE "public"."safety_checklist_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_round_actions" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "round_id"         uuid                     NOT NULL,
  "item_id"          uuid,
  "position"         integer                  NOT NULL DEFAULT 0,
  "finding"          text                     NOT NULL,
  "risk"             text,
  "action"           text,
  "responsible_id"   uuid,
  "responsible_name" text,
  "due_on"           date,
  "status"           text                     NOT NULL DEFAULT 'not_started'::text,
  "followed_up_on"   date,
  "effect"           text,
  "cost_note"        text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "safety_round_actions_effect_chk" CHECK (((effect IS NULL) OR (effect = ANY (ARRAY['yes'::text, 'no'::text, 'partial'::text, 'not_assessed'::text])))),
  CONSTRAINT "safety_round_actions_finding_chk" CHECK ((btrim(finding) <> ''::text)),
  CONSTRAINT "safety_round_actions_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_round_actions_risk_chk" CHECK (((risk IS NULL) OR (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'severe'::text])))),
  CONSTRAINT "safety_round_actions_status_chk" CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'done'::text, 'delayed'::text, 'written_off'::text])))
);

ALTER TABLE "public"."safety_round_actions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_round_items" (
  "id"              uuid    NOT NULL DEFAULT gen_random_uuid(),
  "round_id"        uuid    NOT NULL,
  "catalog_item_id" uuid,
  "category_code"   text    NOT NULL,
  "category_label"  text    NOT NULL,
  "number"          integer,
  "text"            text    NOT NULL,
  "position"        integer NOT NULL,
  "status"          text,
  "risk"            text,
  "description"     text,
  "fixed_on_site"   boolean,
  "to_action_plan"  text,
  "comment"         text,
  CONSTRAINT "safety_round_items_id_round_uniq" UNIQUE (id, round_id),
  CONSTRAINT "safety_round_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_round_items_plan_chk" CHECK (((to_action_plan IS NULL) OR (to_action_plan = ANY (ARRAY['yes'::text, 'no'::text, 'fixed'::text])))),
  CONSTRAINT "safety_round_items_risk_chk" CHECK (((risk IS NULL) OR (risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'severe'::text])))),
  CONSTRAINT "safety_round_items_status_chk" CHECK (((status IS NULL) OR (status = ANY (ARRAY['ok'::text, 'partial'::text, 'defect'::text, 'na'::text])))),
  CONSTRAINT "safety_round_items_text_chk" CHECK ((btrim(text) <> ''::text))
);

ALTER TABLE "public"."safety_round_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_round_participants" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "round_id"   uuid                     NOT NULL,
  "profile_id" uuid,
  "name"       text                     NOT NULL,
  "role"       text                     NOT NULL,
  "company"    text,
  "present"    boolean                  NOT NULL DEFAULT true,
  "initials"   text,
  "comment"    text,
  "position"   integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "safety_round_participants_name_chk" CHECK ((btrim(name) <> ''::text)),
  CONSTRAINT "safety_round_participants_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_round_participants_role_chk" CHECK ((role = ANY (ARRAY['leader'::text, 'safety_rep'::text, 'installer'::text, 'site_manager'::text, 'other'::text])))
);

ALTER TABLE "public"."safety_round_participants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_round_photos" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "round_id"         uuid                     NOT NULL,
  "item_id"          uuid                     NOT NULL,
  "photo_no"         integer                  NOT NULL,
  "storage_path"     text                     NOT NULL,
  "print_path"       text                     NOT NULL,
  "size_bytes"       integer                  NOT NULL,
  "print_size_bytes" integer                  NOT NULL,
  "created_by"       uuid,
  "created_by_name"  text                     NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "safety_round_photos_created_by_name_chk" CHECK ((btrim(created_by_name) <> ''::text)),
  CONSTRAINT "safety_round_photos_no_chk" CHECK ((photo_no >= 1)),
  CONSTRAINT "safety_round_photos_no_uniq" UNIQUE (round_id, photo_no),
  CONSTRAINT "safety_round_photos_path_uniq" UNIQUE (storage_path),
  CONSTRAINT "safety_round_photos_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_round_photos_print_path_uniq" UNIQUE (print_path),
  CONSTRAINT "safety_round_photos_print_size_chk" CHECK (((print_size_bytes > 0) AND (print_size_bytes <= 2097152))),
  CONSTRAINT "safety_round_photos_size_chk" CHECK (((size_bytes > 0) AND (size_bytes <= 2097152)))
);

ALTER TABLE "public"."safety_round_photos"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."safety_rounds" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id"        uuid                     NOT NULL,
  "round_number"         integer                  NOT NULL,
  "status"               text                     NOT NULL DEFAULT 'draft'::text,
  "order_number"         text,
  "fortnox_order_number" text,
  "project_name"         text                     NOT NULL,
  "client_name"          text,
  "site_address"         text,
  "object_label"         text,
  "held_on"              date                     NOT NULL,
  "held_at"              time without time zone,
  "client_label"         text,
  "contract_step"        text,
  "employer"             text,
  "work_type"            text,
  "weather"              text,
  "leader_id"            uuid,
  "leader_name"          text,
  "safety_rep_name"      text,
  "next_round_due"       date,
  "previous_followed_up" boolean,
  "created_by"           uuid,
  "created_by_name"      text                     NOT NULL,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"         timestamp with time zone,
  "completed_by"         uuid,
  "last_photo_no"        integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "safety_rounds_completed_chk" CHECK (((status = 'completed'::text) = (completed_at IS NOT NULL))),
  CONSTRAINT "safety_rounds_created_by_name_chk" CHECK ((btrim(created_by_name) <> ''::text)),
  CONSTRAINT "safety_rounds_number_chk" CHECK ((round_number >= 1)),
  CONSTRAINT "safety_rounds_number_uniq" UNIQUE (work_order_id, round_number),
  CONSTRAINT "safety_rounds_pkey" PRIMARY KEY (id),
  CONSTRAINT "safety_rounds_project_name_chk" CHECK ((btrim(project_name) <> ''::text)),
  CONSTRAINT "safety_rounds_status_chk" CHECK ((status = ANY (ARRAY['draft'::text, 'completed'::text])))
);

ALTER TABLE "public"."safety_rounds"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tasks" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"        text                     NOT NULL,
  "description"  text,
  "status"       text                     NOT NULL DEFAULT 'open'::text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "due_date"     date,
  "created_by"   uuid                     NOT NULL,
  "assigned_to"  uuid                     NOT NULL,
  "source"       text,
  "metadata"     jsonb,
  "prospect_id"  uuid,
  "priority"     text                     NOT NULL DEFAULT 'normal'::text,
  "completed_at" timestamp with time zone,
  CONSTRAINT "tasks_pkey" PRIMARY KEY (id),
  CONSTRAINT "tasks_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])))
);

ALTER TABLE "public"."tasks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."user_permissions" (
  "user_id"        uuid                     NOT NULL,
  "permission_key" text                     NOT NULL,
  "effect"         text                     NOT NULL,
  "created_by"     uuid,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_permissions_effect_check" CHECK ((effect = ANY (ARRAY['grant'::text, 'revoke'::text]))),
  CONSTRAINT "user_permissions_pkey" PRIMARY KEY (user_id, permission_key)
);

ALTER TABLE "public"."user_permissions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."crm_quotes"
  ADD COLUMN "quote_number" text GENERATED ALWAYS AS (('OFF-'::text || upper(substr(replace((id)::text, '-'::text, ''::text), 1, 8)))) STORED;

CREATE TYPE "public"."user_role" AS ENUM (
  'member',
  'sales',
  'admin',
  'konsult',
  'ekonomi'
);

ALTER TABLE "public"."profiles"
  ADD COLUMN "role" public.user_role NOT NULL DEFAULT 'member'::public.user_role;

ALTER TABLE "public"."role_permissions"
  ADD COLUMN "role" public.user_role NOT NULL;

CREATE OR REPLACE FUNCTION public._material_order_create_expected (
  p_order_id uuid,
  p_lines    jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_count integer;
begin
  insert into public.ops_expected_deliveries (depot_id, material, sacks, expected_on, note, created_by, order_id)
  select (l->>'depot_id')::uuid,
         l->>'material',
         ((l->>'sacks')::numeric)::integer,
         (l->>'requested_on')::date,
         -- ⚠️ ALDRIG orderns meddelande här: receive_expected_delivery kopierar noteringen till lagerraden.
         null,
         auth.uid(),
         p_order_id
  from jsonb_array_elements(p_lines) as l
  where exists (select 1 from public.ops_depots d where d.id = (l->>'depot_id')::uuid);
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public._material_order_lines_valid (
  p_lines jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  l jsonb;
  v_sacks numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' then
    return false;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    begin
      if jsonb_typeof(l->'sacks') <> 'number' then
        return false;
      end if;
      v_sacks := (l->>'sacks')::numeric;
      if v_sacks <> trunc(v_sacks) or v_sacks < 1 or v_sacks > 100000 then
        return false;
      end if;
      if coalesce(btrim(l->>'material'), '') = '' then
        return false;
      end if;
      -- Datumet måste vara exakt den dag som står: to_char av castet ska ge tillbaka samma sträng.
      if to_char((l->>'requested_on')::date, 'YYYY-MM-DD') <> (l->>'requested_on') then
        return false;
      end if;
      if not exists (select 1 from public.ops_depots d where d.id = (l->>'depot_id')::uuid) then
        return false;
      end if;
    exception when others then
      return false;
    end;
  end loop;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.add_safety_round_photo (
  p_round_id         uuid,
  p_item_id          uuid,
  p_storage_path     text,
  p_print_path       text,
  p_size_bytes       integer,
  p_print_size_bytes integer
)
  RETURNS public.safety_round_photos
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_no integer;
  v_name text;
  v_row public.safety_round_photos;
begin
  if v_uid is null or not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_storage_path is null
     or p_storage_path !~ ('^' || p_round_id::text || '/' || v_uid::text
                           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
     or p_print_path is distinct from regexp_replace(p_storage_path, '\.jpg$', '.print.jpg') then
    raise exception 'invalid photo path' using errcode = '22023';
  end if;

  -- Låset: två foton i samma rond sparas ett i taget. Numret och taket prövas under låset.
  select r.status into v_status from public.safety_rounds r where r.id = p_round_id for update;
  if not found then
    raise exception 'round not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'round is completed' using errcode = '55000';
  end if;

  if exists (select 1 from public.safety_round_photos p where p.storage_path = p_storage_path) then
    raise exception 'photo already registered' using errcode = '23505';
  end if;

  if (select count(*) from public.safety_round_photos p where p.round_id = p_round_id) >= 30 then
    raise exception 'photo limit reached' using errcode = '54000';
  end if;

  update public.safety_rounds set last_photo_no = last_photo_no + 1
  where id = p_round_id
  returning last_photo_no into v_no;

  select nullif(btrim(pr.full_name), '') into v_name from public.profiles pr where pr.id = v_uid;

  insert into public.safety_round_photos (
    round_id, item_id, photo_no, storage_path, print_path, size_bytes, print_size_bytes, created_by, created_by_name
  ) values (
    p_round_id, p_item_id, v_no, p_storage_path, p_print_path, p_size_bytes, p_print_size_bytes, v_uid, coalesce(v_name, 'Okänd')
  )
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_due_deliveries()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  r record;
  applied int := 0;
begin
  for r in
    select id, depot_id, material_kind, amount
    from public.planning_depot_deliveries
    where processed_at is null
      and delivery_date <= current_date
    order by delivery_date, id
  loop
    if r.material_kind = 'Ekovilla' then
      update public.planning_depots
        set material_ekovilla_total = coalesce(material_ekovilla_total, material_total, 0) + r.amount
      where id = r.depot_id;
    elsif r.material_kind = 'Vitull' then
      update public.planning_depots
        set material_vitull_total = coalesce(material_vitull_total, 0) + r.amount
      where id = r.depot_id;
    end if;
    update public.planning_depot_deliveries
      set processed_at = now()
      where id = r.id;
    applied := applied + 1;
  end loop;
  return applied;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_offert_number()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  y int;
  s int;
begin
  -- Allow manual override (imports/backfills).
  if new.offert_number_year is not null and new.offert_number_seq is not null then
    return new;
  end if;

  if new.created_at is null then
    new.created_at = now();
  end if;

  y := extract(year from new.created_at)::int;

  insert into public.offert_number_counters(year, last_seq, updated_at)
  values (y, 1, now())
  on conflict (year) do update
    set last_seq = public.offert_number_counters.last_seq + 1,
        updated_at = now()
  returning last_seq into s;

  new.offert_number_year := y;
  new.offert_number_seq := s;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_material_order_send (
  p_order_id uuid,
  p_revision integer,
  p_attempt  integer
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row public.ops_material_orders%rowtype;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status = 'sent' then
    return 'already_sent';
  end if;
  if v_row.revision is distinct from p_revision then
    return 'revision_changed';
  end if;
  if v_row.send_attempt is distinct from p_attempt then
    return 'attempt_changed';
  end if;
  if v_row.status = 'draft' and (v_row.email_subject is null or v_row.email_text is null or v_row.recipient_email is null) then
    return 'not_reviewed';
  end if;
  if not public._material_order_lines_valid(v_row.lines) then
    return 'lines_invalid';
  end if;

  if v_row.status = 'draft' then
    perform set_config('ekovilla.material_order_rpc', 'on', true);
    -- attempt_started_at och last_try_at från SAMMA now(): att de skiljer sig är beviset på att försöket
    -- skickats om (se release_material_order_send).
    update public.ops_material_orders
       set status = 'sending', attempt_started_at = now(), last_try_at = now(),
           send_error = null, send_error_code = null
     where id = p_order_id;
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'claimed';
  end if;

  -- sending
  if v_row.attempt_started_at is null or v_row.attempt_started_at < now() - interval '23 hours' then
    return 'window_expired';
  end if;
  if v_row.last_try_at is not null and v_row.last_try_at > now() - interval '2 minutes' then
    return 'in_progress';
  end if;
  perform set_config('ekovilla.material_order_rpc', 'on', true);
  update public.ops_material_orders set last_try_at = now() where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'reclaimed';
end $function$;

CREATE OR REPLACE FUNCTION public.current_actor()
  RETURNS TABLE (
    actor_id   uuid,
    actor_name text
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
declare
  v_sub text;
  v_name text;
  v_actor_id uuid;
  v_actor_name text;
begin
  v_sub := nullif((current_setting('request.jwt.claims', true)::json ->> 'sub')::text, '');
  v_name := nullif((current_setting('request.jwt.claims', true)::json ->> 'full_name')::text, '');
  if v_sub is not null then v_actor_id := v_sub::uuid; else v_actor_id := null; end if;
  v_actor_name := v_name;
  if v_actor_name is null and v_actor_id is not null then
    begin
      select nullif(full_name, '') into v_actor_name from public.profiles where id = v_actor_id;
    exception when undefined_table then
      -- profiles table not available; ignore
      v_actor_name := null;
    end;
  end if;
  return query select v_actor_id, v_actor_name;
end; $function$;

CREATE OR REPLACE FUNCTION public.effective_permissions()
  RETURNS SETOF text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select rp.permission_key
  from public.profiles pr
  join public.role_permissions rp on rp.role = pr.role
  where pr.id = auth.uid()
  union
  select up.permission_key from public.user_permissions up
  where up.user_id = auth.uid() and up.effect = 'grant'
  except
  select up.permission_key from public.user_permissions up
  where up.user_id = auth.uid() and up.effect = 'revoke';
$function$;

CREATE OR REPLACE FUNCTION public.enforce_time_entry_owner()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'En tidrad kan inte byta ägare';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_time_period_lock()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_date_column text := tg_argv[0];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if public.is_time_locked(
         (to_jsonb(old) ->> 'user_id')::uuid,
         (to_jsonb(old) ->> v_date_column)::date
       ) then
      raise exception 'Perioden är inlämnad eller attesterad och kan inte ändras';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if public.is_time_locked(
         (to_jsonb(new) ->> 'user_id')::uuid,
         (to_jsonb(new) ->> v_date_column)::date
       ) then
      raise exception 'Perioden är inlämnad eller attesterad och kan inte ändras';
    end if;
  end if;

  -- En before-trigger måste returnera OLD på DELETE och NEW annars, annars avbryts operationen.
  -- Två grenar i stället för ett CASE: `old` och `new` är record-variabler och en CASE över dem
  -- tvingar plpgsql att typa uttrycket vid kompilering.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_material_order (
  p_order_id            uuid,
  p_provider_message_id text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row   public.ops_material_orders%rowtype;
  v_name  text;
  v_count integer;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'material_order_provider_id_required' using errcode = '22023';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    raise exception 'material_order_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'sent' then
    return 0;
  end if;
  if v_row.status <> 'sending' then
    raise exception 'material_order_not_sending' using errcode = '23514';
  end if;

  v_count := public._material_order_create_expected(p_order_id, v_row.lines);
  select full_name into v_name from public.profiles where id = auth.uid();

  perform set_config('ekovilla.material_order_rpc', 'on', true);
  update public.ops_material_orders
     set status = 'sent', provider_message_id = p_provider_message_id,
         sent_at = now(), sent_by = auth.uid(), sent_by_name = v_name,
         send_error = null, send_error_code = null
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);

  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.get_my_crm_jobs (
  start_date date DEFAULT NULL::date,
  end_date   date DEFAULT NULL::date
)
  RETURNS TABLE (
    segment_id           uuid,
    work_order_id        uuid,
    order_number         text,
    fortnox_order_number text,
    project_name         text,
    customer             text,
    job_day              date,
    start_day            date,
    end_day              date,
    truck                text,
    truck_color          text,
    job_type             text,
    status               text,
    work_address         jsonb,
    customer_address     jsonb,
    placeholder_title    text,
    work_description     text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select
    s.id            as segment_id,
    s.work_order_id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    -- Platshållarens kund läggs INTE ihop med wo.client_name här. Sammanslagningen görs i
    -- TypeScript (lib/domains/planning/myJobs.ts), av samma skäl som adressen redan gör det:
    -- en visningsregel ska stå på ett ställe, och SQL är inte det stället.
    coalesce(wo.client_name, s.placeholder_customer) as customer,
    gs.d::date      as job_day,
    s.start_day,
    s.end_day,
    t.name          as truck,
    t.color         as truck_color,
    s.job_type,
    wo.status,
    wo.work_address,
    -- Address fields ONLY. customer_snapshot also carries personnummer and pricing details, which
    -- an installer has no business receiving — so the snapshot is narrowed here rather than in the
    -- client. Shape matches what resolveJobAddress (lib/domains/planning/display.ts) expects, so
    -- address precedence stays defined in exactly one place (TypeScript), not duplicated in SQL.
    --
    -- En platshållare har ingen kund och därmed ingen adress: allt nedan blir null, och kortet
    -- visar ingen adressrad. Det är korrekt — adressen finns inte förrän ordern gör det.
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    ) as customer_address,
    s.placeholder_title,
    s.work_description
  from public.ops_segments s
  -- left join, inte inner: en flaggad platshållare ÄR ett fältjobb (service av maskiner, interna
  -- dagar). Vilka som släpps igenom avgörs i where-satsen, inte av joinen.
  left join public.crm_work_orders wo on wo.id = s.work_order_id
  join public.ops_trucks t on t.id = s.truck_id
  -- one row per day of the segment, same as user_my_jobs_v
  cross join lateral generate_series(s.start_day, s.end_day, interval '1 day') as gs(d)
  where (start_date is null or gs.d::date >= start_date)
    and (end_date   is null or gs.d::date <= end_date)
    -- A paused segment stays on the board (dimmed, badged "Pausad") because the planner still wants
    -- the slot — but it is not a job to drive to. Gäller båda sorterna.
    and not s.on_hold
    -- Same for a cancelled order whose segment nobody removed. Null-säker: en platshållare har
    -- ingen status och får inte falla på jämförelsen mot null.
    and (s.work_order_id is null or wo.status is distinct from 'cancelled')
    -- En platshållare syns bara när planeraren publicerat den. Ett riktigt jobb behöver ingen flagga.
    and (s.work_order_id is not null or s.field_visible)
    -- THE security boundary: security definer bypasses RLS on ops_*/crm_work_orders, so
    -- membership is what scopes the result.
    --
    -- ⚠️ PER SEGMENT OCH DAG — aldrig is_user_on_work_order här. Den svarar "får du öppna ordern"
    -- och är sann för alla som kört NÅGON dag av den; i feeden blev det att förra veckans lag fick
    -- nästa veckas dagar på en annan bil. Feeden är en delmängd av åtkomsten (på segmentet den dagen
    -- => på ordern), så varje rad här går fortfarande att öppna.
    and public.is_user_on_segment_between(auth.uid(), s.id, gs.d::date, gs.d::date);
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'display_name',
    NULL
  );

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name
    WHERE public.profiles.full_name IS DISTINCT FROM EXCLUDED.full_name;

  INSERT INTO public.employee_profile_details (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.employee_sensitive_details (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_permission (
  p_key text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select
    -- an explicit revoke always wins
    not exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission_key = p_key and up.effect = 'revoke'
    )
    and (
      -- granted by the user's role bundle
      exists (
        select 1
        from public.profiles pr
        join public.role_permissions rp on rp.role = pr.role
        where pr.id = auth.uid() and rp.permission_key = p_key
      )
      -- or granted explicitly to the user
      or exists (
        select 1 from public.user_permissions up
        where up.user_id = auth.uid() and up.permission_key = p_key and up.effect = 'grant'
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_app_ticket_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_fault_report_recipient()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.fault_report_recipients r
    where r.user_id = auth.uid() and r.active
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_konsult_user()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('konsult', 'readonly', 'ekonomi')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_readonly_user()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  AS $function$
  SELECT public.is_konsult_user();
$function$;

CREATE OR REPLACE FUNCTION public.is_time_locked (
  p_user_id uuid,
  p_date    date
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.crm_time_approvals a
    where a.user_id = p_user_id
      -- BÅDA låser. `submitted` räcker: annars kan någon ändra i underlaget medan granskningen
      -- pågår, och granskaren attesterar något annat än det hen tittade på.
      and a.status in ('submitted', 'approved')
      and p_date >= a.period_start
      and p_date < (a.period_start + interval '1 month')
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_user_on_segment (
  p_uid     uuid,
  p_segment uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.ops_segments s
    where s.id = p_segment
      and public.is_user_on_segment_between(p_uid, s.id, s.start_day, s.end_day)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_user_on_segment_between (
  p_uid     uuid,
  p_segment uuid,
  p_from    date,
  p_to      date
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.ops_segments s
    cross join lateral (
      select
        date_trunc('week', greatest(p_from, s.start_day))::date                     as week_start,
        (date_trunc('week', least(p_to, s.end_day)) + interval '6 days')::date      as week_end
    ) w
    where s.id = p_segment
      and p_uid is not null
      and p_from <= s.end_day
      and p_to   >= s.start_day
      and (
        -- 1) uttryckligen tillagd som besättning på just den här placeringen
        exists (
          select 1
          from public.ops_segment_crew c
          where c.segment_id = s.id
            and c.member_id = p_uid
        )
        -- 2) på bilens veckobesättning för veckan/veckorna intervallet ligger i
        or exists (
          select 1
          from public.ops_truck_crew tc
          where tc.truck_id = s.truck_id
            and tc.member_id = p_uid
            and tc.start_day <= w.week_end
            and tc.end_day   >= w.week_start
        )
        -- 3) på bilens standardbemanning — BARA när ingen veckobesättning överstyr de veckorna
        or (
          not exists (
            select 1
            from public.ops_truck_crew tc2
            where tc2.truck_id = s.truck_id
              and tc2.start_day <= w.week_end
              and tc2.end_day   >= w.week_start
          )
          and exists (
            select 1
            from public.ops_truck_default_crew dc
            where dc.truck_id = s.truck_id
              and dc.member_id = p_uid
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_user_on_work_order (
  p_uid uuid,
  p_wo  uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.ops_segments s
    where s.work_order_id = p_wo
      and public.is_user_on_segment(p_uid, s.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.json_diff (
  old_row jsonb,
  new_row jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select coalesce(jsonb_object_agg(k,
    jsonb_build_object('old', old_row->k, 'new', new_row->k)
  ), '{}'::jsonb)
  from (
    select key as k
    from (
      select jsonb_object_keys(old_row) key
      union
      select jsonb_object_keys(new_row) key
    ) u
  ) keys
  where (old_row->>k) is distinct from (new_row->>k)
$function$;

CREATE OR REPLACE FUNCTION public.log_planning_activity (
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_project_id  text,
  p_segment_id  uuid,
  p_details     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  AS $function$
declare
  a_id uuid;
  a_name text;
begin
  -- Mark context so RLS insert policy allows this write
  perform set_config('app.log_allowed', '1', true);
  select actor_id, actor_name into a_id, a_name from public.current_actor();
  insert into public.planning_activity_events (action, entity_type, entity_id, project_id, segment_id, details, actor_id, actor_name)
  values (p_action, p_entity_type, p_entity_id, p_project_id, p_segment_id, p_details, a_id, a_name);
end; $function$;

CREATE OR REPLACE FUNCTION public.log_time_entry_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_owner  uuid;
  v_entry  uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  -- ⚠️ EN GREN PER OPERATION, aldrig `coalesce(new.x, old.x)`.
  --
  -- I plpgsql är NEW OALLOKERAD i en delete-trigger och OLD i en insert-trigger, och att läsa ett
  -- fält ur en oallokerad record är ett fel — inte null. coalesce hjälper inte, den evaluerar båda
  -- argumenten. En sådan funktion hade fått VARJE insert och VARJE delete på crm_time_entries att
  -- misslyckas, alltså all tidrapportering och inte bara adminrättelserna.
  --
  -- enforce_time_period_lock i 20260812_time_approvals.sql undviker samma sak med flit; dess
  -- kommentar om "två grenar i stället för ett CASE" är samma fälla.
  if tg_op = 'DELETE' then
    v_owner := old.user_id; v_entry := old.id; v_before := to_jsonb(old); v_after := null;
  elsif tg_op = 'INSERT' then
    v_owner := new.user_id; v_entry := new.id; v_before := null;             v_after := to_jsonb(new);
  else
    -- ⚠️ ÄGAREN TAS UR OLD PÅ EN UPPDATERING. Tog vi den ur NEW skulle en ägarflytt bokföras under
    -- den som TOG timmarna, och om den som flyttade dem tog dem till sig själv blev actor = owner
    -- och hoppet nedan skrev ingen rad alls — spårlöst, alltså precis tvärtemot vad loggen finns
    -- för. Ägarlåset ovan gör flytten omöjlig, men loggen ska inte förlita sig på en annan trigger.
    v_owner := old.user_id; v_entry := old.id; v_before := to_jsonb(old);    v_after := to_jsonb(new);
  end if;

  -- Egna ändringar loggas inte. Den normala vägen i /tid ska inte fylla loggen med brus; det är
  -- ändringar av NÅGON ANNANS tid som behöver kunna spåras.
  --
  -- v_actor är null när ändringen kommer från en servicenyckel eller ett SQL-editor-anrop. Då
  -- loggas den — en ändring utan känd användare är precis det man vill hitta i efterhand.
  if v_actor is not null and v_actor = v_owner then
    return null;
  end if;

  insert into public.crm_time_entry_audit (entry_id, user_id, changed_by, action, before_data, after_data)
  values (
    v_entry,
    v_owner,
    -- NULL när aktören är okänd (servicenyckel, SQL-editor). Loggen ska bära det som ett faktum,
    -- inte som ett påhittat uuid som ingen profil matchar.
    v_actor,
    lower(tg_op),
    v_before,
    v_after
  );

  -- AFTER-triggerns returvärde ignoreras, så null är rätt svar — och slipper röra record-variabler
  -- en gång till.
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_expected_deliveries_forward_only()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if old.status is distinct from new.status then
    if old.status <> 'expected' then
      raise exception 'expected_delivery_status_is_final' using errcode = '23514';
    end if;
    if new.status not in ('arrived', 'cancelled') then
      raise exception 'expected_delivery_status_invalid' using errcode = '23514';
    end if;
  end if;

  if old.delivery_id is not null and new.delivery_id is distinct from old.delivery_id then
    raise exception 'expected_delivery_link_is_final' using errcode = '23514';
  end if;

  -- NYTT: kopplingen till beställningen ändras aldrig. En rad blir inte "beställd" i efterhand, och en
  -- beställd rad kan inte kopplas loss från ordern den kom ur.
  if new.order_id is distinct from old.order_id then
    raise exception 'expected_delivery_order_is_final' using errcode = '23514';
  end if;

  -- NYTT: på en beställd rad är depå och material låsta — de är det fabriken fick i mailet. Datum, antal
  -- och notering går att ändra: det är fabrikens svar ("vi kommer onsdag i stället").
  if old.order_id is not null
     and (new.depot_id is distinct from old.depot_id or new.material is distinct from old.material) then
    raise exception 'expected_delivery_ordered_line_is_locked' using errcode = '23514';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ops_material_orders_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  v_rpc boolean := coalesce(current_setting('ekovilla.material_order_rpc', true), '') = 'on';
  v_content_changed boolean;
begin
  if new.id is distinct from old.id or new.order_no is distinct from old.order_no or new.created_at is distinct from old.created_at then
    raise exception 'material_order_identity_is_final' using errcode = '23514';
  end if;

  -- FK-kaskaderna (ON DELETE SET NULL) går genom den här triggern, också för en skickad order. De fyra
  -- referenserna får därför bli NULL — men BARA när raden de pekar på är borta. En direkt skrivning som
  -- nollade supplier_id hade annars lyft ordern ur "en öppen order per fabrik" och öppnat för en andra
  -- beställning till samma fabrik medan den första fortfarande kan skickas om. sent_by och verified_by
  -- sätts dessutom (från null) av RPC:erna.
  if new.supplier_id is distinct from old.supplier_id
     and (new.supplier_id is not null
          or exists (select 1 from public.ops_material_suppliers where id = old.supplier_id)) then
    raise exception 'material_order_supplier_is_final' using errcode = '23514';
  end if;
  if new.created_by is distinct from old.created_by
     and (new.created_by is not null or exists (select 1 from public.profiles where id = old.created_by)) then
    raise exception 'material_order_creator_is_final' using errcode = '23514';
  end if;
  if (new.sent_by is distinct from old.sent_by and new.sent_by is null
      and exists (select 1 from public.profiles where id = old.sent_by))
     or (new.verified_by is distinct from old.verified_by and new.verified_by is null
         and exists (select 1 from public.profiles where id = old.verified_by)) then
    raise exception 'material_order_send_state_via_rpc_only' using errcode = '42501';
  end if;
  if (new.sent_by is distinct from old.sent_by and new.sent_by is not null and not v_rpc)
     or (new.verified_by is distinct from old.verified_by and new.verified_by is not null and not v_rpc) then
    raise exception 'material_order_send_state_via_rpc_only' using errcode = '42501';
  end if;

  -- En skickad order är slutgiltig. Allt utom de FK-nullbara referenserna och updated_at jämförs.
  if old.status = 'sent' then
    if (new.status, new.lines, new.other_lines, new.message, new.revision, new.supplier_name,
        new.recipient_email, new.from_address, new.reply_to, new.bcc, new.email_language,
        new.email_subject, new.email_text, new.composed_by_name, new.send_attempt,
        new.attempt_started_at, new.last_try_at, new.send_error, new.send_error_code,
        new.provider_message_id, new.sent_at, new.sent_by_name, new.verified_by_name, new.created_by_name)
       is distinct from
       (old.status, old.lines, old.other_lines, old.message, old.revision, old.supplier_name,
        old.recipient_email, old.from_address, old.reply_to, old.bcc, old.email_language,
        old.email_subject, old.email_text, old.composed_by_name, old.send_attempt,
        old.attempt_started_at, old.last_try_at, old.send_error, old.send_error_code,
        old.provider_message_id, old.sent_at, old.sent_by_name, old.verified_by_name, old.created_by_name)
    then
      raise exception 'material_order_sent_is_final' using errcode = '23514';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- ⚠️ UTSKICKSTILLSTÅNDET ÄNDRAS BARA I RPC:ERNA. Inte bara status: kunde en direkt skrivning flytta
  -- attempt_started_at hade 23-timmarsfönstret gått att förlänga, och ett omförsök efter att Resends
  -- nyckel gått ut hade blivit ett ANDRA mail. Samma för försöksnumret (ny nyckel) och beviset på utskick.
  if not v_rpc and (new.status, new.send_attempt, new.attempt_started_at, new.last_try_at,
                    new.provider_message_id, new.sent_at, new.sent_by_name, new.verified_by_name)
                   is distinct from
                   (old.status, old.send_attempt, old.attempt_started_at, old.last_try_at,
                    old.provider_message_id, old.sent_at, old.sent_by_name, old.verified_by_name) then
    raise exception 'material_order_send_state_via_rpc_only' using errcode = '42501';
  end if;

  -- De tillåtna vägarna, också för RPC:erna.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'sending')
      or (old.status = 'sending' and new.status = 'draft')
      or (old.status = 'sending' and new.status = 'sent')
    ) then
      raise exception 'material_order_status_transition_invalid' using errcode = '23514';
    end if;
    if new.status = 'sending' and (new.email_subject is null or new.email_text is null or new.recipient_email is null) then
      raise exception 'material_order_not_reviewed' using errcode = '23514';
    end if;
    -- Tillbaka till utkast = ett NYTT försök med en ny idempotensnyckel. Samma nummer hade låtit Resend
    -- svara med det gamla, avvisade utfallet.
    if old.status = 'sending' and new.status = 'draft' and new.send_attempt <> old.send_attempt + 1 then
      raise exception 'material_order_release_needs_new_attempt' using errcode = '23514';
    end if;
    if new.status = 'sent' and new.provider_message_id is null and new.verified_by is null then
      raise exception 'material_order_sent_needs_proof' using errcode = '23514';
    end if;
  elsif new.send_attempt is distinct from old.send_attempt then
    raise exception 'material_order_attempt_changes_with_status_only' using errcode = '23514';
  end if;

  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'material_order_provider_id_is_final' using errcode = '23514';
  end if;

  v_content_changed := (new.lines, new.other_lines, new.message, new.supplier_name, new.recipient_email,
                        new.from_address, new.reply_to, new.bcc, new.email_language, new.email_subject,
                        new.email_text, new.composed_by_name)
                       is distinct from
                       (old.lines, old.other_lines, old.message, old.supplier_name, old.recipient_email,
                        old.from_address, old.reply_to, old.bcc, old.email_language, old.email_subject,
                        old.email_text, old.composed_by_name);

  -- Innehållet är fryst så fort ett utskick påbörjats: det som skickas vid ett nytt försök måste vara
  -- samma bytes, annars svarar Resend 409 på nyckeln — och mailet kan redan ha gått.
  if v_content_changed and (old.status <> 'draft' or new.status <> 'draft') then
    raise exception 'material_order_content_is_frozen' using errcode = '23514';
  end if;

  -- Optimistiskt lås: en innehållsändring räknar upp revision med exakt ett. Två admins i samma utkast
  -- kan då inte tyst skriva över varandra.
  if v_content_changed and new.revision <> old.revision + 1 then
    raise exception 'material_order_revision_must_increment' using errcode = '40001';
  end if;
  if not v_content_changed and new.revision is distinct from old.revision then
    raise exception 'material_order_revision_without_change' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ops_material_orders_insert_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.status <> 'draft' or new.send_attempt <> 1 or new.revision <> 1
     or new.provider_message_id is not null or new.sent_at is not null or new.verified_by is not null
     or new.sent_by is not null or new.sent_by_name is not null or new.verified_by_name is not null
     or new.attempt_started_at is not null or new.last_try_at is not null then
    raise exception 'material_order_insert_must_be_fresh_draft' using errcode = '23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.planning_supply_terms()
  RETURNS TABLE (
    supplier_id    uuid,
    materials      text[],
    lead_time_days integer,
    round_up_to    integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- SECURITY DEFINER går förbi RLS på ops_material_suppliers, så grinden prövas här. Board-nivå,
  -- till skillnad från tabellen: prognosen visas för alla som får se schemat.
  --
  -- ⚠️ ALDRIG MED SERVICE-ROLE-KLIENTEN. has_permission nycklar allt på auth.uid(), som är null
  -- under service-role — grinden nedan skulle då alltid neka. Sessionsklienten, alltid. (Samma
  -- fälla som en gång gjorde att admin inte kunde skapa användare, tyst i tre månader.)
  if not public.has_permission('planning.schedule.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Bara AKTIVA. En avvecklad leverantörs ledtid får inte styra en ny beställning — samma regel som
  -- suppliersForMaterial i domänlagret, och att den gäller redan här är avsiktlig dubbel botten.
  return query
    select s.id, s.materials, s.lead_time_days, s.round_up_to
    from public.ops_material_suppliers s
    where s.active;
end $function$;

CREATE OR REPLACE FUNCTION public.receive_expected_delivery (
  p_expected_id  uuid,
  p_delivered_on date,
  p_sacks        integer,
  p_note         text    DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row         public.ops_expected_deliveries%rowtype;
  v_delivery_id uuid;
  v_name        text;
begin
  -- SECURITY DEFINER går förbi RLS på båda tabellerna, så nyckeln prövas här. Samma nyckel som
  -- ops_depot_deliveries_insert kräver: mottagning är lagerarbete.
  if not public.has_permission('planning.schedule.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_sacks is null or p_sacks <= 0 then
    raise exception 'invalid_sacks' using errcode = '22023';
  end if;
  -- Samma tak som createDeliverySchema: en leverans daterad framåt höjer saldot redan idag och
  -- tystar bristvarningen.
  if p_delivered_on is null or p_delivered_on > ((now() at time zone 'Europe/Stockholm')::date) then
    raise exception 'delivered_on_in_future' using errcode = '22023';
  end if;

  select * into v_row from public.ops_expected_deliveries where id = p_expected_id for update;
  if not found then
    raise exception 'expected_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'expected' then
    raise exception 'expected_not_open' using errcode = '23514';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.ops_depot_deliveries (depot_id, material, sacks, delivered_on, note, created_by)
  values (v_row.depot_id, v_row.material, p_sacks, p_delivered_on, coalesce(p_note, v_row.note), auth.uid())
  returning id into v_delivery_id;

  update public.ops_expected_deliveries
     set status = 'arrived',
         delivery_id = v_delivery_id,
         arrived_at = now(),
         arrived_by = auth.uid(),
         arrived_by_name = v_name
   where id = p_expected_id;

  return v_delivery_id;
end $function$;

CREATE OR REPLACE FUNCTION public.release_material_order_send (
  p_order_id   uuid,
  p_attempt    integer,
  p_error_code text,
  p_error      text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row public.ops_material_orders%rowtype;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status <> 'sending' or v_row.send_attempt is distinct from p_attempt then
    return 'stale';
  end if;
  -- ⚠️ ETT AVSLAG PÅ ETT OMFÖRSÖK BEVISAR INGENTING OM DET FÖRSTA ANROPET. Ett tidigare anrop med samma
  -- nyckel kan ha levererats (t.ex. en timeout där Resend ändå skickade), och ett rate limit-svar på
  -- omförsöket säger bara att DET anropet inte gick. Släpptes ordern här hade nästa utskick fått en ny
  -- nyckel — och fabriken ett andra mail. Ett omförsökt försök avgörs i stället av en människa efter
  -- fönstret. attempt_started_at och last_try_at sätts från samma now() i claim och skiljer sig bara efter
  -- ett reclaim.
  if v_row.last_try_at is distinct from v_row.attempt_started_at then
    return 'retried';
  end if;

  perform set_config('ekovilla.material_order_rpc', 'on', true);
  update public.ops_material_orders
     set status = 'draft', send_attempt = send_attempt + 1,
         attempt_started_at = null, last_try_at = null,
         send_error = left(p_error, 1000), send_error_code = left(p_error_code, 100)
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'released';
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_material_order_send (
  p_order_id  uuid,
  p_delivered boolean
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_row  public.ops_material_orders%rowtype;
  v_name text;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_delivered is null then
    raise exception 'material_order_resolution_required' using errcode = '22023';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status = 'sent' then
    return 'already_sent';
  end if;
  if v_row.status <> 'sending' then
    return 'not_sending';
  end if;
  if v_row.last_try_at is not null and v_row.last_try_at > now() - interval '2 minutes' then
    return 'in_progress';
  end if;
  -- ⚠️ INOM FÖNSTRET AVGÖR INGEN MÄNNISKA. Ett omförsök med samma nyckel är då alltid det säkra valet: gick
  -- mailet fram svarar Resend med samma id, gick det inte fram skickas det nu. "Gick inte fram" efter tre
  -- minuter — när kopian i order@ helt enkelt inte kommit än — hade gett ett nytt försök och ett andra mail.
  if v_row.attempt_started_at is not null and v_row.attempt_started_at >= now() - interval '23 hours' then
    return 'window_open';
  end if;
  if not public._material_order_lines_valid(v_row.lines) and p_delivered then
    -- Kan inte bli väntade leveranser. Skickad utan dem hade tystat nästa beställning; utkast hade gett ett
    -- nytt mail. En människa får rätta raderna i databasen — det här ska inte kunna hända efter claim.
    return 'lines_invalid';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  perform set_config('ekovilla.material_order_rpc', 'on', true);

  if p_delivered then
    perform public._material_order_create_expected(p_order_id, v_row.lines);
    update public.ops_material_orders
       set status = 'sent', verified_by = auth.uid(), verified_by_name = v_name,
           sent_at = now(), sent_by = auth.uid(), sent_by_name = v_name
     where id = p_order_id;
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'marked_sent';
  end if;

  update public.ops_material_orders
     set status = 'draft', send_attempt = send_attempt + 1,
         attempt_started_at = null, last_try_at = null
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'released';
end $function$;

CREATE OR REPLACE FUNCTION public.safety_round_actions_before_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  if new.round_id is distinct from old.round_id then
    raise exception 'safety_round_actions: round_id kan inte ändras' using errcode = '42501';
  end if;
  if not public.safety_round_is_draft(old.round_id) and (
       (new.item_id is distinct from old.item_id and new.item_id is not null)
    or new.finding          is distinct from old.finding
    or new.risk             is distinct from old.risk
    or new.action           is distinct from old.action
    or (new.responsible_id is distinct from old.responsible_id and new.responsible_id is not null)
    or new.responsible_name is distinct from old.responsible_name
    or new.due_on           is distinct from old.due_on
    or new.position         is distinct from old.position
  ) then
    raise exception 'safety_round_actions: ronden är slutförd, bara uppföljningen kan ändras'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.safety_round_is_draft (
  p_round_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (select 1 from public.safety_rounds r where r.id = p_round_id and r.status = 'draft');
$function$;

CREATE OR REPLACE FUNCTION public.safety_round_order_header (
  p_work_order_id uuid
)
  RETURNS TABLE (
    id                   uuid,
    order_number         text,
    fortnox_order_number text,
    project_name         text,
    client_name          text,
    status               text,
    work_address         jsonb,
    customer_address     jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    wo.id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    wo.client_name,
    wo.status,
    jsonb_build_object(
      'street_address', wo.work_address ->> 'street_address',
      'postal_code',    wo.work_address ->> 'postal_code',
      'city',           wo.work_address ->> 'city'
    ),
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    )
  from public.crm_work_orders wo
  where wo.id = p_work_order_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.safety_round_order_lookup (
  p_query text
)
  RETURNS TABLE (
    id                   uuid,
    order_number         text,
    fortnox_order_number text,
    project_name         text,
    client_name          text,
    status               text,
    work_address         jsonb,
    customer_address     jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;
  -- Söktexten är TEXT, inte ett mönster: % och _ i den ska matcha sig själva ("6_79" ska inte hitta
  -- 6579). Backslash är LIKE:s standardescape.
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    wo.id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    wo.client_name,
    wo.status,
    jsonb_build_object(
      'street_address', wo.work_address ->> 'street_address',
      'postal_code',    wo.work_address ->> 'postal_code',
      'city',           wo.work_address ->> 'city'
    ),
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    )
  from public.crm_work_orders wo
  where wo.status <> 'cancelled'
    and (
      wo.order_number ilike v_pattern
      or wo.fortnox_order_number ilike v_pattern
      or wo.project_name ilike v_pattern
      or wo.client_name ilike v_pattern
    )
  order by wo.created_at desc
  limit 20;
end;
$function$;

CREATE OR REPLACE FUNCTION public.safety_rounds_before_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  if new.status = 'completed' and old.status = 'draft' then
    new.completed_at := now();
    new.completed_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_crm_customers_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_crm_opportunities_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_crm_time_entry_hours()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.minutes_worked is not null then
    new.hours = round(new.minutes_worked::numeric / 60, 2);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_employee_sensitive_details_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_role_permission (
  p_role    public.user_role,
  p_key     text,
  p_present boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  -- Lockout guard: the admin role must always keep crm.admin.
  if p_role = 'admin' and p_key = 'crm.admin' and p_present = false then
    raise exception 'cannot remove crm.admin from the admin role';
  end if;
  if p_present then
    insert into public.role_permissions(role, permission_key) values (p_role, p_key)
    on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role and permission_key = p_key;
  end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.set_time_period_status (
  p_user_id      uuid,
  p_period_start date,
  p_status       text,
  p_note         text DEFAULT NULL::text
)
  RETURNS public.crm_time_approvals
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor       uuid := auth.uid();
  v_is_self     boolean;
  v_can_approve boolean;
  v_current     text;
  v_row         public.crm_time_approvals;
begin
  if v_actor is null then
    raise exception 'Inte inloggad';
  end if;
  if p_status not in ('open', 'submitted', 'approved') then
    raise exception 'Okänd status: %', p_status;
  end if;
  if p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'Perioden måste börja på den första i en månad';
  end if;

  v_is_self     := (p_user_id = v_actor);
  v_can_approve := public.has_permission('time.approve');

  -- ⚠️ ADVISORY LOCK, inte bara FOR UPDATE.
  --
  -- `for update` låser en RAD, och första gången en period rör sig FINNS ingen rad — raden skapas
  -- ju av den här körningen. Två samtidiga förstagångsanrop läste därför båda `open`, båda kom
  -- förbi matrisen, och den som committade sist skrev över den andra via `on conflict do update`.
  -- Konkret: admin attesterar i samma sekund som den anställde lämnar in → attesten faller
  -- tillbaka till `submitted`, en övergång matrisen uttryckligen förbjuder. Perioden är fortfarande
  -- låst, men den anställde kan nu ångra själv — attesten är tyst upphävd.
  --
  -- Låset är transaktionsbundet (`_xact_`) och släpps automatiskt vid commit eller rollback, och
  -- det är taget på PERSON + PERIOD, så två olika personers attest aldrig köar bakom varandra.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_period_start::text));

  -- FOR UPDATE behålls: när raden väl finns är den billigare och mer exakt än advisory-låset, och
  -- de två tillsammans täcker både "raden finns" och "raden är på väg att skapas".
  select * into v_row
  from public.crm_time_approvals
  where user_id = p_user_id and period_start = p_period_start
  for update;

  v_current := coalesce(v_row.status, 'open');

  if v_current = p_status then
    -- Ingen rad alls + status 'open' = redan sant, inget att skriva.
    return v_row;
  end if;

  if p_status = 'submitted' then
    if not v_is_self then
      raise exception 'Bara den anställde kan lämna in sin egen period';
    end if;
    if not public.has_permission('time.entry.write') then
      raise exception 'Du har inte behörighet att rapportera tid';
    end if;
    if v_current <> 'open' then
      raise exception 'Perioden är redan attesterad';
    end if;

  elsif p_status = 'approved' then
    if not v_can_approve then
      raise exception 'Du har inte behörighet att attestera tid';
    end if;

  else -- 'open'
    if v_current = 'approved' and not v_can_approve then
      raise exception 'Perioden är attesterad och kan bara öppnas av en attestansvarig';
    end if;
    if v_current = 'submitted' and not (v_is_self or v_can_approve) then
      raise exception 'Du kan bara ångra din egen inlämning';
    end if;
  end if;

  insert into public.crm_time_approvals as a (
    user_id, period_start, status, submitted_at, approved_at, approved_by, reopened_at, note
  )
  values (
    p_user_id,
    p_period_start,
    p_status,
    case when p_status = 'submitted' then now() end,
    case when p_status = 'approved'  then now() end,
    case when p_status = 'approved'  then v_actor end,
    case when p_status = 'open'      then now() end,
    p_note
  )
  on conflict (user_id, period_start) do update set
    status = excluded.status,
    -- Tidsstämplarna sätts om från grunden vid varje övergång i stället för att ackumuleras. En
    -- kvarlämnad approved_at på en öppnad period hade läst som att den fortfarande vore attesterad.
    submitted_at = case when excluded.status = 'submitted' then now()
                        when excluded.status = 'open'      then null
                        else a.submitted_at end,
    approved_at  = case when excluded.status = 'approved'  then now()  else null end,
    approved_by  = case when excluded.status = 'approved'  then v_actor else null end,
    reopened_at  = case when excluded.status = 'open'      then now()  else a.reopened_at end,
    note         = p_note,
    updated_at   = now()
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  NEW.updated_at = now();
  return NEW;
end;$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_ai_prospect_suggestions()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_goals()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_prospects()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_quotes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_work_order_stages()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_work_order_time_entries()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_crm_work_orders()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
	new.updated_at = now();
	return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_offert_calculations()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_ops_segments()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin new.updated_at = now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_planning_meta()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$ begin NEW.updated_at = now(); return NEW; end; $function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_planning_segment_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$ begin NEW.updated_at = now(); return NEW; end; $function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_planning_segments()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$ begin NEW.updated_at = now(); return NEW; end; $function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_tasks()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  NEW.updated_at = now();
  return NEW;
end;$function$;

CREATE OR REPLACE FUNCTION public.set_timestamp_time_reference()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_permission (
  p_user   uuid,
  p_key    text,
  p_effect text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  -- Lockout guard: never revoke crm.admin from a user who is an admin.
  if p_key = 'crm.admin' and p_effect = 'revoke'
     and exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'cannot revoke crm.admin from an admin';
  end if;
  if p_effect is null then
    delete from public.user_permissions where user_id = p_user and permission_key = p_key;
  elsif p_effect in ('grant', 'revoke') then
    insert into public.user_permissions(user_id, permission_key, effect, created_by)
    values (p_user, p_key, p_effect, auth.uid())
    on conflict (user_id, permission_key) do update
      set effect = excluded.effect, created_by = excluded.created_by;
  else
    raise exception 'invalid effect %', p_effect;
  end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.set_user_role (
  target   uuid,
  new_role public.user_role
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.profiles SET role = new_role WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target user not found';
  END IF;
END;$function$;

CREATE OR REPLACE FUNCTION public.set_user_tags (
  target   uuid,
  new_tags text[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- This function is intended to be called only with the service role via server-side API.
  -- Keep logic simple and rely on GRANTs to restrict usage.
  update public.profiles
     set tags = coalesce(new_tags, '{}'::text[])
   where id = target;
  if not found then
    raise exception 'target user not found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_safety_round (
  p_work_order_id uuid,
  p_held_on       date,
  p_site_address  text,
  p_employer      text,
  p_work_type     text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_wo record;
  v_round_id uuid;
  v_number integer;
begin
  if v_uid is null or not public.has_permission('safety.round.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select wo.order_number, wo.fortnox_order_number, wo.project_name, wo.client_name, wo.status
    into v_wo
  from public.crm_work_orders wo
  where wo.id = p_work_order_id;

  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  -- En avbruten order är inget jobb (sökningen döljer dem, fältfeeden och planeringen likaså).
  -- 55000 = object_not_in_prerequisite_state; rutten svarar 409.
  if v_wo.status = 'cancelled' then
    raise exception 'work order cancelled' using errcode = '55000';
  end if;

  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = v_uid;

  select coalesce(max(r.round_number), 0) + 1 into v_number
  from public.safety_rounds r
  where r.work_order_id = p_work_order_id;

  insert into public.safety_rounds (
    work_order_id, round_number, status,
    order_number, fortnox_order_number, project_name, client_name,
    site_address, held_on, client_label, employer, work_type,
    leader_id, leader_name,
    created_by, created_by_name
  ) values (
    p_work_order_id, v_number, 'draft',
    v_wo.order_number, v_wo.fortnox_order_number,
    coalesce(nullif(btrim(v_wo.project_name), ''), 'Arbetsorder ' || coalesce(v_wo.order_number, '')),
    v_wo.client_name,
    nullif(btrim(p_site_address), ''), p_held_on, v_wo.client_name,
    nullif(btrim(p_employer), ''), nullif(btrim(p_work_type), ''),
    v_uid, v_name,
    v_uid, coalesce(v_name, 'Okänd')
  )
  returning id into v_round_id;

  insert into public.safety_round_items (
    round_id, catalog_item_id, category_code, category_label, number, text, position
  )
  select
    v_round_id, i.id, c.code, c.label, i.number, i.text,
    row_number() over (order by c.position, i.position, i.number)::integer
  from public.safety_checklist_items i
  join public.safety_checklist_categories c on c.id = i.category_id
  where i.active and c.active;

  -- Rondledaren står först i deltagarlistan, som i mallen ("Chef/arbetsledare").
  insert into public.safety_round_participants (round_id, profile_id, name, role, position)
  values (v_round_id, v_uid, coalesce(v_name, 'Okänd'), 'leader', 0);

  return v_round_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_truck_team_names()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if tg_op in ('INSERT','UPDATE') then
    -- Only replace names if a non-null, non-empty profile name exists
    if new.team1_id is distinct from coalesce(old.team1_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select nullif(trim(p.full_name), '') into new.team_member1_name from public.profiles p where p.id = new.team1_id;
      if new.team_member1_name is null then
        -- keep existing snapshot if profile has no name
        new.team_member1_name := coalesce(old.team_member1_name, new.team_member1_name);
      end if;
    end if;
    if new.team2_id is distinct from coalesce(old.team2_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select nullif(trim(p.full_name), '') into new.team_member2_name from public.profiles p where p.id = new.team2_id;
      if new.team_member2_name is null then
        new.team_member2_name := coalesce(old.team_member2_name, new.team_member2_name);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.time_approval_overview (
  p_period_start date
)
  RETURNS TABLE (
    user_id             uuid,
    full_name           text,
    role                text,
    status              text,
    submitted_at        timestamp with time zone,
    approved_at         timestamp with time zone,
    approved_by         uuid,
    approved_by_name    text,
    note                text,
    work_minutes        bigint,
    absence_minutes     bigint,
    entry_count         bigint,
    compensation_amount numeric,
    compensation_count  bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_next date;
begin
  -- Behörighetsgränsen. En definer-funktion utan den här raden är en öppen dörr till allas timmar.
  if not public.has_permission('time.approve') then
    raise exception 'Du har inte behörighet att attestera tid';
  end if;
  if p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'Perioden måste börja på den första i en månad';
  end if;

  v_next := (p_period_start + interval '1 month')::date;

  return query
  select
    p.id,
    p.full_name,
    p.role::text,
    coalesce(a.status, 'open'),
    a.submitted_at,
    a.approved_at,
    a.approved_by,
    ap.full_name,
    a.note,
    coalesce(e.work_minutes, 0),
    coalesce(e.absence_minutes, 0),
    coalesce(e.entry_count, 0),
    coalesce(c.total_amount, 0)::numeric,
    coalesce(c.row_count, 0)
  from public.profiles p
  left join public.crm_time_approvals a
    on a.user_id = p.id and a.period_start = p_period_start
  left join public.profiles ap on ap.id = a.approved_by
  left join lateral (
    select
      -- minutes_worked är sanningen; hours-fallbacken fångar de gamla kontorsraderna
      -- (source='legacy_office') som skrevs innan minuterna fanns.
      sum(case when t.kind <> 'absence' then coalesce(t.minutes_worked, round(t.hours * 60)::int) else 0 end)::bigint as work_minutes,
      sum(case when t.kind =  'absence' then coalesce(t.minutes_worked, round(t.hours * 60)::int) else 0 end)::bigint as absence_minutes,
      count(*)::bigint as entry_count
    from public.crm_time_entries t
    where t.user_id = p.id
      and t.work_date >= p_period_start
      and t.work_date < v_next
  ) e on true
  left join lateral (
    select sum(k.amount) as total_amount, count(*)::bigint as row_count
    from public.crm_time_compensations k
    where k.user_id = p.id
      and k.entry_date >= p_period_start
      and k.entry_date < v_next
  ) c on true
  -- konsult: extern roll utan time-nycklar, rapporterar aldrig tid.
  -- ekonomi: lönebyrån själv — hon läser listan, hon står inte i den.
  where p.role not in ('konsult','ekonomi')
  order by p.full_name nulls last, p.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_planning_assignments_log()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  entity_id text;
  det jsonb;
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    entity_id := new.id::text;
    det := jsonb_build_object('new', to_jsonb(new));
    perform public.log_planning_activity('assignment_created', 'truck_assignment', entity_id, null, null, det);
    return new;
  elsif tg_op = 'UPDATE' then
    entity_id := coalesce(new.id::text, old.id::text);
    -- Compute diff and skip if empty
    changed := public.json_diff(to_jsonb(old), to_jsonb(new));
    if changed = '{}'::jsonb then
      return new;
    end if;
    det := jsonb_build_object('changed', changed);
    perform public.log_planning_activity('assignment_updated', 'truck_assignment', entity_id, null, null, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := old.id::text;
    det := jsonb_build_object('old', to_jsonb(old));
    perform public.log_planning_activity('assignment_deleted', 'truck_assignment', entity_id, null, null, det);
    return old;
  end if;
  return null;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_planning_meta_log()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  entity_id text;
  proj_id text;
  changed jsonb;
  det jsonb;
begin
  if tg_op = 'UPDATE' then
    entity_id := coalesce(new.project_id::text, old.project_id::text);
    proj_id := entity_id;
    changed := public.json_diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
    -- Skip logging if no actual diff
    if changed = '{}'::jsonb then
      return new;
    end if;
    det := jsonb_build_object('changed', changed);
    perform public.log_planning_activity('meta_updated', 'project_meta', entity_id, proj_id, null, det);
    return new;
  elsif tg_op = 'INSERT' then
    entity_id := new.project_id::text;
    det := jsonb_build_object('new', to_jsonb(new) - 'updated_at');
    perform public.log_planning_activity('meta_created', 'project_meta', entity_id, new.project_id::text, null, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := old.project_id::text;
    det := jsonb_build_object('old', to_jsonb(old) - 'updated_at');
    perform public.log_planning_activity('meta_deleted', 'project_meta', entity_id, old.project_id::text, null, det);
    return old;
  end if;
  return null;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_planning_segments_log()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  changed jsonb;
  moved boolean := false;
  entity_id text;
  proj_id text;
  det jsonb;
begin
  if tg_op = 'INSERT' then
    entity_id := coalesce(new.id::text, '');
    proj_id := new.project_id::text;
    det := jsonb_build_object('new', to_jsonb(new) - 'updated_at', 'context', jsonb_build_object('truck', new.truck, 'start_day', new.start_day, 'end_day', new.end_day));
    perform public.log_planning_activity('segment_created', 'segment', entity_id, proj_id, new.id, det);
    return new;
  elsif tg_op = 'UPDATE' then
    entity_id := coalesce(new.id::text, old.id::text);
    proj_id := coalesce(new.project_id::text, old.project_id::text);
    changed := public.json_diff(to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
        moved := (old.start_day  is distinct from new.start_day)
          or (old.end_day    is distinct from new.end_day)
          or (old.truck      is distinct from new.truck)
          or (old.depot_id   is distinct from new.depot_id)
          or (old.job_type   is distinct from new.job_type)
          or (old.sort_index is distinct from new.sort_index);
    -- Skip logging if nothing actually changed and not moved
    if changed = '{}'::jsonb and not moved then
      return new;
    end if;
    det := jsonb_build_object('changed', changed, 'context', jsonb_build_object(
      'truck_before', old.truck, 'truck_after', new.truck,
      'start_before', old.start_day, 'start_after', new.start_day,
      'end_before', old.end_day, 'end_after', new.end_day,
      'depot_before', old.depot_id, 'depot_after', new.depot_id,
      'job_type_before', old.job_type, 'job_type_after', new.job_type,
      'sort_index_before', old.sort_index, 'sort_index_after', new.sort_index
    ));
    perform public.log_planning_activity(case when moved then 'segment_moved' else 'segment_updated' end, 'segment', entity_id, proj_id, new.id, det);
    return new;
  elsif tg_op = 'DELETE' then
    entity_id := coalesce(old.id::text, '');
    proj_id := old.project_id::text;
    det := jsonb_build_object('old', to_jsonb(old) - 'updated_at');
    perform public.log_planning_activity('segment_deleted', 'segment', entity_id, proj_id, old.id, det);
    return old;
  end if;
  return null;
end; $function$;

ALTER TABLE "public"."contacts"
  ADD CONSTRAINT "contacts_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.contact_categories(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_customers"
  ADD CONSTRAINT "crm_customers_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES auth.users(id);

ALTER TABLE "public"."crm_customers"
  ADD CONSTRAINT "crm_customers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."crm_ai_prospect_suggestions"
  ADD CONSTRAINT "crm_ai_prospect_suggestions_approved_customer_id_fkey" FOREIGN KEY (approved_customer_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_calls"
  ADD CONSTRAINT "crm_calls_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_calls"
  ADD CONSTRAINT "crm_calls_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_customer_contacts"
  ADD CONSTRAINT "crm_customer_contacts_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_calls"
  ADD CONSTRAINT "crm_calls_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES public.crm_quotes(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_routing_rules"
  ADD CONSTRAINT "crm_routing_rules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."crm_routing_rules"
  ADD CONSTRAINT "crm_routing_rules_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_absence_type_fkey" FOREIGN KEY (absence_type_id) REFERENCES public.crm_absence_types(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_break_check" CHECK (((break_minutes >= 0) AND (break_minutes < 1440))) NOT VALID;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_internal_project_fkey" FOREIGN KEY (internal_project_id) REFERENCES public.crm_internal_projects(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_minutes_check" CHECK (((minutes_worked IS NULL) OR ((minutes_worked > 0) AND (minutes_worked <= 1440)))) NOT VALID;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_target_check" CHECK ((((kind = 'work_order'::text) AND (work_order_id IS
    NOT NULL) AND (internal_project_id IS NULL) AND (absence_type_id IS NULL)) OR ((kind = 'internal'::text) AND (internal_project_id IS
    NOT NULL) AND (work_order_id IS NULL) AND (absence_type_id IS NULL)) OR ((kind = 'absence'::text) AND (absence_type_id IS
    NOT NULL) AND (work_order_id IS NULL) AND (internal_project_id IS NULL)))) NOT VALID;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_time_code_fkey" FOREIGN KEY (time_code_id) REFERENCES public.crm_time_codes(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_work_orders"
  ADD CONSTRAINT "crm_work_orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_time_entries_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_work_order_comments"
  ADD CONSTRAINT "crm_work_order_comments_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_order_files"
  ADD CONSTRAINT "crm_work_order_files_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_order_invoices"
  ADD CONSTRAINT "crm_work_order_invoices_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_order_kma_plans"
  ADD CONSTRAINT "crm_work_order_kma_plans_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_order_progress_reports"
  ADD CONSTRAINT "crm_work_order_progress_reports_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_order_stages"
  ADD CONSTRAINT "crm_work_order_stages_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_work_orders"
  ADD CONSTRAINT "crm_work_orders_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_orders"
  ADD CONSTRAINT "crm_work_orders_quote_id_fkey" FOREIGN KEY (quote_id) REFERENCES public.crm_quotes(id) ON DELETE RESTRICT;

ALTER TABLE "public"."dashboard_notes"
  ADD CONSTRAINT "dashboard_notes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dashboard_push_subscriptions"
  ADD CONSTRAINT "dashboard_push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dashboard_work_items"
  ADD CONSTRAINT "dashboard_work_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_publication_receipts"
  ADD CONSTRAINT "document_publication_receipts_publication_id_fkey" FOREIGN KEY (publication_id) REFERENCES public.document_publications(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_publication_recipients"
  ADD CONSTRAINT "document_publication_recipients_publication_id_fkey" FOREIGN KEY (publication_id) REFERENCES public.document_publications(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_publications"
  ADD CONSTRAINT "document_publications_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.documents_files(id) ON DELETE CASCADE;

ALTER TABLE "public"."documents_files"
  ADD CONSTRAINT "documents_files_folder_id_fkey" FOREIGN KEY (folder_id) REFERENCES public.documents_folders(id) ON DELETE CASCADE;

ALTER TABLE "public"."documents_folders"
  ADD CONSTRAINT "documents_folders_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.documents_folders(id) ON DELETE CASCADE;

ALTER TABLE "public"."employee_profile_details"
  ADD CONSTRAINT "employee_profile_details_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."employee_sensitive_details"
  ADD CONSTRAINT "employee_sensitive_details_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."fault_report_updates"
  ADD CONSTRAINT "fault_report_updates_report_id_fkey" FOREIGN KEY (report_id) REFERENCES public.fault_reports(id) ON DELETE CASCADE;

ALTER TABLE "public"."fortnox_integrations"
  ADD CONSTRAINT "fortnox_integrations_connected_by_fkey" FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."info_sections"
  ADD CONSTRAINT "info_sections_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public.info_groups(id) ON DELETE CASCADE;

ALTER TABLE "public"."info_section_images"
  ADD CONSTRAINT "info_section_images_section_id_fkey" FOREIGN KEY (section_id) REFERENCES public.info_sections(id) ON DELETE CASCADE;

ALTER TABLE "public"."offert_calculations"
  ADD CONSTRAINT "offert_calculations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."offert_customer_responses"
  ADD CONSTRAINT "offert_customer_responses_request_id_fkey" FOREIGN KEY (request_id) REFERENCES public.offert_customer_requests(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_depot_deliveries"
  ADD CONSTRAINT "ops_depot_deliveries_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.ops_depots(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_depot_stock_counts"
  ADD CONSTRAINT "ops_depot_stock_counts_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.ops_depots(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ops_expected_deliveries"
  ADD CONSTRAINT "ops_expected_deliveries_delivery_id_fkey" FOREIGN KEY (delivery_id) REFERENCES public.ops_depot_deliveries(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_expected_deliveries"
  ADD CONSTRAINT "ops_expected_deliveries_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.ops_depots(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ops_expected_deliveries"
  ADD CONSTRAINT "ops_expected_deliveries_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.ops_material_orders(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ops_material_orders"
  ADD CONSTRAINT "ops_material_orders_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES public.ops_material_suppliers(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segment_reports"
  ADD CONSTRAINT "ops_segment_reports_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_segment_crew"
  ADD CONSTRAINT "ops_segment_crew_segment_id_fkey" FOREIGN KEY (segment_id) REFERENCES public.ops_segments(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_segment_reports"
  ADD CONSTRAINT "ops_segment_reports_segment_id_fkey" FOREIGN KEY (segment_id) REFERENCES public.ops_segments(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_segments"
  ADD CONSTRAINT "ops_segments_stage_id_fkey" FOREIGN KEY (stage_id) REFERENCES public.crm_work_order_stages(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segments"
  ADD CONSTRAINT "ops_segments_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_trucks"
  ADD CONSTRAINT "ops_trucks_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.ops_depots(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segments"
  ADD CONSTRAINT "ops_segments_truck_id_fkey" FOREIGN KEY (truck_id) REFERENCES public.ops_trucks(id) ON DELETE RESTRICT;

ALTER TABLE "public"."ops_truck_crew"
  ADD CONSTRAINT "ops_truck_crew_truck_id_fkey" FOREIGN KEY (truck_id) REFERENCES public.ops_trucks(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_truck_default_crew"
  ADD CONSTRAINT "ops_truck_default_crew_truck_id_fkey" FOREIGN KEY (truck_id) REFERENCES public.ops_trucks(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_work_order_confirmations"
  ADD CONSTRAINT "ops_work_order_confirmations_segment_id_fkey" FOREIGN KEY (segment_id) REFERENCES public.ops_segments(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_work_order_confirmations"
  ADD CONSTRAINT "ops_work_order_confirmations_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."planning_depot_deliveries"
  ADD CONSTRAINT "planning_depot_deliveries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."planning_depot_deliveries"
  ADD CONSTRAINT "planning_depot_deliveries_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.planning_depots(id) ON DELETE CASCADE;

ALTER TABLE "public"."planning_depot_usage"
  ADD CONSTRAINT "planning_depot_usage_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.planning_depots(id) ON DELETE CASCADE;

ALTER TABLE "public"."planning_segment_reports"
  ADD CONSTRAINT "planning_segment_reports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_segments"
  ADD CONSTRAINT "planning_segments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_segments"
  ADD CONSTRAINT "planning_segments_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.planning_depots(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_segment_reports"
  ADD CONSTRAINT "planning_segment_reports_segment_fk" FOREIGN KEY (segment_id) REFERENCES public.planning_segments(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_segment_team_members"
  ADD CONSTRAINT "planning_segment_team_members_segment_id_fkey" FOREIGN KEY (segment_id) REFERENCES public.planning_segments(id) ON DELETE CASCADE;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_depot_id_fkey" FOREIGN KEY (depot_id) REFERENCES public.planning_depots(id) ON DELETE SET NULL;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."app_changelog_entries"
  ADD CONSTRAINT "app_changelog_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."app_tickets"
  ADD CONSTRAINT "app_tickets_handled_by_fkey" FOREIGN KEY (handled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."app_tickets"
  ADD CONSTRAINT "app_tickets_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_ai_prospect_suggestions"
  ADD CONSTRAINT "crm_ai_prospect_suggestions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_ai_prospect_suggestions"
  ADD CONSTRAINT "crm_ai_prospect_suggestions_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_calc_settings"
  ADD CONSTRAINT "crm_calc_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_calls"
  ADD CONSTRAINT "crm_calls_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_customers"
  ADD CONSTRAINT "crm_customers_account_manager_id_fkey" FOREIGN KEY (account_manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_goals"
  ADD CONSTRAINT "crm_goals_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_goals"
  ADD CONSTRAINT "crm_goals_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_goals"
  ADD CONSTRAINT "crm_goals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_material_cost_articles"
  ADD CONSTRAINT "crm_material_cost_articles_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_productivity_rates"
  ADD CONSTRAINT "crm_productivity_rates_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_converted_to_work_order_by_fkey" FOREIGN KEY (converted_to_work_order_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_quotes"
  ADD CONSTRAINT "crm_quotes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."crm_time_approvals"
  ADD CONSTRAINT "crm_time_approvals_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_time_approvals"
  ADD CONSTRAINT "crm_time_approvals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_time_compensations"
  ADD CONSTRAINT "crm_time_compensations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_time_entries"
  ADD CONSTRAINT "crm_work_order_time_entries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_time_entry_audit"
  ADD CONSTRAINT "crm_time_entry_audit_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_order_comments"
  ADD CONSTRAINT "crm_work_order_comments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_work_order_files"
  ADD CONSTRAINT "crm_work_order_files_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_order_invoices"
  ADD CONSTRAINT "crm_work_order_invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_order_kma_plans"
  ADD CONSTRAINT "crm_work_order_kma_plans_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_order_progress_reports"
  ADD CONSTRAINT "crm_work_order_progress_reports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_order_stages"
  ADD CONSTRAINT "crm_work_order_stages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."crm_work_orders"
  ADD CONSTRAINT "crm_work_orders_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."crm_work_orders"
  ADD CONSTRAINT "crm_work_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."dashboard_work_items"
  ADD CONSTRAINT "dashboard_work_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."document_publication_receipts"
  ADD CONSTRAINT "document_publication_receipts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_publication_recipients"
  ADD CONSTRAINT "document_publication_recipients_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_publications"
  ADD CONSTRAINT "document_publications_published_by_fkey" FOREIGN KEY (published_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."documents_files"
  ADD CONSTRAINT "documents_files_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."documents_folders"
  ADD CONSTRAINT "documents_folders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."fault_report_recipients"
  ADD CONSTRAINT "fault_report_recipients_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."fault_report_updates"
  ADD CONSTRAINT "fault_report_updates_responder_id_fkey" FOREIGN KEY (responder_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."fault_reports"
  ADD CONSTRAINT "fault_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."fault_reports"
  ADD CONSTRAINT "fault_reports_responder_id_fkey" FOREIGN KEY (responder_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."fortnox_article_favorites"
  ADD CONSTRAINT "fortnox_article_favorites_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."fortnox_article_work_description_defaults"
  ADD CONSTRAINT "fortnox_article_work_description_defaults_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."info_groups"
  ADD CONSTRAINT "info_groups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."info_sections"
  ADD CONSTRAINT "info_sections_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."ops_activity_events"
  ADD CONSTRAINT "ops_activity_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_day_notes"
  ADD CONSTRAINT "ops_day_notes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_depot_deliveries"
  ADD CONSTRAINT "ops_depot_deliveries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_depot_stock_counts"
  ADD CONSTRAINT "ops_depot_stock_counts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_expected_deliveries"
  ADD CONSTRAINT "ops_expected_deliveries_arrived_by_fkey" FOREIGN KEY (arrived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_expected_deliveries"
  ADD CONSTRAINT "ops_expected_deliveries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_material_orders"
  ADD CONSTRAINT "ops_material_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_material_orders"
  ADD CONSTRAINT "ops_material_orders_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_material_orders"
  ADD CONSTRAINT "ops_material_orders_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_material_suppliers"
  ADD CONSTRAINT "ops_material_suppliers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segment_crew"
  ADD CONSTRAINT "ops_segment_crew_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segment_crew"
  ADD CONSTRAINT "ops_segment_crew_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segment_reports"
  ADD CONSTRAINT "ops_segment_reports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_segments"
  ADD CONSTRAINT "ops_segments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_truck_crew"
  ADD CONSTRAINT "ops_truck_crew_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_truck_crew"
  ADD CONSTRAINT "ops_truck_crew_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_truck_default_crew"
  ADD CONSTRAINT "ops_truck_default_crew_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_truck_default_crew"
  ADD CONSTRAINT "ops_truck_default_crew_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."ops_work_order_confirmations"
  ADD CONSTRAINT "ops_work_order_confirmations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_depots"
  ADD CONSTRAINT "planning_depots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_job_type_colors"
  ADD CONSTRAINT "planning_job_type_colors_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_segment_team_members"
  ADD CONSTRAINT "planning_segment_team_members_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_team1_id_fkey" FOREIGN KEY (team1_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_team2_id_fkey" FOREIGN KEY (team2_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_team_member1_fkey" FOREIGN KEY (team_member1) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."planning_trucks"
  ADD CONSTRAINT "planning_trucks_team_member2_fkey" FOREIGN KEY (team_member2) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."role_permissions"
  ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY (permission_key) REFERENCES public.permissions(key) ON DELETE CASCADE;

ALTER TABLE "public"."role_permissions"
  ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY (ROLE, permission_key);

ALTER TABLE "public"."safety_checklist_items"
  ADD CONSTRAINT "safety_checklist_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.safety_checklist_categories(id);

ALTER TABLE "public"."safety_round_actions"
  ADD CONSTRAINT "safety_round_actions_responsible_id_fkey" FOREIGN KEY (responsible_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_items"
  ADD CONSTRAINT "safety_round_items_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES public.safety_checklist_items(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_actions"
  ADD CONSTRAINT "safety_round_actions_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.safety_round_items(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_participants"
  ADD CONSTRAINT "safety_round_participants_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_photos"
  ADD CONSTRAINT "safety_round_photos_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_photos"
  ADD CONSTRAINT "safety_round_photos_item_fk" FOREIGN KEY (item_id, round_id) REFERENCES public.safety_round_items(id, round_id) ON DELETE CASCADE;

ALTER TABLE "public"."safety_rounds"
  ADD CONSTRAINT "safety_rounds_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_rounds"
  ADD CONSTRAINT "safety_rounds_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_rounds"
  ADD CONSTRAINT "safety_rounds_leader_id_fkey" FOREIGN KEY (leader_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."safety_round_actions"
  ADD CONSTRAINT "safety_round_actions_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.safety_rounds(id) ON DELETE CASCADE;

ALTER TABLE "public"."safety_round_items"
  ADD CONSTRAINT "safety_round_items_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.safety_rounds(id) ON DELETE CASCADE;

ALTER TABLE "public"."safety_round_participants"
  ADD CONSTRAINT "safety_round_participants_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.safety_rounds(id) ON DELETE CASCADE;

ALTER TABLE "public"."safety_round_photos"
  ADD CONSTRAINT "safety_round_photos_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.safety_rounds(id) ON DELETE CASCADE;

ALTER TABLE "public"."safety_rounds"
  ADD CONSTRAINT "safety_rounds_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES public.crm_work_orders(id) ON DELETE CASCADE;

ALTER TABLE "public"."tasks"
  ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tasks"
  ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."tasks"
  ADD CONSTRAINT "tasks_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.crm_customers(id) ON DELETE SET NULL;

ALTER TABLE "public"."user_permissions"
  ADD CONSTRAINT "user_permissions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."user_permissions"
  ADD CONSTRAINT "user_permissions_permission_key_fkey" FOREIGN KEY (permission_key) REFERENCES public.permissions(key) ON DELETE CASCADE;

ALTER TABLE "public"."user_permissions"
  ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE VIEW "public"."current_user_dashboard_notes" AS  SELECT id,
    text,
    done,
    created_at,
    updated_at
   FROM public.dashboard_notes
  WHERE (user_id = auth.uid())
  ORDER BY created_at DESC;

CREATE VIEW "public"."current_user_role" AS  SELECT role
   FROM public.profiles p
  WHERE (id = auth.uid());

CREATE VIEW "public"."user_my_jobs_v" AS  SELECT s.id AS segment_id,
    s.project_id,
    s.project_name,
    s.customer,
    s.order_number,
    s.start_day,
    s.end_day,
    (gs.d)::date AS job_day,
    COALESCE(s.truck, m.truck) AS truck,
    m.job_type,
    m.bag_count
   FROM (((public.planning_segments s
     LEFT JOIN public.planning_project_meta m ON ((m.project_id = s.project_id)))
     LEFT JOIN LATERAL generate_series((s.start_day)::timestamp with time zone, (s.end_day)::timestamp with time zone, '1 day'::interval) gs(d) ON (true))
     LEFT JOIN public.planning_trucks t ON ((t.name = COALESCE(s.truck, m.truck))))
  WHERE ((t.name IS NOT NULL) AND (COALESCE(s.on_hold, false) = false));

CREATE OR REPLACE FUNCTION public.get_my_jobs (
  start_date date DEFAULT NULL::date,
  end_date   date DEFAULT NULL::date
)
  RETURNS SETOF public.user_my_jobs_v
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with me as (
    select auth.uid() as id
  )
  select *
  from public.user_my_jobs_v v
  where (start_date is null or v.job_day >= start_date)
    and (end_date is null or v.job_day <= end_date)
    and (
      -- 1) Membership via weekly assignment on the truck for that job_day
      exists (
        select 1
        from public.planning_truck_assignments a
        join public.planning_trucks t on t.name = v.truck and t.name = a.truck_id
        where v.job_day between a.start_day and a.end_day
          and (
            a.team1_id = (select id from me) or a.team2_id = (select id from me)
            or (
              -- Fallback: match on full name if IDs were not set in the assignment
              (a.team1_id is null and a.team_member1_name is not null and exists (
                select 1 from public.profiles p where p.id = (select id from me) and lower(p.full_name) = lower(a.team_member1_name)
              ))
              or (a.team2_id is null and a.team_member2_name is not null and exists (
                select 1 from public.profiles p where p.id = (select id from me) and lower(p.full_name) = lower(a.team_member2_name)
              ))
            )
          )
      )
      -- 2) OR membership via static truck team (fallback if no assignment applies)
      or exists (
        select 1
        from public.planning_trucks t2
        where t2.name = v.truck
          and (
            t2.team1_id = (select id from me) or t2.team2_id = (select id from me)
          )
      )
      -- 3) OR explicitly added as segment crew member
      or exists (
        select 1
        from public.planning_segment_team_members stm
        where stm.segment_id = v.segment_id
          and stm.member_id = (select id from me)
      )
    );
$function$;

CREATE INDEX addresses_name_trgm ON public.addresses USING gin (name public.gin_trgm_ops);

CREATE INDEX app_changelog_published_idx ON public.app_changelog_entries USING btree (published_at DESC)
  WHERE (published_at IS NOT NULL);

CREATE INDEX app_tickets_changelog_idx ON public.app_tickets USING btree (changelog_published_at DESC)
  WHERE (changelog_published_at IS NOT NULL);

CREATE INDEX app_tickets_reporter_idx ON public.app_tickets USING btree (reporter_id, created_at DESC);

CREATE INDEX app_tickets_status_idx ON public.app_tickets USING btree (status, created_at DESC);

CREATE INDEX blikk_activities_code_idx ON public.blikk_activities USING btree (code);

CREATE INDEX blikk_activities_name_lower_idx ON public.blikk_activities USING btree (lower(name));

CREATE INDEX blikk_activities_updated_at_idx ON public.blikk_activities USING btree (updated_at DESC);

CREATE INDEX blikk_timecodes_code_idx ON public.blikk_timecodes USING btree (code);

CREATE INDEX blikk_timecodes_name_lower_idx ON public.blikk_timecodes USING btree (lower(name));

CREATE INDEX blikk_timecodes_updated_at_idx ON public.blikk_timecodes USING btree (updated_at DESC);

CREATE INDEX contacts_category_idx ON public.contacts USING btree (category_id);

CREATE INDEX contacts_name_trgm ON public.contacts USING gin (name public.gin_trgm_ops);

CREATE INDEX crm_absence_types_active_idx ON public.crm_absence_types USING btree (is_active, sort_index, name);

CREATE UNIQUE INDEX crm_absence_types_blikk_id_uniq ON public.crm_absence_types USING btree (blikk_id);

CREATE INDEX crm_ai_prospect_suggestions_approved_prospect_idx ON public.crm_ai_prospect_suggestions USING btree (approved_customer_id)
  WHERE (approved_customer_id IS NOT NULL);

CREATE INDEX crm_ai_prospect_suggestions_company_name_idx ON public.crm_ai_prospect_suggestions USING btree (lower(company_name));

CREATE INDEX crm_ai_prospect_suggestions_status_created_at_idx ON public.crm_ai_prospect_suggestions USING btree (status, created_at DESC);

CREATE INDEX crm_calls_prospect_call_at_idx ON public.crm_calls USING btree (prospect_id, call_at DESC);

CREATE INDEX crm_calls_prospect_id_idx ON public.crm_calls USING btree (prospect_id);

CREATE INDEX crm_calls_quote_call_at_idx ON public.crm_calls USING btree (quote_id, call_at DESC);

CREATE INDEX crm_calls_user_call_at_idx ON public.crm_calls USING btree (user_id, call_at DESC);

CREATE INDEX crm_customers_account_manager_id_idx ON public.crm_customers USING btree (account_manager_id);

CREATE INDEX crm_customers_assigned_to_idx ON public.crm_customers USING btree (assigned_to);

CREATE INDEX crm_customers_customer_stage_idx ON public.crm_customers USING btree (customer_stage);

CREATE INDEX crm_customers_stage_idx ON public.crm_customers USING btree (customer_stage);

CREATE INDEX crm_customers_type_unverified_idx ON public.crm_customers USING btree (fortnox_customer_id)
  WHERE (customer_type_verified = false);

CREATE INDEX crm_goals_period_type_period_start_idx ON public.crm_goals USING btree (period_type, period_start);

CREATE INDEX crm_goals_user_period_idx ON public.crm_goals USING btree (user_id, period_type, period_start);

CREATE INDEX crm_internal_projects_active_idx ON public.crm_internal_projects USING btree (is_active, sort_index, name);

CREATE UNIQUE INDEX crm_internal_projects_blikk_id_uniq ON public.crm_internal_projects USING btree (blikk_id);

CREATE INDEX crm_quotes_assigned_status_idx ON public.crm_quotes USING btree (assigned_to, status, follow_up_date);

CREATE INDEX crm_quotes_created_at_idx ON public.crm_quotes USING btree (created_at DESC);

CREATE INDEX crm_quotes_fortnox_offer_number_idx ON public.crm_quotes USING btree (fortnox_offer_number)
  WHERE (fortnox_offer_number IS NOT NULL);

CREATE INDEX crm_quotes_project_name_idx ON public.crm_quotes USING btree (lower(project_name));

CREATE INDEX crm_quotes_prospect_id_idx ON public.crm_quotes USING btree (prospect_id);

CREATE INDEX crm_quotes_prospect_quote_date_idx ON public.crm_quotes USING btree (prospect_id, quote_date DESC);

CREATE INDEX crm_quotes_work_order_id_idx ON public.crm_quotes USING btree (work_order_id);

CREATE INDEX crm_routing_rules_county_idx ON public.crm_routing_rules USING btree (county);

CREATE INDEX crm_routing_rules_user_idx ON public.crm_routing_rules USING btree (user_id);

CREATE INDEX crm_time_approvals_period_status_idx ON public.crm_time_approvals USING btree (period_start, status);

CREATE UNIQUE INDEX crm_time_approvals_user_period_idx ON public.crm_time_approvals USING btree (user_id, period_start);

CREATE INDEX crm_time_codes_active_idx ON public.crm_time_codes USING btree (is_active, sort_index, name);

CREATE UNIQUE INDEX crm_time_codes_blikk_id_uniq ON public.crm_time_codes USING btree (blikk_id);

CREATE INDEX crm_time_compensations_missing_receipt_idx ON public.crm_time_compensations USING btree (user_id, entry_date)
  WHERE ((kind = 'expense'::text) AND (receipt_path IS NULL));

CREATE UNIQUE INDEX crm_time_compensations_receipt_path_key ON public.crm_time_compensations USING btree (receipt_path)
  WHERE (receipt_path IS NOT NULL);

CREATE INDEX crm_time_compensations_user_date_idx ON public.crm_time_compensations USING btree (user_id, entry_date DESC);

CREATE INDEX crm_time_entry_audit_entry_idx ON public.crm_time_entry_audit USING btree (entry_id, created_at DESC);

CREATE INDEX crm_time_entry_audit_user_idx ON public.crm_time_entry_audit USING btree (user_id, created_at DESC);

CREATE INDEX crm_wo_invoices_work_order_idx ON public.crm_work_order_invoices USING btree (work_order_id);

CREATE INDEX crm_wo_kma_created_at_idx ON public.crm_work_order_kma_plans USING btree (created_at DESC);

CREATE INDEX crm_wo_kma_created_by_idx ON public.crm_work_order_kma_plans USING btree (created_by, created_at DESC);

CREATE INDEX crm_work_order_comments_work_order_idx ON public.crm_work_order_comments USING btree (work_order_id, created_at DESC);

CREATE INDEX crm_work_order_files_created_by_idx ON public.crm_work_order_files USING btree (created_by);

CREATE UNIQUE INDEX crm_work_order_files_storage_path_key ON public.crm_work_order_files USING btree (storage_path);

CREATE INDEX crm_work_order_files_work_order_idx ON public.crm_work_order_files USING btree (work_order_id, created_at DESC);

CREATE INDEX crm_work_order_progress_created_by_idx ON public.crm_work_order_progress_reports USING btree (created_by);

CREATE INDEX crm_work_order_progress_work_order_idx ON public.crm_work_order_progress_reports USING btree (work_order_id, created_at DESC);

CREATE INDEX crm_work_order_time_entries_user_idx ON public.crm_time_entries USING btree (user_id, work_date DESC);

CREATE INDEX crm_work_order_time_entries_work_order_idx ON public.crm_time_entries USING btree (work_order_id, work_date DESC);

CREATE INDEX crm_work_orders_assigned_status_idx ON public.crm_work_orders USING btree (assigned_to, status, desired_installation_date);

CREATE INDEX crm_work_orders_created_at_idx ON public.crm_work_orders USING btree (created_at DESC);

CREATE INDEX crm_work_orders_fortnox_invoice_number_idx ON public.crm_work_orders USING btree (fortnox_invoice_number)
  WHERE (fortnox_invoice_number IS NOT NULL);

CREATE INDEX crm_work_orders_fortnox_order_number_idx ON public.crm_work_orders USING btree (fortnox_order_number)
  WHERE (fortnox_order_number IS NOT NULL);

CREATE INDEX crm_work_orders_prospect_id_idx ON public.crm_work_orders USING btree (prospect_id);

CREATE INDEX crm_work_orders_prospect_idx ON public.crm_work_orders USING btree (prospect_id);

CREATE INDEX dashboard_notes_due_reminders_idx ON public.dashboard_notes USING btree (reminder_at)
  WHERE ((reminder_at IS NOT NULL) AND (reminder_sent_at IS NULL) AND (done = false));

CREATE INDEX dashboard_notes_user_id_created_idx ON public.dashboard_notes USING btree (user_id, created_at DESC);

CREATE INDEX dashboard_push_subscriptions_user_idx ON public.dashboard_push_subscriptions USING btree (user_id, created_at DESC);

CREATE INDEX dashboard_work_items_created_by_idx ON public.dashboard_work_items USING btree (created_by, created_at DESC)
  WHERE (created_by IS NOT NULL);

CREATE INDEX dashboard_work_items_related_idx ON public.dashboard_work_items USING btree (related_type, related_id)
  WHERE (related_type IS NOT NULL);

CREATE INDEX dashboard_work_items_user_remind_at_idx ON public.dashboard_work_items USING btree (user_id, remind_at)
  WHERE ((remind_at IS NOT NULL) AND (reminder_sent_at IS NULL) AND (status = 'active'::text));

CREATE INDEX dashboard_work_items_user_starts_at_idx ON public.dashboard_work_items USING btree (user_id, starts_at)
  WHERE (starts_at IS NOT NULL);

CREATE INDEX dashboard_work_items_user_status_kind_idx ON public.dashboard_work_items USING btree (user_id, status, kind, created_at DESC);

CREATE INDEX document_publication_receipts_publication_idx ON public.document_publication_receipts USING btree (publication_id);

CREATE INDEX document_publication_receipts_user_idx ON public.document_publication_receipts USING btree (user_id, updated_at DESC);

CREATE INDEX document_publication_recipients_publication_idx ON public.document_publication_recipients USING btree (publication_id);

CREATE INDEX document_publication_recipients_user_idx ON public.document_publication_recipients USING btree (recipient_user_id, created_at DESC);

CREATE INDEX document_publications_active_idx ON public.document_publications USING btree (archived_at, due_at);

CREATE INDEX document_publications_file_idx ON public.document_publications USING btree (file_id, created_at DESC);

CREATE INDEX documents_files_file_name_trgm_idx ON public.documents_files USING gin (file_name public.gin_trgm_ops);

CREATE INDEX documents_files_folder_idx ON public.documents_files USING btree (folder_id);

CREATE UNIQUE INDEX documents_files_folder_name_uq ON public.documents_files USING btree (COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(file_name));

CREATE INDEX documents_folders_parent_idx ON public.documents_folders USING btree (parent_id);

CREATE UNIQUE INDEX documents_folders_parent_name_uq ON public.documents_folders USING btree (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX fault_report_updates_report_idx ON public.fault_report_updates USING btree (report_id, created_at);

CREATE INDEX fault_reports_reporter_idx ON public.fault_reports USING btree (reporter_id, created_at DESC);

CREATE INDEX fault_reports_status_idx ON public.fault_reports USING btree (status, created_at DESC);

CREATE INDEX fortnox_articles_cache_active_idx ON public.fortnox_articles_cache USING btree (active, article_number);

CREATE INDEX fortnox_articles_cache_note_pending_idx ON public.fortnox_articles_cache USING btree (article_number)
  WHERE (note_synced_at IS NULL);

CREATE INDEX idx_mqs_batch ON public.material_quality_samples USING btree (batch_number);

CREATE INDEX idx_mqs_installation_date ON public.material_quality_samples USING btree (installation_date);

CREATE INDEX idx_mqs_order_id ON public.material_quality_samples USING btree (order_id);

CREATE INDEX idx_planning_day_notes_day ON public.planning_day_notes USING btree (note_day);

CREATE INDEX idx_planning_depot_deliveries_depot_date ON public.planning_depot_deliveries USING btree (depot_id, delivery_date);

CREATE INDEX idx_planning_depot_deliveries_unprocessed ON public.planning_depot_deliveries USING btree (delivery_date)
  WHERE (processed_at IS NULL);

CREATE INDEX idx_planning_project_meta_client_notified ON public.planning_project_meta USING btree (client_notified);

CREATE INDEX idx_planning_project_meta_delivery_sent ON public.planning_project_meta USING btree (delivery_sent);

CREATE INDEX idx_planning_project_meta_sms_notified ON public.planning_project_meta USING btree (sms_notified);

CREATE INDEX idx_planning_project_meta_sms_provider_message_id ON public.planning_project_meta USING btree (sms_provider_message_id);

CREATE INDEX info_groups_order_idx ON public.info_groups USING btree (sort_order, created_at);

CREATE INDEX info_section_images_section_idx ON public.info_section_images USING btree (section_id, sort_order, created_at);

CREATE INDEX info_sections_group_idx ON public.info_sections USING btree (group_id, sort_order, created_at);

CREATE INDEX news_items_created_at_idx ON public.news_items USING btree (created_at DESC);

CREATE INDEX notifications_recipient_created_idx ON public.notifications USING btree (recipient_user_id, created_at DESC);

CREATE INDEX notifications_recipient_unread_idx ON public.notifications USING btree (recipient_user_id)
  WHERE (read_at IS NULL);

CREATE UNIQUE INDEX offert_calculations_offert_number_uidx ON public.offert_calculations USING btree (offert_number_year, offert_number_seq);

CREATE INDEX offert_calculations_user_id_created_at_idx ON public.offert_calculations USING btree (user_id, created_at DESC);

CREATE INDEX offert_calculations_user_id_next_meeting_date_idx ON public.offert_calculations USING btree (user_id, next_meeting_date);

CREATE INDEX offert_calculations_user_id_offert_number_idx ON public.offert_calculations USING btree (user_id, offert_number_year DESC, offert_number_seq DESC);

CREATE INDEX offert_calculations_user_id_quote_date_idx ON public.offert_calculations USING btree (user_id, quote_date DESC);

CREATE INDEX offert_calculations_user_id_status_idx ON public.offert_calculations USING btree (user_id, status);

CREATE INDEX offert_calculations_user_id_updated_at_idx ON public.offert_calculations USING btree (user_id, updated_at DESC);

CREATE INDEX offert_customer_requests_offert_id_idx ON public.offert_customer_requests USING btree (offert_id);

CREATE INDEX offert_customer_requests_seller_user_id_idx ON public.offert_customer_requests USING btree (seller_user_id);

CREATE INDEX offert_customer_requests_status_idx ON public.offert_customer_requests USING btree (status);

CREATE UNIQUE INDEX offert_customer_responses_request_id_uidx ON public.offert_customer_responses USING btree (request_id);

CREATE INDEX ops_activity_events_actor_idx ON public.ops_activity_events USING btree (actor_id);

CREATE INDEX ops_activity_events_created_idx ON public.ops_activity_events USING btree (created_at DESC);

CREATE INDEX ops_activity_events_work_order_idx ON public.ops_activity_events USING btree (work_order_id);

CREATE INDEX ops_day_notes_day_idx ON public.ops_day_notes USING btree (note_day);

CREATE INDEX ops_depot_deliveries_depot_idx ON public.ops_depot_deliveries USING btree (depot_id, material);

CREATE INDEX ops_depot_stock_counts_latest_idx ON public.ops_depot_stock_counts USING btree (depot_id, material, counted_on DESC, created_at DESC);

CREATE INDEX ops_expected_deliveries_day_idx ON public.ops_expected_deliveries USING btree (expected_on)
  WHERE (status = 'expected'::text);

CREATE UNIQUE INDEX ops_expected_deliveries_delivery_uniq ON public.ops_expected_deliveries USING btree (delivery_id)
  WHERE (delivery_id IS NOT NULL);

CREATE INDEX ops_expected_deliveries_order_idx ON public.ops_expected_deliveries USING btree (order_id)
  WHERE (order_id IS NOT NULL);

CREATE INDEX ops_expected_deliveries_stock_idx ON public.ops_expected_deliveries USING btree (depot_id, material, status);

CREATE UNIQUE INDEX ops_material_orders_one_open_per_supplier ON public.ops_material_orders USING btree (supplier_id)
  WHERE (status = ANY (ARRAY['draft'::text, 'sending'::text]));

CREATE INDEX ops_material_orders_status_sent_idx ON public.ops_material_orders USING btree (status, sent_at DESC);

CREATE UNIQUE INDEX ops_material_suppliers_name_uniq ON public.ops_material_suppliers USING btree (lower(btrim(name)))
  WHERE active;

CREATE UNIQUE INDEX ops_segment_crew_member_uniq ON public.ops_segment_crew USING btree (segment_id, member_id)
  WHERE (member_id IS NOT NULL);

CREATE INDEX ops_segment_crew_segment_idx ON public.ops_segment_crew USING btree (segment_id);

CREATE INDEX ops_segment_reports_segment_idx ON public.ops_segment_reports USING btree (segment_id);

CREATE INDEX ops_segment_reports_work_order_idx ON public.ops_segment_reports USING btree (work_order_id);

CREATE INDEX ops_segments_stage_idx ON public.ops_segments USING btree (stage_id);

CREATE INDEX ops_segments_truck_range_idx ON public.ops_segments USING btree (truck_id, start_day, end_day);

CREATE INDEX ops_segments_work_order_idx ON public.ops_segments USING btree (work_order_id);

CREATE UNIQUE INDEX ops_truck_crew_member_uniq ON public.ops_truck_crew USING btree (truck_id, member_id, start_day)
  WHERE (member_id IS NOT NULL);

CREATE INDEX ops_truck_crew_truck_range_idx ON public.ops_truck_crew USING btree (truck_id, start_day, end_day);

CREATE UNIQUE INDEX ops_truck_default_crew_leader_uniq ON public.ops_truck_default_crew USING btree (truck_id)
  WHERE (ROLE = 'leader'::text);

CREATE UNIQUE INDEX ops_truck_default_crew_member_uniq ON public.ops_truck_default_crew USING btree (truck_id, member_id)
  WHERE (member_id IS NOT NULL);

CREATE INDEX ops_truck_default_crew_truck_idx ON public.ops_truck_default_crew USING btree (truck_id);

CREATE INDEX ops_wo_confirmations_segment_idx ON public.ops_work_order_confirmations USING btree (segment_id);

CREATE INDEX ops_wo_confirmations_work_order_idx ON public.ops_work_order_confirmations USING btree (work_order_id, created_at DESC);

CREATE INDEX planning_activity_events_created_idx ON public.planning_activity_events USING btree (created_at DESC);

CREATE INDEX planning_activity_events_project_idx ON public.planning_activity_events USING btree (project_id);

CREATE INDEX planning_activity_events_segment_idx ON public.planning_activity_events USING btree (segment_id);

CREATE INDEX planning_depot_usage_date_idx ON public.planning_depot_usage USING btree (installation_date);

CREATE INDEX planning_depot_usage_depot_idx ON public.planning_depot_usage USING btree (depot_id);

CREATE INDEX planning_depot_usage_material_idx ON public.planning_depot_usage USING btree (material_kind);

CREATE INDEX planning_depot_usage_order_number_idx ON public.planning_depot_usage USING btree (order_number);

CREATE INDEX planning_depot_usage_project_idx ON public.planning_depot_usage USING btree (project_id);

CREATE UNIQUE INDEX planning_depot_usage_source_key_unique ON public.planning_depot_usage USING btree (source_key)
  WHERE (source_key IS NOT NULL);

CREATE INDEX planning_project_meta_address_city_idx ON public.planning_project_meta USING btree (address_city);

CREATE INDEX planning_segment_reports_created_idx ON public.planning_segment_reports USING btree (created_at);

CREATE INDEX planning_segment_reports_day_idx ON public.planning_segment_reports USING btree (report_day);

CREATE INDEX planning_segment_reports_project_idx ON public.planning_segment_reports USING btree (project_id);

CREATE INDEX planning_segment_reports_segment_idx ON public.planning_segment_reports USING btree (segment_id);

CREATE INDEX planning_segment_team_members_segment_idx ON public.planning_segment_team_members USING btree (segment_id);

CREATE INDEX planning_segments_depot_id_idx ON public.planning_segments USING btree (depot_id);

CREATE INDEX planning_segments_on_hold_idx ON public.planning_segments USING btree (on_hold);

CREATE INDEX planning_segments_project_idx ON public.planning_segments USING btree (project_id);

CREATE INDEX planning_segments_sort_index_idx ON public.planning_segments USING btree (sort_index);

CREATE INDEX planning_segments_start_idx ON public.planning_segments USING btree (start_day);

CREATE INDEX planning_segments_truck_idx ON public.planning_segments USING btree (truck);

CREATE INDEX planning_truck_assignments_truck_range_idx ON public.planning_truck_assignments USING btree (truck_id, start_day, end_day);

CREATE INDEX planning_trucks_depot_id_idx ON public.planning_trucks USING btree (depot_id);

CREATE INDEX planning_trucks_team1_idx ON public.planning_trucks USING btree (team1_id);

CREATE INDEX planning_trucks_team2_idx ON public.planning_trucks USING btree (team2_id);

CREATE UNIQUE INDEX profiles_blikk_id_unique ON public.profiles USING btree (blikk_id)
  WHERE (blikk_id IS NOT NULL);

CREATE INDEX profiles_role_idx ON public.profiles USING btree (ROLE);

CREATE INDEX profiles_tags_gin ON public.profiles USING gin (tags);

CREATE INDEX role_permissions_role_idx ON public.role_permissions USING btree (ROLE);

CREATE INDEX safety_checklist_items_category_idx ON public.safety_checklist_items USING btree (category_id, "position");

CREATE INDEX safety_round_actions_round_idx ON public.safety_round_actions USING btree (round_id, "position");

CREATE INDEX safety_round_items_round_idx ON public.safety_round_items USING btree (round_id, "position");

CREATE INDEX safety_round_participants_round_idx ON public.safety_round_participants USING btree (round_id, "position");

CREATE INDEX safety_round_photos_item_idx ON public.safety_round_photos USING btree (item_id, round_id);

CREATE INDEX safety_rounds_held_on_idx ON public.safety_rounds USING btree (held_on DESC, created_at DESC);

CREATE INDEX tasks_assigned_priority_idx ON public.tasks USING btree (assigned_to, priority, due_date);

CREATE INDEX tasks_assigned_status_idx ON public.tasks USING btree (assigned_to, status);

CREATE INDEX tasks_created_at_idx ON public.tasks USING btree (created_at DESC);

CREATE INDEX tasks_prospect_status_idx ON public.tasks USING btree (prospect_id, status);

CREATE INDEX user_permissions_user_idx ON public.user_permissions USING btree (user_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER set_timestamp_crm_absence_types
  BEFORE UPDATE ON public.crm_absence_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_time_reference();

CREATE TRIGGER set_timestamp_crm_ai_prospect_suggestions
  BEFORE UPDATE ON public.crm_ai_prospect_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_ai_prospect_suggestions();

CREATE TRIGGER crm_customers_set_updated_at
  BEFORE UPDATE ON public.crm_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_customers_updated_at();

CREATE TRIGGER set_timestamp_crm_goals
  BEFORE UPDATE ON public.crm_goals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_goals();

CREATE TRIGGER set_timestamp_crm_internal_projects
  BEFORE UPDATE ON public.crm_internal_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_time_reference();

CREATE TRIGGER set_timestamp_crm_quotes
  BEFORE UPDATE ON public.crm_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_quotes();

CREATE TRIGGER set_timestamp_crm_time_approvals
  BEFORE UPDATE ON public.crm_time_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_time_reference();

CREATE TRIGGER set_timestamp_crm_time_codes
  BEFORE UPDATE ON public.crm_time_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_time_reference();

CREATE TRIGGER enforce_time_period_lock
  BEFORE INSERT OR DELETE OR UPDATE ON public.crm_time_compensations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_time_period_lock('entry_date');

CREATE TRIGGER set_timestamp_crm_time_compensations
  BEFORE UPDATE ON public.crm_time_compensations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_time_reference();

CREATE TRIGGER enforce_time_entry_owner
  BEFORE UPDATE ON public.crm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_time_entry_owner();

CREATE TRIGGER enforce_time_period_lock
  BEFORE INSERT OR DELETE OR UPDATE ON public.crm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_time_period_lock('work_date');

CREATE TRIGGER log_time_entry_change
  AFTER INSERT OR DELETE OR UPDATE ON public.crm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_time_entry_change();

CREATE TRIGGER set_crm_time_entry_hours
  BEFORE INSERT OR UPDATE ON public.crm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_time_entry_hours();

CREATE TRIGGER set_timestamp_crm_work_order_time_entries
  BEFORE UPDATE ON public.crm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_work_order_time_entries();

CREATE TRIGGER set_timestamp_crm_work_order_stages
  BEFORE UPDATE ON public.crm_work_order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_work_order_stages();

CREATE TRIGGER set_timestamp_crm_work_orders
  BEFORE UPDATE ON public.crm_work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_crm_work_orders();

CREATE TRIGGER set_timestamp_dashboard_notes
  BEFORE UPDATE ON public.dashboard_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp();

CREATE TRIGGER set_timestamp_dashboard_push_subscriptions
  BEFORE UPDATE ON public.dashboard_push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp();

CREATE TRIGGER set_timestamp_dashboard_work_items
  BEFORE UPDATE ON public.dashboard_work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp();

CREATE TRIGGER document_publication_receipts_set_updated_at
  BEFORE UPDATE ON public.document_publication_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TRIGGER document_publications_set_updated_at
  BEFORE UPDATE ON public.document_publications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TRIGGER employee_sensitive_details_set_updated_at
  BEFORE UPDATE ON public.employee_sensitive_details
  FOR EACH ROW
  EXECUTE FUNCTION public.set_employee_sensitive_details_updated_at();

CREATE TRIGGER info_groups_set_updated_at
  BEFORE UPDATE ON public.info_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TRIGGER info_sections_set_updated_at
  BEFORE UPDATE ON public.info_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TRIGGER offert_calculations_set_timestamp
  BEFORE UPDATE ON public.offert_calculations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_offert_calculations();

CREATE TRIGGER trg_assign_offert_number
  BEFORE INSERT ON public.offert_calculations
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_offert_number();

CREATE TRIGGER ops_expected_deliveries_forward_only
  BEFORE UPDATE ON public.ops_expected_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.ops_expected_deliveries_forward_only();

CREATE TRIGGER ops_material_orders_guard
  BEFORE UPDATE ON public.ops_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ops_material_orders_guard();

CREATE TRIGGER ops_material_orders_insert_guard
  BEFORE INSERT ON public.ops_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ops_material_orders_insert_guard();

CREATE TRIGGER set_timestamp_ops_segments
  BEFORE UPDATE ON public.ops_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_ops_segments();

CREATE TRIGGER set_updated_at_planning_job_type_colors
  BEFORE UPDATE ON public.planning_job_type_colors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER planning_meta_set_timestamp
  BEFORE UPDATE ON public.planning_project_meta
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_planning_meta();

CREATE TRIGGER trg_planning_meta_log
  AFTER INSERT OR DELETE OR UPDATE ON public.planning_project_meta
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_planning_meta_log();

CREATE TRIGGER planning_segment_reports_set_timestamp
  BEFORE UPDATE ON public.planning_segment_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_planning_segment_reports();

CREATE TRIGGER planning_segments_set_timestamp
  BEFORE UPDATE ON public.planning_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_planning_segments();

CREATE TRIGGER trg_planning_segments_log
  AFTER INSERT OR DELETE OR UPDATE ON public.planning_segments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_planning_segments_log();

CREATE TRIGGER trg_planning_assignments_log
  AFTER INSERT OR DELETE OR UPDATE ON public.planning_truck_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_planning_assignments_log();

CREATE TRIGGER trg_sync_truck_team_names
  BEFORE INSERT OR UPDATE OF team1_id, team2_id ON public.planning_trucks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_truck_team_names();

CREATE TRIGGER safety_round_actions_before_update
  BEFORE UPDATE ON public.safety_round_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.safety_round_actions_before_update();

CREATE TRIGGER safety_rounds_before_update
  BEFORE UPDATE ON public.safety_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.safety_rounds_before_update();

CREATE TRIGGER set_timestamp_tasks
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_tasks();

CREATE POLICY "addr_admin_write" ON "public"."addresses"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "addr_select_all" ON "public"."addresses"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "app_changelog_select" ON "public"."app_changelog_entries"
  FOR SELECT
  TO "authenticated"
  USING (((published_at IS NOT NULL) OR public.is_app_ticket_admin()));

CREATE POLICY "app_changelog_write" ON "public"."app_changelog_entries"
  FOR ALL
  TO "authenticated"
  USING (public.is_app_ticket_admin())
  WITH CHECK (public.is_app_ticket_admin());

CREATE POLICY "app_tickets_delete" ON "public"."app_tickets"
  FOR DELETE
  TO "authenticated"
  USING (public.is_app_ticket_admin());

CREATE POLICY "app_tickets_insert" ON "public"."app_tickets"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((reporter_id = auth.uid()));

CREATE POLICY "app_tickets_select" ON "public"."app_tickets"
  FOR SELECT
  TO "authenticated"
  USING (((reporter_id = auth.uid()) OR public.is_app_ticket_admin()));

CREATE POLICY "app_tickets_update" ON "public"."app_tickets"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_app_ticket_admin())
  WITH CHECK (public.is_app_ticket_admin());

CREATE POLICY "cat_admin_write" ON "public"."contact_categories"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "cat_select_all" ON "public"."contact_categories"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "contacts_admin_write" ON "public"."contacts"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "contacts_select_all" ON "public"."contacts"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "crm_absence_types_insert" ON "public"."crm_absence_types"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_absence_types_select" ON "public"."crm_absence_types"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "crm_absence_types_update" ON "public"."crm_absence_types"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('time.reference.manage'::text))
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_ai_prospect_suggestions_insert_admin_only" ON "public"."crm_ai_prospect_suggestions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.aiprospect.manage'::text)));

CREATE POLICY "crm_ai_prospect_suggestions_select_visible" ON "public"."crm_ai_prospect_suggestions"
  FOR SELECT
  TO PUBLIC
  USING (public.has_permission('crm.aiprospect.read'::text));

CREATE POLICY "crm_ai_prospect_suggestions_update_admin_only" ON "public"."crm_ai_prospect_suggestions"
  FOR UPDATE
  TO PUBLIC
  USING (public.has_permission('crm.aiprospect.manage'::text))
  WITH CHECK (public.has_permission('crm.aiprospect.manage'::text));

CREATE POLICY "crm_calc_settings_insert" ON "public"."crm_calc_settings"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_calc_settings_select" ON "public"."crm_calc_settings"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('crm.access'::text));

CREATE POLICY "crm_calc_settings_update" ON "public"."crm_calc_settings"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('crm.admin'::text))
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_calls_insert_visible" ON "public"."crm_calls"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((((user_id = auth.uid()) AND public.has_permission('crm.call.write'::text) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = auth.uid())))))) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_calls_select_visible" ON "public"."crm_calls"
  FOR SELECT
  TO PUBLIC
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = auth.uid())))) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_calls_update_visible" ON "public"."crm_calls"
  FOR UPDATE
  TO PUBLIC
  USING (((user_id = auth.uid()) OR public.has_permission('crm.admin'::text)))
  WITH CHECK ((((user_id = auth.uid()) AND public.has_permission('crm.call.write'::text) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = auth.uid())))))) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_customer_contacts_delete_sales_or_admin" ON "public"."crm_customer_contacts"
  FOR DELETE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = auth.uid()) OR public.has_permission('crm.customer.write'::text))))));

CREATE POLICY "crm_customer_contacts_insert_sales_or_admin" ON "public"."crm_customer_contacts"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = auth.uid()) OR public.has_permission('crm.customer.write'::text))))));

CREATE POLICY "crm_customer_contacts_select_visible" ON "public"."crm_customer_contacts"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = auth.uid()) OR public.has_permission('crm.customer.read'::text))))));

CREATE POLICY "crm_customer_contacts_update_sales_or_admin" ON "public"."crm_customer_contacts"
  FOR UPDATE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = auth.uid()) OR public.has_permission('crm.customer.write'::text))))));

CREATE POLICY "crm_customers_delete_admin" ON "public"."crm_customers"
  FOR DELETE
  TO PUBLIC
  USING (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_customers_insert_sales_or_admin" ON "public"."crm_customers"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.customer.write'::text)));

CREATE POLICY "crm_customers_select_visible" ON "public"."crm_customers"
  FOR SELECT
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.customer.read'::text)));

CREATE POLICY "crm_customers_update_assigned_or_admin" ON "public"."crm_customers"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.customer.write'::text)))
  WITH CHECK (((auth.uid() = assigned_to) OR public.has_permission('crm.customer.write'::text)));

CREATE POLICY "crm_goals_insert_admin_only" ON "public"."crm_goals"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.goal.manage'::text));

CREATE POLICY "crm_goals_select_visible" ON "public"."crm_goals"
  FOR SELECT
  TO PUBLIC
  USING (((user_id = auth.uid()) OR public.has_permission('crm.goal.manage'::text)));

CREATE POLICY "crm_goals_update_admin_only" ON "public"."crm_goals"
  FOR UPDATE
  TO PUBLIC
  USING (public.has_permission('crm.goal.manage'::text))
  WITH CHECK (public.has_permission('crm.goal.manage'::text));

CREATE POLICY "crm_internal_projects_insert" ON "public"."crm_internal_projects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_internal_projects_select" ON "public"."crm_internal_projects"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "crm_internal_projects_update" ON "public"."crm_internal_projects"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('time.reference.manage'::text))
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_material_cost_articles_delete" ON "public"."crm_material_cost_articles"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_material_cost_articles_insert" ON "public"."crm_material_cost_articles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_material_cost_articles_select" ON "public"."crm_material_cost_articles"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('crm.access'::text));

CREATE POLICY "crm_material_cost_articles_update" ON "public"."crm_material_cost_articles"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('crm.admin'::text))
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_productivity_rates_delete" ON "public"."crm_productivity_rates"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_productivity_rates_insert" ON "public"."crm_productivity_rates"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_productivity_rates_select" ON "public"."crm_productivity_rates"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('crm.access'::text));

CREATE POLICY "crm_productivity_rates_update" ON "public"."crm_productivity_rates"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('crm.admin'::text))
  WITH CHECK (public.has_permission('crm.admin'::text));

CREATE POLICY "crm_quotes_delete_assigned_or_admin" ON "public"."crm_quotes"
  FOR DELETE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_quotes_insert_admin_manage" ON "public"."crm_quotes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_quotes_insert_sales_or_admin" ON "public"."crm_quotes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND (assigned_to = auth.uid()) AND public.has_permission('crm.offer.write'::text) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.crm_customers c
  WHERE ((c.id = crm_quotes.prospect_id) AND (c.assigned_to = auth.uid())))))));

CREATE POLICY "crm_quotes_select_visible" ON "public"."crm_quotes"
  FOR SELECT
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.offer.read'::text)));

CREATE POLICY "crm_quotes_update_visible" ON "public"."crm_quotes"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)))
  WITH CHECK (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_routing_rules_manage_admin" ON "public"."crm_routing_rules"
  FOR ALL
  TO PUBLIC
  USING (public.has_permission('crm.routingrule.manage'::text))
  WITH CHECK (public.has_permission('crm.routingrule.manage'::text));

CREATE POLICY "crm_routing_rules_select_crm" ON "public"."crm_routing_rules"
  FOR SELECT
  TO PUBLIC
  USING (public.has_permission('crm.routingrule.read'::text));

CREATE POLICY "crm_time_approvals_select" ON "public"."crm_time_approvals"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR public.has_permission('time.approve'::text) OR public.has_permission('time.entry.read.all'::text)));

CREATE POLICY "crm_time_codes_insert" ON "public"."crm_time_codes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_time_codes_select" ON "public"."crm_time_codes"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "crm_time_codes_update" ON "public"."crm_time_codes"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('time.reference.manage'::text))
  WITH CHECK (public.has_permission('time.reference.manage'::text));

CREATE POLICY "crm_time_compensations_delete_own" ON "public"."crm_time_compensations"
  FOR DELETE
  TO "authenticated"
  USING (((user_id = auth.uid()) AND (NOT public.is_time_locked(auth.uid(), entry_date))));

CREATE POLICY "crm_time_compensations_insert" ON "public"."crm_time_compensations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((user_id = auth.uid()) AND public.has_permission('time.entry.write'::text) AND (NOT public.is_time_locked(auth.uid(), entry_date))));

CREATE POLICY "crm_time_compensations_select" ON "public"."crm_time_compensations"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR public.has_permission('time.entry.read.all'::text)));

CREATE POLICY "crm_time_compensations_update_own" ON "public"."crm_time_compensations"
  FOR UPDATE
  TO "authenticated"
  USING (((user_id = auth.uid()) AND (NOT public.is_time_locked(auth.uid(), entry_date))))
  WITH CHECK (((user_id = auth.uid()) AND (NOT public.is_time_locked(auth.uid(), entry_date))));

CREATE POLICY "crm_time_entries_delete_own" ON "public"."crm_time_entries"
  FOR DELETE
  TO "authenticated"
  USING ((((user_id = auth.uid()) OR public.has_permission('time.entry.write.all'::text)) AND (NOT public.is_time_locked(user_id, work_date))));

CREATE POLICY "crm_time_entries_insert" ON "public"."crm_time_entries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((user_id = auth.uid()) AND public.has_permission('time.entry.write'::text) AND ((work_order_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = auth.uid())))) OR public.is_user_on_work_order(auth.uid(), work_order_id) OR
    public.has_permission('crm.workorder.read'::text)) AND (NOT public.is_time_locked(auth.uid(), work_date))));

CREATE POLICY "crm_time_entries_select" ON "public"."crm_time_entries"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR public.has_permission('time.entry.read.all'::text) OR ((work_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = auth.uid()))))) OR ((work_order_id IS NOT NULL) AND public.is_user_on_work_order(auth.uid(), work_order_id))));

CREATE POLICY "crm_time_entries_update_own" ON "public"."crm_time_entries"
  FOR UPDATE
  TO "authenticated"
  USING ((((user_id = auth.uid()) OR public.has_permission('time.entry.write.all'::text)) AND (NOT public.is_time_locked(user_id, work_date))))
  WITH
    CHECK
    ((((user_id = auth.uid()) OR public.has_permission('time.entry.write.all'::text)) AND (NOT public.is_time_locked(user_id, work_date)) AND ((work_order_id IS NULL) OR (EXISTS (
    SELECT 1
   FROM public.crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = auth.uid())))) OR public.is_user_on_work_order(auth.uid(), work_order_id) OR
    public.has_permission('crm.workorder.read'::text))));

CREATE POLICY "crm_time_entry_audit_select" ON "public"."crm_time_entry_audit"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR public.has_permission('time.entry.read.all'::text)));

CREATE POLICY "crm_wo_comments_delete_own" ON "public"."crm_work_order_comments"
  FOR DELETE
  TO PUBLIC
  USING ((created_by = auth.uid()));

CREATE POLICY "crm_wo_comments_insert_crew" ON "public"."crm_work_order_comments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.is_user_on_work_order(auth.uid(), work_order_id)));

CREATE POLICY "crm_wo_comments_select_crew" ON "public"."crm_work_order_comments"
  FOR SELECT
  TO "authenticated"
  USING (public.is_user_on_work_order(auth.uid(), work_order_id));

CREATE POLICY "crm_wo_comments_update_own" ON "public"."crm_work_order_comments"
  FOR UPDATE
  TO PUBLIC
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "crm_work_order_comments_delete_self_or_visible" ON "public"."crm_work_order_comments"
  FOR DELETE
  TO PUBLIC
  USING (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))))))));

CREATE POLICY "crm_work_order_comments_insert_self" ON "public"."crm_work_order_comments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))))))));

CREATE POLICY "crm_work_order_comments_select_visible" ON "public"."crm_work_order_comments"
  FOR SELECT
  TO PUBLIC
  USING (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))))))));

CREATE POLICY "crm_wo_files_delete" ON "public"."crm_work_order_files"
  FOR DELETE
  TO "authenticated"
  USING (((created_by = auth.uid()) OR public.has_permission('crm.workorder.write'::text)));

CREATE POLICY "crm_wo_files_insert" ON "public"."crm_work_order_files"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((created_by = auth.uid()) AND (public.has_permission('crm.workorder.write'::text) OR ((is_internal = false) AND public.is_user_on_work_order(auth.uid(), work_order_id)))));

CREATE POLICY "crm_wo_files_select" ON "public"."crm_work_order_files"
  FOR SELECT
  TO "authenticated"
  USING (((created_by = auth.uid()) OR public.has_permission('crm.workorder.read'::text) OR ((is_internal = false) AND public.is_user_on_work_order(auth.uid(), work_order_id))));

CREATE POLICY "crm_wo_invoices_select_visible" ON "public"."crm_work_order_invoices"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.crm_work_orders w
  WHERE ((w.id = crm_work_order_invoices.work_order_id) AND ((auth.uid() = w.assigned_to) OR public.has_permission('crm.workorder.read'::text))))));

CREATE POLICY "crm_wo_kma_insert" ON "public"."crm_work_order_kma_plans"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.workorder.write'::text)));

CREATE POLICY "crm_wo_kma_select" ON "public"."crm_work_order_kma_plans"
  FOR SELECT
  TO "authenticated"
  USING (((created_by = auth.uid()) OR public.has_permission('crm.workorder.read'::text)));

CREATE POLICY "crm_wo_progress_delete" ON "public"."crm_work_order_progress_reports"
  FOR DELETE
  TO "authenticated"
  USING ((public.has_permission('crm.workorder.write'::text) OR ((created_by = auth.uid()) AND public.is_user_on_work_order(auth.uid(), work_order_id))));

CREATE POLICY "crm_wo_progress_insert" ON "public"."crm_work_order_progress_reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND (public.has_permission('crm.workorder.write'::text) OR public.is_user_on_work_order(auth.uid(), work_order_id))));

CREATE POLICY "crm_wo_progress_select" ON "public"."crm_work_order_progress_reports"
  FOR SELECT
  TO "authenticated"
  USING (((created_by = auth.uid()) OR public.has_permission('crm.workorder.read'::text) OR public.is_user_on_work_order(auth.uid(), work_order_id)));

CREATE POLICY "crm_wo_stages_delete" ON "public"."crm_work_order_stages"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('crm.workorder.write'::text));

CREATE POLICY "crm_wo_stages_insert" ON "public"."crm_work_order_stages"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.workorder.write'::text)));

CREATE POLICY "crm_wo_stages_select" ON "public"."crm_work_order_stages"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.crm_work_orders w
  WHERE ((w.id = crm_work_order_stages.work_order_id) AND ((auth.uid() = w.assigned_to) OR public.has_permission('crm.workorder.read'::text))))));

CREATE POLICY "crm_wo_stages_update" ON "public"."crm_work_order_stages"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('crm.workorder.write'::text))
  WITH CHECK (public.has_permission('crm.workorder.write'::text));

CREATE POLICY "crm_work_orders_delete_assigned_or_admin" ON "public"."crm_work_orders"
  FOR DELETE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_work_orders_insert_admin_manage" ON "public"."crm_work_orders"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.admin'::text)));

CREATE POLICY "crm_work_orders_insert_sales_or_admin" ON "public"."crm_work_orders"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('crm.workorder.write'::text) AND ((assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.crm_quotes q
  WHERE ((q.id = crm_work_orders.quote_id) AND (q.status = 'won'::text) AND (q.assigned_to = crm_work_orders.assigned_to)))))));

CREATE POLICY "crm_work_orders_select_crew" ON "public"."crm_work_orders"
  FOR SELECT
  TO "authenticated"
  USING (public.is_user_on_work_order(auth.uid(), id));

CREATE POLICY "crm_work_orders_select_visible" ON "public"."crm_work_orders"
  FOR SELECT
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.workorder.read'::text)));

CREATE POLICY "crm_work_orders_update_visible" ON "public"."crm_work_orders"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)))
  WITH CHECK (((auth.uid() = assigned_to) OR public.has_permission('crm.admin'::text)));

CREATE POLICY "dashboard_notes_modify_own" ON "public"."dashboard_notes"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "dashboard_notes_select_own" ON "public"."dashboard_notes"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "dashboard_push_subscriptions_modify_own" ON "public"."dashboard_push_subscriptions"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "dashboard_push_subscriptions_select_own" ON "public"."dashboard_push_subscriptions"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "dashboard_work_items_modify_own" ON "public"."dashboard_work_items"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "dashboard_work_items_select_own" ON "public"."dashboard_work_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "document_publication_receipts_insert" ON "public"."document_publication_receipts"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))));

CREATE POLICY "document_publication_receipts_select" ON "public"."document_publication_receipts"
  FOR SELECT
  TO PUBLIC
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))));

CREATE POLICY "document_publication_receipts_update" ON "public"."document_publication_receipts"
  FOR UPDATE
  TO PUBLIC
  USING ((((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))))
  WITH CHECK ((((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))));

CREATE POLICY "document_publication_recipients_admin_write" ON "public"."document_publication_recipients"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "document_publication_recipients_select" ON "public"."document_publication_recipients"
  FOR SELECT
  TO PUBLIC
  USING (((recipient_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))));

CREATE POLICY "document_publications_admin_write" ON "public"."document_publications"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "document_publications_select" ON "public"."document_publications"
  FOR SELECT
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))) OR (EXISTS ( SELECT 1
   FROM public.document_publication_recipients r
  WHERE ((r.publication_id = document_publications.id) AND (r.recipient_user_id = auth.uid()))))));

CREATE POLICY "documents_files_admin_write" ON "public"."documents_files"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "documents_files_select" ON "public"."documents_files"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "documents_folders_admin_write" ON "public"."documents_folders"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "documents_folders_select" ON "public"."documents_folders"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "employee_profile_details_select_self" ON "public"."employee_profile_details"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "employee_sensitive_details_no_direct_access" ON "public"."employee_sensitive_details"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "fault_report_recipients_select" ON "public"."fault_report_recipients"
  FOR SELECT
  TO "authenticated"
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role))))));

CREATE POLICY "fault_report_recipients_write" ON "public"."fault_report_recipients"
  FOR ALL
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "fault_report_updates_insert" ON "public"."fault_report_updates"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.is_fault_report_recipient() AND (responder_id = auth.uid())));

CREATE POLICY "fault_report_updates_select" ON "public"."fault_report_updates"
  FOR SELECT
  TO "authenticated"
  USING ((public.is_fault_report_recipient() OR (EXISTS ( SELECT 1
   FROM public.fault_reports fr
  WHERE ((fr.id = fault_report_updates.report_id) AND (fr.reporter_id = auth.uid()))))));

CREATE POLICY "fault_reports_insert" ON "public"."fault_reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((reporter_id = auth.uid()));

CREATE POLICY "fault_reports_select" ON "public"."fault_reports"
  FOR SELECT
  TO "authenticated"
  USING (((reporter_id = auth.uid()) OR public.is_fault_report_recipient()));

CREATE POLICY "fault_reports_update" ON "public"."fault_reports"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_fault_report_recipient())
  WITH CHECK (public.is_fault_report_recipient());

CREATE POLICY "fortnox_article_favorites_delete" ON "public"."fortnox_article_favorites"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('crm.write'::text));

CREATE POLICY "fortnox_article_favorites_insert" ON "public"."fortnox_article_favorites"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.write'::text));

CREATE POLICY "fortnox_article_favorites_select" ON "public"."fortnox_article_favorites"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('crm.access'::text));

CREATE POLICY "fortnox_article_work_description_defaults_delete" ON "public"."fortnox_article_work_description_defaults"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('crm.write'::text));

CREATE POLICY "fortnox_article_work_description_defaults_insert" ON "public"."fortnox_article_work_description_defaults"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('crm.write'::text));

CREATE POLICY "fortnox_article_work_description_defaults_select" ON "public"."fortnox_article_work_description_defaults"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('crm.access'::text));

CREATE POLICY "CRM users can read fortnox_articles_cache" ON "public"."fortnox_articles_cache"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['sales'::public.user_role, 'admin'::public.user_role]))))));

CREATE POLICY "Admins can read fortnox_integrations" ON "public"."fortnox_integrations"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::public.user_role)))));

CREATE POLICY "info_groups_admin_write" ON "public"."info_groups"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "info_groups_select" ON "public"."info_groups"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "info_section_images_admin_write" ON "public"."info_section_images"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "info_section_images_select" ON "public"."info_section_images"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "info_sections_admin_write" ON "public"."info_sections"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "info_sections_select" ON "public"."info_sections"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "korjournal delete own" ON "public"."korjournal_trips"
  FOR DELETE
  TO PUBLIC
  USING (((auth.uid())::text = user_id));

CREATE POLICY "korjournal read own" ON "public"."korjournal_trips"
  FOR SELECT
  TO PUBLIC
  USING (((auth.uid())::text = user_id));

CREATE POLICY "korjournal update own" ON "public"."korjournal_trips"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.uid())::text = user_id))
  WITH CHECK (((auth.uid())::text = user_id));

CREATE POLICY "korjournal write own" ON "public"."korjournal_trips"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((auth.uid())::text = user_id));

CREATE POLICY "news_items_admin_mod" ON "public"."news_items"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "news_items_select_all" ON "public"."news_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "notifications_select" ON "public"."notifications"
  FOR SELECT
  TO "authenticated"
  USING ((recipient_user_id = auth.uid()));

CREATE POLICY "notifications_update" ON "public"."notifications"
  FOR UPDATE
  TO "authenticated"
  USING ((recipient_user_id = auth.uid()))
  WITH CHECK ((recipient_user_id = auth.uid()));

CREATE POLICY "offert_calculations_delete_own" ON "public"."offert_calculations"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "offert_calculations_insert_own" ON "public"."offert_calculations"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "offert_calculations_select_own" ON "public"."offert_calculations"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "offert_calculations_update_own" ON "public"."offert_calculations"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "ops_activity_events_insert" ON "public"."ops_activity_events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((actor_id = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_activity_events_select" ON "public"."ops_activity_events"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_day_notes_delete" ON "public"."ops_day_notes"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_day_notes_insert" ON "public"."ops_day_notes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_day_notes_select" ON "public"."ops_day_notes"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_day_notes_update" ON "public"."ops_day_notes"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_depot_deliveries_delete" ON "public"."ops_depot_deliveries"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_depot_deliveries_insert" ON "public"."ops_depot_deliveries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_depot_deliveries_select" ON "public"."ops_depot_deliveries"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_depot_deliveries_update" ON "public"."ops_depot_deliveries"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_depot_stock_counts_insert" ON "public"."ops_depot_stock_counts"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.depot.manage'::text) AND (counted_on <= ((now() AT TIME ZONE 'Europe/Stockholm'::text))::date)));

CREATE POLICY "ops_depot_stock_counts_select" ON "public"."ops_depot_stock_counts"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_depots_delete" ON "public"."ops_depots"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_depots_insert" ON "public"."ops_depots"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_depots_select" ON "public"."ops_depots"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_depots_update" ON "public"."ops_depots"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text))
  WITH CHECK (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_expected_deliveries_delete" ON "public"."ops_expected_deliveries"
  FOR DELETE
  TO "authenticated"
  USING (((order_id IS NULL) AND public.has_permission('planning.depot.manage'::text)));

CREATE POLICY "ops_expected_deliveries_insert" ON "public"."ops_expected_deliveries"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND (order_id IS NULL) AND public.has_permission('planning.depot.manage'::text)));

CREATE POLICY "ops_expected_deliveries_select" ON "public"."ops_expected_deliveries"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_expected_deliveries_update" ON "public"."ops_expected_deliveries"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text))
  WITH CHECK (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_job_types_delete" ON "public"."ops_job_types"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_job_types_insert" ON "public"."ops_job_types"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_job_types_select" ON "public"."ops_job_types"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_job_types_update" ON "public"."ops_job_types"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.truck.manage'::text))
  WITH CHECK (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_material_orders_delete" ON "public"."ops_material_orders"
  FOR DELETE
  TO "authenticated"
  USING ((public.has_permission('planning.depot.manage'::text) AND (status = 'draft'::text)));

CREATE POLICY "ops_material_orders_insert" ON "public"."ops_material_orders"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND (status = 'draft'::text) AND public.has_permission('planning.depot.manage'::text)));

CREATE POLICY "ops_material_orders_select" ON "public"."ops_material_orders"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_material_orders_update" ON "public"."ops_material_orders"
  FOR UPDATE
  TO "authenticated"
  USING ((public.has_permission('planning.depot.manage'::text) AND (status <> 'sent'::text)))
  WITH CHECK ((public.has_permission('planning.depot.manage'::text) AND (status <> 'sent'::text)));

CREATE POLICY "ops_material_suppliers_delete" ON "public"."ops_material_suppliers"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_material_suppliers_insert" ON "public"."ops_material_suppliers"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.depot.manage'::text)));

CREATE POLICY "ops_material_suppliers_select" ON "public"."ops_material_suppliers"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_material_suppliers_update" ON "public"."ops_material_suppliers"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.depot.manage'::text))
  WITH CHECK (public.has_permission('planning.depot.manage'::text));

CREATE POLICY "ops_segment_crew_delete" ON "public"."ops_segment_crew"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_segment_crew_insert" ON "public"."ops_segment_crew"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_segment_crew_select" ON "public"."ops_segment_crew"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_segment_crew_update" ON "public"."ops_segment_crew"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_segment_reports_delete_own_partial" ON "public"."ops_segment_reports"
  FOR DELETE
  TO "authenticated"
  USING (((kind = 'partial'::text) AND (created_by = auth.uid()) AND public.is_user_on_work_order(auth.uid(), work_order_id)));

CREATE POLICY "ops_segment_reports_delete" ON "public"."ops_segment_reports"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_segment_reports_insert_crew" ON "public"."ops_segment_reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.is_user_on_work_order(auth.uid(), work_order_id)));

CREATE POLICY "ops_segment_reports_insert" ON "public"."ops_segment_reports"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_segment_reports_select_crew" ON "public"."ops_segment_reports"
  FOR SELECT
  TO "authenticated"
  USING (public.is_user_on_work_order(auth.uid(), work_order_id));

CREATE POLICY "ops_segment_reports_select" ON "public"."ops_segment_reports"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_segment_reports_update" ON "public"."ops_segment_reports"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_segments_delete" ON "public"."ops_segments"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_segments_insert" ON "public"."ops_segments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_segments_select" ON "public"."ops_segments"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_segments_update" ON "public"."ops_segments"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_truck_crew_delete" ON "public"."ops_truck_crew"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_truck_crew_insert" ON "public"."ops_truck_crew"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_truck_crew_select" ON "public"."ops_truck_crew"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_truck_crew_update" ON "public"."ops_truck_crew"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_truck_default_crew_delete" ON "public"."ops_truck_default_crew"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_truck_default_crew_insert" ON "public"."ops_truck_default_crew"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_truck_default_crew_select" ON "public"."ops_truck_default_crew"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_truck_default_crew_update" ON "public"."ops_truck_default_crew"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_trucks_delete" ON "public"."ops_trucks"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_trucks_insert" ON "public"."ops_trucks"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_trucks_select" ON "public"."ops_trucks"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_trucks_update" ON "public"."ops_trucks"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.truck.manage'::text))
  WITH CHECK (public.has_permission('planning.truck.manage'::text));

CREATE POLICY "ops_wo_confirmations_delete" ON "public"."ops_work_order_confirmations"
  FOR DELETE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "ops_wo_confirmations_insert" ON "public"."ops_work_order_confirmations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = auth.uid()) AND public.has_permission('planning.schedule.write'::text)));

CREATE POLICY "ops_wo_confirmations_select" ON "public"."ops_work_order_confirmations"
  FOR SELECT
  TO "authenticated"
  USING (public.has_permission('planning.schedule.read'::text));

CREATE POLICY "ops_wo_confirmations_update" ON "public"."ops_work_order_confirmations"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('planning.schedule.write'::text))
  WITH CHECK (public.has_permission('planning.schedule.write'::text));

CREATE POLICY "permissions_select_all" ON "public"."permissions"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "planning_activity_events_insert" ON "public"."planning_activity_events"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (current_setting('app.log_allowed'::text, true) = '1'::text)));

CREATE POLICY "planning_activity_events_select" ON "public"."planning_activity_events"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_day_notes_delete" ON "public"."planning_day_notes"
  FOR DELETE
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_day_notes_insert" ON "public"."planning_day_notes"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_day_notes_select" ON "public"."planning_day_notes"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_day_notes_update" ON "public"."planning_day_notes"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())))
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_depot_deliveries_admin_mod" ON "public"."planning_depot_deliveries"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "planning_depot_deliveries_select" ON "public"."planning_depot_deliveries"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_depot_usage_insert" ON "public"."planning_depot_usage"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_depot_usage_read" ON "public"."planning_depot_usage"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_depots_admin_mod" ON "public"."planning_depots"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "planning_depots_select" ON "public"."planning_depots"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_job_type_colors_admin_mod" ON "public"."planning_job_type_colors"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "planning_job_type_colors_select" ON "public"."planning_job_type_colors"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_project_meta_select" ON "public"."planning_project_meta"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_project_meta_write" ON "public"."planning_project_meta"
  FOR ALL
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())))
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_segment_reports_select" ON "public"."planning_segment_reports"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_segment_reports_write" ON "public"."planning_segment_reports"
  FOR ALL
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())))
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_segment_team_members_select" ON "public"."planning_segment_team_members"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_segment_team_members_write" ON "public"."planning_segment_team_members"
  FOR ALL
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())))
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_segments_select" ON "public"."planning_segments"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "planning_segments_write" ON "public"."planning_segments"
  FOR ALL
  TO PUBLIC
  USING (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())))
  WITH CHECK (((auth.role() = 'authenticated'::text) AND (NOT public.is_konsult_user())));

CREATE POLICY "planning_trucks_admin_mod" ON "public"."planning_trucks"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::public.user_role)))));

CREATE POLICY "planning_trucks_select" ON "public"."planning_trucks"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "profiles_select_self" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));

CREATE POLICY "profiles_update_self" ON "public"."profiles"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = id));

CREATE POLICY "profiles_update_service_role" ON "public"."profiles"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));

CREATE POLICY "role_permissions_select_all" ON "public"."role_permissions"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "safety_checklist_categories_select" ON "public"."safety_checklist_categories"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "safety_checklist_items_select" ON "public"."safety_checklist_items"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "safety_round_actions_delete" ON "public"."safety_round_actions"
  FOR DELETE
  TO "authenticated"
  USING ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_actions_insert" ON "public"."safety_round_actions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_actions_select" ON "public"."safety_round_actions"
  FOR SELECT
  TO "authenticated"
  USING ((public.has_permission('safety.round.read'::text) OR public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_round_actions_update" ON "public"."safety_round_actions"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_permission('safety.round.write'::text))
  WITH CHECK (public.has_permission('safety.round.write'::text));

CREATE POLICY "safety_round_items_delete" ON "public"."safety_round_items"
  FOR DELETE
  TO "authenticated"
  USING (((catalog_item_id IS NULL) AND public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_items_insert" ON "public"."safety_round_items"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((catalog_item_id IS NULL) AND public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_items_select" ON "public"."safety_round_items"
  FOR SELECT
  TO "authenticated"
  USING ((public.has_permission('safety.round.read'::text) OR public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_round_items_update" ON "public"."safety_round_items"
  FOR UPDATE
  TO "authenticated"
  USING ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)))
  WITH CHECK ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_participants_delete" ON "public"."safety_round_participants"
  FOR DELETE
  TO "authenticated"
  USING ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_participants_insert" ON "public"."safety_round_participants"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_participants_select" ON "public"."safety_round_participants"
  FOR SELECT
  TO "authenticated"
  USING ((public.has_permission('safety.round.read'::text) OR public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_round_participants_update" ON "public"."safety_round_participants"
  FOR UPDATE
  TO "authenticated"
  USING ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)))
  WITH CHECK ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_photos_delete" ON "public"."safety_round_photos"
  FOR DELETE
  TO "authenticated"
  USING ((public.has_permission('safety.round.write'::text) AND public.safety_round_is_draft(round_id)));

CREATE POLICY "safety_round_photos_select" ON "public"."safety_round_photos"
  FOR SELECT
  TO "authenticated"
  USING ((public.has_permission('safety.round.read'::text) OR public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_rounds_delete" ON "public"."safety_rounds"
  FOR DELETE
  TO "authenticated"
  USING (((status = 'draft'::text) AND public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_rounds_select" ON "public"."safety_rounds"
  FOR SELECT
  TO "authenticated"
  USING ((public.has_permission('safety.round.read'::text) OR public.has_permission('safety.round.write'::text)));

CREATE POLICY "safety_rounds_update" ON "public"."safety_rounds"
  FOR UPDATE
  TO "authenticated"
  USING (((status = 'draft'::text) AND public.has_permission('safety.round.write'::text)))
  WITH CHECK (public.has_permission('safety.round.write'::text));

CREATE POLICY "tasks_delete_creator_only" ON "public"."tasks"
  FOR DELETE
  TO PUBLIC
  USING ((auth.uid() = created_by));

CREATE POLICY "tasks_insert_self_creator" ON "public"."tasks"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((created_by = auth.uid()));

CREATE POLICY "tasks_select_assigned_or_created" ON "public"."tasks"
  FOR SELECT
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR (auth.uid() = created_by)));

CREATE POLICY "tasks_update_assigned_or_created" ON "public"."tasks"
  FOR UPDATE
  TO PUBLIC
  USING (((auth.uid() = assigned_to) OR (auth.uid() = created_by)))
  WITH CHECK (((auth.uid() = assigned_to) OR (auth.uid() = created_by)));

CREATE POLICY "user_permissions_select_self" ON "public"."user_permissions"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."dashboard_notes";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."dashboard_work_items";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."notifications";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_activity_events";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_day_notes";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_depot_deliveries";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_depot_stock_counts";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_depots";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_expected_deliveries";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_job_types";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_segment_crew";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_segment_reports";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_segments";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_truck_crew";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_truck_default_crew";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_trucks";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."ops_work_order_confirmations";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_activity_events";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_day_notes";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_depot_deliveries";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_depot_usage";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_depots";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_job_type_colors";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_project_meta";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_segment_reports";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_segment_team_members";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_segments";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."planning_trucks";

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."tasks";

COMMENT ON COLUMN "public"."crm_calls"."quote_id" IS 'Offerten samtalet loggades från (CRM-offertmodalen). Null för samtal loggade utanför en offert.';

COMMENT ON COLUMN "public"."crm_customers"."account_manager_id" IS 'Kundansvarig säljare (FK profiles). Fristående från assigned_to (ägare/RLS-synlighet).';

COMMENT ON COLUMN "public"."dashboard_push_subscriptions"."origin" IS 'Browser-origin som prenumerationen skapades pa, t.ex. https://app.ekovilla.se. Stamplas av app/api/push/subscription/route.ts fran requestens host - INTE fran NEXT_PUBLIC_SITE_URL, som alltid pekar pa den kanoniska domanen. null = rad skapad innan kolumnen fanns.';

COMMENT ON COLUMN "public"."dashboard_work_items"."created_by" IS 'Vem som skapade raden. Skiljer sig från user_id när en uppgift delegerats (chef → säljare). RLS oförändrad — se huvudkommentaren i 20260817_dashboard_work_items_created_by.sql.';

COMMENT ON COLUMN "public"."info_section_images"."content_type" IS 'MIME-typen filen laddades upp med. Null på rader skrivna före 2026-08-21 och på de seedade - lasvagen faller da tillbaka pa filandelsen i sokvagen.';

COMMENT ON COLUMN "public"."ops_segments"."field_visible" IS 'Platshållare: syns i entreprenadens feed (/mina-jobb + startsidans veckoschema) för bilens besättning. Läses bara på rader utan work_order_id.';

COMMENT ON COLUMN "public"."ops_segments"."work_description" IS 'Platshållare: vad som ska göras, skrivet av planeraren och läst av besättningen i fält.';

COMMENT ON COLUMN "public"."planning_project_meta"."actual_bags_set_at" IS 'Timestamp when actual bags value was set';

COMMENT ON COLUMN "public"."planning_project_meta"."actual_bags_set_by" IS 'User who set the actual bags value';

COMMENT ON COLUMN "public"."planning_project_meta"."actual_bags_used" IS 'Reported total number of bags actually used (egenkontroll)';

COMMENT ON COLUMN "public"."planning_project_meta"."client_notified" IS 'Whether the customer has been notified (planner mail / phone)';

COMMENT ON COLUMN "public"."planning_project_meta"."client_notified_at" IS 'Timestamp when customer notification was marked';

COMMENT ON COLUMN "public"."planning_project_meta"."client_notified_by" IS 'Name or identifier of user who marked notification';

COMMENT ON COLUMN "public"."planning_project_meta"."delivery_sent" IS 'Whether outgoing delivery (jobType Leverans) has been marked as sent';

COMMENT ON COLUMN "public"."planning_project_meta"."delivery_sent_at" IS 'Timestamp when delivery was marked as sent';

COMMENT ON COLUMN "public"."planning_project_meta"."delivery_sent_by" IS 'User who marked delivery as sent';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_delivery_status" IS 'Latest Twilio delivery status for the latest SMS notification';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_last_error" IS 'Latest Twilio error code or message for the latest SMS notification';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_notified" IS 'Whether an SMS notification was accepted by Twilio';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_notified_at" IS 'Timestamp when the latest SMS notification was accepted';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_notified_by" IS 'User who triggered the latest SMS notification';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_provider_message_id" IS 'Twilio MessageSid for the latest SMS notification';

COMMENT ON COLUMN "public"."planning_project_meta"."sms_recipient_phone" IS 'Recipient phone number used for the latest SMS notification';

COMMENT ON COLUMN "public"."profiles"."blikk_id" IS 'External Blikk user id for syncing time reports and tasks';

COMMENT ON COLUMN "public"."profiles"."tags" IS 'Free-form tags (e.g., crew) for filtering and assignment UI';

COMMENT ON EXTENSION "hypopg" IS 'Hypothetical indexes for PostgreSQL';

COMMENT ON EXTENSION "index_advisor" IS 'Query index advisor';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';

COMMENT ON TABLE "public"."blikk_activities" IS 'Cached Blikk activities for fast UI access. Refreshed periodically.';

COMMENT ON TABLE "public"."blikk_timecodes" IS 'Cached Blikk timecodes for fast UI access. Refreshed periodically.';

COMMENT ON TABLE "public"."korjournal_trips" IS 'lagring av körjournaler';

COMMENT ON TABLE "public"."planning_activity_events" IS 'Audit/activity log for planning changes';

COMMENT ON TABLE "public"."planning_depot_deliveries" IS 'Planned deliveries to depots (material, amount, date).';

REVOKE ALL ON FUNCTION "public"."_material_order_create_expected"(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."_material_order_create_expected"(uuid, jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."_material_order_lines_valid"(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."_material_order_lines_valid"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."add_safety_round_photo"(uuid, uuid, text, text, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."add_safety_round_photo"(uuid, uuid, text, text, integer, integer) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."apply_due_deliveries"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."apply_due_deliveries"() TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."assign_offert_number"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."claim_material_order_send"(uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."claim_material_order_send"(uuid, integer, integer) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."current_actor"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."effective_permissions"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."effective_permissions"() TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_time_entry_owner"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_time_period_lock"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_material_order"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."finalize_material_order"(uuid, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_my_crm_jobs"(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_my_crm_jobs"(date, date) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."get_my_jobs"(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_my_jobs"(date, date) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."has_permission"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."has_permission"(text) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_app_ticket_admin"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_fault_report_recipient"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_konsult_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_readonly_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_time_locked"(uuid, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_time_locked"(uuid, date) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_user_on_segment"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_user_on_segment"(uuid, uuid) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_user_on_segment_between"(uuid, uuid, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_user_on_segment_between"(uuid, uuid, date, date) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_user_on_work_order"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_user_on_work_order"(uuid, uuid) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."json_diff"(jsonb, jsonb) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."log_planning_activity"(text, text, text, text, uuid, jsonb) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."log_time_entry_change"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."ops_expected_deliveries_forward_only"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."ops_material_orders_guard"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."ops_material_orders_insert_guard"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."planning_supply_terms"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."planning_supply_terms"() TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."receive_expected_delivery"(uuid, date, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."receive_expected_delivery"(uuid, date, integer, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."release_material_order_send"(uuid, integer, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."release_material_order_send"(uuid, integer, text, text) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_material_order_send"(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."resolve_material_order_send"(uuid, boolean) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safety_round_actions_before_update"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."safety_round_is_draft"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."safety_round_is_draft"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."safety_round_order_header"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."safety_round_order_header"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."safety_round_order_lookup"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."safety_round_order_lookup"(text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."safety_rounds_before_update"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_crm_customers_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_crm_opportunities_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_crm_time_entry_hours"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_employee_sensitive_details_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_role_permission"(public.user_role, text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_role_permission"(public.user_role, text, boolean) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_time_period_status"(uuid, date, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_time_period_status"(uuid, date, text, text) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_ai_prospect_suggestions"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_goals"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_prospects"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_quotes"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_work_order_stages"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_work_order_time_entries"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_crm_work_orders"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_offert_calculations"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_ops_segments"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_planning_meta"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_planning_segment_reports"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_planning_segments"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_tasks"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_timestamp_time_reference"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at_timestamp"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_user_permission"(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_user_permission"(uuid, text, text) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_user_role"(uuid, public.user_role) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_user_role"(uuid, public.user_role) TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."set_user_tags"(uuid, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_user_tags"(uuid, text[]) TO "anon", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."start_safety_round"(uuid, date, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."start_safety_round"(uuid, date, text, text, text) TO "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_truck_team_names"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."time_approval_overview"(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."time_approval_overview"(date) TO "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."trg_planning_assignments_log"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."trg_planning_meta_log"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."trg_planning_segments_log"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."addresses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_changelog_entries" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_tickets" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."blikk_activities" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."blikk_timecodes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contact_categories" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."contacts" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_absence_types" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_ai_prospect_suggestions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_calc_settings" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_calls" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_customer_contacts" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_customers" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_goals" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_internal_projects" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_material_cost_articles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_productivity_rates" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_quotes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_routing_rules" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_approvals" TO "anon";

REVOKE ALL ON TABLE "public"."crm_time_approvals" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."crm_time_approvals" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_approvals" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_codes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_compensations" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_entries" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."crm_time_entry_audit" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."crm_time_entry_audit" TO "anon";

REVOKE ALL ON TABLE "public"."crm_time_entry_audit" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."crm_time_entry_audit" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_time_entry_audit" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_order_comments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_order_files" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_order_invoices" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."crm_work_order_kma_plans" FROM "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."crm_work_order_kma_plans" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_order_kma_plans" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."crm_work_order_progress_reports"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_order_stages" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."crm_work_orders" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."dashboard_notes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."dashboard_push_subscriptions"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."dashboard_work_items" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."document_publication_receipts"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."document_publication_recipients"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_publications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."documents_files" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."documents_folders" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employee_profile_details" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employee_sensitive_details" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fault_report_recipients" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fault_report_updates" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fault_reports" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fortnox_article_favorites" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."fortnox_article_work_description_defaults"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fortnox_articles_cache" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fortnox_integrations" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."info_groups" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."info_section_images" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."info_sections" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."korjournal_trips" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."material_quality_samples" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."news_items" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."offert_calculations" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."offert_customer_requests" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."offert_customer_responses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."offert_number_counters" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_activity_events" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_day_notes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_depot_deliveries" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ops_depot_stock_counts" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."ops_depot_stock_counts" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_depot_stock_counts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_depots" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_expected_deliveries" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_job_types" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_material_orders" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_material_suppliers" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_segment_crew" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_segment_reports" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_segments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_truck_crew" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_truck_default_crew" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ops_trucks" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."ops_work_order_confirmations"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."permissions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_activity_events" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_day_notes" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_depot_deliveries" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_depot_usage" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_depots" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_job_type_colors" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_project_meta" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_segment_reports" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."planning_segment_team_members"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_segments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_truck_assignments" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."planning_trucks" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."role_permissions" TO "anon", "authenticated", "postgres", "service_role";

REVOKE ALL ON TABLE "public"."safety_checklist_categories" FROM "authenticated";

GRANT SELECT ON TABLE "public"."safety_checklist_categories" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_checklist_categories" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."safety_checklist_items" FROM "authenticated";

GRANT SELECT ON TABLE "public"."safety_checklist_items" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_checklist_items" TO "postgres", "service_role";

REVOKE ALL ("action") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("action") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("cost_note") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("cost_note") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("due_on") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("due_on") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("effect") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("effect") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("finding") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("finding") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("followed_up_on") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("followed_up_on") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("item_id") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("item_id") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("position") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("position") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("responsible_name") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("responsible_name") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("risk") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("risk") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."safety_round_actions" TO "authenticated";

REVOKE ALL ON TABLE "public"."safety_round_actions" FROM "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."safety_round_actions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_round_actions" TO "postgres", "service_role";

REVOKE ALL ("comment") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("comment") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ("description") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("description") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ("fixed_on_site") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("fixed_on_site") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ("risk") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("risk") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ("to_action_plan") ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT UPDATE ("to_action_plan") ON TABLE "public"."safety_round_items" TO "authenticated";

REVOKE ALL ON TABLE "public"."safety_round_items" FROM "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."safety_round_items" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_round_items" TO "postgres", "service_role";

REVOKE ALL ("comment") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("comment") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ("company") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("company") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ("initials") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("initials") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("name") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ("present") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("present") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ("role") ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT UPDATE ("role") ON TABLE "public"."safety_round_participants" TO "authenticated";

REVOKE ALL ON TABLE "public"."safety_round_participants" FROM "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."safety_round_participants" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_round_participants" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."safety_round_photos" FROM "authenticated";

GRANT DELETE, SELECT ON TABLE "public"."safety_round_photos" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_round_photos" TO "postgres", "service_role";

REVOKE ALL ("client_label") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("client_label") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("contract_step") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("contract_step") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("employer") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("employer") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("held_at") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("held_at") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("held_on") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("held_on") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("leader_id") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("leader_id") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("leader_name") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("leader_name") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("next_round_due") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("next_round_due") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("object_label") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("object_label") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("previous_followed_up") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("previous_followed_up") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("safety_rep_name") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("safety_rep_name") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("site_address") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("site_address") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("status") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("status") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("weather") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("weather") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ("work_type") ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT UPDATE ("work_type") ON TABLE "public"."safety_rounds" TO "authenticated";

REVOKE ALL ON TABLE "public"."safety_rounds" FROM "authenticated";

GRANT DELETE, SELECT ON TABLE "public"."safety_rounds" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."safety_rounds" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tasks" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_permissions" TO "anon", "authenticated", "postgres", "service_role";

GRANT USAGE ON TYPE "public"."user_role" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON TABLE "public"."current_user_dashboard_notes"
  TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."current_user_role" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_my_jobs_v" TO "anon", "authenticated", "postgres", "service_role";

-- ⚠️ Medvetet borttaget ur baslinjen: prods pg_cron-jobb 'scheduler_run-due-delivers'.
--
-- Pull:en fick med det som
--   cron.schedule_in_database('scheduler_run-due-delivers', '0 6 * * *',
--     net.http_post(url := 'https://<prod-ref>.supabase.co/functions/v1/run-due-deliveries', ...))
-- alltså ett dagligt anrop 06:00 UTC till PRODS Edge Function run-due-deliveries (gamla
-- /plannering:s depåleveranser, jfr apply_due_deliveries). Adressen är prods. Hade jobbet följt med
-- hade varje lokal databas och testdatabasen anropat prod varje morgon.
--
-- Jobbet lever bara i prod och rörs inte av den här filen — baslinjen körs aldrig mot prod, den
-- markeras bara som körd. En diff mot prod visar därför alltid jobbet som en skillnad; det är väntat.
-- Edge Function-koden finns inte i repot.

