import type { KmaSelfCheckKey } from './types';

// KMA-planens fasta innehåll — Isoleringslandslagets mallar, transkriberade ur Word.
//
// KÄLLAN är paketet "KMA till Willy" (2026-09-24): KMA_Isoleringslandslaget AB-Ekovilla se AB.docx
// plus bilaga 1–5, 7 och 8. Filerna ligger utanför repot med flit — de bär kunddata. Bilaga 6
// (egenkontrollmallen) saknades i paketet: den är appens egen egenkontroll, tom (Williams beslut
// 2026-10-14 — den byggdes först efter en äldre Word-mall, 6_Egenkontrollmall.docx).
//
// ENTREPRENÖREN ÄR ALLTID ISOLERINGSLANDSLAGET AB (Williams beslut 2026-09-24), inte Ekovilla som
// resten av appen känner. Planens texter namnger den (KMA_COMPANY). Raden "Företag" överst bär sedan
// 2026-10-20 båda bolagen med org.nr (KMA_COMPANIES, Williams beslut), och foten Ekovilla, som i mallen.
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
// 2026-10-19: EKOVILLA SVERIGES KVALITETS- OCH MILJÖPOLICY INARBETAD (Williams beslut, VD bekräftar).
// Källa: "Ekovilla Sverige Kvalitets- och miljöpolicy (KMA-policy) 2026-02-02.pdf", fastställd av VD
// 2026-02-02 (policyns sidhuvud sa 2026-09-23 — fel, VD bekräftade februari).
//   * Policyn ÄR nu bilaga 5, ordagrant. Den ersätter gamla "Miljöledningssystem", som kallade
//     glasull från Knauf för vår huvudprodukt och lovade en WWF-gåva som VD inte står bakom.
//   * §1–§6 har fått policyns konkreta åtaganden: regelverk, ansvar, kvalitetsmål, utbildning,
//     miljövärderade varor, fossilfria transporter, BAS-U. Formuleringarna är policyns, kortade.
//   * Bilaga 1: "Isoleringsmaterialet ger inget spill" stred mot policyns spillmål — omskriven.
//   * Datumet skrivs "2 februari 2026", aldrig ÅÅÅÅ-MM-DD: dokumentet får bara bära planens egna
//     datum i den formen (tests/crm/kmaDocument.test.ts, "inget utskriftsdatum").
//
// ⚠️ Ett ändrat värde här påverkar bara NYA planer. Varje sparad revision bär sitt eget dokument
// (crm_work_order_kma_plans.document) och renderas ur det, aldrig ur den här filen.

export const KMA_COMPANY = { name: 'Isoleringslandslaget AB', orgNumber: '559022-5800' } as const;

/**
 * Bolagen på planens rad "Företag", ett per rad: entreprenören och Ekovilla, båda med org.nr (William
 * 2026-10-20). Bara den raden — planens övriga texter namnger entreprenören som förut.
 *
 * Stavningen "EKOVILLA se AB" är bolagets egen, som i bilaga 5 (VD:s policy) — Williams val framför
 * "Ekovilla SE AB", så att samma PDF inte stavar bolaget på två sätt.
 */
export const KMA_COMPANIES = [KMA_COMPANY, { name: 'EKOVILLA se AB', orgNumber: '559341-9673' }] as const;

/**
 * Betalningsplanen, på planens första sida under Projektnummer (William 2026-10-20: "Betalningsplan- 25e
 * varje månad"). Samma för varje plan; blir den per projekt hör den hemma i formuläret i stället.
 */
export const KMA_PAYMENT_PLAN = '25:e varje månad';

/** Mallens version, som i Word-mallen. Planens egen revision visas separat (Williams beslut). */
export const KMA_TEMPLATE_VERSION = '2.1';

export const KMA_FOOTER = 'Ekovilla AB / Isoleringslandslaget AB - 020-44 66 40 - Info@ekovilla.se';

/** Taket på kontaktlistans egna rader — schemat, förifyllnaden och dialogen delar det. */
export const KMA_MAX_CONTACTS = 30;

/** Den fasta första raden i kontaktlistan (§2 och bilaga 7). */
export const KMA_CEO_CONTACT = { name: 'Andreas Östlund', role: 'VD / Teknisk expert', phone: '072-459 99 98' } as const;

// ── Huvuddokumentet ──────────────────────────────────────────────────────────

export const KMA_TITLE = 'KMA-PLAN';
export const KMA_SUBTITLE = 'Kvalitet • Miljö • Arbetsmiljö';

export const KMA_STANDARDS_INTRO = 'Planen är upprättad enligt:';
export const KMA_STANDARDS = [
  'Behörig Lösull regelverk',
  'Ekovilla Sveriges kvalitets- och miljöpolicy (Bilaga 5) och företagets kvalitetssystem (Bilaga 4)',
  'Tillverkarens anvisningar samt beställarens projekteringsanvisningar, arbetsbeskrivningar och monteringsanvisningar',
  'Arbetsmiljölagen, AFS 2023:3 och AFS 2023:13',
  'Miljöbalken',
  'AB 04, ABT 06 eller ABU 07 enligt avtal',
];
export const KMA_PURPOSE = 'Säkerställa hög kvalitet, låg miljöpåverkan och säker arbetsmiljö i projektet.';

export const KMA_DEFAULT_WORK_TYPE = 'tilläggsisolering';
export const KMA_DEFAULT_COMMITMENT = 'Tilläggsisolering / Isoleringsentreprenad';

// §2 — policyns avsnitt 8
export const KMA_POLICY_RESPONSIBILITY =
  'VD är ytterst ansvarig för kvalitets- och miljöpolicyn. Entreprenadchef ansvarar för att den tillämpas på arbetsplatsen. ' +
  'Hållbarhetsansvarig (tills vidare VD) ansvarar för miljövärdering av varor, EPD och klimatpåståenden. ' +
  'Varje medarbetare ansvarar för att följa policyn i det dagliga arbetet.';

// §3 — policyns avsnitt 3
export const KMA_QUALITY_POLICY =
  'Vi ska leverera lösullsentreprenader som uppfyller avtal, tillverkarens anvisningar, Behörig Lösull och företagets kvalitetsmanual ' +
  'samt beställarens projekteringsanvisningar, arbetsbeskrivningar och monteringsanvisningar. ' +
  'Avvikelser ska synas, åtgärdas och läras av – inte döljas.';
export const KMA_QUALITY_MEASURES = [
  'Bemanning med utbildad personal. Safe Construction Training, beställarens arbetsmiljöutbildning och övriga kravställda utbildningar ska vara registrerade i ID06 Kompetensdatabas innan arbete påbörjas.',
  'Startmöte, samordning med platsledning och BAS-U samt arbetsberedning av riskfyllda moment.',
  'Relationshandlingar, egenkontrollprotokoll och avvikelserapporter lämnas i beställarens projektsamverkanssystem i avtalad tid.',
  'Reklamationer och fel avhjälps inom avtalad tid.',
  'Underentreprenörer används bara om de är anmälda och godkända i förväg och arbetar under samma krav.',
];
export const KMA_QUALITY_GOALS = [
  'Leverans i rätt tid enligt överenskommen tidplan – minst 95 % leveranssäkerhet per halvår',
  'Noll allvarliga kvalitetsavvikelser som leder till omtag av färdig isolering på grund av eget fel',
  'Komplett egenkontrolldokumentation för samtliga objekt',
];
export const KMA_MATERIAL_APPROVAL_RULES = [
  'Enbart miljögodkända varor som är förtecknade för projektet (Byggvarubedömningen lägst Accepteras, SundaHus lägst C+, BASTA och – där det krävs – Svanens Husproduktportal eller SCDP)',
  'Kemiska produkter endast om de är godkända i BVB, SundaHus eller BASTA, med säkerhetsdatablad på plats',
];
export const KMA_STORAGE_RULE = 'Lagring sker torrt och skyddat mot fukt';
export const KMA_SELF_CHECK_NOTE =
  'Tjocklek mäts med avsedd mätsticka. Öppen vind utförs med tillverkarens sättningspåslag; sluten konstruktion med lägst tillverkarens minsta densitet.';
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
/** Efter mottagarmeningen. Policyns avsnitt 8. */
export const KMA_DEVIATION_ESCALATION = 'Avvikelser från kvalitets- och miljöpolicyn hanteras av entreprenadchef och VD.';

// §4
export const KMA_ENV_POLICY = 'Vi tar miljöarbetet på största allvar och arbetar aktivt för att minska vår miljöpåverkan.';
export const KMA_ENV_SENTENCE_CELLULOSE =
  'Cellulosaisolering från återvunnet tidningspapper är ett av marknadens mest miljövänliga material.';
/**
 * Saklig, utan värdering (Williams beslut 2026-10-19). Den gamla meningen kallade Knauf "en av de mest
 * miljöanpassade produkterna på marknaden" — det krockade med VD:s policy i bilaga 5, som räknar glasull
 * till den fossilintensiva isolering Ekovilla ersätter.
 */
export const KMA_ENV_SENTENCE_KNAUF = 'Glasullsisoleringen från Knauf är tillverkad med upp till 80 % återvunnet glas.';
/** Policyns 4.2 — bara när ordern har EKOVILLA (materials.ts). */
export const KMA_ENV_SENTENCE_EKOVILLA =
  'EKOVILLA cellulosaisolering är CE-märkt, har EPD enligt EN 15804 och är bedömd i Byggvarubedömningen, BASTA och SundaHus. ' +
  'Deklarerad värmekonduktivitet är 0,038 W/mK.';
/** Policyns 4.1, "Vi förbinder oss att:". */
export const KMA_ENV_COMMITMENTS = [
  'Prioritera biobaserad cellulosaisolering där den tekniskt och avtalsmässigt är lämplig',
  'Redovisa klimatprestanda med EPD enligt EN 15804 och inte överdriva påståenden',
  'Uppfylla beställarens miljökrav på drivmedel och fordon, inklusive fossilfria drivmedel på byggarbetsplats när det är avtalat',
  'Följa försiktighetsprincipen – biologisk mångfald och människors hälsa ska inte försämras av vårt arbete',
];
export const KMA_ENV_ASPECTS = ['Damm och partiklar vid blåsning', 'Transporter', 'Avfall (plastpåsar, lastpallar)', 'Kemiska produkter'];
export const KMA_ENV_GOALS = [
  'Minst 90 % återvinning av avfall',
  'Minimera spill och använda retursystem',
  'Återlämna lastpallar till leverantör',
  'Minimera onödiga transporter',
];
export const KMA_ENV_ACTIONS = [
  'Källsortering enligt arbetsplatsens fraktioner',
  'Daglig renhållning av eget arbetsställe',
  'Dammsugning, ej sopning',
  'Plastpåsar återvinns',
];

// §5
export const KMA_WORK_ENV_POLICY =
  'Ingen ska skadas på våra arbetsplatser. Vi strävar efter noll olyckor och följer arbetsmiljölagen, AFS 2023:13, ' +
  'beställarens arbetsmiljöplan och Allmänna ordnings- och skyddsregler. Riskfyllda moment arbetsbereds. ' +
  'Tillbud och olyckor anmäls enligt beställarens rutin och till BAS-U.';
export const KMA_SITE_RULES = [
  'God ordning och reda',
  'ID06 ska bäras synligt',
  'Kravställda utbildningar registrerade i ID06 Kompetensdatabas innan arbetet påbörjas',
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
export const KMA_FOLLOW_UP_START = 'KMA-planen gås igenom vid projektstart (startmöte med platsledning och BAS-U)';
export const KMA_FOLLOW_UP_FINAL = 'Slutrapport med egenkontroller och avvikelser';

/** Bilagetabellen. `comment` för bilaga 1 är projektspecifik och byggs i document.ts. */
export const KMA_APPENDICES: ReadonlyArray<{ no: number; title: string; comment: string | null }> = [
  { no: 1, title: 'Arbetsmiljöplan med detaljerad riskanalys', comment: null },
  { no: 2, title: 'Arbetsmiljöpolicy – Isoleringslandslaget AB', comment: 'Övergripande policy' },
  { no: 3, title: 'Trafiksäkerhetspolicy – Isoleringslandslaget AB', comment: 'Övergripande policy' },
  { no: 4, title: 'Kvalitetssystem – Isoleringslandslaget AB', comment: 'Beskrivning av Behörig Lösull-system' },
  { no: 5, title: 'Kvalitets- och miljöpolicy – Ekovilla Sverige', comment: 'Fastställd av VD 2 februari 2026' },
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
  'Spill av isoleringsmaterial minimeras och retursystem används.',
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

// ── Bilaga 5 — Kvalitets- och miljöpolicy, Ekovilla Sverige ─────────────────
//
// ⚠️ ORDAGRANN ur VD:s fastställda policy (2 februari 2026). Ändra den inte här — en ny version av
// policyn ska komma från VD, och då byts hela blocket. Enda avvikelsen: "CO₂" skrivs "CO2" (typsnittet).

export const KMA_A5_TAGLINE = 'Naturlig omtanke om både hus och människa';
export const KMA_A5_META: ReadonlyArray<[string, string]> = [
  ['Dokumentägare', 'VD'],
  ['Gäller', 'Ekovilla Sverige AB med rörelsedrivande bolag Isoleringslandslaget AB och EKOVILLA se AB'],
  ['Fastställd', '2 februari 2026'],
  ['Giltighet', 'Giltig tills vidare, ses över minst årligen'],
];

/** Policyns avsnitt i ordning. `h3` är underrubriker (3.1, 3.2 …); `table` är registertabellen i 5. */
export type KmaPolicyPart =
  | { h2: string }
  | { h3: string }
  | { p: string }
  | { list: string[] }
  | { table: Array<[string, string]> };

export const KMA_A5_POLICY: ReadonlyArray<KmaPolicyPart> = [
  { h2: '1. Syfte och omfattning' },
  {
    p:
      'Denna policy anger hur Ekovilla Sverige styr kvalitet, miljö, klimat och arbetsmiljö när vi projekterar, levererar, installerar och dokumenterar lösullsentreprenader och isoleringssystem. ' +
      'Den är vårt åtagande mot kunder, medarbetare, samhälle och de stora riksbyggare vi arbetar med – bland dem projektutvecklare som JM, liksom övriga totalentreprenörer och husfabriker.',
  },
  {
    p:
      'Policyn gäller all verksamhet i Sverige: egna montörer, arbetsledning, transporter, materialhantering, underentreprenörer och samarbetspartners som arbetar i vårt namn. ' +
      'Där koncernen EcoUp Oyj / Ekovilla Oy tillverkar materialet i Finland gäller deras fabriksstandarder. Vi ansvarar för att det som byggs in i svenska projekt uppfyller samma kravnivå.',
  },

  { h2: '2. Vår hållning' },
  {
    p:
      'Vi tar miljöarbetet på största allvar. Det är inte en sidotext till affären. Ekovilla finns för att hus ska kunna isoleras med biobaserat, cirkulärt material som lagrar kol, buffrar fukt och ger människor ett sunt inomhusklimat. ' +
      'Sedan 1979 har det varit kärnan. I Sverige installerar vi det materialet med egen personal, egen utrustning och dokumenterad egenkontroll.',
  },
  {
    p:
      'Kvalitet för oss är att rätt densitet och rätt tjocklek sitter där ritningen kräver det, att facket är fyllt, att relationshandlingarna stämmer och att kunden kan lita på resultatet under sin livstid. ' +
      'Miljö för oss är att den klimatvinst som sitter i materialet inte äts upp av slarv på arbetsplatsen, felsorterat avfall eller fossila transporter.',
  },

  { h2: '3. Kvalitetspolicy' },
  { h3: '3.1 Åtagande' },
  {
    p:
      'Vi ska leverera lösullsentreprenader som uppfyller avtal, tillverkarens anvisningar, Behörig Lösull, AB 04/AB-U 07 samt kundens projekteringsanvisningar, arbetsbeskrivningar och monteringsanvisningar. ' +
      'Avvikelser ska synas, åtgärdas och läras av – inte döljas.',
  },
  { h3: '3.2 Så säkrar vi kvaliteten' },
  {
    list: [
      'Bemanning med utbildad personal. Safe Construction Training, kundens arbetsmiljöutbildning och övriga kravställda utbildningar ska vara registrerade i ID06 Kompetensdatabas innan arbete påbörjas.',
      'Egenkontroll på varje objekt: densitet, tjocklek med avsedd mätsticka, sättningspåslag på öppen vind, sluten konstruktion enligt tillverkarens minsta densitet.',
      'Relationshandlingar, egenkontrollprotokoll och avvikelserapporter lämnas i kundens projektsamverkanssystem i avtalad tid.',
      'Startmöte, samordning med platsledning och BAS-U, arbetsberedning av riskfyllda moment.',
      'Enbart miljögodkända varor som är förtecknade för projektet (Byggvarubedömningen lägst Accepteras, SundaHus lägst C+, BASTA och – där det krävs – Svanens Husproduktportal eller SCDP).',
      'Reklamationer och fel avhjälps inom avtalad tid. Fel som rör boende hos riksbyggare återkopplas enligt kundens portal och tidsgränser.',
      'Underentreprenörer får bara användas om de är anmälda och godkända i förväg och arbetar under samma krav.',
    ],
  },
  { h3: '3.3 Kvalitetsmål' },
  {
    list: [
      'Leverans i rätt tid enligt överenskommen tidplan. Målsättning minst 95 procent leveranssäkerhet per halvår.',
      'Noll allvarliga kvalitetsavvikelser som leder till omtag av färdig isolering på grund av eget fel.',
      'Samtliga objekt ska ha komplett egenkontrolldokumentation.',
    ],
  },

  { h2: '4. Miljöpolicy' },
  { h3: '4.1 Vi tar miljöarbetet på största allvar' },
  {
    p:
      'Bygg- och fastighetssektorn står för en stor del av Sveriges klimatutsläpp. Isolering avgör både byggnadens energianvändning i drift och en växande del av den inbyggda klimatpåverkan. ' +
      'Därför är miljö inte ett tillägg hos oss. Det är skälet till att produkten finns.',
  },
  { p: 'Vi förbinder oss att:' },
  {
    list: [
      'Prioritera biobaserad cellulosaisolering där den tekniskt och avtalsmässigt är lämplig.',
      'Redovisa klimatprestanda med EPD enligt EN 15804 och inte överdriva påståenden. Vi skiljer på produktens kolinlagring, undvikta utsläpp jämfört med marknadsmix, och eventuella sålda klimatcredits.',
      'Uppfylla kundens miljökrav på drivmedel och fordon, inklusive fossilfria drivmedel på byggarbetsplats när det är avtalat.',
      'Minimera spill, använda retursystem och källsortera enligt arbetsplatsens guide. Merkostnad för felsortering ska inte belasta kunden i onödan.',
      'Endast använda kemiska produkter som är godkända i BVB, SundaHus eller BASTA, med säkerhetsdatablad på plats.',
      'Följa försiktighetsprincipen. Biologisk mångfald och människors hälsa ska inte försämras av vårt arbete.',
      'Sätta mätbara mål för klimat, spill och transporter och följa upp dem minst årligen tillsammans med koncernen.',
    ],
  },
  { h3: '4.2 Våra egna produkter' },
  {
    p:
      'EKOVILLA cellulosaisolering tillverkas av återvunnet returpapper i koncernens fabriker. Den är CE-märkt, har EPD, är bedömd i Byggvarubedömningen, BASTA och SundaHus och är avsedd för Svanenmärkta byggnader när den är listad i gällande portal. ' +
      'Deklarerad värmekonduktivitet för lösull och skivor är 0,038 W/mK. Materialet binder i storleksordningen 1,3–1,5 kg CO2 per kg produkt. ' +
      'Sättningsfritt i sluten konstruktion från 38 kg/m³. Öppen vind utförs med tillverkarens sättningspåslag.',
  },

  { h2: '5. Verifierat klimatarbete – Rainbow Standard' },
  {
    p:
      'Vi tar klimatfrågan på största allvar även där den är svår: i den frivilliga kolmarknaden, där trovärdighet avgör om arbetet gör skillnad eller bara blir ett påstående. ' +
      'Koncernen EcoUp / Ekovilla har därför registrerat ett tredjepartsgranskat klimatprojekt – inte som reklam, utan som ett mätbart åtagande.',
  },
  {
    p:
      'Projektet RIV-2024-PROJ-75 – EcoUp, Finland, expansion of biobased insulation facility – är registrerat hos Rainbow Standard (tidigare Riverse) med mekanismen Avoidance. ' +
      'Offentlig registerpost:\nhttps://registry.rainbowstandard.io/projects/RIV-2024-PROJ-75?mechanism=AVOIDANCE',
  },
  {
    table: [
      ['Projekt-ID', 'RIV-2024-PROJ-75'],
      ['Utvecklare', 'EcoUp (Ekovilla i Finland)'],
      ['Status', 'Credited'],
      ['Mekanism', 'Avoidance (undvikta utsläpp)'],
      ['Metod', 'Biobased construction materials'],
      ['Standard', 'Rainbow / Riverse Standard Rules V6.2'],
      ['Verifiering', 'Enviance Services Private (oberoende VVB)'],
      ['Kreditperiod', '1 maj 2023 – 30 april 2028'],
      ['Verifierade credits', '14 288 utfärdade (5 758 vintage 2023, 8 530 vintage 2024)'],
      ['Anläggningar', 'Kiiminki och Kuusankoski, Finland'],
    ],
  },
  {
    p:
      'Projektet går ut på att tillverka lösull av returpapper – upp till 30 000 ton per år – och ersätta fossilintensiv isolering (glasull, stenull, EPS, XPS, PUR) i byggnader. ' +
      'Jämförelsen görs livscykelbaserat mot marknadens mix. Koncernen har dessutom sänkt elanvändningen i tillverkningen från 0,12 till 0,06 kWh per kilogram och använder ursprungsmärkt fossilfri el. ' +
      'Tomcontainer går i retur. Plast- och pallanvändning minskas genom containersystem.',
  },
  {
    p:
      'Rainbow (tidigare Riverse) är ett europeiskt program för industriella klimatprojekt. Programmet är av Integrity Council for the Voluntary Carbon Market bedömt som CCP-Eligible för Standard Rules v7 och senare. ' +
      'Vårt registrerade projekt följer de regler som gällde vid valideringen (V6.2) och är tredjepartsverifierat. Det är inte EU ETS, inte nationell compliance och inte CORSIA.',
  },
  { h3: '5.1 Hur Ekovilla Sverige använder detta – och hur vi inte gör det' },
  {
    p: 'Vi är stolta över projektet och lyfter det mot kunder som vill förstå var klimatvinsten kommer ifrån. Samtidigt följer vi koncernens integritetsregler:',
  },
  {
    list: [
      'Samma utsläppsminskning ska inte räknas två gånger. När en credit är såld och retired tillhör klimatpåståendet köparen, inte byggnaden och inte vår svenska entreprenad.',
      'Vi påstår inte att ett JM-hus är klimatneutralt enbart för att isoleringen kommer från Ekovilla, och vi säljer inte credits vidare från svensk installation i dagsläget.',
      'Intäkt från credits i koncernen ska återinvesteras i renare produktion, energieffektivitet och materialutveckling – inte behandlas som en ursäkt att sluta minska utsläpp i den egna kedjan.',
      'I anbud och projekt redovisar vi produktens EPD och BVB-status. Credits är ett komplement, inte ett substitut för dokumenterad produktprestanda.',
    ],
  },
  {
    p: 'Det är så vi tar miljöarbetet på största allvar: genom att visa registret, verifieraren och reglerna – och genom att inte lova mer än vad som är sant.',
  },

  { h2: '6. Arbetsmiljö, etik och leverantörskedja' },
  {
    p:
      'Ingen ska skadas på våra arbetsplatser. Vi följer arbetsmiljölagen, AFS 2023:13, kundens arbetsmiljöplan och Allmänna ordnings- och skyddsregler. ' +
      'Riskfyllda moment arbetsbereds. Tillbud och olyckor anmäls enligt kundens rutin och till BAS-U.',
  },
  {
    p:
      'Vi ställer oss bakom de minimikrav som de stora riksbyggarna ställer på sina leverantörer, i linje med FN:s vägledande principer för företag och mänskliga rättigheter, ' +
      'OECD:s riktlinjer, ILO:s kärnkonventioner och FN:s Global Compact:',
  },
  {
    list: [
      'Inget barnarbete, inget tvångsarbete, ingen diskriminering, inga trakasserier.',
      'Föreningsfrihet och kollektivavtalsenliga villkor där sådant avtal gäller verksamheten.',
      'Nolltolerans mot mutor, osund konkurrens och intressekonflikter.',
      'Skydd av personuppgifter enligt GDPR.',
      'Visselblåsning ska kunna ske utan repressalier.',
    ],
  },
  { p: 'Vi skriver under kundens uppförandekod när den begärs, eller visar att vår egen kod täcker motsvarande innehåll.' },

  { h2: '7. Vad stora riksbyggare kan förvänta sig av oss' },
  {
    list: [
      'Huvudanbud enligt kundens handlingar. Avvikelser redovisas och prissätts som sidoanbud, aldrig tyst.',
      'Svanen- och miljövärderade varor förtecknade före användning. Inget material in i huset som inte är godkänt i projektets loggbok.',
      'EPD per isolermaterial.',
      'Fossilfria drivmedel och Euro-krav på fordon när avtalet kräver det, med underlag vid stickprov.',
      'Källsortering enligt arbetsplatsens fraktioner. Daglig renhållning av eget arbetsställe.',
      'Kapacitet som vi faktiskt har. Vi lovar inte geografi eller volym vi inte kan bemanna.',
      'Öppenhet vid revision, självskattning och uppföljningsmöten.',
    ],
  },

  { h2: '8. Organisation, uppföljning och giltighet' },
  {
    p:
      'VD är ytterst ansvarig för policyn. Entreprenadchef ansvarar för att den tillämpas på arbetsplatsen. ' +
      'Hållbarhetsansvarig (tills vidare VD) ansvarar för miljövärdering av varor, EPD och klimatpåståenden. Varje medarbetare ansvarar för att följa policyn i det dagliga arbetet.',
  },
  {
    p:
      'Policyn ses över minst en gång per år, eller tidigare vid ny lag, nytt ramavtal eller väsentlig avvikelse. Avvikelser hanteras av entreprenadchef och VD. ' +
      'Policyn kompletteras av kvalitets- och miljöplan per entreprenad.',
  },
  { p: 'Denna version ersätter tidigare utkast. Den ska undertecknas av VD och bifogas anbud när beställaren så kräver.' },
];

/** Underskriften, som i policyn. */
export const KMA_A5_SIGNED: ReadonlyArray<[string, string]> = [
  ['Ort och datum', 'Sandviken den 2 februari 2026'],
  ['Undertecknad', 'Andreas Östlund\nVD, Ekovilla Sverige'],
  ['Bolag', 'Isoleringslandslaget AB, org.nr 559022-5800\nEkovilla Sverige AB, org.nr 559113-8002'],
];

// ── Bilaga 6 — Egenkontrollmall ──────────────────────────────────────────────
//
// Inga texter här: bilagan är egenkontrollens egen blankett (lib/domains/egenkontroll/template.ts).

// ── Bilaga 8 — Signaturlista ─────────────────────────────────────────────────

export const KMA_A8_SUBTITLE = 'Förteckning över personer som utför och dokumenterar egenkontroll, deras befogenheter och signaturer';
/** Tomrader att skriva på, som i mallen: tio löpande, sju verifierande. */
export const KMA_A8_ONGOING_ROWS = 10;
export const KMA_A8_VERIFYING_ROWS = 7;
export const KMA_A8_CONFIRM = 'Behörigheter enligt ovan bekräftas:';
export const KMA_A8_SIGNATURE = 'Namnteckning av behörig undertecknare:';
