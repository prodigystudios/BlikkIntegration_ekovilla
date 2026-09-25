-- Offertkalkylator: store salesperson phone (admin-managed via profiles)

alter table public.offert_calculations
  add column if not exists salesperson_phone text not null default '';
