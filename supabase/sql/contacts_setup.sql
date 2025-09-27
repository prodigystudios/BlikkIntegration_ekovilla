-- Contacts / Phone list structured schema & migration (Step A)
-- Run this in the Supabase SQL editor (ONE time). Safe to re-run: tables created IF NOT EXISTS, policies dropped/re-created.
-- Provides:
--   * contact_categories (grouping sections e.g. Entreprenad, Försäljning)
--   * contacts (persons with phone/location/role)
--   * addresses (depåer)
--   * RLS: all authenticated users can SELECT; only admins (profiles.role='admin') can INSERT/UPDATE/DELETE
--   * One-off migration of existing JSON (embedded) -> tables (skips if already migrated)
--
-- After success you can phase out usage of public/data/PhoneList.json and build CRUD UI (Step B/C).

-- 0. Prereqs (UUID / crypto helpers)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Tables
CREATE TABLE IF NOT EXISTS public.contact_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.contact_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  location text,
  role text,
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  address text NOT NULL,
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS contacts_category_idx ON public.contacts(category_id);
CREATE INDEX IF NOT EXISTS contacts_name_trgm ON public.contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS addresses_name_trgm ON public.addresses USING gin (name gin_trgm_ops);

-- 2. Enable RLS
ALTER TABLE public.contact_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies (idempotent) & recreate
DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'cat_select_all'; IF FOUND THEN DROP POLICY "cat_select_all" ON public.contact_categories; END IF;
  PERFORM 1 FROM pg_policies WHERE policyname = 'cat_admin_write'; IF FOUND THEN DROP POLICY "cat_admin_write" ON public.contact_categories; END IF;
  PERFORM 1 FROM pg_policies WHERE policyname = 'contacts_select_all'; IF FOUND THEN DROP POLICY "contacts_select_all" ON public.contacts; END IF;
  PERFORM 1 FROM pg_policies WHERE policyname = 'contacts_admin_write'; IF FOUND THEN DROP POLICY "contacts_admin_write" ON public.contacts; END IF;
  PERFORM 1 FROM pg_policies WHERE policyname = 'addr_select_all'; IF FOUND THEN DROP POLICY "addr_select_all" ON public.addresses; END IF;
  PERFORM 1 FROM pg_policies WHERE policyname = 'addr_admin_write'; IF FOUND THEN DROP POLICY "addr_admin_write" ON public.addresses; END IF;
END$$;

-- SELECT for any authenticated user
CREATE POLICY "cat_select_all" ON public.contact_categories FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "contacts_select_all" ON public.contacts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "addr_select_all" ON public.addresses FOR SELECT USING (auth.role() = 'authenticated');

-- Admin-only write (INSERT/UPDATE/DELETE)
CREATE POLICY "cat_admin_write" ON public.contact_categories
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "contacts_admin_write" ON public.contacts
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "addr_admin_write" ON public.addresses
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- 4. One-off migration from embedded JSON (skips if categories already exist)
DO $$
DECLARE
  already boolean;
  js jsonb;
  cat_name text;
  arr jsonb;
  elem jsonb;
  cat_id uuid;
  cat_sort int := 1;
  contact_sort int;
  addr_sort int := 1;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.contact_categories) INTO already;
  IF already THEN
    RAISE NOTICE 'Skipping JSON migration (categories already present)';
    RETURN;
  END IF;

  js := $JSON$
  {"Entreprenad":[{"name":"Ahmet Ogur","phone":"072-834 43 79","location":"Sandviken"},{"name":"Daniel Moreno","phone":"073-081 87 47","location":"Sandviken"},{"name":"Oskar Hedblad","phone":"072-218 94 99","location":"Sandviken"},{"name":"Jimmy Larsson","phone":"073-800 60 03","location":"Sandviken"},{"name":"Alexander Seger","phone":"070-494 09 49","location":"Sandviken"},{"name":"William Ali","phone":"072-902 21 98","location":"Södertälje"},{"name":"Joonas Ahonen","phone":"079-339 85 40","location":"Södertälje"},{"name":"Rasmus Adolfsson","phone":"070-588 80 35","location":"Borlänge"},{"name":"Martin Wikner","phone":"070-460 67 24","location":"Borlänge"},{"name":"Kent Sollien","phone":"070-398 60 87","location":"Motus-envy"},{"name":"Fredric Carlström-Stridh","phone":"070-410 93 94","location":"Motus-envy"}],"Försäljning":[{"name":"Klas Abrahamsson","phone":"070-813 60 69","location":"Gävleborg"},{"name":"Marcus Huld","phone":"070-813 60 64","location":"Stockholm"},{"name":"Michael Klingvall","phone":"070-813 61 15","location":"Stockholm"},{"name":"Tony Bejedal","phone":"070-518 93 01","location":"Södertälje"},{"name":"Johan Borres","phone":"070-290 06 05","location":"Borlänge"}],"Företagsledning":[{"name":"Andreas Östlund","role":"VD"},{"name":"Marcus Huld","phone":"070-813 60 64","role":"Operativ chef / Ledning"},{"name":"Johan Borres","phone":"070-290 06 05","role":"Säljare / Ledning"},{"name":"Patrik Vall","phone":"070-694 31 30","role":"Entreprenadchef / Ledning"}],"Adresser":[{"name":"Rosersberg","address":"västerbytorp 111, 195 96 Rosersberg"},{"name":"Södertälje","address":"Sydhamnsvägen 46, 15138 Södertälje"},{"name":"Borlänge","address":"Nygårdsvägen 31, 781 70 Borlänge"},{"name":"Sandviken(Sågen)","address":"Kärråsvägen 73, 811 91 Sandviken"},{"name":"Sandviken(kontor och lager)","address":"Spångvägen 9, 811 32 Sandviken"}]}
  $JSON$::jsonb;

  FOR cat_name, arr IN SELECT k, v FROM jsonb_each(js) AS t(k,v) LOOP
    IF cat_name = 'Adresser' THEN
      addr_sort := 1;
      FOR elem IN SELECT * FROM jsonb_array_elements(arr) LOOP
        INSERT INTO public.addresses(name, address, sort)
        VALUES (elem->>'name', elem->>'address', addr_sort);
        addr_sort := addr_sort + 1;
      END LOOP;
    ELSE
      INSERT INTO public.contact_categories(name, sort) VALUES (cat_name, cat_sort) RETURNING id INTO cat_id;
      contact_sort := 1;
      FOR elem IN SELECT * FROM jsonb_array_elements(arr) LOOP
        INSERT INTO public.contacts(category_id, name, phone, location, role, sort)
        VALUES (cat_id, elem->>'name', NULLIF(elem->>'phone',''), NULLIF(elem->>'location',''), NULLIF(elem->>'role',''), contact_sort);
        contact_sort := contact_sort + 1;
      END LOOP;
      cat_sort := cat_sort + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'JSON migration completed.';
END$$;

-- 5. Suggested rollback helper (ONLY if needed – will drop ALL data!)
-- DO $$ BEGIN
--   DROP TABLE IF EXISTS public.contacts CASCADE;
--   DROP TABLE IF EXISTS public.contact_categories CASCADE;
--   DROP TABLE IF EXISTS public.addresses CASCADE;
-- END $$;

-- Done.
