# Profiles — bygg om, sluta bygga runt

**Status:** förslag, inget beslutat. Skriven 2026-08-26.
**Föregås av:** `feature/profiles-name-resolution` (lappar de tre akuta hålen, löser inget).

---

## Problemet i en mening

`profiles` har en enda SELECT-policy — `profiles_select_self`, `USING (auth.uid() = id)` — så ingen
kan läsa någon annans namn, och varje yta som behöver ett kollegnamn har byggt sin egen väg runt.

Det är inte ett integritetsbeslut. Kommentaren i
[auth_roles_setup.sql:69](supabase/sql/auth_roles_setup.sql#L69) säger det rakt ut:

> *Replaced recursive select policy (caused infinite recursion) with simple self-only select.*

Den gamla `profiles_select_self_or_admin` slog upp rollen i `profiles` inifrån sin egen policy →
oändlig rekursion. Självläs var det snabba stoppet. Sedan dess har varje ny yta betalat räkningen.

**Verktyget som bryter rekursionen finns numera i repot.** `has_permission()` är `security definer`
och läser `profiles` ([20260608_permissions_model.sql:97](supabase/sql/20260608_permissions_model.sql#L97))
utan att utlösa RLS på den — precis det som gjorde den gamla policyn omöjlig. Samma mönster finns i
`is_user_on_work_order` och `time_approval_overview`. Vi har alltså redan lösningen på det problem
som orsakade självläs-policyn; vi har bara aldrig gått tillbaka och rivit den.

---

## Vad det kostar idag (mätt 2026-08-26)

| Form | Antal | Kommentar |
| --- | --- | --- |
| Service-role-elevering för att läsa namn/roll | **17 filer** | Varje elevering är en yta att hålla smal — en säkerhetsförsämring, inte bara skuld |
| PostgREST-joins som tyst ger `null` för andras rader | **5 selects** | `author:profiles`, `user:profiles`, `assignee:profiles`, goals, time-audit |
| Klientsidiga namnkartor som kompenserar joinen | **5 komponenter** | `WorkOrdersClient`, `WorkOrderDetailClient`, `QuotesClient`, `PlanningClient`, nu även `useWorkOrderActivity` |
| RPC i stället för vy | **1** | `time_approval_overview` — motiverad ändå, se "rörs inte" |
| Denormaliserade namnkolumner | **9 tabeller** | ⛔ **Ska stå kvar.** Se "rörs inte" |

Tre av joinarna renderade fel i drift ända fram till i går: kollegans kommentar visade ordet
"Kommentar", kollegans tidrad "Medarbetare". Det är felklassen — den syns inte som ett fel, den
syns som ett tomt namn, och därför har den fått leva i månader.

---

## ⚠️ Det blockerande beslutet: vem är "anställd"?

Innan något öppnas måste den här frågan ha ett svar, för hela planen vilar på den.

🧨 **`/auth/create-account` är öppen självregistrering.**
[app/auth/create-account/page.tsx:28](app/auth/create-account/page.tsx#L28) anropar
`supabase.auth.signUp` utan inbjudningskod, utan domänspärr, utan godkännande. Kommentaren i filen
säger *"not linked in main navigation"* — alltså skydd genom att länken är hemlig. Kontot som
skapas får `role = 'member'`, exakt samma roll som en installatör.

Följden: **`authenticated` betyder inte "anställd"**, och `member` går inte att skilja från en
främling. En policy av formen `for select to authenticated using (true)` skulle därför inte öppna
katalogen för personalen — den skulle öppna den för vem som helst som hittar URL:en.

⚠️ **Och det är inte hypotetiskt i morgon — det är sant i dag.**
`/api/crm/work-orders/mention-users` gatas bara av `requireSignedInUser`
([mention-users/route.ts:11](app/api/crm/work-orders/mention-users/route.ts#L11)) och svarar med
hela personallistan. Ett självregistrerat konto når den redan nu. Det är en befintlig exponering,
oberoende av den här planen.

**Att verifiera först (kan inte läsas ur koden):** är registrering påslagen i Supabase?
Dashboard → Authentication → Sign In / Providers → *Allow new users to sign up*. Är den AV är hålet
teoretiskt och beslutet enklare; är den PÅ är det öppet nu.

**Tre vägar, i den ordning jag rekommenderar dem:**

1. **Stäng självregistreringen.** Konton skapas redan av admin
   ([app/api/admin/users/route.ts:65](app/api/admin/users/route.ts#L65) kör
   `auth.admin.createUser`), så vägen finns och används. Då betyder `member` åter "anställd", och
   katalogen kan gatas på inloggning. Minst kod, störst effekt.
2. **En `is_active_employee`-flagga på `profiles`** som admin sätter, och som katalogpolicyn läser.
   Fungerar även med öppen registrering, men lägger till ett fält någon måste komma ihåg att sätta —
   och glöms det ser det ut som att appen är trasig för en ny kollega.
3. **En egen permission-nyckel** (`directory.read`) seedad på member/sales/admin/konsult. ⛔ Löser
   ingenting så länge självregistrering ger `member`: nyckeln följer rollen, och rollen är samma.

⛔ **Öppna inte katalogen förrän 1 eller 2 är på plats.** Annars byter vi en trasig yta mot ett
läckage, och det är en sämre affär än dagens eleveringar.

---

## Två designer — och varför jag rekommenderar den andra

### Design A — en smal katalogvy

`create view public.employee_directory as select id, full_name, role from public.profiles`,
läsbar för anställda, `profiles` orörd.

* ✅ Minimal yta, exponerar exakt tre kolumner.
* ❌ **Varje join måste skrivas om** från `author:profiles(...)` till `author:employee_directory(...)`.
* ❌ **Vilar på att PostgREST kan bädda in en vy.** Det stöds i teorin (PostgREST spårar vykolumner
  till bastabellen), men det är inte verifierat mot vår Supabase-version. Håller det inte finns
  ingen väg tillbaka till joinarna — då sitter vi kvar med namnkartorna, alltså precis det vi
  försöker bli av med.
* ❌ Vyn ärver inte RLS från `profiles`; den blir en andra säkerhetsgräns att hålla reda på, och
  Supabases egen linter flaggar `security definer`-vyer.

### Design B — återställ premissen ✅ REKOMMENDERAS

Flytta de privata kolumnerna av `profiles` till `employee_profile_details` (som **redan finns**,
redan är self-read-only och redan har en självbetjäningsyta). Kvar på `profiles` blir bara
katalogdata. Då kan en additiv SELECT-policy öppna tabellen — **och varje befintlig join börjar
fungera utan att en enda select-sträng rörs.**

* ✅ De fem joinarna börjar leverera namn **med noll kodändring**. Det är hela poängen med din fråga.
* ✅ Eleveringarna kan tas bort **en yta i taget**, i egen takt, var och en revertbar för sig.
* ✅ **Repot har redan gjort exakt den här migreringen en gång.**
  [20260517_employee_sensitive_details.sql](supabase/sql/20260517_employee_sensitive_details.sql)
  flyttade personnummer och bankuppgifter ur `employee_profile_details` till en låst tabell,
  backfillade och droppade kolumnerna. Vi kopierar en beprövad form, hittar inte på en ny.
* ✅ Sammanfogningen finns redan i kod: `mergeEmployeeProfile`, `PROFILE_SELECT`,
  `PROFILE_DETAILS_SELECT` i [lib/profileDetails.ts](lib/profileDetails.ts). Trelagersmodellen är
  etablerad — vi lägger inte till ett lager, vi flyttar sju kolumner till rätt lager.
* ⚠️ Priset: `profiles` blir läsbar för anställda, så **allt som läggs på den framöver är publikt
  internt**. Det måste vaktas, inte bara kommenteras — se riskerna.

**Varför B trots att A är "smalare":** A skyddar kolumner genom att lägga en vy framför dem. B
skyddar dem genom att flytta dem dit de hör hemma. A lämnar en tabell där känsligt och okänsligt
ligger blandat och en vy som måste komma ihåg att inte visa fel del; B gör kolumnens plats till
svaret på frågan "vem får se det här". Den andra är enklare att inte ha sönder om ett år.

---

## Kolumnbeslutet — vad katalogen bär

Tre grupper. Den mellersta är ditt beslut.

**Stannar på `profiles` (katalogdata, alla anställda får se):**
`id`, `role`, `full_name`, `created_at`, `tags`, `blikk_id`

`tags` är driftetiketter (t.ex. `crew`), inte personuppgifter, och
[documents/publications/_lib.ts:77](app/api/documents/publications/_lib.ts#L77) läser dem eleverat
i dag — de bör med. `blikk_id` är ett internt integrations-id.

**⚠️ Öppet beslut: `phone`.**
Argument för att den stannar: appen visar den redan för kollegor
([CrmSettingsView.tsx:114](app/crm/installningar/CrmSettingsView.tsx#L114) listar teamets
telefoner), och [planning/notify-customer:198](app/api/planning/notify-customer/route.ts#L198)
skickar säljarens nummer vidare till kunden. Den behandlas alltså redan som ett arbetsnummer.
Argument emot: den är **självredigerad** (`SELF_EDITABLE_PROFILE_FIELDS` i
[lib/profileDetails.ts:43](lib/profileDetails.ts#L43)), så det som står där kan lika gärna vara
någons privata mobil. **Min rekommendation: låt den stanna** — annars måste `notify-customer` och
CRM-inställningarna behålla sin elevering, och två av vinsterna uteblir. Men det är din bedömning
av vad numret faktiskt är.

**Flyttar till `employee_profile_details` (privat, bara jag själv och admin):**
`private_email`, `address_line1`, `postal_code`, `city`, `emergency_contact_name`,
`emergency_contact_phone`, `clothing_size`

🧨 Hemadress och anhörigkontakt är den verkliga anledningen till att den breda policyn är utesluten
i dag. De läses och skrivs av **exakt två ytor** — självbetjäningen
([app/profil/ProfilePageClient.tsx](app/profil/ProfilePageClient.tsx) via
[app/api/profile/route.ts](app/api/profile/route.ts)) och adminredigeraren
([AdminUserProfileEditor.tsx](app/admin/users/[id]/AdminUserProfileEditor.tsx)) — vilket är hela
skälet till att flytten är billig.

---

## Migreringen — sex steg, var och en en egen PR

Ingen av dem är stor. Poängen med uppdelningen är att varje steg går att slå av för sig.

### Steg 0 — verifiera och besluta *(ingen kod)*
Kolla registreringsinställningen i Supabase. Ta beslutet om `phone`. Ta beslutet om vem som är
anställd. Utan dem är resten gissningar.

### Steg 1 — SQL, **additiv**: gör plats
`20260901_employee_private_fields.sql` — lägg de sju kolumnerna på `employee_profile_details` och
backfilla ur `profiles`. Ingenting läser dem ännu, ingenting går sönder, ordningen är fri.

### Steg 2 — kod: byt läs- och skrivväg
`lib/profileDetails.ts` flyttar de sju fälten från `PROFILE_SELECT` till `PROFILE_DETAILS_SELECT`;
`app/api/profile/route.ts` och `app/api/admin/users/[id]/route.ts` skriver till den nya platsen.
`mergeEmployeeProfile` gör att **klientkomponenterna inte behöver röras alls** — de ser samma
sammanslagna objekt som förut. Deploya. Kolumnerna på `profiles` är nu döda men kvar.

### Steg 3 — SQL, **icke-additiv**: droppa de gamla kolumnerna
⚠️ **KODEN FÖRST.** Det här är planens enda steg som inte är additivt — det får aldrig köras före
steg 2 är ute i drift. Läs [feedback_sql_migrations_must_be_additive]. Simulera mot riktig data två
gånger, och ta en dump av de sju kolumnerna innan de försvinner.

### Steg 4 — SQL, **additiv**: öppna katalogen
En andra SELECT-policy på `profiles` (den befintliga `profiles_select_self` rörs INTE — Postgres
OR-kombinerar permissiva policyer, så ingen tappar åtkomst). Predikatet kommer ur steg 0:s beslut.

🧨 **Rekursionsvakten:** predikatet får inte innehålla en subquery mot `profiles`. Antingen ett
kolumnvillkor (`is_active_employee`) eller ett anrop till en `security definer`-funktion som
`has_permission`. Det var precis den regeln den ursprungliga policyn bröt mot.

**Samma fil bär vakten:** en `verify`-fråga som listar kolumnerna på `profiles` och failar om de
inte är exakt den beslutade mängden — plus ett Vitest som läser migreringsfilen och jämför, samma
grepp som redan används för `ops_segment_reports_construction_chk`. Utan den vakten är det bara en
tidsfråga innan någon lägger ett personnummer på `profiles` igen.

**Här slutar det obligatoriska.** Efter steg 4 fungerar de fem joinarna, och de tre trasiga ytorna
är lagade på riktigt i stället för lappade. Allt nedan är städning som kan tas när det passar.

### Steg 5..n — kod: riv en yta i taget
Varje rad nedan är en självständig liten PR. Ingen beror på en annan.

| Yta | Vad som försvinner |
| --- | --- |
| `listMentionableProfiles`, `listAssignableCrmUsers` | Eleveringen; rutterna kör sessionsklienten |
| `WorkOrderCommentsTab`, `WorkOrderTimeTab` | `namesById` — joinen bär namnet igen |
| `WorkOrdersClient`, `WorkOrderDetailClient`, `QuotesClient` | `assigneeNameById`-kartorna |
| `lib/domains/crm/reports.ts` | Adminklienten för säljarlistan |
| `lib/domains/crm/customers.ts` → `listCrmSellers` | Eleveringen |
| `lib/domains/support/recipients.ts` | Eleveringen (läser bara `role='admin'`) |
| `lib/domains/fortnox/helpers.ts:399` | Eleveringen (ett `full_name`) |
| `app/api/crm/tasks`, `.../comments` | Eleveringen för notisavsändarens namn |
| `app/api/planning/sales-directory` | **Hela rutten** — katalogen ersätter den |
| `app/api/offert-kalkylator`, `documents/publications/_lib` | Eleveringen |
| `app/crm/installningar` | Eleveringen (om `phone` stannar) |

---

## Vad som INTE rörs

* ⛔ **De denormaliserade namnkolumnerna.** `crm_work_order_files.created_by_name`,
  `ops_segment_crew.member_name`, `ops_segment_reports.created_by_name`, `app_changelog`,
  dagsanteckningarna m.fl. Där är det **frysta** namnet hela poängen: raden ska säga vem som skrev
  den *då*, även om personen slutat eller bytt namn. Planen gäller UPPSLAG, inte historik.
* ⛔ **Blikks tidrapportering** (`app/api/blikk/time-reports/**`). Spärr — bara på din uttryckliga
  instruktion.
* ⛔ **`app/plannering/**`** är skyddad yta under refaktorprogrammet. `sales-directory` är dess enda
  konsument; rutten tas bort först när planeringen ändå rörs, eller på ditt ord.
* ✅ **`employee_sensitive_details`** ligger redan rätt (personnummer, bank, `USING (false)`, bara
  adminklienten). Rörs inte.
* ✅ **`time_approval_overview`** förblir en RPC. Den är inte en workaround — dess urval *är*
  säkerhetsgränsen, med `has_permission('time.approve')` inuti. Rätt konstruktion, behåll den.

---

## Riskerna, rakt upp och ner

1. **`profiles` blir internt publik.** Den största. Mitigeras av kolumnvakten i steg 4 plus en
   kommentar på tabellen som säger var personuppgifter ska ligga. Utan vakten återkommer problemet.
2. **Öppen självregistrering.** Blockerande, se ovan. Löses den inte är hela planen på fel sida av
   en olåst dörr.
3. **Steg 3 är destruktivt.** Dumpa de sju kolumnerna först. Rullas steg 2 tillbaka efter steg 3 är
   fälten borta ur självbetjäningen tills en restore körs.
4. **Nya användare.** `handle_new_user` skapar redan raden i `employee_profile_details`
   ([20260517:96](supabase/sql/20260517_employee_sensitive_details.sql#L96)), så inget nytt behövs —
   men verifiera det i steg 1 i stället för att lita på den här meningen.
5. **`konsult` är extern.** Rollen får läsa CRM men är inte anställd. Ska en konsult se hela
   personallistan med telefonnummer? Antagligen ja (de arbetar i CRM och @-nämner folk), men ta
   ställningen medvetet i steg 0 — den följer inte automatiskt av något annat beslut.
6. **Bred ändring i behörighetsmodellen** → CLAUDE.md kräver att angreppssättet förklaras, riskerna
   namnges och migreringen simuleras mot riktig data två gånger. Den här filen är den förklaringen;
   simuleringen återstår.

---

## Så vet vi att det blev rätt

* `20260609_rls_permissions_verify.sql` och paritets-asserten körs om — inga rader får ändra sig.
* Kolumnvakten (steg 4) grön, och Vitest som läser migreringsfilen.
* Manuellt, med två inloggade användare: kollegans namn på en kommentar, en tidrad, en arbetsorders
  ansvarig, en @-lista — utan att någon rutt kör service-role.
* `grep -rn "getSupabaseAdmin" | grep profiles` ska krympa steg för steg. Den siffran är facit.

---

## Relaterat

`PERMISSIONS.md` (behörighetsmodellen, `has_permission`, besättningsåtkomsten som medvetet *inte*
är nyckelbaserad) · `SUPABASE_CONVENTIONS.md` · minnena `project_profiles_rls_rebuild`,
`project_rbac_permissions`, `feedback_sql_migrations_must_be_additive`.
