// Vad ska push-synken göra vid inloggning? Ren beslutsfunktion, ingen I/O.
//
// Bakgrund: appen flyttade till app.ekovilla.se och den gamla vercel.app-adressen lever kvar.
// Både service worker-registreringen, PushSubscription-objektet OCH Notification.permission är
// origin-scopade. En användare som beviljade notiser på den gamla adressen har därför
// permission === 'default' på den nya — inte 'granted'. Migreringen kan alltså inte göras tyst;
// requestPermission() kräver i praktiken en användargest i alla moderna webbläsare.
//
// Logiken bor här och inte i hooken därför att grenvalet är det som faktiskt kan bli fel, och
// hooken är "use client" och kräver en webbläsare för att köras.

export type PushPermission = 'default' | 'granted' | 'denied';

export type PushSyncAction =
  /** Lokal prenumeration finns → POST:a om den. Upserten är idempotent på endpoint, så det
   *  stämplar origin-kolumnen och återskapar en tappad databasrad utan att fråga servern först. */
  | 'persist'
  /** Ingen lokal prenumeration, men tillståndet är redan beviljat på DET HÄR originet → skapa en
   *  ny prenumeration utan att visa något. Träffar den som beviljat här och sedan tappat sin rad,
   *  inte den som kommer från den gamla adressen. */
  | 'resubscribe-silently'
  /** Ingen lokal prenumeration och tillståndet är obesvarat → visa en avfärdbar uppmaning.
   *  Det är den här grenen som bär migreringen från den gamla adressen. */
  | 'prompt'
  /** Gör ingenting. Antingen är notiser blockerade, användaren har stängt av dem själv, eller så
   *  har uppmaningen redan avfärdats. */
  | 'idle';

export type PushSyncInput = {
  /** Har den här webbläsaren en PushSubscription på det här originet? */
  hasSubscription: boolean;
  /** Notification.permission, origin-scopat. */
  permission: PushPermission;
  /** Användaren har stängt av notiser här med avsikt (sparat lokalt vid disable()). */
  optedOut: boolean;
  /** Uppmaningen har avfärdats en gång och ska inte återkomma. */
  promptDismissed: boolean;
  /** Den här webbläsaren har någon gång haft en prenumeration på det här originet. */
  hadSubscription: boolean;
};

/**
 * Nyckel i localStorage: användaren stängde av notiser med avsikt på det här originet.
 *
 * Behövs för att 'resubscribe-silently' annars skulle slåss med disable(): efter en avstängning
 * är tillståndet fortfarande 'granted' och den lokala prenumerationen borta — exakt formen på
 * "beviljad men tappad rad". Utan flaggan hade nästa sidladdning tyst slagit på notiserna igen.
 */
export const PUSH_OPT_OUT_KEY = 'push:opted-out:v1';

/** Nyckel i localStorage: uppmaningen om att slå på notiser igen har avfärdats. */
export const PUSH_PROMPT_DISMISSED_KEY = 'push:reactivation-dismissed:v1';

/** Nyckel i sessionStorage: endpoint vi redan POST:at om under den här webbläsarsessionen. */
export const PUSH_PERSISTED_ENDPOINT_KEY = 'push:persisted-endpoint:v1';

/**
 * Nyckel i localStorage: den här webbläsaren HAR haft en prenumeration på det här originet.
 *
 * Grindar den tysta omprenumerationen. Utan den träffar 'granted utan prenumeration' också den som
 * stängde av notiser INNAN av-vals-flaggan fanns — de har beviljat tillstånd, ingen prenumeration
 * och ingen flagga, exakt samma form som "tappad rad" — och vi hade tyst slagit på notiserna igen
 * för någon som valt bort dem. Samma sak händer om localStorage vräks (Safari/ITP) medan
 * tillståndet överlever. Saknas markören faller vi tillbaka på att FRÅGA, vilket alltid är säkert.
 */
export const PUSH_HAD_SUBSCRIPTION_KEY = 'push:had-subscription:v1';

/** Hämtar webbläsarens storage utan att kasta. Vissa privatlägen kastar redan på åtkomsten. */
export function browserStorage(kind: 'local' | 'session'): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Minsta delen av Storage vi använder. Gör flaggorna testbara utan webbläsare. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Läs en lokal flagga. Kastar storage (privat läge, blockerade cookies) tolkas det som "inte satt"
 * hellre än att synken kraschar — värsta utfallet blir då en uppmaning som visas en gång till.
 */
export function readFlag(storage: StorageLike | null | undefined, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(storage: StorageLike | null | undefined, key: string, value: boolean): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Ska den här endpointen POST:as om under den här webbläsarsessionen?
 *
 * Synken kör vid varje montering av notisklockan, som sitter i app-skalet — utan spärr blir det en
 * skrivning per sidladdning. En gång per session räcker för att stämpla origin och för att läka en
 * tappad databasrad.
 *
 * Kvitteringen ligger i `markEndpointPersisted` och ska ske FÖRST när POST:en lyckats. Markerar man
 * i förväg räcker ett 401 (utgången session vid montering) för att stämplingen ska hoppas över
 * resten av sessionen — och en ostämplad men levande rad är precis vad städscriptet tolkar som
 * skräp.
 */
export function shouldPersistEndpoint(storage: StorageLike | null | undefined, endpoint: string): boolean {
  if (!endpoint) return false;
  if (!storage) return true;
  try {
    return storage.getItem(PUSH_PERSISTED_ENDPOINT_KEY) !== endpoint;
  } catch {
    // Utan fungerande storage kan vi inte minnas — POST:a hellre en gång för mycket.
    return true;
  }
}

/** Kvittera en lyckad omPOST. Anropas bara när svaret var ok. */
export function markEndpointPersisted(storage: StorageLike | null | undefined, endpoint: string): void {
  if (!storage || !endpoint) return;
  try {
    storage.setItem(PUSH_PERSISTED_ENDPOINT_KEY, endpoint);
  } catch {
    // ignore
  }
}

export function decidePushSync(input: PushSyncInput): PushSyncAction {
  // Ett medvetet av-val vinner över allt annat, ÄVEN över en prenumeration som ligger kvar.
  // `unsubscribe()` returnerar false vid misslyckande utan att kasta, så av-valet kan mycket väl
  // ha skrivits medan prenumerationen lever. POST:ar vi då om den återuppstår raden som
  // avstängningen just raderade, och notiserna kommer tillbaka för någon som stängt av dem.
  if (input.optedOut) return 'idle';

  // Finns en prenumeration är det enda vi behöver göra att se till att servern känner till den.
  if (input.hasSubscription) return 'persist';

  // Blockerat i enhetens inställningar. Vi kan inte fråga igen, så vi tiger.
  if (input.permission === 'denied') return 'idle';

  // Tillstånd beviljat här OCH bevis för att den här webbläsaren har haft en prenumeration →
  // raden är tappad, inte bortvald. Bara då prenumererar vi om utan att fråga.
  if (input.permission === 'granted' && input.hadSubscription) return 'resubscribe-silently';

  // Allt annat går via ett synligt val, en gång. Det gäller också 'granted' utan markör: den som
  // stängde av innan flaggorna fanns ska tillfrågas, inte överkörad.
  return input.promptDismissed ? 'idle' : 'prompt';
}
