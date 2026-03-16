-- Add phone number to user profiles (for admin-managed seller contact info)

alter table public.profiles
  add column if not exists phone text;
