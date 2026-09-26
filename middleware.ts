import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_FILE = /\.(.*)$/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next')) return NextResponse.next();
  if (PUBLIC_FILE.test(pathname)) return NextResponse.next();

  // Allow the auth UI and auth callback routes.
  const isAuthPage = pathname.startsWith('/auth');
  // Undantag från utsparkningen nedan. Återställningslänken bär en engångstoken, och den som glömt
  // sitt lösenord kan mycket väl ha en levande session kvar i en annan flik eller i den
  // installerade appen. Utan undantaget skickas hen till startsidan — och eftersom redirecten
  // dessutom nollar `search` följer token aldrig med. Lösenordsformuläret syns aldrig.
  //
  // ⚠️ Undantaget kan INTE grindas på token här. Implicita länkar bär den i fragmentet, och
  // fragmentet skickas aldrig till servern — en grind på query hade sparkat ut just dem.
  // Grinden sitter därför i sidan, som ser fragmentet: den visar formuläret bara när den här
  // laddningen faktiskt löste in en återställningslänk, aldrig bara för att en session finns.
  // Utan den grinden vore det här kontoövertagande i en lånad olåst webbläsare.
  //
  // Begäransidan måste med i undantaget. Felrutan på confirm-sidan har en enda uppmaning — "be om
  // en ny på Återställ lösenord" — och just den användare undantaget finns för (levande session i
  // en annan flik eller i den installerade appen) hade sparkats ut därifrån till startsidan.
  // Återvändsgränd, utan annan väg ut än att logga ut. Sidan i sig skickar bara ett mejl till en
  // adress man skriver in, så en inloggad besökare är ofarlig.
  //
  // ⚖️ MEDVETEN BIEFFEKT: en inloggad användare som öppnar en AVVISAD länk (`#error=…`,
  // `?error_description=…`) eller en implicit `#access_token=…` loggas ut. Sidan laddas nu i
  // stället för att redirectas bort, och klientens init läser `error_description` och
  // `access_token` ur BÅDE fragment och query, behandlar dem som ett implicit försök, kastar på
  // pkce-låsningen och river sessionen. Accepterat: användaren får ett tydligt besked och vägen
  // till ett nytt mejl, i stället för att som förr dumpas på startsidan utan förklaring. Formerna
  // slutar dessutom uppstå när mejlmallen bytts till `?token_hash=` — den går direkt hit och
  // passerar aldrig `/auth/v1/verify`, som är det enda som svarar med de här parametrarna.
  // Alternativet, att skrubba dem innan klienten hinner skapas, kräver en sidoeffekt under render
  // och är farligare än besväret det tar bort.
  const isPasswordRecoveryPage =
    pathname === '/auth/reset-password' || pathname === '/auth/reset-password-confirm';
  const isApiAuth = pathname.startsWith('/api/auth');
  const isApi = pathname.startsWith('/api');
  const isReminderDispatchApi = pathname === '/api/dashboard-notes/reminders/dispatch';
  const isNotificationsCleanupApi = pathname === '/api/notifications/cleanup';
  const isTwilioSmsStatusApi = pathname === '/api/twilio/sms-status';
  const isPublicCustomerOffertPage = pathname.startsWith('/kund/offert/');
  const isPublicCustomerOffertApi = pathname.startsWith('/api/kund/offert/');

  if (isApiAuth) return NextResponse.next();
  if (isReminderDispatchApi) return NextResponse.next();
  if (isNotificationsCleanupApi) return NextResponse.next();
  if (isTwilioSmsStatusApi) return NextResponse.next();
  if (isPublicCustomerOffertPage || isPublicCustomerOffertApi) return NextResponse.next();

  // En förnyad session skrivs på TVÅ ställen: på begäran (så att sidan och routen i samma request
  // läser den nya token i stället för att förnya en gång till med samma refresh-token — utanför
  // Supabase 10-sekundersfönster är det reuse detection och utloggning av hela token-familjen) och
  // på svaret (så att webbläsaren får den). `res` byggs därför om när kakor sätts.
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) res.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Redirect och JSON är NYA svar — kakor som satts på `res` följer inte med av sig själva. Utan det
  // här tappas en förnyad (eller rensad) session precis när användaren skickas vidare.
  const withSessionCookies = (target: NextResponse) => {
    for (const cookie of res.cookies.getAll()) target.cookies.set(cookie);
    return target;
  };

  if (!session && !isAuthPage) {
    if (isApi) {
      return withSessionCookies(NextResponse.json(
        { ok: false, error: 'unauthorized' },
        { status: 401 }
      ));
    }

    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/auth/sign-in';
    redirectUrl.searchParams.set('next', pathname);
    return withSessionCookies(NextResponse.redirect(redirectUrl));
  }

  if (session && isAuthPage && !isPasswordRecoveryPage) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/';
    redirectUrl.search = '';
    return withSessionCookies(NextResponse.redirect(redirectUrl));
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
