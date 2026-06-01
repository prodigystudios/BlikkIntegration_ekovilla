# CRM Quote Stage Redesign Plan

Detta dokument beskriver hur offertsteget ska göras om innan vi fortsätter bredare mot Fortnox och installatörsflöden.

Målet är att göra offertgeneratorn tydlig, uppdelad efter verkligt användningsfall och förberedd för framtida kundsynk mot Fortnox utan att skapa fel kunddata för tidigt.

## Status just nu

Det här dokumentet beskriver inte längre bara målbilden. Följande delar är nu redan genomförda i kod och ska betraktas som nuvarande bas för nästa steg.

### Genomfört

- offertmodalen är uppdelad i separata sektioner i stället för att ligga i ett enda långt renderblock
- kundtyp styr nu verkligt formulärinnehåll för företag respektive privatkund
- företagsflödet använder organisationsnummer i kundsnapshot
- privatflödet kräver personnummer och ROT visas bara i privatflödet
- ROT, intern handoff och arbetsorderblocket är brutna till egna lokala komponenter
- offert­rader och ekonomi är en egen sektion med summeringskort och tydligare radstruktur
- kundkälla är införd som riktig modell för offerter via `customer_source`
- `customer_source` stöds i UI, API-validering, domänmodell och databas
- ny migration för `crm_quotes.customer_source` är skapad och körd
- Fortnox-riktning finns nu som reserverad modell i offertsteget utan att själva sökningen är byggd
- modalen har fått större bredd, ny header, mer spacing och bättre sektionering
- valideringssammanfattning finns i modalens footer och visar vad som saknas före sparning

### Påbörjat men inte färdigt

- modalen har förbättrats tydligt, men vissa sektioner behöver fortfarande bättre intern komposition och prioritering
- breakpoint-logiken är justerad så att sektioner stannar i full bredd längre, men fintrimning kan fortfarande behövas efter verklig användning
- Fortnox-platsen finns i modellen och UI:t, men fungerar ännu bara som reservation/placeholder

### Kvar att göra

- ren UX-polish av hela modalen så att informationshierarkin blir mer självklar i första ögonkastet
- bättre intern komposition i framför allt offertgrund, kundkort och offert­rader
- göra offert­radsdelen ännu mer arbetsyta och mindre klassiskt formulär
- lägga till tydligare visning av kundkälla även i offertlistan utanför modalen om det behövs
- bygga riktig Fortnox-sökning och koppling först när offertflödets interna struktur känns stabil
- definiera exakt när `organization_number` ska vara hårt obligatoriskt för företagskund, inte bara rekommenderat
- utvärdera om valideringssammanfattningen ska göras ännu mer handlingsorienterad med direktlänkar/fokus till saknade fält

## Varför offertsteget behöver göras om

Nuvarande offertmodal fungerar tekniskt men är för tung att arbeta i.

De största problemen just nu är:

- företag och privat ligger i samma långa formulär
- fel fält visas i fel sammanhang, till exempel personnummer i företagsflödet
- ROT ligger i samma struktur även när kundtypen är företag
- modalen är för tät och linjär, vilket gör den svår att skumma och svår att fylla i i rätt ordning
- kundinformation, offertinnehåll, handoff och arbetsorderunderlag ligger blandat i samma arbetsyta
- Fortnox-riktningen finns i huvudet men inte som tydlig produktregel i offertsteget

## Produktprinciper för nya offertsteget

Det nya offertsteget ska följa dessa principer:

- användaren ska först välja kundtyp: företag eller privat
- efter kundtyp ska bara relevanta fält visas
- företagsflödet ska aldrig visa ROT-fält
- företagsflödet ska använda organisationsnummer, inte personnummer som primär identitet
- privatflödet ska använda personnummer och kunna visa ROT när det är relevant
- offertskapandet ska delas upp i tydliga sektioner eller steg i stället för ett enda långt formulär
- arbetsorderrelevant handoff ska fortfarande kunna fyllas i i offertsteget, men separerat från kund- och offertgrunden
- Fortnox ska behandlas som kommande integrationsmål, inte som att hela offertflödet redan nu måste styras av Fortnox

## Målbild för informationsarkitektur

Offertgeneratorn ska struktureras i följande huvuddelar.

### 1. Kundtyp och kundkälla

Det användaren väljer först:

- kundtyp: företag eller privat
- kundkälla: befintligt prospekt, lokal offertkund eller senare Fortnox-sökning

Detta ska sätta resten av formulärets struktur.

Framtida plats för Fortnox ska finnas med i modellen redan nu:

- sök befintlig kund i Fortnox, när den integrationen byggs
- skapa ny kund i offertläget, men spara den bara lokalt i CRM tills offerten faktiskt går vidare till arbetsorder

## 2. Kundkort

Kundkortet ska vara olika för företag och privat.

### Företag

Företagsflödet ska innehålla:

- företagsnamn
- organisationsnummer
- kontaktperson
- e-post
- telefon
- besöksadress
- leveransadress
- fakturaadress

Det som inte ska visas i företagsflödet:

- personnummer som kundens huvudidentitet
- ROT-sektion
- ROT-sökande eller ROT-fastighetsuppgifter

### Privat

Privatflödet ska innehålla:

- kundnamn
- personnummer
- e-post
- telefon
- folkbokförings- eller kundadress
- besöksadress om annan
- leveransadress
- fakturaadress

ROT ska bara kunna visas i privatflödet.

## 3. Offertgrund

Detta block ska vara samma oavsett kundtyp:

- offertnamn eller projektnamn
- beskrivning eller omfattning
- offertdatum
- giltig till
- offertstatus
- uppföljningsdatum

Detta block ska ligga tidigt eftersom det beskriver själva affären, inte kunden.

## 4. Offertinnehåll

Rader och ekonomi ska vara en egen tydlig arbetsyta.

Den ska innehålla:

- artiklar eller rader
- mängdlogik
- prislogik
- rabatt
- delsumma, moms och total

Detta ska visuellt vara en separat sektion och inte uppfattas som ännu ett kundformulär.

## 5. ROT

ROT ska vara en separat sektion som bara existerar när:

- kundtyp är privat
- användaren aktivt väljer att ROT ska användas

ROT-sektionen ska då innehålla:

- namn på ROT-sökande
- personnummer för ROT-sökande
- fastighetsbeteckning
- ROT-procent

ROT ska inte bara vara disabled i företagsflödet. Sektionen ska inte renderas där alls.

## 6. Intern handoff

Det som senare ska vidare till arbetsorder ska ligga separat från själva kund- och offertdelen.

Den sektionen ska innehålla:

- önskat installationsdatum
- arbetets scope
- överlämningsnotering
- interna anteckningar som hör till leverans eller planering

Poängen är att säljaren ska förstå att detta är internt underlag, inte en del av kundofferten.

## Rekommenderad UI-struktur

Nuvarande modal ska göras om från ett långt formulär till en sektionerad arbetsyta.

Rekommenderad struktur:

- topp: kundtyp och kundkälla
- sektion 1: kunduppgifter
- sektion 2: offertgrund
- sektion 3: artiklar och ekonomi
- sektion 4: ROT, endast för privat
- sektion 5: intern handoff
- footer: valideringssammanfattning och spara

Två rimliga UI-varianter:

- tabbar eller segmenterad top-navigation i samma modal
- stegvis wizard med tydlig nästa-föregående-logik

Rekommendation just nu:

- behåll modalformatet
- dela upp innehållet i tydliga sektioner eller steg i samma modal
- gör kundtyp till första styrande val
- låt företag och privat få olika formulärdelar direkt efter valet

Detta är mindre riskfyllt än att bygga en helt ny fristående offertsida i första omtaget.

## Datamodell som behöver stödjas

Nuvarande modell med `quote_type`, `customer_snapshot`, `rot_details` och `internal_handoff` är rätt grund, men kundsnapshoten behöver bli tydligare.

Följande gäller nu i faktisk implementation:

- `organization_number` är redan infört i kundsnapshoten
- `customer_source` är infört på `crm_quotes` som JSON-modell för källa och framtida synkintention
- offertmodellen stödjer nu både lokal kund, prospekt och reserverad Fortnox-kund som olika lägen

Följande modellriktning ska gälla:

### Gemensamma kundfält

- email
- phone
- street_address
- postal_code
- city
- visit_address
- delivery_address
- invoice_address

### Företagsspecifika kundfält

- company_name
- organization_number
- contact_name

### Privatspecifika kundfält

- customer_name
- personal_number

### Viktig förändring

`organization_number` behöver införas som förstaklassfält i kundsnapshoten. Företag ska inte modelleras med samma identitetsfält som privatkund.

## Valideringsregler för nästa implementation

När detta byggs om ska valideringen styras tydligare av kundtyp.

Följande är redan aktivt i nuvarande implementation:

- privatkund kräver personnummer
- företagskund kan inte använda ROT
- prospekt som kundkälla kräver faktiskt valt prospekt
- Fortnox som kundkälla kräver reserverat Fortnox-kundnamn i nuvarande placeholderläge
- ROT kräver extra fält när ROT används

### Företag

Ska kräva:

- company_name
- organization_number när det finns krav på identifiering

Ska inte tillåta:

- ROT aktiverat

### Privat

Ska kräva:

- customer_name
- personal_number

Ska kräva ytterligare när ROT används:

- rot applicant
- rot personal number
- property designation

## Fortnox-riktning

Offertsteget måste förberedas för två framtida kundvägar mot Fortnox.

### 1. Söka befintlig kund i Fortnox

När Fortnox-integrationen byggs ska användaren kunna:

- söka kund i Fortnox från offertsteget
- välja en befintlig Fortnox-kund som källa
- fylla offert med kunduppgifter från den kunden

Detta ska vara ett separat kundkälla-val, inte en dold bakgrundssynk.

### 2. Skapa ny kund i offertsteget

Användaren ska senare kunna skapa en ny kund i offertläget, men kundens livscykel ska följa denna regel:

- kunden sparas lokalt i CRM medan offerten fortfarande bara är en offert
- kunden skickas inte till Fortnox direkt bara för att offerten skapades
- kunden sparas i Fortnox först när offerten faktiskt går vidare och blir arbetsorder

Detta är viktigt för att undvika att fylla Fortnox-registret med kunder som aldrig blir riktiga jobb.

## Rekommenderad teknisk riktning för nästa omtag

Detta bör byggas i följande ordning.

Status för stegen nedan:

- steg 1 är genomfört
- steg 2 är genomfört i första version
- steg 3 är genomfört
- steg 4 är genomfört i modell och grund-UI, men inte i faktisk Fortnox-integration
- steg 5 återstår

### Steg 1. Dela upp draft- och renderlogiken i företag och privat

- bryt ut kundsektionen från den stora modalen
- skapa separata renderblock eller komponenter för företagskund och privatkund
- låt `quote_type` styra vilka fält som överhuvudtaget finns i UI:t

### Steg 2. Separera modalen i tydliga sektioner

- kund
- offert
- rader och ekonomi
- ROT
- intern handoff

### Steg 3. Förbättra kundsnapshoten

- lägg till `organization_number`
- säkerställ att företags- och privatfält inte blandas ihop i sparlogiken

### Steg 4. Förbered kundkälla för Fortnox

- inför konceptet kundkälla i draften
- lokal kund
- prospekt
- framtida Fortnox-kund

### Steg 5. Först därefter bygga Fortnox-sökning

Fortnox-sökning ska inte göras innan offertstegets interna struktur är tydlig. Annars byggs integration ovanpå en redan rörig form.

Det läget gäller fortfarande. Nästa stora tekniska steg ska därför inte vara extern integration, utan fortsatt stabilisering av modalens arbetsyta och informationshierarki.

## Beslut just nu

Följande ska gälla för nästa arbetsfas:

- offertgeneratorn byggs om först
- företag och privat delas upp tydligt
- ROT visas bara i privatflödet
- företagsflödet ska stödja organisationsnummer
- kund ska ligga kvar lokalt i CRM tills en riktig arbetsorder skapas
- Fortnox-sökning och faktisk kundsynk förbereds i modellen men implementeras inte före omtaget av offert-UI:t

## Praktisk målbild efter omtaget

När omtaget är klart ska användaren kunna:

- välja företag eller privat direkt
- bara se fält som är relevanta för det valet
- förstå skillnaden mellan kunduppgifter, offertinnehåll och intern handoff
- bygga offert utan att drunkna i ett enda långt formulär
- känna att Fortnox-riktningen är inbyggd utan att Fortnox ännu styr hela flödet

## Rekommenderat nästa steg

Nästa arbetsvåg bör fokusera på följande i ordning:

1. putsa modalens interna layout ytterligare där sektioner fortfarande känns optiskt obalanserade
2. förbättra offertgrund och offert­rader så att de blir snabbare att läsa och arbeta i
3. avgöra om kundkälla ska synas även i listkort eller detaljvy utanför modalen
4. först därefter börja skissa riktig Fortnox-sökning ovanpå den nuvarande `customer_source`-modellen