import type { KmaSelfCheckKey } from './types';

// KMA-planens fasta innehåll — Isoleringslandslagets mallar, transkriberade ur Word.
//
// KÄLLAN är paketet "KMA till Willy" (2026-09-24): KMA_Isoleringslandslaget AB-Ekovilla se AB.docx
// plus bilaga 1–5, 7 och 8. Bilaga 6 (egenkontrollmallen) saknades i paketet och byggs efter
// Ekovillas 6_Egenkontrollmall.docx ur AstraZeneca-planen (Williams beslut 2026-09-24). Filerna
// ligger utanför repot med flit — de bär kunddata.
//
// ENTREPRENÖREN ÄR ALLTID ISOLERINGSLANDSLAGET AB (Williams beslut 2026-09-24), inte Ekovilla som
// resten av appen känner. Det enda Ekovilla-namnet i dokumentet är bolagsraden i foten, som i mallen.
//
// ⚠️ TEXTERNA ÄR ORDAGRANNA utom rättningarna nedan. Ändra dem inte för att något "låter bättre" —
// dokumentet går till beställare, och bolaget äger formuleringarna. Rättningarna, listade i PR:en
// för korrektur:
//   * Bilagetabellens rader 2–4 sa "– Ekovilla se AB". Bilagorna själva är Isoleringslandslagets.
//   * Miljöledningsfilens rubrik sa "Bilaga 3"; den är bilaga 5 i tabellen.
//   * "vårat interna arbetssystem" → "vårt interna arbetssystem".
//   * "Ser till att fordonen i ett trafiksäkert skick" → "… fordonen är i ett trafiksäkert skick".
//   * "Endast godkänd glasulls isolering CE09/0081" — CE09/0081 är Ekovillas ETA-nummer,
//     felkopierat. Certifikatet tas nu ur materialtabellen per material (materials.ts).
//   * §1, §3 och §4 räknar inte längre upp BÅDA materialen: meningarna följer orderns material.
//
// ⚠️ Ett ändrat värde här påverkar bara NYA planer. Varje sparad revision bär sitt eget dokument
// (crm_work_order_kma_plans.document) och renderas ur det, aldrig ur den här filen.

export const KMA_COMPANY = { name: 'Isoleringslandslaget AB', orgNumber: '559022-5800' } as const;

/** Mallens version, som i Word-mallen. Planens egen revision visas separat (Williams beslut). */
export const KMA_TEMPLATE_VERSION = '2.0';

export const KMA_FOOTER = 'Ekovilla AB / Isoleringslandslaget AB - 020-44 66 40 - Info@ekovilla.se';

/** Den fasta första raden i kontaktlistan (§2 och bilaga 7). */
export const KMA_CEO_CONTACT = { name: 'Andreas Östlund', role: 'VD / Teknisk expert', phone: '072-459 99 98' } as const;

// ── Huvuddokumentet ──────────────────────────────────────────────────────────

export const KMA_TITLE = 'KMA-PLAN';
export const KMA_SUBTITLE = 'Kvalitet • Miljö • Arbetsmiljö';

export const KMA_STANDARDS_INTRO = 'Planen är upprättad enligt:';
export const KMA_STANDARDS = [
  'Behörig Lösull regelverk',
  'Företagets kvalitetssystem och miljöledningssystem',
  'AFS 2023:3',
  'Miljöbalken',
  'ABT 06',
];
export const KMA_PURPOSE = 'Säkerställa hög kvalitet, låg miljöpåverkan och säker arbetsmiljö i projektet.';

export const KMA_DEFAULT_WORK_TYPE = 'tilläggsisolering';
export const KMA_DEFAULT_COMMITMENT = 'Tilläggsisolering / Isoleringsentreprenad';

// §3
export const KMA_QUALITY_POLICY = 'Vi utför alla arbeten i enlighet med Behörig Lösull och företagets kvalitetsmanual.';
export const KMA_STORAGE_RULE = 'Lagring sker torrt och skyddat mot fukt';
export const KMA_SELF_CHECK_POINTS: ReadonlyArray<{
  key: KmaSelfCheckKey;
  point: string;
  frequency: string;
  defaultResponsible: string;
}> = [
  { key: 'incomingMaterial', point: 'Inkommande material', frequency: 'Vid varje leverans', defaultResponsible: 'Installatör' },
  { key: 'density', point: 'Densitet (kg/m³)', frequency: 'Minst 3 stickprov per etapp', defaultResponsible: 'Installatör' },
  { key: 'thickness', point: 'Tjocklek och fyllnadsgrad', frequency: 'Löpande + slutkontroll', defaultResponsible: 'Ledande installatör' },
  { key: 'airGaps', point: 'Luftspalter / hålrum', frequency: 'Visuell kontroll', defaultResponsible: 'Installatör' },
  { key: 'finalInspection', point: 'Slutbesiktning', frequency: 'Inför överlämnande', defaultResponsible: 'Säljare/Projektledare' },
];
/** "Alla avvikelser rapporteras till <mottagare>." — mallens ursprungliga mottagare. */
export const KMA_DEFAULT_DEVIATION_RECIPIENT = 'Ansvarig projektledare i vårt interna arbetssystem';

// §4
export const KMA_ENV_POLICY = 'Vi arbetar aktivt för att minska vår miljöpåverkan.';
export const KMA_ENV_SENTENCE_CELLULOSE =
  'Cellulosaisolering från återvunnet tidningspapper är ett av marknadens mest miljövänliga material.';
/** Omskriven ur bilaga 5:s egen mening om Knauf — samma påstående, fristående. */
export const KMA_ENV_SENTENCE_KNAUF =
  'Glasullsisolering från Knauf, tillverkad med upp till 80 % återvunnet glas, är en av de mest miljöanpassade produkterna på marknaden.';
export const KMA_ENV_ASPECTS = ['Damm och partiklar vid blåsning', 'Transporter', 'Avfall (plastpåsar, lastpallar)'];
export const KMA_ENV_GOALS = ['Minst 90 % återvinning av avfall', 'Återlämna lastpallar till leverantör', 'Minimera onödiga transporter'];
export const KMA_ENV_ACTIONS = ['Sortering på plats', 'Dammsugning, ej sopning', 'Plastpåsar återvinns'];

// §5
export const KMA_WORK_ENV_POLICY = 'Vi strävar efter noll olyckor och följer alla lagar och regler inom arbetsmiljöområdet.';
export const KMA_SITE_RULES = [
  'God ordning och reda',
  'ID06 ska bäras synligt',
  'Minst två personer på arbetsplatsen',
  'Alkohol- och drogfri arbetsmiljö',
];
export const KMA_PPE = [
  'Andningsskydd / munskydd (P3) vid isoleringsarbete',
  'Användning av mask med övertryck vid installation på vind',
  'Säkerhetssele vid arbete på höjd',
  'Skyddsglasögon, hörselkåpor vid buller och skyddskläder',
  'Handskar med skärskydd vid hantering av knivar samt arbete på vind',
];
export const KMA_RISKS = [
  { risk: 'Dammexponering', action: 'Andningsskydd P3, dammsugning' },
  { risk: 'Arbete på hög höjd (slangupptagning)', action: 'Säkerhetssele + minst två man' },
  { risk: 'Skador vid isoleringsarbete', action: 'Tvåmansarbete, första hjälpen-utbildning' },
  { risk: 'Nyckelperson sjuk/frånvarande', action: 'Backup med erfaren installatör' },
];
export const KMA_EMERGENCY = 'Beredskapsplan finns och är informerad till alla på arbetsplatsen.';

// §6
export const KMA_FOLLOW_UP_START = 'KMA-planen gås igenom vid projektstart';
export const KMA_FOLLOW_UP_FINAL = 'Slutrapport med egenkontroller och avvikelser';

/** Bilagetabellen. `comment` för bilaga 1 är projektspecifik och byggs i document.ts. */
export const KMA_APPENDICES: ReadonlyArray<{ no: number; title: string; comment: string | null }> = [
  { no: 1, title: 'Arbetsmiljöplan med detaljerad riskanalys', comment: null },
  { no: 2, title: 'Arbetsmiljöpolicy – Isoleringslandslaget AB', comment: 'Övergripande policy' },
  { no: 3, title: 'Trafiksäkerhetspolicy – Isoleringslandslaget AB', comment: 'Övergripande policy' },
  { no: 4, title: 'Kvalitetssystem – Isoleringslandslaget AB', comment: 'Beskrivning av Behörig Lösull-system' },
  { no: 5, title: 'Miljöledningssystem – Isoleringslandslaget AB', comment: 'Miljöpolicy och miljömål' },
  { no: 6, title: 'Egenkontrollmall', comment: 'Checklista för installation och dokumentation' },
  { no: 7, title: 'Kontaktlista – Isoleringslandslaget AB', comment: 'Aktuell kontaktinformation' },
  { no: 8, title: 'Signaturlista – Isoleringslandslaget AB', comment: 'Behöriga personer för egenkontroll och verifiering' },
];

// ── Bilaga 1 — Arbetsmiljöplan med detaljerad riskanalys ─────────────────────

export const KMA_A1_RULES: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: 'Ordning på arbetsplatsen',
    text: 'God ordning ska gälla på arbetsplatsen. Detta skapar trivsel och framkomlighet och kan förhindra många olyckor.',
  },
  {
    title: 'Personlig skyddsutrustning',
    text:
      'Munskydd/ansiktsmask ska alltid användas vid isoleringsarbetet. Vid arbete på höga höjder ska alltid säkerhetssele användas. ' +
      'Sådan utrustning finns alltid i våra arbetsfordon. Övrig anbefalld skyddsutrustning ska även bäras.',
  },
  {
    title: 'Skyddsanordningar',
    text:
      'Innan ett arbete påbörjas ska man alltid kontrollera att erforderliga skyddsanordningar är korrekta och säkert utförda. ' +
      'Ett arbete kan innebära att man måste sätta upp en tillfällig avspärrning omkring arbetsplatsen för att förhindra att någon skadar sig.',
  },
  {
    title: 'Materialupplag',
    text: 'Material ska läggas på anvisade platser. Kontrollera att transportvägarna ej blir blockerade. Ta hand om allt spillmaterial - fortlöpande!',
  },
  {
    title: 'Elsäkerhet',
    text:
      'Ej behörig installatör får inte göra ingrepp i elanläggningen - tillfällig eller permanent. Endast byte av säkringar får utföras. ' +
      'Var rädd om kablarna - de skadas lätt. Låt ej kablar ligga oskyddade där skaderisk föreligger. ' +
      'Skadade elkablar får under inga omständigheter användas. Om skada på elkabel upptäcks - underrätta genast arbetsledningen.',
  },
  { title: 'Bilparkering', text: 'Inom arbetsområdet får parkering ske endast vid anvisad plats.' },
  {
    title: 'Beredskap vid olycka',
    text: 'Beredskapsplan att följa vid olycka är informerad till samtliga på arbetsplatsen och finns anslagen/utdelad.',
  },
];
export const KMA_A1_RISK_INTRO = 'I samband med snickeri och isoleringsarbeten har följande riskanalys utförts.';
export const KMA_A1_RISKS = [
  'Skador i samband med snickeriarbeten',
  'Olycksrisk i samband med arbete på hög höjd. (Upptagning av isoleringsslang).',
  'Nyckelperson i projekt försvinner (sjukdom etc).',
  'Vid arbete med kniv samt vid arbete på vind, skärrisk vid ej synligt materiel på vind som göms i t.ex. befintlig isolering.',
];
export const KMA_A1_ACTION_PLAN = [
  'För att förebygga eventuella skador arbetar vi alltid minst två man tillsammans på arbetsplatsen, dessutom har internutbildning i ”första hjälpen” genomförts.',
  'Vid arbete på höga höjder ska alltid säkerhetssele användas. Sådan utrustning finns alltid i våra arbetsfordon.',
  'Vid sjukdom på nyckelperson finns alltid en ”backup plan” redo, dvs en annan erfaren entreprenör skickas till arbetsplatsen.',
  'Vi använder oss av handskar med skärskydd.',
];
export const KMA_A1_RESIDUALS = [
  'Isoleringsmaterialet ger inget spill.',
  'Lastpallarna kommer att levereras åter till vår leverantör av isoleringsmaterial.',
  'Plastpåsar levereras till miljöstation.',
  'Sopor och överblivet trämaterial forslas bort till miljöstationen för separat material.',
];

// ── Bilaga 2 — Arbetsmiljöpolicy ─────────────────────────────────────────────

export const KMA_A2_PARAGRAPHS = [
  'Alla anställda i Isoleringslandslaget AB arbetar med att efterfölja dessa krav i vårt arbetsmiljöarbete.',
  'Arbetsmiljöplanen innebär att alla anställda hos Isoleringslandslaget AB arbetar för bra och säkra arbetsplatser för alla våra medarbetare:',
];
export const KMA_A2_POINTS = [
  'Vi använder ID06 som ska bäras synlig när man är på jobbet.',
  'Vi jobbar för att helt eliminera arbetsplatsolyckor, skador genom att alltid analysera och förebygga risker',
  'Vi ska följa de lagar, regler och krav som gäller inom arbetsmiljöområdet',
  'Vi ska alltid försöka förbättra arbetsmiljön',
];

// ── Bilaga 3 — Trafiksäkerhetspolicy ─────────────────────────────────────────

export const KMA_A3_INTRO = 'Vår trafiksäkerhetspolicy innebär att anställda inom företaget:';
export const KMA_A3_POINTS = [
  'Använder säkerhetsbälte',
  'Följer hastighetsbestämmelser',
  'Följer kör- och vilotidsreglerna',
  'Lastar och säkrar godset på ett ansvarsfullt sätt',
  'Ej kör med överlast',
  'Tar hänsyn till trafiksituation och väglag',
  'Undviker att köra då man är trött',
  'Är sprit- och drogfria',
  'Ser till att fordonen är i ett trafiksäkert skick',
  'Rapporterar eventuella olyckor, tillbud till närmaste chef',
];

// ── Bilaga 4 — Kvalitetssystem ───────────────────────────────────────────────

export const KMA_A4_INTRO =
  'Isoleringslandslaget AB och de medlemmar som utför arbete åt oss som UE arbetar i enlighet med branschstandarden och regelverket Behörig Lösull. ' +
  'Vår kvalitetsmanual är upprättad enligt de riktlinjer som föreskrivs inom Behörig Lösull och innehåller följande:';
export const KMA_A4_CONTENTS = [
  'Kvalitetssystemets syfte och kvalitetspolicy',
  'Företagets egenkontroll',
  'Organisation',
  'Ansvar och befogenheter',
  'Ledningens genomgång samt internrevision',
  'Styrning av dokument',
  'Kontraktsgenomgång',
  'Projektering',
  'Märkning',
  'Korrigerande åtgärder',
  'Klagomål',
  'Ändringshistorik',
];
export const KMA_A4_OUTRO = [
  'Regelverket för Behörig Lösull och vår kvalitetsmanual är ett slags ISO 9001 i mindre skala anpassat helt för lösullsentreprenader.',
  'Hela kvalitetsmanualen lämnas gärna över på begäran från beställaren. I övrigt kommer vi att upprätta kvalitets- och miljöplaner på varje objekt/beställning som föreskrivs i förfrågningsunderlaget.',
];

// ── Bilaga 5 — Miljöledningssystem ───────────────────────────────────────────

export const KMA_A5_INVESTIGATION =
  'I och med entreprenader åt privatpersoner, byggbolag, fastighetsbolag och bostadsrättsföreningar har Isoleringslandslaget AB gjort olika slags miljöutredningar. ' +
  'Genomgång görs vid ledningens genomgångar och träffar. Vi har då diskuterat miljöpåverkan , omfattning , varaktighet och sannolikhet. ' +
  'Utefter detta och tidigare erfarenheter har sedan en bedömning gjorts där vi identifierat våra betydande miljöaspekter. ' +
  'Dessa miljöaspekter skall alltid beaktas i verksamheten, utöver detta kan det finnas projektspecifika miljöaspekter att ta hänsyn till ex, störande buller, dammspridning. ' +
  'Vi identifierar och analyserar våra miljöaspekter kontinuerligt.';
export const KMA_A5_POLICY = [
  'Vi arbetar aktivt med att minska vår miljöpåverkan för att motverka klimatförändringarna och vi skänker minst 10 % av vår vinst till välgörande ändamål ' +
    '(främst miljöorganisationer som ex. WWF) årligen för att göra skillnad på internationell nivå.',
  'Isoleringslandslaget AB bidrar till en långsiktig hållbar utveckling genom att använda de mest miljövänliga materialen vi kan. ' +
    'Vår huvudprodukt är glasullsisolering från Knauf, tillverkad med upp till 80 % återvunnet glas, och det är en av de mest miljöanpassade produkterna på marknaden.',
  'Vårt miljöarbete är viktigt för företagets långsiktiga mål och visioner. Bolaget skall ständigt prövas mot miljömässiga värderingar: ' +
    'Att uppdatera personal om vårt miljöarbete. Att uppfylla gällande lagar och andra krav på miljöområdet. ' +
    'Att sträva efter att ständigt bli bättre och att vår miljöpåverkan ständigt minskar. Vid val av material och tjänster beaktar vi miljöaspekter. ' +
    'Hantering av plast från vårt isoleringsmaterial skall alltid returneras vid återvinning. Arbeta aktivt med att ständigt ta hänsyn till miljö i alla delar i vårt arbete. ' +
    'Eftersträva effektiva transporter med vårt isoleringsmaterial för att förebygga föroreningar och därmed minska miljöpåverkan. ' +
    'Att vi alltid i det dagliga arbetet ansvarar för att miljöpolicyn efterlevs.',
];
export const KMA_A5_GOALS_MOTTO = '”Som mål att medverka till ett hållbart samhälle”';
export const KMA_A5_GOALS_TEXT =
  'Ett dokumenterat miljöledningssystem blir allt viktigare, framför allt i stora organisationer. ' +
  'Isoleringslandslaget AB har påbörjat arbetet med att skapa ett eget system, som förhoppningsvis aldrig blir färdigt, eftersom kontinuerlig förändring/förbättring är ett led i miljöarbetet. ' +
  'Vårt mål är att hela tiden uppdatera och verifiera alla positiva förändringar som tas upp.';
export const KMA_A5_GOALS_EXAMPLES_INTRO = 'Exempel på miljömål som diskuteras:';
export const KMA_A5_GOALS_EXAMPLES = [
  'Minska antalet tjänsteresor',
  'Framförhållning på beställningar av material',
  'Planering av entreprenader',
  'Upplysa kunder om förbättrad framförhållning vid beställning av material',
];
export const KMA_A5_ACTION_PLAN_TEXT =
  'Detta betyder att vi anpassar och använder material, processer och som är skonsamma mot miljön utan att därmed riskera beständigheten i våra arbeten.';
export const KMA_A5_ACTION_PLAN = [
  'Ta fram ny mötes- och resepolicy.',
  'Effektivisera energiförbrukningen och transporterna.',
  'Minska materialåtgång genom återanvändning och återvinning.',
  'Minska mängden och säker hantering av vårt avfall.',
];
export const KMA_A5_RESPONSIBILITY = [
  'Ledningen delegerar miljöarbetet till anställda och dess ansvarsområde.',
  'VD - ansvarar för att samordna, prioritera och följa upp det samlade arbetet.',
];

// ── Bilaga 6 — Egenkontrollmall (efter Ekovillas 6_Egenkontrollmall.docx) ────

export const KMA_A6_CHECKLIST = ['Luftspalt', 'Snickerier', 'Tätskikt', 'Genomföringar', 'Grovstädning', 'Märkskylt', 'Övrig kommentar'];
/** Hör till cellulosa — och markeras med en asterisk på "Luftspalt" bara när den står med. */
export const KMA_A6_VENTILATION_NOTE =
  '*Ett vindsbjälklag kan utföras helt utan takfotsventilation vid användandet av cellulosaisolering och gavelventiler. ' +
  '(Rek. Ventilationsarea: 0,1-0,2m2/100m2 vindsyta).';
/** Hör bara till Ekovilla — produktbladets egen mening. */
export const KMA_A6_EKOVILLA_NOTE =
  'Ekovilla tillverkas i Finland av förnyelsebar FSC-certifierad råvara och produktionen drivs av grön el. Klimatsmartare än så blir det inte…';
export const KMA_A6_THANKS = 'Vi tackar för Ert förtroende och intygar härmed ovanstående uppgifter,';

// ── Bilaga 8 — Signaturlista ─────────────────────────────────────────────────

export const KMA_A8_SUBTITLE = 'Förteckning över personer som utför och dokumenterar egenkontroll, deras befogenheter och signaturer';
/** Tomrader att skriva på, som i mallen: tio löpande, sju verifierande. */
export const KMA_A8_ONGOING_ROWS = 10;
export const KMA_A8_VERIFYING_ROWS = 7;
export const KMA_A8_CONFIRM = 'Behörigheter enligt ovan bekräftas:';
export const KMA_A8_SIGNATURE = 'Namnteckning av behörig undertecknare:';
