-- Städar upprepade segment ur artikelbeskrivningarna som redan hämtats.
--
-- KÖRS EFTER 20260813_fortnox_article_notes.sql och efter att artikelsynken hämtat beskrivningarna.
--
-- PROBLEMET: beskrivningarna i Fortnox innehåller till stor del samma text flera gånger, separerad
-- med semikolon — troligen upprepade importer som lagt på texten i stället för att ersätta den.
-- Vid mätning 2026-08-13, direkt efter första synken: 177 av 227 ifyllda beskrivningar (78 %) hade
-- upprepade segment, och 19 843 tecken var ren dubblering. Artikel 10124 hade samma mening fyra
-- gånger, 435 tecken där 108 räckte.
--
-- VARFÖR HÄR OCH INTE VIA SYNKEN: koden dedupar numera vid skrivning (dedupeArticleNote), men de
-- rader som redan hämtats bär den odedupade texten och `note_synced_at` är satt — synken frågar
-- alltså inte om dem igen. Att nolla stämpeln och hämta om hade kostat ~289 API-anrop och några
-- minuter för något SQL gör på en sekund, på text vi redan har.
--
-- VI RÖR INTE FORTNOX. Beskrivningen är hjälptext för säljaren i offertformuläret. Att skriva om
-- 177 artiklar i det skarpa artikelregistret är en helt annan sorts åtgärd med andra konsekvenser
-- (allt annat som läser fältet påverkas) och kräver ett eget beslut.
--
-- IDEMPOTENT: andra körningen matchar noll rader, eftersom villkoret kräver att den städade texten
-- faktiskt skiljer sig från den lagrade.

update public.fortnox_articles_cache AS c
set note = sub.cleaned
from (
  select
    article_number,
    (
      -- Unika segment i den ordning de först dök upp. `with ordinality` bär positionen så
      -- ordningen bevaras — utan den blir resultatet godtyckligt sorterat.
      select string_agg(d.part, '; ' order by d.first_pos)
      from (
        select btrim(part) as part, min(ord) as first_pos
        from unnest(string_to_array(a.note, ';')) with ordinality as t(part, ord)
        where btrim(part) <> ''
        group by btrim(part)
      ) d
    ) as cleaned
  from public.fortnox_articles_cache a
  where a.note is not null and btrim(a.note) <> ''
) sub
where c.article_number = sub.article_number
  and sub.cleaned is not null
  and sub.cleaned <> c.note;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Inga beskrivningar ska ha upprepade segment kvar. Förväntat: 0 rader.
--
--      select article_number, note
--      from public.fortnox_articles_cache
--      where note is not null
--        and (select count(*) from unnest(string_to_array(note, ';')) p where btrim(p) <> '')
--          <> (select count(distinct btrim(p)) from unnest(string_to_array(note, ';')) p where btrim(p) <> '');
--
-- 2. Längderna ska ha kortats rejält. Förväntat efter städning: median kring 49 tecken.
--
--      select count(*) as med_beskrivning,
--             round(avg(length(note))) as snitt,
--             max(length(note)) as langsta
--      from public.fortnox_articles_cache
--      where note is not null and btrim(note) <> '';
--
-- 3. Stickprov mot en artikel som var illa däran.
--
--      select article_number, note from public.fortnox_articles_cache where article_number = '10124';
