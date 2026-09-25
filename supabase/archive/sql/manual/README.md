# supabase/sql/manual

Script som körs **för hand**, aldrig av migreringskedjan.

Filerna här är inte idempotenta migreringar utan engångshändelser som är bundna till ett
tillfälle — typiskt städning som blir korrekt först när något annat har skett. Att köra dem
"för säkerhets skull" kan förstöra produktionsdata.

Varje fil ska ha ett huvud som säger:

- vad den gör,
- vilket villkor som måste vara uppfyllt innan den får köras,
- vad som går sönder om den körs för tidigt.

Kör alltid den räknande delen först och läs utfallet innan du kör en DELETE.
