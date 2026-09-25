-- Documents / Search performance
-- Date: 2026-02-26

-- Speeds up ILIKE / contains search on documents_files.file_name
create extension if not exists pg_trgm;

create index if not exists documents_files_file_name_trgm_idx
  on public.documents_files
  using gin (file_name gin_trgm_ops);
