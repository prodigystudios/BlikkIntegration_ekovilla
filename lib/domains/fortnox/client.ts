import { waitUntil } from '@vercel/functions';
import { getSupabaseAdminUncached } from '@/lib/supabase/server';
import type { FortnoxTokenResponse } from './types';

export const FORTNOX_API_BASE = 'https://api.fortnox.se/3';
export const FORTNOX_TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token';
export const FORTNOX_AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth';

// Scopes required by this integration.
// settings: needed for the terms-of-payment register (/termsofpayments) – per
//   Fortnox docs, "Terms Of Payments" is under the Settings scope. Must be enabled
//   on the Fortnox app registration, otherwise authorization fails with invalid_scope.
// price: needed for the price-list register (/pricelists).
// NOTE: changing this requires reconnecting Fortnox – existing tokens keep their
// originally-granted scopes until a new authorization is performed.
export const FORTNOX_SCOPES = 'article customer order offer invoice price settings';

export class FortnoxNotConnectedError extends Error {
  constructor() {
    super('Fortnox är inte kopplat. Anslut via CRM-inställningar.');
    this.name = 'FortnoxNotConnectedError';
  }
}

// Thrown when a concurrent push to the same document is already in flight (a fresh claim is
// held). Lets routes return 409 instead of creating a duplicate Fortnox document.
export class FortnoxPushInProgressError extends Error {
  constructor() {
    super('En synk mot Fortnox pågår redan för den här posten. Försök igen om en liten stund.');
    this.name = 'FortnoxPushInProgressError';
  }
}

// En avbruten arbetsorder skapas aldrig i Fortnox (lib/domains/fortnox/workOrderCancel.ts): dess Fortnox-order är
// makulerad, eller fanns aldrig, och en ny öppen order hade varit just den drift makuleringen finns för att hindra.
export class WorkOrderCancelledError extends Error {
  constructor() {
    super('Arbetsordern är avbruten och skickas inte till Fortnox.');
    this.name = 'WorkOrderCancelledError';
  }
}

// 🧨 FAKTURAN FINNS I FORTNOX, MEN CRM VET INTE OM DEN. Kastas när en delfaktura skapats hos Fortnox och sparandet
// efteråt fallerade. Meddelandet MÅSTE nå användaren ordagrant: friendlyFortnoxMessage svarar annars "Försök igen" —
// och ett nytt försök på en runda som inte sparats fakturerar samma antal en gång till.
export class FortnoxInvoiceNotRecordedError extends Error {
  constructor(public readonly invoiceNumber: string, message: string) {
    super(message);
    this.name = 'FortnoxInvoiceNotRecordedError';
  }
}

export class FortnoxApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Fortnox's own error code + message (parsed from the response body) so callers
    // can translate them to user-friendly text. `message` keeps the full technical
    // string for logs.
    public readonly fortnoxCode?: number,
    public readonly fortnoxMessage?: string,
  ) {
    super(message);
    this.name = 'FortnoxApiError';
  }
}

// Fortnox nekar refresh-tokenen (`{"error":"invalid_grant"}`). Uppmätt mot testbolaget 2026-10-01: en refresh-token
// går att använda EN gång — återanvänd nekas direkt, men den token den första förnyelsen gav lever vidare.
class FortnoxRefreshTokenRejectedError extends FortnoxApiError {}

// Refresh-tokenen nekas och ingen annan instans har sparat en ny: kedjan är bruten och bara en ny koppling hjälper.
// Ärver FortnoxApiError så att varje ställe som redan fångar Fortnox-fel fortsätter göra det. 503, inte Fortnox 400:
// ett 400 betyder "dokumentet är fel" för den som klassar felen (storeOrderFortnoxFailure gör inga omförsök på det), men
// det här går över när någon kopplat om.
export class FortnoxConnectionExpiredError extends FortnoxApiError {
  constructor(detail: string) {
    super(503, `Fortnox-kopplingen har slutat gälla: ${detail}`);
    this.name = 'FortnoxConnectionExpiredError';
  }
}

// Fortnox error bodies look like { "ErrorInformation": { "code": 2001243, "message": "..." } }.
// Exporterad för test: det är HÄR som avgörs om en FRIENDLY_FORTNOX_MESSAGES-mappning alls kan
// slå till. Ett test som bygger FortnoxApiError med en redan tolkad kod hoppar över steget, och
// skulle förbli grönt om Fortnox bytte till versalt `Code`.
export function parseFortnoxError(text: string): { code?: number; message?: string } {
  try {
    const info = (JSON.parse(text) as { ErrorInformation?: { code?: unknown; message?: unknown } })?.ErrorInformation;
    if (!info) return {};
    const code = typeof info.code === 'number' ? info.code : Number(info.code) || undefined;
    const message = typeof info.message === 'string' ? info.message : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

function buildFortnoxError(status: number, method: string, path: string, text: string): FortnoxApiError {
  const { code, message } = parseFortnoxError(text);
  return new FortnoxApiError(status, `Fortnox ${method} ${path} misslyckades (${status}): ${text}`, code, message);
}

// Exporterad: klienten äger rate-limit-policyn mot Fortnox, så de pass som throttlar sina egna
// anrop (artikelbeskrivningar, kundtyp-verifiering) ska använda samma paus i stället för att var
// och en bära en egen kopia.
export function fortnoxSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const sleep = fortnoxSleep;

// Fortnox rate-limits the API (~4 req/s). On 429 it returns Retry-After. Retry
// transparently with backoff so callers (sync passes, document pushes) ride out
// a throttle instead of failing. Caps the wait so a request never hangs forever.
const MAX_429_RETRIES = 5;
const MAX_BACKOFF_MS = 8000;

// Wraps fetch with transparent 429 handling. The body is drained between
// attempts so the connection can be reused; the final Response is returned
// untouched for the caller to read.
async function fortnoxFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= MAX_429_RETRIES) return res;

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    // Drain the throttle body so the socket frees up before we wait + retry.
    await res.text().catch(() => {});
    await sleep(waitMs);
  }
}

// Known Fortnox error codes → plain-language Swedish a salesperson understands.
// Add codes here as we hit them; unknown codes fall back to Fortnox's own message.
const FRIENDLY_FORTNOX_MESSAGES: Record<number, string> = {
  2001243: 'Offerten är låst eftersom en arbetsorder redan har skapats från den. Den går inte att ändra i efterhand.',
  2000499: 'Det finns redan en order kopplad till den här offerten.',
  2000310: 'Posten används redan i Fortnox och kan inte ändras eller tas bort.',
  2000204: 'En obligatorisk uppgift saknas i Fortnox. Komplettera kund-/offertuppgifterna och försök igen.',
  1000030: 'Kunde inte hämta dokumentet från Fortnox. Försök igen om en stund.',
  // Uppmätt i drift 2026-09-17 på en enskild firma: momsnumret var handinmatat ur ett org.nr som
  // inte ens var kontrollsiffre-giltigt, och låg kvar när org.numret rättades. Fortnox säger bara
  // "Ogiltigt VAT-nummer" — beskedet här pekar ut VAR det sitter och hur det ska se ut, eftersom
  // felet alltid är kundkortets och alltid samma åtgärd.
  // ⚠️ KORT MED FLIT. Beskedet levereras i en toast som försvinner efter fem sekunder, så det måste
  // gå att läsa i ett svep. Formen (01 är vanligast, koncerner kan ha 02/03) står i orgNumber.ts.
  2004194: 'Ogiltigt momsregistreringsnummer på kundkortet. Rätta det (normalt SE + org.nr + 01), '
    + 'eller töm fältet om företaget inte är momsregistrerat.',
  // Fortnox säger "skattereduktionstypen 'none' får inte innehålla rader med husarbetestypen X" —
  // sant, men det pekar ut dokumentet när felet sitter på ARTIKELN. Vi skickar aldrig husarbete på
  // ett icke-ROT-dokument; flaggan (`Housework` på artikeln i Fortnox) ärvs ner på raden och går
  // inte att överrösta därifrån — `HouseWork: false` stämplar EMPTYHOUSEWORK och nekas likaså.
  // Åtgärden ligger i artikelregistret. Se FORTNOX_INTEGRATION.md sekt. 4 punkt 3.
  2004021: 'En av artiklarna har en husarbetestyp satt i Fortnox, men dokumentet har inte ROT. '
    + 'Typen sitter på ARTIKELN och ärvs ner på raden — den går inte att stänga av härifrån. '
    + 'Obs: den syns oftast INTE i Fortnox artikelvy, eftersom en urkryssad husarbetesruta lämnar '
    + 'kvar typen. Kontakta en administratör — den behöver rensas via API:t '
    + '(PUT /articles/{nr} med HouseworkType: null).',
};

// Turn any thrown Fortnox error into a message safe to show a non-technical user.
export function friendlyFortnoxMessage(e: unknown): string {
  if (e instanceof FortnoxNotConnectedError) {
    return 'Fortnox är inte kopplat. Be en administratör ansluta Fortnox i CRM-inställningarna.';
  }
  if (e instanceof FortnoxPushInProgressError || e instanceof WorkOrderCancelledError || e instanceof FortnoxInvoiceNotRecordedError) {
    return e.message;
  }
  // Rutan i inställningarna säger fortfarande "Kopplad" (raden finns kvar), så beskedet måste säga vad som hjälper.
  if (e instanceof FortnoxConnectionExpiredError) {
    return 'Fortnox-kopplingen har slutat gälla. Be en administratör koppla från och ansluta Fortnox igen i CRM-inställningarna.';
  }
  if (e instanceof FortnoxApiError) {
    if (e.fortnoxCode && FRIENDLY_FORTNOX_MESSAGES[e.fortnoxCode]) {
      return FRIENDLY_FORTNOX_MESSAGES[e.fortnoxCode];
    }
    // Fortnox's own message is Swedish and usually readable — far better than the raw
    // "Fortnox PUT ... (400): {json}" technical string.
    if (e.fortnoxMessage) return e.fortnoxMessage;
    return 'Något gick fel mot Fortnox. Försök igen, eller kontakta support om det kvarstår.';
  }
  return 'Något gick fel. Försök igen.';
}

function getClientCredentials() {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FORTNOX_CLIENT_ID och FORTNOX_CLIENT_SECRET måste vara satta i miljön.');
  }
  return { clientId, clientSecret };
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

// Refresh access token using refresh_token. Returns new token response or throws.
export async function refreshAccessToken(refreshToken: string): Promise<FortnoxTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();

  const res = await fetch(FORTNOX_TOKEN_URL, {
    method: 'POST',
    // Aldrig ur Next datacache: ett cachat svar ger en refresh-token som Fortnox redan har förbrukat.
    cache: 'no-store',
    // MED FLIT ingen tidsgräns: Fortnox kan ha roterat tokenen när vi ger upp, och då är den nya tokenen borta och
    // kedjan bruten. Tar anropet längre än anspråkets fönster och någon tar över, nekas den (invalid_grant) och väntar
    // in vårt sparande.
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    const message = `Token refresh misslyckades: ${text}`;
    if (res.status === 400 && parseOAuthError(text) === 'invalid_grant') {
      throw new FortnoxRefreshTokenRejectedError(res.status, message);
    }
    throw new FortnoxApiError(res.status, message);
  }

  return res.json() as Promise<FortnoxTokenResponse>;
}

// Token-ändpunktens fel är OAuth:s, inte Fortnox ErrorInformation: `{"error":"invalid_grant","error_description":…}`.
function parseOAuthError(text: string): string | undefined {
  try {
    const error = (JSON.parse(text) as { error?: unknown })?.error;
    return typeof error === 'string' ? error : undefined;
  } catch {
    return undefined;
  }
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Bara en instans åt gången får förnya. Uppmätt mot testbolaget 2026-10-01: två förnyelser med samma refresh-token i
// samma ögonblick får BÅDA nya tokens, men bara det senast utdelade paret gäller — sparas det andra är kedjan bruten.
// Ett anspråk äldre än så här räknas som övergivet (instansen dog). Långt över en förnyelse (under en sekund) plus
// sparandet med omförsök (~5 s), så att ingen tar över medan förnyelsen pågår.
const REFRESH_CLAIM_STALE_MS = 20_000;
// Hur ofta den som väntar på någon annans förnyelse läser om raden, och hur länge den väntar som mest: längre än ett
// övergivet anspråk plus en förnyelse, så att den hinner ta över.
const REFRESH_CLAIM_POLL_MS = 250;
const REFRESH_CLAIM_MAX_WAIT_MS = 40_000;
// Sparandet av en förnyad token görs om: Fortnox har redan förbrukat den gamla, så ett tappat sparande bryter kedjan.
const PERSIST_RETRY_DELAYS_MS = [250, 1000, 3000];
// Hur länge en nekad förnyelse väntar på att en annan instans sparar sin nya token (en instans utan anspråket, t.ex. med
// den gamla koden under en deploy). Fortnox nekar den återanvända tokenen fortare (~0,2 s) än den första förnyelsen
// hinner svara (~0,7 s), så den andra måste vänta in sparandet — också dess omförsök.
const REJECTED_REFRESH_REREAD_DELAYS_MS = [250, 500, 1000, 2000, 2000];

// Raden läses med `*`: refresh_claimed_at finns först efter migreringen 20261001113130, och en namngiven kolumn som
// saknas hade fällt varje läsning — och med den varje Fortnox-anrop.
type TokenRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  connected_at: string;
  refresh_claimed_at?: string | null;
};
type TokenStore = ReturnType<typeof getSupabaseAdminUncached>;

function isFresh(row: Pick<TokenRow, 'expires_at'>): boolean {
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS < new Date(row.expires_at).getTime();
}

function isClaimHeld(row: TokenRow): boolean {
  return !!row.refresh_claimed_at && new Date(row.refresh_claimed_at).getTime() > Date.now() - REFRESH_CLAIM_STALE_MS;
}

async function readTokenRow(supabase: TokenStore): Promise<TokenRow | null> {
  const { data, error } = await supabase.from('fortnox_integrations').select('*').eq('provider', 'fortnox').maybeSingle();
  // Ett läsfel är inte "inte kopplat": det hade fått anropare att tyst hoppa över en push.
  if (error) throw new Error(`Fortnox-tokenen gick inte att läsa: ${error.message}`);
  return data;
}

// Single-flight guard: when a refresh is in progress, concurrent callers await
// the same promise instead of each firing their own. Scoped per process; across
// instances the claim on the row (refresh_claimed_at) does the same job.
let inflightRefresh: Promise<string> | null = null;

// En refresh-token som Fortnox nekat och som ingen ersatt: kedjan är bruten tills någon kopplar om. Utan minnet hade
// varje anrop gått hela vägen (anspråk, Fortnox, omläsningar i ~6 s) innan det föll. Bara i den här processen; en ny
// koppling byter tokenen och släpper spärren.
let deadRefreshToken: string | null = null;

// Refresh the access token and persist the rotated tokens. Re-reads the row
// first and re-checks expiry: a caller queued behind the lock may find the token
// already refreshed by the call it waited on, in which case it must NOT refresh
// again with the now-rotated refresh_token. Another instance holding the claim is
// waited out the same way: its saved token makes the row fresh.
async function refreshAndPersist(): Promise<string> {
  const supabase = getSupabaseAdminUncached();
  const giveUpAt = Date.now() + REFRESH_CLAIM_MAX_WAIT_MS;

  for (;;) {
    const row = await readTokenRow(supabase);
    if (!row) throw new FortnoxNotConnectedError();
    if (isFresh(row)) return row.access_token;
    if (row.refresh_token === deadRefreshToken) {
      throw new FortnoxConnectionExpiredError('refresh-tokenen har redan nekats');
    }

    // Ett färskt anspråk hos någon annan: vänta, utan att försöka ta det.
    const claim: RefreshClaim = isClaimHeld(row) ? { kind: 'held' } : await claimRefresh(supabase, row);
    if (claim.kind !== 'held') return refreshWith(supabase, row, claim.kind === 'claimed' ? claim.stamp : null);

    if (Date.now() >= giveUpAt) {
      console.error('[fortnox-token] en annan instans håller förnyelsen och blir inte klar');
      throw new FortnoxApiError(503, 'Fortnox-tokenen förnyas av en annan instans som inte blir klar');
    }
    await sleep(REFRESH_CLAIM_POLL_MS);
  }
}

type RefreshClaim = { kind: 'claimed'; stamp: string } | { kind: 'held' } | { kind: 'unavailable' };

// Anspråket på att förnya radens token, som claimFortnoxPush: två villkorade UPDATE, eftersom PostgREST inte godtar .or()
// på en ändring. Av två samtidiga vinner en; den andra träffar 0 rader. 0 rader betyder också att tokenen redan har
// bytts — läs om. Versionen är expires_at, som byts vid varje förnyelse och koppling: refresh-tokenen själv hade hamnat i
// URL:en, och därmed i Supabase loggar.
async function claimRefresh(supabase: TokenStore, row: TokenRow): Promise<RefreshClaim> {
  const stamp = new Date().toISOString();
  const staleBefore = new Date(Date.now() - REFRESH_CLAIM_STALE_MS).toISOString();

  const free = await supabase
    .from('fortnox_integrations')
    .update({ refresh_claimed_at: stamp })
    .eq('provider', 'fortnox')
    .eq('expires_at', row.expires_at)
    .is('refresh_claimed_at', null)
    .select('id');
  if (free.error) return claimFailed(free.error);
  if (free.data && free.data.length > 0) return { kind: 'claimed', stamp };

  const abandoned = await supabase
    .from('fortnox_integrations')
    .update({ refresh_claimed_at: stamp })
    .eq('provider', 'fortnox')
    .eq('expires_at', row.expires_at)
    .lt('refresh_claimed_at', staleBefore)
    .select('id');
  if (abandoned.error) return claimFailed(abandoned.error);
  return abandoned.data && abandoned.data.length > 0 ? { kind: 'claimed', stamp } : { kind: 'held' };
}

// Bara en saknad kolumn (koden före migreringen: PGRST204 i kroppen, 42703 i filtret) förnyar utan lås — att stänga ute
// Fortnox vore värre. Andra fel är inget vunnet anspråk: vänta och försök igen, annars förnyar två instanser samtidigt.
function claimFailed(error: { code?: string; message: string }): RefreshClaim {
  if (error.code === 'PGRST204' || error.code === '42703') {
    console.error('[fortnox-token] kolumnen för anspråket saknas; förnyar utan lås', error.message);
    return { kind: 'unavailable' };
  }
  console.error('[fortnox-token] anspråket gick inte att ta; försöker igen', error.message);
  return { kind: 'held' };
}

async function refreshWith(supabase: TokenStore, row: TokenRow, claimedAt: string | null): Promise<string> {
  let refreshed: FortnoxTokenResponse;
  try {
    refreshed = await refreshAccessToken(row.refresh_token);
  } catch (e) {
    if (claimedAt) await releaseClaim(supabase, claimedAt);
    if (!(e instanceof FortnoxRefreshTokenRejectedError)) {
      console.error('[fortnox-token] förnyelsen misslyckades', e instanceof Error ? e.message : e);
      throw e;
    }
    return adoptConcurrentRefresh(supabase, row.refresh_token, e);
  }

  await persistRefreshedTokens(supabase, row, refreshed, claimedAt !== null);
  return refreshed.access_token;
}

// Släpper vårt anspråk när förnyelsen misslyckades, så att de som väntar inte behöver vänta ut det. Bara vårt eget: har
// någon tagit över ett anspråk vi höll för länge är det deras nu. Ett fel här är ofarligt, anspråket blir övergivet ändå.
async function releaseClaim(supabase: TokenStore, claimedAt: string): Promise<void> {
  await supabase
    .from('fortnox_integrations')
    .update({ refresh_claimed_at: null })
    .eq('provider', 'fortnox')
    .eq('refresh_claimed_at', claimedAt)
    .select('id');
}

// Fortnox nekade tokenen vi läste: en annan instans förnyade med samma token en stund före oss och sparar just nu sin
// nya. Byts raden medan vi väntar är kedjan hel — använd den. Annars är den bruten.
async function adoptConcurrentRefresh(
  supabase: TokenStore,
  rejectedRefreshToken: string,
  cause: FortnoxRefreshTokenRejectedError,
): Promise<string> {
  for (const delay of REJECTED_REFRESH_REREAD_DELAYS_MS) {
    await sleep(delay);
    const row = await readTokenRow(supabase);
    if (!row) throw new FortnoxNotConnectedError();
    if (row.refresh_token !== rejectedRefreshToken) {
      console.warn('[fortnox-token] refresh-tokenen var redan förbrukad; använder den som en annan instans sparade');
      return row.access_token;
    }
  }
  console.error('[fortnox-token] refresh-tokenen nekas och ingen ny har sparats: kopplingen måste göras om', cause.message);
  deadRefreshToken = rejectedRefreshToken;
  throw new FortnoxConnectionExpiredError(cause.message);
}

// Sparar över den version vi förnyade (expires_at). Har raden bytts under tiden:
//   - en ny koppling (connected_at ändrat) ligger kvar orörd;
//   - annars hann en annan förnyelse av samma token spara först (en instans utan anspråket). Fortnox godtar bara det
//     senast utdelade paret, och vårt svar kom efter deras sparande — skriv över, en gång.
// Misslyckas sparandet trots omförsöken gäller den nya access-tokenen bara för det här anropet: raden har kvar den
// förbrukade refresh-tokenen, och nästa förnyelse nekas.
async function persistRefreshedTokens(
  supabase: TokenStore,
  row: TokenRow,
  refreshed: FortnoxTokenResponse,
  claimed: boolean,
): Promise<void> {
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const tokens = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
    // Bara den som tog anspråket nollar det: då finns kolumnen. Före migreringen hade en okänd kolumn fällt sparandet.
    ...(claimed ? { refresh_claimed_at: null } : {}),
  };

  const first = await writeTokens(supabase, tokens, row.expires_at);
  if (first === 'written') {
    console.info('[fortnox-token] förnyad, gäller till', expiresAt);
    return;
  }
  if (first === 'failed') return;

  const current = await readTokenRow(supabase);
  if (!current || current.connected_at !== row.connected_at) {
    console.warn('[fortnox-token] Fortnox kopplades om eller från under förnyelsen; raden ligger kvar orörd');
    return;
  }
  console.warn('[fortnox-token] två förnyelser av samma token; den senaste sparas');
  const second = await writeTokens(supabase, tokens, current.expires_at);
  if (second === 'moved') console.warn('[fortnox-token] raden byttes igen; den ligger kvar orörd');
}

async function writeTokens(
  supabase: TokenStore,
  tokens: Record<string, string | null>,
  expectedExpiresAt: string,
): Promise<'written' | 'moved' | 'failed'> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase
      .from('fortnox_integrations')
      .update(tokens)
      .eq('provider', 'fortnox')
      .eq('expires_at', expectedExpiresAt)
      .select('id');
    if (!error) return data && data.length > 0 ? 'written' : 'moved';
    if (attempt >= PERSIST_RETRY_DELAYS_MS.length) {
      console.error('[fortnox-token] den förnyade tokenen kunde inte sparas: nästa förnyelse kommer att nekas', error.message);
      return 'failed';
    }
    await sleep(PERSIST_RETRY_DELAYS_MS[attempt]);
  }
}

// Returns a valid access token, refreshing if needed (5-minute buffer).
async function getValidAccessToken(): Promise<string> {
  const row = await readTokenRow(getSupabaseAdminUncached());

  if (!row) throw new FortnoxNotConnectedError();
  if (isFresh(row)) return row.access_token;

  // Near/at expiry: collapse all concurrent refreshes into one in-flight call.
  // Cleared on settle so the next expiry cycle (or a retry after failure) starts fresh.
  if (!inflightRefresh) {
    inflightRefresh = refreshAndPersist().finally(() => {
      inflightRefresh = null;
    });
    // Fortnox roterar tokenen innan vi sparat den nya. Har svaret redan gått (en anropare som inte väntade in
    // förnyelsen) får Vercel inte frysa instansen mittemellan. Utanför Vercel gör anropet ingenting.
    waitUntil(inflightRefresh.catch(() => {}));
  }
  return inflightRefresh;
}

// Perform a GET request to the Fortnox API.
export async function fortnoxGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getValidAccessToken();
  const url = new URL(`${FORTNOX_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fortnoxFetch(url.toString(), {
    // Never serve a cached response – Next.js App Router caches fetch() by
    // default, which would return stale Fortnox data after a write.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'GET', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a GET that returns a binary document (e.g. an offer/order/invoice PDF
// from the `/print` endpoints). Unlike fortnoxGet this requests a non-JSON body and
// returns the raw bytes + content type.
export async function fortnoxGetBinary(
  path: string,
  accept = 'application/pdf',
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const token = await getValidAccessToken();

  const res = await fortnoxFetch(`${FORTNOX_API_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw buildFortnoxError(res.status, 'GET', path, text);
  }

  const buf = await res.arrayBuffer();
  // Fall back to application/pdf (the actual document type), NOT `accept` — callers pass
  // accept='application/json' as a Fortnox workaround, so using it as the fallback would
  // mislabel a valid PDF that arrives without a Content-Type header.
  return { bytes: new Uint8Array(buf), contentType: res.headers.get('content-type') || 'application/pdf' };
}

// Perform a PUT request to the Fortnox API (e.g. offer → order conversion).
export async function fortnoxPut<T>(path: string, body?: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fortnoxFetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'PUT', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a POST request to the Fortnox API.
export async function fortnoxPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fortnoxFetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'POST', path, text);
  }

  return res.json() as Promise<T>;
}

// Perform a DELETE request to the Fortnox API. Fortnox returns an empty body
// (204) on success, so unlike GET/POST/PUT this does not parse JSON.
export async function fortnoxDelete(path: string): Promise<void> {
  const token = await getValidAccessToken();

  const res = await fortnoxFetch(`${FORTNOX_API_BASE}${path}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw buildFortnoxError(res.status, 'DELETE', path, text);
  }
}
