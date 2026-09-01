"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
  decodeRecoveryMark,
  describeRecoveryError,
  encodeRecoveryMark,
  isIndecisiveFailure,
  INDECISIVE_MESSAGE,
  parseRecoveryLink,
  STALE_PKCE_MESSAGE,
} from './recoveryLink';

/**
 * Markering för "den här fliken har löst in en återställningslänk".
 *
 * Behövs för omladdningen: vi skrubbar engångstoken ur adressfältet så fort den är förbrukad, så
 * en omladdning ser en URL utan länkinformation. Utan markeringen skulle användaren tappa
 * formuläret mitt i — med en redan förbrukad token, alltså tvingad att begära ett nytt mejl och
 * riskera Supabases rate limit på två.
 *
 * `sessionStorage` och inte `localStorage`: markeringen ska dö med fliken. Den får aldrig ligga
 * kvar och öppna formuläret för nästa person vid datorn.
 */
const RECOVERY_MARK = 'ekovilla:password-recovery';

/**
 * Hur länge markeringen får öppna formuläret. Kort med flit: en påbörjad men ÖVERGIVEN
 * återställning — någon löser in länken, ser formuläret och går därifrån — hade annars lämnat ett
 * lösenordsbyte-utan-gammalt-lösenord öppet i fliken så länge den stod kvar. Det är just den
 * lånade olåsta webbläsaren grinden finns för att stänga.
 */
const RECOVERY_MARK_TTL_MS = 15 * 60 * 1000;

function markRecoveryInThisTab(userId: string | undefined) {
  if (!userId) return;
  // Privat läge och blockerade kakor kan få lagringen att kasta. En förlorad markering betyder
  // bara att en omladdning kräver ett nytt mejl — inte att flödet går sönder.
  try {
    window.sessionStorage.setItem(RECOVERY_MARK, encodeRecoveryMark(userId, Date.now()));
  } catch {}
}

/** Användar-ID:t som löste in en länk i den här fliken, om markeringen fortfarande gäller. */
function recoveryMarkedInThisTab(): string | null {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(RECOVERY_MARK); } catch { return null; }

  const userId = decodeRecoveryMark(raw, Date.now(), RECOVERY_MARK_TTL_MS);
  if (!userId) clearRecoveryMark();
  return userId;
}

function clearRecoveryMark() {
  try {
    window.sessionStorage.removeItem(RECOVERY_MARK);
    window.sessionStorage.removeItem(SWAP_MARK);
  } catch {}
}

/**
 * Varningen om att sessionen byttes ut måste överleva en omladdning.
 *
 * Vi skrubbar adressfältet, så en omladdning landar på den markeringsbaserade vägen — och utan
 * det här försvann den gula rutan medan lösenordsformuläret stod kvar öppet. Den som råkat klicka
 * på någon annans länk hade då bara behövt ladda om för att varningen skulle tystna.
 */
const SWAP_MARK = 'ekovilla:password-recovery-swapped-from';

function markSwap(previousEmail: string) {
  try { window.sessionStorage.setItem(SWAP_MARK, previousEmail); } catch {}
}

function swapMarkedInThisTab(): string | null {
  try { return window.sessionStorage.getItem(SWAP_MARK) || null; } catch { return null; }
}

export default function ResetPasswordConfirmPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Går felet att åtgärda med en omladdning? Då får sidan INTE be om ett nytt mejl: länken är
  // oförbrukad och ett nytt mejl bränner en av två tillåtna.
  const [retryInPlace, setRetryInPlace] = useState(false);
  // Vilket konto sätter vi lösenord för? Ska ALLTID stå på formuläret — se `swappedFrom`.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  // Var någon annan inloggad i webbläsaren när länken löstes in? Då bytte vi tyst ut sessionen.
  const [swappedFrom, setSwappedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Engångstoken tål inte att lösas in två gånger, och `reactStrictMode: true` kör varje effekt
  // dubbelt i utveckling. Utan spärren förbrukar det första anropet token och det andra får
  // "otp_expired" tillbaka — alltså ett fel som bara syns lokalt och inte finns i drift.
  const redeemed = useRef(false);

  // Lös in återställningslänken och avgör om vi FAKTISKT står i en återställning.
  //
  // ⚠️ Grinden är "den här laddningen löste in en återställningslänk" — ALDRIG "det finns en
  // session". Skillnaden är hela säkerheten i sidan: formuläret sätter ett nytt lösenord utan att
  // fråga efter det gamla, medan profilmenyn kräver det gamla (ProfileMenu.tsx:114). Räckte en
  // session hade en olåst lånad webbläsare varit ett kontoövertagande — man surfar hit utan token
  // och byter lösenord.
  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;

    // Läs adressen FÖRST, innan någon annan hinner röra den. Klientens init skrubbar URL:en när
    // den lyckas lösa in något, så en `?code=`-länk kan vara borta ur adressfältet innan vi ens
    // tittat — och då hade vi sagt "ogiltig länk" om något vi aldrig såg.
    const link = parseRecoveryLink(window.location.href);

    (async () => {
      try {
        // Vänta in klientens EGEN init innan vi rör sessionen. På en fragment-länk kastar den
        // (pkce-låsningen, GoTrueClient.js:1070) och river då sessionen med `_removeSession()`.
        // Hann den köra efter vårt `setSession` nedan skulle den radera den vi just satt — en
        // kapplöpning som hade slagit till sporadiskt. Att vänta in den gör ordningen bestämd.
        await supabase.auth.initialize();

        // Vem var inloggad INNAN vi löste in något?
        //
        // 🧨 `verifyOtp` skriver över en befintlig session utan att fråga. En angripare kan begära
        // en återställning för SITT EGET konto och skicka länken till en kollega som är inloggad
        // — offrets webbläsare blir då tyst angriparens session, och allt kollegan skriver
        // därefter hamnar i fel konto. Vi kan inte veta vems token det är utan att lösa in den,
        // men vi kan säga ifrån efteråt, högt. Se `swappedFrom` i renderingen.
        //
        // ⚖️ GRÄNS: den här avläsningen sker efter `initialize()`, som river sessionen på varje
        // fragment-länk (pkce-låsningen ovan). För implicita `#access_token=`-länkar är
        // `previousUser` därför alltid null och varningen kan inte utlösas. Att läsa sessionen
        // FÖRE init går inte — allt i det publika API:t väntar in initializePromise. Skyddet som
        // återstår i det fallet är att formuläret ändå namnger kontot, vilket det gör: den raden
        // sätts även när `previousUser` är null.
        //
        // Övervägt och valt bort: att läsa identiteten direkt ur `sb-<ref>-auth-token`-kakan förbi
        // SDK:n. Det vore att binda sig till ett privat, chunkat lagringsformat som kan ändras vid
        // vilken uppgradering som helst — och tyst sluta varna — för ett fall som upphör att
        // existera så snart mejlmallen bytts till `?token_hash=`. Fragmentlänkar uppstår bara via
        // `/auth/v1/verify`, som den mallen aldrig passerar.
        const { data: before } = await supabase.auth.getUser();
        const previousUser = before.user ?? null;

        const adoptSession = (user: { id: string; email?: string } | null | undefined) => {
          if (previousUser && user && previousUser.id !== user.id) {
            const from = previousUser.email || 'ett annat konto';
            setSwappedFrom(from);
            markSwap(from);
          }
          setAccountEmail(user?.email ?? null);
        };

        if (link.kind === 'error') {
          // ⚠️ `link.description` kommer RAKT UR ADRESSFÄLTET och renderas aldrig. Vem som helst
          // kan skicka en länk med ett påhittat `error_description` och få sin egen text att stå
          // i appens felruta, på vår riktiga domän — en färdig nätfiskeyta. Bara `code` används,
          // och den matchas mot våra egna fasta strängar.
          setLinkError(describeRecoveryError(link.code));
          return;
        }

        if (link.kind === 'token_hash') {
          const { data, error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: link.tokenHash,
            type: 'recovery',
          });
          // 🧨 Skrubba INTE utan ett avgörande besked. Kom svaret aldrig fram, eller sa det
          // ingenting om token (429, 5xx), kan länken fortfarande vara giltig — då ska en
          // omladdning få göra om försöket i stället för att kosta ett av två tillåtna mejl.
          if (isIndecisiveFailure(otpErr)) {
            setLinkError(INDECISIVE_MESSAGE);
            setRetryInPlace(true);
            return;
          }
          // Nu HAR den varit hos GoTrue och är förbrukad, oavsett utfall. Ligger den kvar i
          // adressfältet följer den med i historiken och i en eventuell referer, och en
          // omladdning gör ett andra inlösningsförsök som alltid misslyckas. Bort med den.
          //
          // `{}` och INTE `window.history.state` (som auth-js själv skickar): Next patchar
          // `replaceState` och kopierar in sina interna fält åt oss (app-router.js:447 →
          // copyNextJsInternalHistoryState). Skickar man in det befintliga state:t träffar man i
          // stället patchens `__NA`-vakt, som hoppar över routerns URL-synk helt.
          window.history.replaceState({}, '', window.location.pathname);
          if (otpErr) {
            setLinkError(describeRecoveryError((otpErr as any)?.code || '', otpErr.message));
            return;
          }
          // 🧨 `otpErr === null` betyder INTE att vi fick en session. `_sessionResponse`
          // (auth-js lib/fetch.js:126) ger `session: null` utan fel när svaret saknar
          // `access_token`, och `verifyOtp` rensar inte en session som redan fanns. Grindade vi på
          // frånvaron av fel skulle B:s länk i en webbläsare där A är inloggad rendera formuläret
          // — och skriva om A:s lösenord. Sessionen vi fick TILLBAKA är det enda giltiga beviset.
          if (!data?.session?.access_token) {
            setLinkError(describeRecoveryError('', ''));
            return;
          }
          adoptSession(data.session.user);
          markRecoveryInThisTab(data.session.user?.id);
          setHasSession(true);
          return;
        }

        if (link.kind === 'session') {
          // Implicit länk: färdiga tokens i fragmentet. Vi sätter dem SJÄLVA i stället för att
          // låta `detectSessionInUrl` göra det — auth-helpers-klienten är låst till `pkce` och
          // kastar på varje fragment-länk (GoTrueClient.js:1070). Den kastar redan innan den
          // hunnit skrubba fragmentet, så tokens ligger kvar åt oss här.
          const { data, error: setErr } = await supabase.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
          // Samma regel som ovan: nådde anropet aldrig fram lever fragmentet vidare och en
          // omladdning får försöka igen. Skrubba först när servern faktiskt svarat.
          if (isIndecisiveFailure(setErr)) {
            setLinkError(INDECISIVE_MESSAGE);
            setRetryInPlace(true);
            return;
          }
          window.history.replaceState({}, '', window.location.pathname);
          if (setErr || !data?.session?.access_token) {
            setLinkError(describeRecoveryError((setErr as any)?.code || '', setErr?.message));
            return;
          }
          adoptSession(data.session.user);
          markRecoveryInThisTab(data.session.user?.id);
          setHasSession(true);
          return;
        }

        if (link.kind === 'pkce-code') {
          // En PKCE-länk från gamla koden. Den GÅR att lösa in om verifieraren råkar ligga kvar i
          // den här webbläsaren — kakan har lång livslängd, så länkar som begärdes strax före
          // deployen fungerar fortfarande. Klientens init har i så fall redan gjort utbytet.
          //
          // 🧨 Frågan är inte "finns en session?" utan "kom den från DEN HÄR laddningen?". Svaret
          // står i adressfältet: `_getSessionFromURL` tar bort `code` ur URL:en när utbytet
          // lyckades (GoTrueClient.js:1080). Ligger koden kvar hände ingenting — och då hade en
          // session bara betytt att någon redan var inloggad i webbläsaren, alltså övertagandet.
          const codeStillInUrl = new URL(window.location.href).searchParams.get('code');
          if (codeStillInUrl) {
            setLinkError(STALE_PKCE_MESSAGE);
            return;
          }
          const { data } = await supabase.auth.getUser();
          if (!data.user) {
            setLinkError(STALE_PKCE_MESSAGE);
            return;
          }
          adoptSession(data.user);
          markRecoveryInThisTab(data.user.id);
          setHasSession(true);
          return;
        }

        // Ingen länkinformation alls. Enda giltiga skälet att stå här är att vi själva skrubbade
        // adressfältet efter en lyckad inlösning och användaren laddade om sidan. Markeringen
        // lever i sessionStorage: per flik, och dör när fliken stängs.
        //
        // 🧨 Den bär ANVÄNDAR-ID med flit. En markering som bara sa "den här fliken löste in en
        // länk" hade följt med när någon loggade ut och någon annan loggade in i samma flik —
        // och då visat formuläret för fel person.
        const markedUserId = recoveryMarkedInThisTab();
        if (markedUserId) {
          const { data } = await supabase.auth.getUser();
          const matches = !!data.user && data.user.id === markedUserId;
          // Kontot måste namnges HÄR också. Utan raden tappade formuläret sin enda upplysning om
          // vems lösenord man sätter så fort användaren laddade om — och det är just skyddet som
          // kommentaren vid `swappedFrom` kallar obligatoriskt.
          if (matches) {
            setAccountEmail(data.user?.email ?? null);
            setSwappedFrom(swapMarkedInThisTab());
          }
          setHasSession(matches);
          return;
        }
      } catch {
        setHasSession(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password || password.length < 6) { setError('Lösenord måste vara minst 6 tecken.'); return; }
    if (password !== password2) { setError('Lösenorden matchar inte.'); return; }
    setSubmitting(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      // Återställningen är fullbordad — markeringen har gjort sitt och ska inte kunna öppna
      // formuläret igen om någon navigerar tillbaka hit i samma flik.
      clearRecoveryMark();
      setSuccess(true);
      // Sync cookie and redirect
      try { await fetch('/api/auth/callback', { method: 'POST', cache: 'no-store' }); } catch {}
      setTimeout(() => { router.replace('/'); }, 600);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte uppdatera lösenord. Länken kan vara förbrukad.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={outerWrap} className="reset-confirm-root">
      <div style={cardWrap} className="reset-confirm-card">
        <h1 style={titleStyle}>Byt lösenord</h1>
        {loading ? (
          <p style={subStyle}>Kontrollerar länk…</p>
        ) : !hasSession ? (
          <div style={errorBox}>
            {linkError || 'Länken är ogiltig eller har gått ut.'}
            {/*
              Uppmaningen bara när länken FAKTISKT är förbrukad. Vid ett nätverksfel är den
              oförbrukad och ligger kvar i adressfältet — då säger meddelandet "ladda om sidan",
              och att i samma andetag be om ett nytt mejl hade motsagt det OCH bränt en av de två
              återställningar användaren får per timme.
            */}
            {!retryInPlace && (
              <>
                {' '}Be om en ny på{' '}
                <a href="/auth/reset-password" style={linkStyle}>Återställ lösenord</a>.
              </>
            )}
          </div>
        ) : success ? (
          <div style={successBox}>Lösenord uppdaterat. Du skickas vidare…</div>
        ) : (
          <form onSubmit={onSubmit} style={formStyle}>
            {/*
              🧨 Formuläret MÅSTE namnge kontot. `verifyOtp` skriver över en befintlig session
              utan att fråga, så den som skickat länken bestämmer vilket konto man hamnar i. Utan
              adressen här kan en inloggad kollega klicka på en länk hen fått, tyst bli någon
              annan, och sätta ett lösenord åt fel konto utan att ana det.
            */}
            {accountEmail && (
              <p style={subStyle}>
                Nytt lösenord för <strong>{accountEmail}</strong>.
              </p>
            )}
            {swappedFrom && (
              <div style={warnBox}>
                Du var inloggad som <strong>{swappedFrom}</strong> och är nu inloggad som kontot
                ovan. Känner du inte igen det — stäng sidan och logga in igen i stället för att
                fortsätta.
              </div>
            )}
            <label style={labelStyle}>
              <span style={labelTxt}>Nytt lösenord</span>
              <input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minst 6 tecken" autoComplete="new-password" required />
            </label>
            <label style={labelStyle}>
              <span style={labelTxt}>Bekräfta lösenord</span>
              <input style={inputStyle} type="password" value={password2} onChange={e=>setPassword2(e.target.value)} placeholder="Skriv igen" autoComplete="new-password" required />
            </label>
            {error && <div style={errorBox}>{error}</div>}
            <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Uppdaterar…' : 'Uppdatera lösenord'}</button>
          </form>
        )}
        <div style={footNote}>Behöver hjälp? <a href="/auth/sign-in" style={linkStyle}>Logga in</a></div>
      </div>
      <style>{`
        @media (max-width: 600px) {
          .reset-confirm-card { padding:24px 22px 30px !important; gap:18px !important; }
          .reset-confirm-card h1 { font-size:26px !important; }
          .reset-confirm-card form { gap:14px !important; }
          .reset-confirm-card input { padding:11px 12px !important; font-size:14px !important; }
          .reset-confirm-card button { padding:13px 16px !important; font-size:14px !important; }
        }
        @media (prefers-color-scheme: dark) {
          .reset-confirm-root { background:#0f2a21 !important; }
          .reset-confirm-card { background:#0f3d2e !important; border-color:#115e46 !important; }
          .reset-confirm-card h1 { color:#d1fae5 !important; }
          .reset-confirm-card p { color:#a7f3d0 !important; }
          .reset-confirm-card input { background:#0f2a21 !important; border-color:#1d6f55 !important; color:#ecfdf5 !important; }
          .reset-confirm-card input:focus { outline:1px solid #10b981; }
          .reset-confirm-card button { background:linear-gradient(135deg,#059669,#10b981) !important; border-color:#059669 !important; }
          .reset-confirm-card a { color:#34d399 !important; }
        }
      `}</style>
    </div>
  );
}

// Styles reused from auth palette
const outerWrap: React.CSSProperties = { minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, background:'radial-gradient(circle at 35% 25%, #f0fdf4 0%, #ecfdf5 30%, #f6fef9 60%)' };
const cardWrap: React.CSSProperties = { width:'100%', maxWidth:520, background:'#ffffffcc', backdropFilter:'blur(6px)', border:'1px solid #d1fae5', borderRadius:28, padding:'40px 40px 48px', display:'flex', flexDirection:'column', gap:24, boxShadow:'0 8px 28px -8px rgba(6,78,59,0.28)', position:'relative' , overflow:'hidden', };
const titleStyle: React.CSSProperties = { margin:0, fontSize:32, fontWeight:650, letterSpacing:-0.5, color:'#064e3b' };
const subStyle: React.CSSProperties = { margin:'-4px 0 4px', fontSize:15, lineHeight:1.5, color:'#065f46' };
const formStyle: React.CSSProperties = { display:'flex', flexDirection:'column', gap:18 };
const labelStyle: React.CSSProperties = { display:'flex', flexDirection:'column', gap:6 };
const labelTxt: React.CSSProperties = { fontSize:12, fontWeight:600, letterSpacing:0.6, textTransform:'uppercase', color:'#ffffffff' };
const inputStyle: React.CSSProperties = { padding:'12px 14px', border:'1px solid #94d5bb', borderRadius:12, fontSize:15, outline:'none', background:'#ffffff', fontWeight:500, color:'#064e3b', boxShadow:'0 1px 2px rgba(6,78,59,0.05)' };
const primaryBtn: React.CSSProperties = { padding:'14px 18px', borderRadius:14, background:'linear-gradient(135deg,#047857,#059669)', color:'#ffffff', fontSize:15, fontWeight:600, border:'1px solid #047857', cursor:'pointer', letterSpacing:0.3, boxShadow:'0 3px 8px -2px rgba(4,120,87,0.45)' };
const errorBox: React.CSSProperties = { background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const warnBox: React.CSSProperties = { background:'#fffbeb', border:'1px solid #fde68a', color:'#92400e', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const successBox: React.CSSProperties = { background:'#ecfdf5', border:'1px solid #bbf7d0', color:'#065f46', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const footNote: React.CSSProperties = { marginTop:8, fontSize:12, color:'#ffffffff' };
const linkStyle: React.CSSProperties = { color:'#047857', fontWeight:600, textDecoration:'none' };
