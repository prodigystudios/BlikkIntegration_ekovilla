/**
 * Tolkar den URL som en återställningslänk landar på.
 *
 * Ren och sidoeffektfri med flit — hela poängen med modulen är att formerna nedan går att pröva
 * utan webbläsare. Den får INTE importera supabase-klienten.
 *
 * BAKGRUND: varför fyra former?
 *
 * GoTrue svarar olika beroende på hur mejlmallen är skriven och vilket flöde som begärde länken,
 * och vi har haft alla varianterna i omlopp samtidigt:
 *
 *   1. `?token_hash=…&type=recovery`  — mallen vi vill ha. Verifieras med `verifyOtp` och bär
 *      ingen hemlighet i webbläsaren, alltså fungerar den på VILKEN enhet, webbläsare och domän
 *      som helst. Det är den som lagar buggen.
 *   2. `#access_token=…`              — implicit. Uppstår när mallen står kvar på
 *      `{{ .ConfirmationURL }}`, alltså under deployfönstret innan mallen bytts. Tokens sätts med
 *      `setSession` — se nedan om varför vi inte låter supabase-js göra det.
 *   3. `?code=…`                      — PKCE, från länkar som skickades av den GAMLA koden. Kräver
 *      en `code_verifier` som låg i lagringen på den origin där återställningen BEGÄRDES; sedan
 *      förfrågan gjordes implicit skrivs ingen sådan längre, så de går inte att lösa in. Vi säger
 *      det rakt ut i stället för att låtsas.
 *   4. `#error=…` / `?error=…`        — GoTrue vägrade. Felet ligger i FRAGMENTET för implicit och
 *      i query för PKCE, så båda måste läsas. Läser man ingendera ser en utgången länk exakt
 *      likadan ut som fel domän och fel enhet, vilket är varför det här var osynligt i drift.
 *
 * ⚠️ VARFÖR SIDAN LÖSER IN ALLT SJÄLV I STÄLLET FÖR ATT LITA PÅ `detectSessionInUrl`
 *
 * Två skäl, båda verifierade i auth-js 2.65:
 *
 *   • `?code=` utan lagrad verifier gör `_isPKCEFlow()` falsk, och då hoppar `_initialize`
 *     (GoTrueClient.js:170) över URL-detektionen HELT och behåller den session som redan fanns.
 *     Frågar sidan då bara "finns en session?" räcker det att skriva `?code=vadsomhelst` i
 *     adressfältet i en inloggad webbläsare för att få upp formuläret — och byta NÅGON ANNANS
 *     lösenord. Sessionen måste komma från den här laddningen, inte från lagringen.
 *   • Klienten är auth-helpers, som hårdkodar `flowType: 'pkce'`. Rad 1070 kastar då
 *     "Not a valid PKCE flow url" för varje fragment-länk och river sessionen. Implicita länkar
 *     kan alltså aldrig lösas in av den vägen.
 */

export type RecoveryLink =
  /** Engångstoken att lösa in med `verifyOtp`. Bär ingen hemlighet — fungerar överallt. */
  | { kind: 'token_hash'; tokenHash: string }
  /** Implicit: färdiga tokens i fragmentet, sätts med `setSession`. */
  | { kind: 'session'; accessToken: string; refreshToken: string }
  /**
   * PKCE-länk från koden som fanns före implicit-omläggningen.
   *
   * Går att lösa in ENDAST om verifieraren råkar ligga kvar i den här webbläsaren — den skrivs
   * inte längre, men kakan har lång livslängd, så länkar som begärdes strax före deployen kan
   * fortfarande fungera. Sidan avgör vilket det blev; den formen ensam räcker inte som bevis.
   */
  | { kind: 'pkce-code' }
  /**
   * GoTrue avvisade länken.
   *
   * ⚠️ `description` kommer rakt ur adressfältet och får ALDRIG renderas — vem som helst kan
   * skicka en länk med påhittad text och få den att stå i appens egen felruta på vår riktiga
   * domän. Fältet finns för felsökning och loggning. Meddelandet byggs ur `code`, som matchas mot
   * våra egna fasta strängar.
   */
  | { kind: 'error'; code: string; description: string }
  /** Ingen länkinformation alls — direktbesök. */
  | { kind: 'none' };

/**
 * Fragmentet är inte en URL-sökväg utan en query-sträng, trots att den sitter efter `#`.
 * `new URL(...).hash` ger den med ledande `#`, som måste bort innan URLSearchParams förstår den.
 */
function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(String(hash || '').replace(/^#/, ''));
}

export function parseRecoveryLink(href: string): RecoveryLink {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'none' };
  }

  const query = url.searchParams;
  const frag = fragmentParams(url.hash);

  // 🧨 VARJE PARAMETER LÄSES BARA DÄR DEN KAN KOMMA IFRÅN PÅ RIKTIGT.
  //
  // Frestelsen är en `pick()` som provar fragmentet och sedan query. Den blev ett
  // kontoövertagande: `#code=x` klassades då som en PKCE-länk, medan sidans bevis på att koden
  // FAKTISKT lösts in läser `searchParams` — som förstås är tom. Beviset uteblev, sidan föll
  // tillbaka på "finns en session?" och visade lösenordsformuläret för den som råkade vara
  // inloggad i webbläsaren. Angriparen behövde bara skicka en adress.
  //
  // Så här svarar GoTrue i verkligheten:
  //   query    → `?token_hash=…&type=recovery` (vår mall) och `?code=…` (PKCE-redirect)
  //   fragment → `#access_token=…&refresh_token=…&type=recovery` (implicit redirect)
  //   båda     → fel: implicit lägger dem i fragmentet, PKCE i query

  // Ett fel är definitivt och vinner över allt annat — en avvisad länk bär ingen giltig token.
  const errorCode =
    frag.get('error_code') || frag.get('error') || query.get('error_code') || query.get('error');
  if (errorCode) {
    return {
      kind: 'error',
      code: errorCode,
      // `+` betyder mellanslag i en query-sträng; URLSearchParams avkodar det åt oss.
      description: frag.get('error_description') || query.get('error_description') || '',
    };
  }

  const tokenHash = query.get('token_hash');
  if (tokenHash) {
    // `type` avgör vad token gäller. Saknas den är det vår egen mall som skickat den hit, och
    // den här sidan finns bara för återställning. Allt annat (signup, email_change) hör hemma i
    // ett annat flöde och ska inte lösas in här — då hade vi verifierat en token åt fel syfte.
    const type = query.get('type');
    if (type && type !== 'recovery') return { kind: 'none' };
    return { kind: 'token_hash', tokenHash };
  }

  const accessToken = frag.get('access_token');
  if (accessToken) {
    // Samma grind som för `token_hash`, och lika nödvändig: fragmentet bär `type`, och en
    // magiclink-, invite- eller signup-länk som pekas hit skulle annars öppna formuläret som
    // sätter nytt lösenord UTAN att fråga efter det gamla. Bara återställning hör hemma här.
    const sessionType = frag.get('type');
    if (sessionType && sessionType !== 'recovery') return { kind: 'none' };

    // `setSession` kräver båda. Saknas refresh-token är länken obrukbar för oss, och att sätta en
    // halv session vore värre än att säga att den inte gick att använda.
    const refreshToken = frag.get('refresh_token');
    if (!refreshToken) return { kind: 'none' };
    return { kind: 'session', accessToken, refreshToken };
  }

  // Bara query: det är där en PKCE-redirect lägger koden, och det är där sidan letar efter beviset
  // på att den lösts in. Läses den även ur fragmentet glider de två isär — se varningen ovan.
  if (query.get('code')) return { kind: 'pkce-code' };

  return { kind: 'none' };
}

/**
 * Svensk förklaring till varför länken inte gick att använda.
 *
 * Den viktiga raden är `otp_expired`: den betyder nästan alltid "redan använd", inte "för gammal".
 * En engångstoken förbrukas av den FÖRSTA som hämtar adressen — och det är ofta mottagarens egen
 * mejlskanner (Outlook Safe Links och liknande följer länkar automatiskt), inte människan. Därför
 * nämner texten att länken kan vara förbrukad, så att den som läser den förstår att ett nytt mejl
 * är rätt åtgärd i stället för att klicka igen.
 */
/**
 * ⚠️ `description` ekas rakt av när koden inte känns igen. Skicka den BARA när den kommer från
 * SDK:ns svar — aldrig ur adressfältet. Se varningen på `RecoveryLink`s error-variant.
 */
export function describeRecoveryError(code: string, description?: string): string {
  const normalized = String(code || '').toLowerCase();

  if (normalized.includes('expired') || normalized === 'access_denied') {
    return 'Länken har gått ut eller är redan använd — återställningslänkar gäller en kort tid och bara en gång.';
  }
  if (normalized.includes('pkce') || normalized.includes('code_verifier') || normalized.includes('flow_state')) {
    return 'Länken kunde inte verifieras i den här webbläsaren.';
  }

  const raw = String(description || '').trim();
  return raw || 'Länken är ogiltig.';
}

/**
 * En `?code=`-länk från koden som fanns före implicit-omläggningen. Verifieraren den behöver
 * skrivs inte längre, så den kan inte lösas in — oavsett webbläsare. Säg det rakt ut: alternativet
 * är "ogiltig länk", vilket får folk att klicka igen och slå i rate-limiten på två mejl.
 */
export const STALE_PKCE_MESSAGE =
  'Länken kommer från en tidigare version av appen och går inte längre att använda.';

export const INDECISIVE_MESSAGE =
  'Vi kunde inte slutföra verifieringen just nu. Länken är kvar — ladda om sidan och försök igen.';

/**
 * Fick vi INGET avgörande besked om token?
 *
 * Styr om adressfältet får skrubbas. Engångstoken finns bara i URL:en — skrubbar vi den utan att
 * veta att den är förbrukad kastar vi bort en fullt giltig länk och tvingar fram ett nytt mejl
 * mot en rate limit på två, för att nätet hackade i en sekund.
 *
 * Tre lägen, och bara det sista rättfärdigar en skrubb:
 *
 *   • Kom aldrig fram      — `AuthRetryableFetchError` med status 0 (`lib/fetch.js:23`). Orörd.
 *   • Ovisst               — 429 (GoTrue rate-limitar `/verify` och avvisar FÖRE prövning) samt
 *                            502/503/504 och andra 5xx, där requesten nådde fram men svaret inte
 *                            säger något om token.
 *   • Avgjort              — allt annat: en riktig dom från GoTrue (`otp_expired` …) eller succé.
 *
 * 🧨 Vid ovisshet väljer vi att INTE skrubba, med flit. Är token ändå förbrukad ligger en värdelös
 * sträng kvar i historiken — det kostar ingenting. Är den giltig och vi skrubbat är användaren
 * låst i en timme. Asymmetrin avgör.
 */
export function isIndecisiveFailure(err: unknown): boolean {
  const e = err as { name?: string; status?: number } | null;
  if (!e) return false;
  // Täcker både status 0 och gateway-felen 502/503/504 (`lib/fetch.js:25`).
  if (e.name === 'AuthRetryableFetchError') return true;
  // 🧨 `AuthUnknownError` bär INGEN status (`errors.js:31`). Den uppstår när svarskroppen inte går
  // att parsa som JSON — alltså typiskt en 500/520/522 med en HTML-felsida från en gateway som
  // inte står i auth-js egen lista över nätverksfel. Utan raden hade `status ?? 0` gjort den
  // "avgjord" och skrubbat en oförbrukad token.
  if (e.name === 'AuthUnknownError') return true;
  const status = e.status ?? 0;
  return status === 429 || status >= 500;
}

/* ------------------------------------------------------------------------------------------- *
 * Markeringen "den här fliken löste in en återställningslänk"
 *
 * Sidan skrubbar engångstoken ur adressfältet så fort den är förbrukad. En omladdning ser då en
 * URL utan länkinformation, och utan markeringen tappar användaren formuläret mitt i — med en
 * redan förbrukad token, alltså tvingad att begära ett nytt mejl mot en rate limit på två.
 *
 * Kodningen ligger här, ren och testbar, för att det ÄR säkerhetsgrinden: bär den inte både vem
 * och när blir den ett skal som öppnar lösenordsbytet för fel person eller under obegränsad tid.
 * ------------------------------------------------------------------------------------------- */

export function encodeRecoveryMark(userId: string, now: number): string {
  return `${userId}:${now}`;
}

/** Användar-ID:t i markeringen, eller null om den saknas, är trasig eller har gått ut. */
export function decodeRecoveryMark(raw: string | null, now: number, ttlMs: number): string | null {
  if (!raw) return null;

  // Ankra på kolonet, inte på bindestrecket — ett UUID är fullt av bindestreck. `lastIndexOf` är
  // defensivt: dagens ID:n innehåller inga kolon, så det är samma sak som `indexOf` just nu.
  const at = raw.lastIndexOf(':');
  if (at <= 0) return null;

  const userId = raw.slice(0, at);
  const markedAt = Number(raw.slice(at + 1));
  // `Number('')` är 0, alltså "1970" — utan finit-kontrollen hade en trasig markering sett
  // urgammal ut och tyst gått ut, vilket är rätt utfall men av fel skäl. En framtida tidsstämpel
  // (klockan ställd bakåt) får inte heller förlänga fönstret.
  if (!Number.isFinite(markedAt) || markedAt > now) return null;
  if (now - markedAt > ttlMs) return null;

  return userId || null;
}
