-- Documents / Folder colors
-- Date: 2026-02-26

alter table public.documents_folders
  add column if not exists color text;

-- Allow only a small predefined palette (or NULL)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_folders_color_chk'
  ) then
    alter table public.documents_folders
      add constraint documents_folders_color_chk
      check (color is null or color in ('gray','blue','green','yellow','red','purple'));
  end if;
end $$;
