import { describe, it, expect } from 'vitest';
import { createBackGuard, leaveHrefFromClick, type HistoryPort, type LeaveClick, type PopOutcome } from '@/lib/domains/crm/leaveGuard';

// Stoppet för osparade ändringar (offerten och arbetsordern). Bakåtvakten prövas mot en fejkad
// historik med webbläsarens semantik: ett steg ärver scrolläget från det det lades ovanpå, en push
// kapar allt framåt, och back()/go() sker inte förrän webbläsaren hunnit — här: när testet säger till.

const PAGE = 'https://app.ekovilla.se/crm/arbetsorder/abc';

function click(overrides: Partial<LeaveClick> = {}, anchor: Partial<NonNullable<LeaveClick['anchor']>> | null = {}): LeaveClick {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    anchor: anchor === null
      ? null
      : { href: 'https://app.ekovilla.se/crm/offerter', rawHref: '/crm/offerter', target: '', download: false, ...anchor },
    ...overrides,
  };
}

describe('leaveHrefFromClick', () => {
  it('ett vanligt klick på en länk inne i appen är ett försök att lämna', () => {
    expect(leaveHrefFromClick(click(), PAGE)).toBe('/crm/offerter');
  });

  it('frågesträngen följer med, men inte #-delen', () => {
    const c = click({}, { href: 'https://app.ekovilla.se/crm/kunder/1?returnTo=%2Fcrm#kontakt', rawHref: '/crm/kunder/1?returnTo=%2Fcrm#kontakt' });
    expect(leaveHrefFromClick(c, PAGE)).toBe('/crm/kunder/1?returnTo=%2Fcrm');
  });

  it('släpper klick som öppnar i ny flik — sidan står kvar', () => {
    expect(leaveHrefFromClick(click({ metaKey: true }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({ ctrlKey: true }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({ shiftKey: true }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({ altKey: true }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({ button: 1 }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({}, { target: '_blank' }), PAGE)).toBeNull();
  });

  it('släpper nedladdningar, rena #-länkar och klick utan länk', () => {
    expect(leaveHrefFromClick(click({}, { download: true }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({}, { rawHref: '#rader', href: `${PAGE}#rader` }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({}, { rawHref: null }), PAGE)).toBeNull();
    expect(leaveHrefFromClick(click({}, null), PAGE)).toBeNull();
  });

  it('släpper ett klick någon annan redan tagit hand om', () => {
    expect(leaveHrefFromClick(click({ defaultPrevented: true }), PAGE)).toBeNull();
  });

  it('en annan origin lämnar appen helt — den är webbläsarens egen ruta, inte vår', () => {
    expect(leaveHrefFromClick(click({}, { href: 'https://www.fortnox.se/', rawHref: 'https://www.fortnox.se/' }), PAGE)).toBeNull();
  });

  it('en API-adress är aldrig en sida — "Ladda ner" under Filer är en sådan länk', () => {
    const href = 'https://app.ekovilla.se/api/crm/work-orders/abc/files/f1?redirect=1&download=1';
    expect(leaveHrefFromClick(click({}, { href, rawHref: '/api/crm/work-orders/abc/files/f1?redirect=1&download=1' }), PAGE)).toBeNull();
  });

  it('samma sökväg är inte att lämna sidan', () => {
    expect(leaveHrefFromClick(click({}, { href: `${PAGE}?flik=filer`, rawHref: '?flik=filer' }), PAGE)).toBeNull();
  });
});

type Entry = { url: string; state: unknown; scroll: ScrollRestoration };

const nextState = (url: string) => ({ __NA: true, tree: url });

function fakeHistory(urls: string[]) {
  const entries: Entry[] = urls.map((url) => ({ url, state: nextState(url), scroll: 'auto' }));
  let index = entries.length - 1;
  const queued: number[] = [];
  // Next:s popstate-hanterare: varje landning på ett steg med state blir en routeråterställning —
  // den som i Next 14 rullar sidan till toppen. Ett steg med null hoppar Next över.
  const nextRestores: string[] = [];
  const port: HistoryPort = {
    state: () => entries[index].state,
    replaceState: (state) => { entries[index].state = state; },
    pushState(state) {
      const current = entries[index];
      entries.splice(index + 1);
      entries.push({ url: current.url, state, scroll: current.scroll });
      index += 1;
    },
    back: () => { queued.push(-1); },
    length: () => entries.length,
    scrollRestoration: () => entries[index].scroll,
    setScrollRestoration: (mode) => { entries[index].scroll = mode; },
  };
  return {
    port,
    entries,
    nextRestores,
    get index() { return index; },
    get url() { return entries[index].url; },
    /** Webbläsaren hinner ikapp: köade steg tas, ett popstate per steg som gick att ta. */
    settle(onPop: () => PopOutcome): PopOutcome[] {
      const outcomes: PopOutcome[] = [];
      while (queued.length) {
        const target = index + queued.shift()!;
        if (target < 0 || target >= entries.length) continue;
        index = target;
        if (entries[index].state) nextRestores.push(entries[index].url);
        outcomes.push(onPop());
      }
      return outcomes;
    },
    /** Användaren trycker bakåt / framåt. */
    userBack() { queued.push(-1); },
    userForward() { queued.push(1); },
    /** Next lägger ett steg för en ny sida. */
    navigate(url: string) {
      const scroll = entries[index].scroll;
      entries.splice(index + 1);
      entries.push({ url, state: nextState(url), scroll });
      index += 1;
    },
    /** Next ersätter det nuvarande steget (router.replace). */
    replace(url: string) {
      entries[index] = { url, state: nextState(url), scroll: entries[index].scroll };
    },
  };
}

const LIST_URL = '/crm/arbetsorder';
const PAGE_URL = '/crm/arbetsorder/abc';

function setup(urls = [LIST_URL, PAGE_URL]) {
  const history = fakeHistory(urls);
  const guard = createBackGuard(history.port);
  let guarding = false;
  return {
    history,
    guard,
    setGuarding(value: boolean) { guarding = value; },
    settle: () => history.settle(() => guard.onPopState(guarding)),
    /** Next känner igen varje steg igen: inget steg bär kvar vaktens null. */
    allRecognised: () => history.entries.every((e) => e.state !== null),
  };
}

describe('createBackGuard — bakåtpilen', () => {
  /** Laddad vakt, ett stoppat bakåt — där frågan står öppen. */
  function blocked(urls?: string[]) {
    const t = setup(urls);
    t.setGuarding(true);
    t.guard.arm();
    t.history.userBack();
    expect(t.settle()).toEqual([{ kind: 'blocked' }]);
    return t;
  }

  it('laddar ETT tvillingsteg med sidans egen adress och state, hur många gånger den än laddas', () => {
    const t = setup();
    t.guard.arm();
    t.guard.arm();
    expect(t.history.entries.map((e) => e.url)).toEqual([LIST_URL, PAGE_URL, PAGE_URL]);
    expect(t.history.entries[2].state).toEqual(nextState(PAGE_URL));
    // Sidans eget steg bär null medan vakten är laddad — se "NEXT FÅR INTE SE VÅRA STEG".
    expect(t.history.entries[1].state).toBeNull();
    expect(t.guard.armed).toBe(true);
  });

  it('bakåt med något osparat stoppas: sidan står kvar, Next märker inget, och sidans steg är Next:s igen', () => {
    const t = blocked();
    expect(t.history.url).toBe(PAGE_URL);
    expect(t.history.nextRestores).toEqual([]);
    expect(t.history.entries[1].state).toEqual(nextState(PAGE_URL));
    // Ingen ny tvilling förrän "Stanna kvar" — se stay().
    expect(t.guard.armed).toBe(false);
  });

  it('"Stanna kvar" lägger tvillingen igen, och nästa bakåt stoppas också', () => {
    const t = blocked();
    t.guard.stay();
    expect(t.guard.armed).toBe(true);
    // Den gamla tvillingen framåt är kapad, inte staplad.
    expect(t.history.entries.map((e) => e.url)).toEqual([LIST_URL, PAGE_URL, PAGE_URL]);
    expect(t.history.entries[1].state).toBeNull();
    t.history.userBack();
    expect(t.settle()).toEqual([{ kind: 'blocked' }]);
    expect(t.history.url).toBe(PAGE_URL);
    expect(t.history.nextRestores).toEqual([]);
  });

  it('ett andra bakåt medan frågan står öppen lämnar sidan — till en sida Next känner igen', () => {
    const t = blocked();
    t.history.userBack();
    t.settle();
    expect(t.history.url).toBe(LIST_URL);
    expect(t.allRecognised()).toBe(true);
  });

  it('"Lämna utan att spara" efter bakåt når förra sidan', () => {
    const t = blocked();
    expect(t.guard.leaveBack(LIST_URL)).toBeNull();
    expect(t.settle()).toEqual([{ kind: 'none' }]);
    expect(t.history.url).toBe(LIST_URL);
    expect(t.history.nextRestores).toEqual([LIST_URL]);
    expect(t.allRecognised()).toBe(true);
  });

  it('framåt efter att ha lämnat bakåt landar på en sida Next känner igen', () => {
    const t = blocked();
    t.guard.leaveBack(LIST_URL);
    t.settle();
    t.history.userForward();
    t.settle();
    expect(t.history.url).toBe(PAGE_URL);
    expect(t.history.nextRestores).toEqual([LIST_URL, PAGE_URL]);
  });

  it('fliken öppnades direkt på sidan: reservmålet i stället, och ingen förflyttning', () => {
    const t = blocked([PAGE_URL]);
    expect(t.guard.leaveBack(LIST_URL)).toBe(LIST_URL);
    expect(t.settle()).toEqual([]);
    expect(t.history.index).toBe(0);
    expect(t.allRecognised()).toBe(true);
  });

  it('"Lämna" efter bakåt utan tvilling framåt: ett vanligt bakåt, och förra sidans state lämnas orörd', () => {
    const t = setup();
    expect(t.guard.leaveBack(LIST_URL)).toBeNull();
    t.settle();
    expect(t.history.url).toBe(LIST_URL);
    expect(t.history.entries[0].state).toEqual(nextState(LIST_URL));
  });

  it('"Lämna" bakåt med laddad vakt: ned till sidans steg först, sedan förra sidan', () => {
    const t = setup();
    t.setGuarding(true);
    t.guard.arm();
    expect(t.guard.leaveBack(LIST_URL)).toBeNull();
    expect(t.settle()).toEqual([{ kind: 'none' }, { kind: 'none' }]);
    expect(t.history.url).toBe(LIST_URL);
    expect(t.history.nextRestores).toEqual([LIST_URL]);
    expect(t.allRecognised()).toBe(true);
  });

  it('sparat (avväpnad): tvillingen tas bort utan att Next märker det, och nästa bakåt når förra sidan i ETT tryck', () => {
    const t = setup();
    t.setGuarding(true);
    t.guard.arm();
    t.setGuarding(false);
    t.guard.disarm();
    expect(t.settle()).toEqual([{ kind: 'none' }]);
    expect(t.history.url).toBe(PAGE_URL);
    expect(t.history.nextRestores).toEqual([]);
    expect(t.allRecognised()).toBe(true);
    t.history.userBack();
    t.settle();
    expect(t.history.url).toBe(LIST_URL);
  });

  it('avväpnad tar med sig tvillingens senaste state — Next kan ha skrivit om den', () => {
    const t = setup();
    t.guard.arm();
    t.history.entries[2].state = { __NA: true, tree: 'nyare' };
    t.guard.disarm();
    t.settle();
    expect(t.history.entries[1].state).toEqual({ __NA: true, tree: 'nyare' });
  });

  it('laddas medan avväpningen är på väg: väntar in steget och laddas sedan på sidans steg', () => {
    const t = setup();
    t.setGuarding(true);
    t.guard.arm();
    t.guard.disarm(); // Spara börjar…
    t.guard.arm(); // …och misslyckas innan webbläsaren hunnit ta steget
    expect(t.settle()).toEqual([{ kind: 'none' }]);
    expect(t.guard.armed).toBe(true);
    expect(t.history.entries.map((e) => e.url)).toEqual([LIST_URL, PAGE_URL, PAGE_URL]);
    expect(t.history.entries[1].state).toBeNull();
    expect(t.history.entries[2].state).toEqual(nextState(PAGE_URL));
    expect(t.history.nextRestores).toEqual([]);
  });

  it('den uppskjutna laddningen glöms om inget längre är osparat när steget landar', () => {
    const t = setup();
    t.guard.arm();
    t.guard.disarm();
    t.guard.arm();
    t.settle(); // guarding false
    expect(t.guard.armed).toBe(false);
    expect(t.allRecognised()).toBe(true);
  });

  it('laddas inte på ett steg utan state — en tvilling av det hade Next laddat om sidan för', () => {
    const t = setup();
    t.history.entries[1].state = null;
    t.guard.arm();
    expect(t.guard.armed).toBe(false);
    expect(t.history.entries).toHaveLength(2);
  });

  it('avväpna utan laddad vakt rör inte historiken', () => {
    const t = setup();
    t.guard.disarm();
    expect(t.settle()).toEqual([]);
    expect(t.history.index).toBe(1);
  });

  it('lämna via länk: tvillingen tas bort först, så historiken blir som utan vakt', () => {
    const t = setup();
    t.setGuarding(true);
    t.guard.arm();
    expect(t.guard.leaveTo('/crm/offerter')).toBe(true);
    expect(t.settle()).toEqual([{ kind: 'navigate', href: '/crm/offerter', replace: false }]);
    expect(t.history.nextRestores).toEqual([]);
    t.history.navigate('/crm/offerter');
    expect(t.history.entries.map((e) => e.url)).toEqual([LIST_URL, PAGE_URL, '/crm/offerter']);
    expect(t.allRecognised()).toBe(true);
  });

  it('lämna via länk utan laddad vakt: navigera direkt', () => {
    const t = setup();
    expect(t.guard.leaveTo('/crm/offerter')).toBe(false);
    expect(t.settle()).toEqual([]);
  });

  it('ett popstate som inte är vårt lämnas orört', () => {
    const t = setup();
    t.history.userBack();
    expect(t.settle()).toEqual([{ kind: 'none' }]);
    expect(t.history.url).toBe(LIST_URL);
  });

  it('laddad men inget längre osparat: bakåtklicket fullföljs i stället för att se dött ut', () => {
    const t = setup();
    t.guard.arm();
    t.setGuarding(false);
    t.history.userBack();
    t.settle();
    expect(t.history.url).toBe(LIST_URL);
    expect(t.allRecognised()).toBe(true);
  });
});

describe('createBackGuard — scrolläget', () => {
  it("'manual' på sidan och tvillingen medan vakten är laddad — annars hoppar sidan vid bakåt", () => {
    const t = setup();
    t.guard.arm();
    expect(t.history.entries.slice(1).map((e) => e.scroll)).toEqual(['manual', 'manual']);
    // Förra sidan är inte vår att röra.
    expect(t.history.entries[0].scroll).toBe('auto');
  });

  it('återställs på sidan när vakten avväpnats', () => {
    const t = setup();
    t.guard.arm();
    t.guard.disarm();
    t.settle();
    expect(t.history.entries[1].scroll).toBe('auto');
  });

  it('återställs innan en länk navigerar, så nästa sida ärver det vanliga läget', () => {
    const t = setup();
    t.setGuarding(true);
    t.guard.arm();
    t.guard.leaveTo('/crm/offerter');
    t.settle();
    t.history.navigate('/crm/offerter');
    expect(t.history.entries.map((e) => e.scroll)).toEqual(['auto', 'auto', 'auto']);
  });

  it('återställs vid avmontering', () => {
    const t = setup();
    t.guard.arm();
    t.history.navigate('/crm/offerter'); // en navigering förbi vakten: nästa steg ärvde 'manual'
    t.guard.release();
    expect(t.history.url).toBe('/crm/offerter');
    expect(t.history.entries[t.history.index].scroll).toBe('auto');
  });
});
