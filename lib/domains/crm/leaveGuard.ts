// Stoppet för osparade ändringar — den rena delen. React-kopplingen bor i
// app/crm/components/useLeaveGuard.ts; här bor besluten, så att de går att pröva utan webbläsare.
//
// Två saker:
//
//   • leaveHrefFromClick — är det här klicket ett försök att lämna sidan via en länk?
//   • createBackGuard — webbläsarens bakåtpil. App Router har ingen navigeringsvakt, och bakåt är
//     en popstate: webbläsaren har redan flyttat sig när vi får höra om det. Vakten lägger därför
//     ett osynligt historiksteg (en "tvilling" med samma adress) ovanpå sidan medan något är
//     osparat. Bakåt landar då på sidan själv i stället för på förra sidan, och vi kan fråga.

/** Det ur ett klick som avgör om det är ett försök att lämna sidan. */
export type LeaveClick = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Närmaste `<a>` från klickets mål, eller null. */
  anchor: {
    /** Upplöst, absolut adress (`a.href`). */
    href: string;
    /** Attributet som det står (`getAttribute('href')`). */
    rawHref: string | null;
    target: string;
    download: boolean;
  } | null;
};

/**
 * Adressen klicket hade lett till inne i appen, eller null om klicket inte lämnar sidan — eller
 * inte är vårt att stoppa.
 *
 * Släpps igenom: klick med modifierare eller annan musknapp (ny flik — sidan står kvar), länkar som
 * öppnar i ny flik eller laddar ner, rena #-länkar, API-adresser, och en annan origin (den lämnar
 * appen helt och fångas av webbläsarens egen beforeunload-ruta). Samma sökväg räknas inte heller
 * som att lämna.
 */
export function leaveHrefFromClick(click: LeaveClick, currentHref: string): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  const anchor = click.anchor;
  if (!anchor || anchor.target === '_blank' || anchor.download) return null;
  if (!anchor.rawHref || anchor.rawHref.startsWith('#')) return null;
  let url: URL;
  let current: URL;
  try {
    url = new URL(anchor.href, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }
  if (url.origin !== current.origin || url.pathname === current.pathname) return null;
  // En API-adress är aldrig en sida: "Ladda ner" under Filer är en vanlig länk till
  // /api/…?download=1, utan download-attribut. Sidan står kvar, och ingenting går förlorat.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  return url.pathname + url.search;
}

/** Det vakten behöver av `window.history`. Bytbart, så att sekvenserna går att pröva. */
export type HistoryPort = {
  /** Det nuvarande stegets state (för Next: `__NA` + routerträdet). */
  state(): unknown;
  /** Byt det nuvarande stegets state — FÖRBI Next:s lappade replaceState, se createBackGuard. */
  replaceState(state: unknown): void;
  /** Lägg ett nytt steg med sidans egen adress och den här staten ovanpå det nuvarande. */
  pushState(state: unknown): void;
  back(): void;
  length(): number;
  scrollRestoration(): ScrollRestoration;
  setScrollRestoration(mode: ScrollRestoration): void;
};

export type PopOutcome =
  /** Inte vårt, eller redan omhändertaget. */
  | { kind: 'none' }
  /** Bakåt stoppades: sidan står kvar och ett nytt tvillingsteg ligger på. Visa frågan. */
  | { kind: 'blocked' }
  /** Tvillingen är borta och sidans steg återställt; gå nu dit användaren bad om. */
  | { kind: 'navigate'; href: string; replace: boolean };

type Expected =
  | { kind: 'disarm' }
  | { kind: 'href'; href: string; replace: boolean }
  /** Första steget av två när frågan bekräftats efter bakåt: ned till sidans eget steg. */
  | { kind: 'leave' }
  /** Andra steget: till förra sidan, som Next tar hand om. */
  | { kind: 'gone' }
  | null;

export type BackGuard = ReturnType<typeof createBackGuard>;

/**
 * Tillståndsmaskinen kring tvillingsteget. Ett steg i taget, och inget av det här får ske i en
 * effekts städfunktion vid avmontering: då har nästa sida redan lagt sitt steg, och ett `back()` där
 * hade ångrat själva navigeringen.
 *
 * 🧨 NEXT FÅR INTE SE VÅRA STEG. Varje popstate med en Next-state blir en routeråterställning, och i
 * Next 14 rullar den första routeruppdateringen efter en klientnavigering sidan till toppen och tar
 * fokus: `focusAndScrollRef.apply` står kvar som sann när sidan hängde i Suspense vid ankomsten
 * (useSearchParams), och förbrukas av nästa uppdatering — vilken som helst. Uppmätt: bakåt till
 * tvillingen rullade arbetsordern från 1901 px till toppen bakom frågan, och samma sak hade hänt
 * vid varje Spara. Next:s popstate-hanterare gör ingenting med ett steg vars state är null
 * (`if (!state) return`), så sidans eget steg bär null medan vakten är laddad, och sidans state
 * ligger på tvillingen ovanför. Den skrivs tillbaka så fort vi landat på sidans steg av egen vilja.
 * Därför replaceState FÖRBI Next:s lapp — den lappade kopierar in Next:s state igen, och
 * dispatchar dessutom själv en återställning.
 *
 * ⚠️ SIDAN FÅR INTE BYTA SIN EGEN ADRESS MEDAN VAKTEN ÄR LADDAD. Sidans steg under bär adressen den
 * hade när vakten laddades; byter sidan adress (router.replace) står det kvar på den gamla, och
 * bakåt hade landat där med en adress Next aldrig får veta om. Offertformuläret rensar sina
 * returparametrar med router.replace och laddar därför vakten först efteråt.
 *
 * Scrolläget: webbläsaren återställer scrollpositionen vid varje steg i historiken, även mellan två
 * steg i samma dokument, och sidans steg sparade positionen från när första ändringen gjordes. Där
 * dokumentet självt scrollar hade sidan hoppat dit. Därför 'manual' medan vakten är laddad — och
 * tillbaka till det sparade läget så fort den inte är det.
 */
export function createBackGuard(history: HistoryPort) {
  let armed = false;
  let expected: Expected = null;
  let savedScroll: ScrollRestoration | null = null;
  // Sidans egen state, undanlagd medan sidans steg bär null.
  let pageState: unknown = null;
  // Bakåt stoppades: vi står på sidans steg och tvillingen ligger kvar som enda steg framåt.
  let twinAhead = false;
  // arm() kom medan ett steg ned var på väg — laddas när steget landat, inte mitt i det.
  let rearm = false;

  function holdScroll() {
    if (savedScroll !== null) return;
    savedScroll = history.scrollRestoration();
    history.setScrollRestoration('manual');
  }
  function releaseScroll() {
    if (savedScroll === null) return;
    history.setScrollRestoration(savedScroll);
    savedScroll = null;
  }
  function pushTwin() {
    holdScroll();
    history.pushState(pageState);
    armed = true;
  }
  /** Vi står på sidans eget steg: ge det tillbaka sin state, så att Next känner igen det igen. */
  function restorePage() {
    history.replaceState(pageState);
    releaseScroll();
  }
  /** Gå ned från tvillingen. Tvillingens state först — Next kan ha skrivit om den medan vi stod där. */
  function stepDown(next: Exclude<Expected, null>) {
    pageState = history.state();
    armed = false;
    expected = next;
    history.back();
  }

  /** Något är osparat: lägg tvillingsteget om det inte redan ligger. */
  function arm() {
    if (armed) return;
    // Ett steg ned är på väg (t.ex. Spara som misslyckades direkt efter att vakten släppt). Laddas
    // nu hade null-staten hamnat på tvillingen och sidans steg behållit sin — se onPopState.
    if (expected) {
      rearm = true;
      return;
    }
    // Ett steg utan state är inte Next:s — en kvarlämning från en vakt som aldrig fick ta bort sig
    // (omladdning mitt i en redigering). En tvilling av det hade Next inte känt igen, och Next
    // laddar om hela sidan vid bakåt till ett sådant. Då ingen bakåtvakt; länkarna och
    // webbläsarens egen ruta skyddar ändå.
    const state = history.state();
    if (state == null) return;
    pageState = state;
    twinAhead = false;
    holdScroll();
    history.replaceState(null);
    pushTwin();
  }

  return {
    get armed() {
      return armed;
    },

    /** Något är osparat: lägg tvillingsteget om det inte redan ligger. */
    arm,

    /**
     * Inget osparat längre (sparat, avbrutet, återställt): ta bort tvillingen. Annars hade nästa
     * bakåt bara landat på samma sida och sett ut att inte göra något.
     */
    disarm() {
      rearm = false;
      if (!armed) return;
      stepDown({ kind: 'disarm' });
    },

    /**
     * Lämna till en adress inne i appen. Ligger tvillingen kvar tas den bort först — annars hade den
     * stått kvar i historiken och gett ett dött bakåtklick senare. Returnerar true när navigeringen
     * väntar på popstate (onPopState svarar då med 'navigate'), false när den kan ske direkt.
     */
    leaveTo(href: string): boolean {
      if (!armed) {
        releaseScroll();
        return false;
      }
      stepDown({ kind: 'href', href, replace: false });
      return true;
    },

    /**
     * "Stanna kvar" efter ett stoppat bakåt: lägg tvillingen igen.
     *
     * 🧨 HÄR, OCH INTE I POPSTATE. Chrome hoppar över historiksteg vid bakåtknappen när steget efter
     * dem lades utan att användaren rört sidan sedan senaste navigeringen ("history manipulation
     * intervention") — och att landa på sidans steg ÄR en navigering. En tvilling lagd direkt i
     * popstate hade alltså kunnat göra sidans steg överhoppningsbart, och då hade varje senare bakåt
     * gått förbi vakten. Klicket på "Stanna kvar" är en riktig interaktion. Priset: ett andra bakåt
     * medan frågan står öppen lämnar sidan — det första frågade.
     */
    stay() {
      twinAhead = false;
      arm();
    },

    /**
     * "Lämna utan att spara" efter ett stoppat bakåt. Returnerar ett reservmål att ersätta sidan med
     * när inget finns bakom den — fliken öppnades direkt på sidan, och bakåtpilen gick bara att trycka
     * på för att vi lagt dit tvillingen — annars null.
     */
    leaveBack(fallbackHref: string): string | null {
      if (armed) {
        // Utanför det vanliga flödet (onPopState släpper vakten när bakåt stoppas), men korrekt ändå:
        // ned till sidans steg först, så att det får tillbaka sin state på vägen — annars hade ett
        // framåt senare landat på ett steg Next inte känner igen.
        stepDown({ kind: 'leave' });
        return null;
      }
      releaseScroll();
      // ⚠️ length räknar även steg framåt. Tvillingen ligger kvar som enda steg framåt (pushen kapade
      // allt efter den), så steg bakom sidan = length − tvillingen − sidan själv.
      const behind = history.length() - (twinAhead ? 1 : 0) - 1;
      twinAhead = false;
      if (behind < 1) return fallbackHref;
      history.back();
      return null;
    },

    /** `guarding`: är något osparat just nu? Läses vid händelsen, inte när vakten skapades. */
    onPopState(guarding: boolean): PopOutcome {
      const exp = expected;
      expected = null;
      if (exp?.kind === 'disarm') {
        restorePage();
        if (rearm && guarding) {
          rearm = false;
          arm();
        }
        rearm = false;
        return { kind: 'none' };
      }
      if (exp?.kind === 'href') {
        restorePage();
        return { kind: 'navigate', href: exp.href, replace: exp.replace };
      }
      if (exp?.kind === 'leave') {
        restorePage();
        expected = { kind: 'gone' };
        history.back();
        return { kind: 'none' };
      }
      if (exp?.kind === 'gone') return { kind: 'none' };
      if (!armed) return { kind: 'none' };
      // Användaren tryckte bakåt och står nu på sidans eget steg, under tvillingen. Sidans steg får
      // tillbaka sin state direkt: frågan kan sluta med att användaren lämnar med ett andra bakåt.
      armed = false;
      restorePage();
      if (!guarding) {
        // Inget kvar att skydda: fullfölj bakåtklicket, som annars hade sett dött ut.
        history.back();
        return { kind: 'none' };
      }
      twinAhead = true;
      return { kind: 'blocked' };
    },

    /** Vid avmontering. Bara scrolläget — se ovan om varför historiken lämnas orörd här. */
    release() {
      releaseScroll();
    },
  };
}
