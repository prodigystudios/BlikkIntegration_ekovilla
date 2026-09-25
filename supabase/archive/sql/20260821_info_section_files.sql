-- PDF:er på /dokument-information.
--
-- Sidan kunde bara bära bilder: filväljaren i /admin släppte igenom image/*, och den publika
-- sidan renderade varje rad som en <img>. En pdf gick alltså varken att ladda upp eller läsa
-- där, och installatörerna fick gå någon annanstans för att hitta den. Raderna bär nu även
-- pdf, och sidan bäddar in dem.
--
-- ORDNINGEN: KÖR DEN HÄR FÖRE KODEN.
-- Migreringen är additiv (en nullbar kolumn, inget befintligt rörs), men läsvägen väljer
-- content_type i sin select. En select på en kolumn som inte finns svarar 42703 från PostgREST,
-- loadInfoPage kastar, och hela /dokument-information faller ned i sin felruta. Motsatt ordning
-- - migreringen först, koden efteråt - är helt ofarlig: kolumnen står bara tom.
--
-- Tabellen heter fortfarande info_section_images. Ett namnbyte hade tvingat med sig policyer,
-- index, främmande nycklar och varje referens i koden utan att ge något - kolumnen säger vad
-- raden faktiskt bär, och namnet på tabellen säger var den hör hemma.

alter table public.info_section_images
  add column if not exists content_type text;

comment on column public.info_section_images.content_type is
  'MIME-typen filen laddades upp med. Null på rader skrivna före 2026-08-21 och på de seedade - lasvagen faller da tillbaka pa filandelsen i sokvagen.';
