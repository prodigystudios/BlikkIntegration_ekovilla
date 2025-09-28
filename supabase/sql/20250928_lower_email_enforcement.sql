-- Enforce lowercase emails in auth.users (client-level + optional backfill)
-- Date: 2025-09-28
-- NOTE:
--   Supabase projects do NOT grant ownership of auth.users to the postgres role you use in the SQL editor.
--   Therefore creating indexes / triggers directly on auth.users will fail with "must be owner of table users".
--   We already lowercase emails in the UI before calling auth.signUp / signIn.
--   This file now only provides a one-time BACKFILL query for existing rows plus optional verification.
--   If you absolutely need enforced lowercasing, implement it at the application edge (Edge Function) or
--   a cron job using the service key calling the Admin API to normalize periodically.

-- (Run once; requires sufficient privileges. If this errors, perform normalization via Admin API from server code.)
UPDATE auth.users SET email = lower(email) WHERE email <> lower(email);

-- REMOVED: Creating an index on auth.users requires table ownership (not granted). Rely on existing unique index on email.
-- Existing unique constraint already prevents duplicate exact-case emails. Client normalization avoids case variants.

-- REMOVED: Trigger creation not possible without ownership. Handled in application layer.

-- OPTIONAL: Identify any remaining mixed-case emails after deploying front-end normalization:
--   SELECT email FROM auth.users WHERE email ~ '[A-Z]' LIMIT 20;
-- OPTIONAL: Example server-side (Node) admin script snippet (not stored in DB):
--   const { createClient } = require('@supabase/supabase-js');
--   const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
--   const { data: users } = await supabase.auth.admin.listUsers();
--   for (const u of users.users) {
--     const lower = u.email.toLowerCase();
--     if (u.email !== lower) await supabase.auth.admin.updateUserById(u.id, { email: lower });
--   }
