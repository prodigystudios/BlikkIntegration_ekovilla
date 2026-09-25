-- Tid & lön — kvitto och moms på utlägget.
--
-- VARFÖR: utlägg gick att rapportera men inte att styrka. Kontoret såg ett belopp, ett datum och en
-- fritextrad i attestunderlaget och hade ingen väg till kvittot alls — det låg i en telefon, i en
-- ficka, eller i en tråd någonstans. Bokföringen behöver dessutom momsen utbruten, och den fanns
-- ingenstans i modellen.
--
-- ⚠️ KOLUMNER PÅ POSTEN, INTE EN EGEN TABELL. Motsatt val mot crm_work_order_files, och med flit:
-- ett kvitto hör till exakt ETT utlägg och till exakt EN person, aldrig till ett jobb och aldrig
-- till flera poster. Det avgörande är periodlåset — crm_time_compensations bär redan
-- enforce_time_period_lock och `not is_time_locked(...)` i sina policyer, så ett kvitto som är en
-- kolumn på raden fryser med månaden helt av sig självt. En sidotabell hade behövt sin egen
-- låskontroll, och den hade kunnat glida isär från radens utan att någon märkte det förrän ett
-- attesterat underlag ändrades i efterhand.
--
-- Priset är att en post bär ett kvitto, inte flera. Två kvitton samma dag är två utlägg — vilket är
-- vad byrån vill ha ändå, eftersom varje belopp ska kunna härledas till sitt papper.
--
-- VARFÖR INGEN NY BUCKET, INGA STORAGE-POLICYER: samma linje som Documents/, Support/ och
-- Arbetsorder/. Den befintliga privata bucketen används med prefix per område, nu Kvitton/, och all
-- läsning sker via en kortlivad signerad URL som servern skapar med service-role EFTER att RLS på
-- den här tabellen gatat raden. Bucketnamnet sparas PER RAD, så en framtida bucketflytt inte gör
-- gamla rader olästbara.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN. Ändringen är helt additiv (nya nullbara kolumner,
-- inga ändringar på befintliga objekt eller policyer), men utan kolumnerna svarar PostgREST 400 på
-- varje sparning som skickar dem — och POST:en till /api/time/compensations skickar dem så fort
-- koden är ute, även för en post utan kvitto.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).

-- ---------------------------------------------------------------------------
-- Kolumner
-- ---------------------------------------------------------------------------

alter table public.crm_time_compensations
  -- Momsen på utlägget, i kronor. Egen kolumn och inte en sats: kvitton bär 25 %, 12 % och 6 % om
  -- vartannat (en lunch och en spik på samma kvitto är två satser), och den som räknar ur en enda
  -- procentsats gissar. Nullbar med flit — moms som inte är ifylld är inte moms som är noll, och
  -- skillnaden är hela poängen för den som bokför.
  add column if not exists vat_amount numeric(10, 2),

  -- Kvittot. Bucket + path är lagringens koordinater; name är det riktiga filnamnet (sökvägen är
  -- sanerad till ren ASCII och duger inte som visningsnamn).
  add column if not exists receipt_bucket text,
  add column if not exists receipt_path text,
  add column if not exists receipt_name text,
  add column if not exists receipt_content_type text,
  add column if not exists receipt_size_bytes bigint,
  add column if not exists receipt_uploaded_at timestamptz;

-- Momsen får inte vara negativ, och den får inte överstiga beloppet den är moms på. Det senare är
-- inte hårklyveri: ett felskrivet momsfält (250 i stället för 25) går rakt in i bokföringen och
-- syns aldrig i en summa som ändå ser rimlig ut.
--
-- Villkoret är NULL-tolerant i båda leden. En CHECK utvärderas till NULL — och släpper därmed
-- igenom — så fort ett led är null, men att skriva ut det gör avsikten läsbar för nästa person.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_time_compensations'::regclass
      and conname = 'crm_time_compensations_vat_amount_chk'
  ) then
    alter table public.crm_time_compensations
      add constraint crm_time_compensations_vat_amount_chk
      check (vat_amount is null or (vat_amount >= 0 and vat_amount <= amount));
  end if;
end $$;

-- Ett lagringsobjekt får bäras av EN post. Utan det här indexet kan samma uppladdade kvitto kopplas
-- till två utlägg, och då raderar den som tar bort den ena posten bilden under fötterna på den
-- andra. Partiellt: alla poster utan kvitto har null och ska inte krocka med varandra.
create unique index if not exists crm_time_compensations_receipt_path_key
  on public.crm_time_compensations (receipt_path)
  where receipt_path is not null;

-- Attestunderlaget frågar "vilka utlägg saknar kvitto i den här månaden". Utan index blir det en
-- seq scan per person och period.
create index if not exists crm_time_compensations_missing_receipt_idx
  on public.crm_time_compensations (user_id, entry_date)
  where kind = 'expense' and receipt_path is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Oförändrad, och det är avsiktligt. Kolumnerna ärver radens policyer: man ser sitt eget kvitto,
-- den med time.entry.read.all ser allas, och ändra/radera är ägarskopat. Periodlåset i
-- 20260812_time_approvals.sql gäller kolumnerna utan ett ord tillagt — vilket var hela skälet till
-- att kvittot blev en kolumn och inte en sidotabell.
--
-- Ingen grant behövs heller: select/insert/update/delete på tabellen gavs till authenticated i
-- 20260811_time_compensations.sql och gäller nya kolumner automatiskt (kolumn-grants finns inte i
-- spel här).

-- ---------------------------------------------------------------------------
-- Verifiering
-- ---------------------------------------------------------------------------
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'crm_time_compensations'
--     and column_name in ('vat_amount','receipt_bucket','receipt_path','receipt_name',
--                         'receipt_content_type','receipt_size_bytes','receipt_uploaded_at')
--   order by column_name;
--
-- Momsvillkoret ska avvisa en moms som är större än beloppet:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.crm_time_compensations'::regclass and contype = 'c';
--
-- Utlägg utan kvitto, innevarande månad (samma fråga attesten ställer):
--   select user_id, entry_date, amount from public.crm_time_compensations
--   where kind = 'expense' and receipt_path is null
--     and entry_date >= date_trunc('month', current_date)::date
--   order by entry_date;
