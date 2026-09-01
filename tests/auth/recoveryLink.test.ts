import { describe, it, expect } from 'vitest';
import {
  decodeRecoveryMark,
  describeRecoveryError,
  encodeRecoveryMark,
  isIndecisiveFailure,
  parseRecoveryLink,
} from '@/app/auth/reset-password-confirm/recoveryLink';

const BASE = 'https://app.ekovilla.se/auth/reset-password-confirm';

describe('parseRecoveryLink', () => {
  it('läser token_hash ur mejlmallens länk — den form som ska fungera överallt', () => {
    const link = parseRecoveryLink(`${BASE}?token_hash=8ab3f1c0d9&type=recovery`);
    expect(link).toEqual({ kind: 'token_hash', tokenHash: '8ab3f1c0d9' });
  });

  it('godtar token_hash utan type — mallen är vår egen och sidan finns bara för återställning', () => {
    expect(parseRecoveryLink(`${BASE}?token_hash=abc`)).toEqual({ kind: 'token_hash', tokenHash: 'abc' });
  });

  it('vägrar lösa in en token för ett ANNAT syfte än recovery', () => {
    // En signup- eller email_change-token hör hemma i ett annat flöde. Löser vi in den här
    // bekräftar vi något användaren aldrig bad om på den här sidan.
    expect(parseRecoveryLink(`${BASE}?token_hash=abc&type=signup`).kind).toBe('none');
    expect(parseRecoveryLink(`${BASE}?token_hash=abc&type=email_change`).kind).toBe('none');
  });

  it('plockar ut BÅDA tokens ur en implicit fragment-länk', () => {
    const link = parseRecoveryLink(`${BASE}#access_token=at123&refresh_token=rt456&type=recovery`);
    expect(link).toEqual({ kind: 'session', accessToken: 'at123', refreshToken: 'rt456' });
  });

  it('vägrar en halv implicit länk — setSession kräver refresh-token', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=at123&type=recovery`).kind).toBe('none');
  });

  it('🧨 vägrar en implicit länk för ett ANNAT syfte — samma grind som för token_hash', () => {
    // Asymmetrin var buggen: `token_hash` hade grinden, fragmentet inte. En magiclink- eller
    // invite-länk som pekas hit hade då öppnat formuläret som sätter nytt lösenord utan att
    // fråga efter det gamla.
    for (const type of ['magiclink', 'invite', 'signup', 'email_change']) {
      expect(parseRecoveryLink(`${BASE}#access_token=at&refresh_token=rt&type=${type}`).kind).toBe('none');
    }
  });

  it('🧨 `?code=` får ALDRIG räknas som en giltig session', () => {
    // Det här är kontoövertagandet. Behandlades `?code=` som "supabase-js har redan fixat det"
    // räckte det att skriva ?code=vadsomhelst i en inloggad webbläsare för att få upp formuläret
    // — och byta någon annans lösenord.
    //
    // `pkce-code` betyder bara "adressen har den formen". Om länken FAKTISKT gick att lösa in kan
    // den här funktionen inte veta; det avgör sidan, genom att se om koden försvann ur URL:en.
    expect(parseRecoveryLink(`${BASE}?code=abc123`).kind).toBe('pkce-code');
    expect(parseRecoveryLink(`${BASE}?code=vadsomhelst`).kind).toBe('pkce-code');
  });

  it('🧨 `#code=` i FRAGMENTET är inte en PKCE-länk — det var ett kontoövertagande', () => {
    // Läste parsern koden ur fragmentet men sidan sitt bevis ur query gled de två isär: beviset
    // uteblev alltid, sidan föll tillbaka på "finns en session?" och visade lösenordsformuläret
    // för den som råkade vara inloggad. En riktig PKCE-redirect lägger ALLTID koden i query.
    expect(parseRecoveryLink(`${BASE}#code=abc123`).kind).toBe('none');
    expect(parseRecoveryLink(`${BASE}#code=abc&access_token=`).kind).toBe('none');
  });

  it('läser GoTrue-felet ur FRAGMENTET — det är där det hamnar, inte i query', () => {
    // Exakt sträng som GoTrue svarade med i produktion när token var förbrukad. Läser man bara
    // query-strängen är den här länken omöjlig att skilja från ett direktbesök.
    const href = `${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
    const link = parseRecoveryLink(href);
    expect(link.kind).toBe('error');
    if (link.kind !== 'error') throw new Error('fel form');
    expect(link.code).toBe('otp_expired');
    // `+` är mellanslag i en query-sträng — avkodas, annars visas det rått för användaren.
    expect(link.description).toBe('Email link is invalid or has expired');
  });

  it('läser felet ur query också — PKCE lägger det där', () => {
    const link = parseRecoveryLink(`${BASE}?error=access_denied&error_code=flow_state_not_found`);
    expect(link.kind).toBe('error');
    if (link.kind !== 'error') throw new Error('fel form');
    expect(link.code).toBe('flow_state_not_found');
  });

  it('ett fel vinner över en token som ligger kvar i samma URL', () => {
    const href = `${BASE}?token_hash=abc#error=access_denied&error_code=otp_expired`;
    expect(parseRecoveryLink(href).kind).toBe('error');
  });

  it('direktbesök utan länkinformation ger none', () => {
    expect(parseRecoveryLink(BASE).kind).toBe('none');
    expect(parseRecoveryLink('inte-en-url').kind).toBe('none');
  });
});

describe('describeRecoveryError', () => {
  it('säger uttryckligen att länken kan vara REDAN ANVÄND, inte bara för gammal', () => {
    // Den vanligaste orsaken är att mottagarens mejlskanner följt länken före människan. Står det
    // bara "har gått ut" klickar användaren igen i stället för att begära en ny — och slår i
    // Supabases rate limit på två mejl.
    // `otp_expired` är exakt den kod projektets GoTrue svarar med; verifierat mot /auth/v1/verify.
    const msg = describeRecoveryError('otp_expired', 'Email link is invalid or has expired');
    expect(msg).toContain('redan använd');
  });

  it('faller tillbaka på GoTrues egen beskrivning för okända koder', () => {
    // ⚠️ Funktionen ekar beskrivningen rakt av. Därför är det ANROPARENS ansvar att bara skicka
    // med den när den kommer från SDK:ns svar — aldrig ur adressfältet, som vem som helst kan
    // fylla med egen text och få den att stå i appens felruta på vår riktiga domän.
    expect(describeRecoveryError('nagot_nytt', 'Something specific')).toBe('Something specific');
  });

  it('har alltid en text att visa, även utan kod och beskrivning', () => {
    expect(describeRecoveryError('', '')).toBeTruthy();
  });

  it('upprepar inte uppmaningen som sidan själv skriver ut', () => {
    // Sidan renderar "Be om en ny på <länk>". Skrev texten också "begär en ny nedan" stod det
    // två gånger — och "nedan" pekar på ingenting, länken sitter inline.
    for (const code of ['otp_expired', 'flow_state_not_found', '']) {
      expect(describeRecoveryError(code, '')).not.toMatch(/nedan|begär en ny/i);
    }
  });
});

describe('återställningsmarkeringen', () => {
  const USER = '3f1a9c40-8b2e-4d77-9a51-0c6e2b8f4d13';
  const TTL = 15 * 60 * 1000;
  const NOW = 1_756_700_000_000;

  it('bär både VEM och NÄR — och läses tillbaka', () => {
    expect(decodeRecoveryMark(encodeRecoveryMark(USER, NOW), NOW, TTL)).toBe(USER);
  });

  it('överlever ett UUID med bindestreck', () => {
    // Vad det här FAKTISKT bevisar: att avkodningen ankrar på kolonet och inte på bindestrecket.
    // Delas markeringen på bindestreck kapas ID:t mitt itu — mutationsprövat, blir rött.
    // Vad det INTE kan bevisa: skillnaden mellan första och sista kolonet. Ett UUID innehåller
    // inga kolon, så de två är samma sak här. `lastIndexOf` i källan är rent defensivt.
    const decoded = decodeRecoveryMark(encodeRecoveryMark(USER, NOW), NOW, TTL);
    expect(decoded).toContain('-');
    expect(decoded).toHaveLength(36);
  });

  it('🧨 går ut — en övergiven återställning får inte stå öppen i fliken', () => {
    const mark = encodeRecoveryMark(USER, NOW);
    expect(decodeRecoveryMark(mark, NOW + TTL - 1, TTL)).toBe(USER);
    expect(decodeRecoveryMark(mark, NOW + TTL + 1, TTL)).toBeNull();
  });

  it('godtar inte en tidsstämpel i framtiden', () => {
    // Klockan ställd bakåt skulle annars förlänga fönstret godtyckligt.
    expect(decodeRecoveryMark(encodeRecoveryMark(USER, NOW + 60_000), NOW, TTL)).toBeNull();
  });

  it('avvisar trasiga och tomma markeringar', () => {
    expect(decodeRecoveryMark(null, NOW, TTL)).toBeNull();
    expect(decodeRecoveryMark('', NOW, TTL)).toBeNull();
    expect(decodeRecoveryMark('1', NOW, TTL)).toBeNull();          // inget kolon
    expect(decodeRecoveryMark(`:${NOW}`, NOW, TTL)).toBeNull();     // inget användar-ID
    expect(decodeRecoveryMark(`${USER}:abc`, NOW, TTL)).toBeNull(); // ingen tidsstämpel
    expect(decodeRecoveryMark(`${USER}:`, NOW, TTL)).toBeNull();    // tom tidsstämpel → inte 1970
  });
});

describe('isIndecisiveFailure', () => {
  it('🧨 skiljer "inget besked om token" från "GoTrue har dömt"', () => {
    // Avgör om engångstoken får skrubbas ur adressfältet. auth-js RETURNERAR felet, kastar inte.
    expect(isIndecisiveFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    // En riktig dom: token ÄR förbrukad, adressen ska skrubbas.
    expect(isIndecisiveFailure({ name: 'AuthApiError', status: 403, code: 'otp_expired' })).toBe(false);
    expect(isIndecisiveFailure(null)).toBe(false);
    expect(isIndecisiveFailure(undefined)).toBe(false);
  });

  it('🧨 429 och 5xx säger ingenting om token — behandlas som ovissa', () => {
    // 429: GoTrue rate-limitar `/verify` och avvisar FÖRE prövning, alltså är token orörd.
    // 5xx: requesten nådde fram men svaret säger inget. Skrubbade vi där skulle en fullt giltig
    // länk kastas bort och användaren låsas i en timme mot rate-limiten på två mejl.
    expect(isIndecisiveFailure({ name: 'AuthApiError', status: 429 })).toBe(true);
    expect(isIndecisiveFailure({ name: 'AuthApiError', status: 500 })).toBe(true);
    for (const status of [502, 503, 504]) {
      expect(isIndecisiveFailure({ name: 'AuthRetryableFetchError', status })).toBe(true);
    }
  });

  it('🧨 AuthUnknownError bär ingen status — får inte falla igenom som "avgjord"', () => {
    // Uppstår när svarskroppen inte går att parsa (errors.js:31) — typiskt en gateway-felsida i
    // HTML med status 520/522, som inte står i auth-js egen lista över nätverksfel. Utan
    // namnkontrollen blir `status ?? 0` noll och felet räknas som en dom från GoTrue.
    expect(isIndecisiveFailure({ name: 'AuthUnknownError', message: 'Unexpected token <' })).toBe(true);
  });
});
