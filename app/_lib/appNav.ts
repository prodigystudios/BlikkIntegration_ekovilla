import type { UserRole } from '@/lib/roles';
import type { PermissionKey } from '@/lib/auth/permissions';

// App-level navigation shown OUTSIDE the CRM context (start page + the per-role
// destinations that used to live in the global header / dashboard). The CRM
// context reuses its own nav (app/crm/_lib/nav.ts) when the path is under /crm.
//
// Två sorters grind, rad för rad:
//   * `permission` — raden syns för den som HAR nyckeln (effektiva behörigheter: rollens knippe,
//     minus nekanden, plus undantag per användare). Samma nyckel som sidan eller dess API gatar på.
//   * `roles` — den gamla rollgrinden, kvar på de rader som medvetet inte flyttats: Start, /tid,
//     /admin, /crm/dokument, gamla /plannering och lönebyråns två rader. Den använder den *effektiva*
//     rollen (konsult blir sales uppströms).
// En rad med `permission` läser ALDRIG `roles`. Nycklarnas seed är dagens rollmängd
// (20260926101919_rbac_app_permission_keys.sql), så bytet flyttar ingen rad för någon roll —
// tests/auth/permissionCatalog.test.ts jämför menyn per roll mot hur den såg ut före bytet.
//
// Shape mirrors CrmNavItem: an item with `children` renders as an expandable group
// in the sidebar. The frequent destinations stay flat on purpose — the collapsed
// 68px rail hides child lists entirely, so anything behind a group costs a hover
// (or a pin) to reach. Only the long tail is grouped.
export type AppNavItem = {
  // For a group this is an identity key, never a destination: the sidebar renders
  // group rows as a <button>, so it is only used for the expand state and the icon
  // lookup. Groups therefore carry a `group:` key instead of a URL, and
  // getVisibleAppNavItems drops any group whose children are all filtered away —
  // an empty group would otherwise fall through to the plain-link branch and
  // render `group:…` as an href.
  href: string;
  label: string;
  roles?: UserRole[]; // omitted = visible to all authenticated roles (see EXPLICIT_ONLY_ROLES)
  // set = visible iff the user holds the key (ALL of them, for an array); `roles` is then ignored.
  // An array is for a row whose page sits behind one gate and reads data behind another.
  permission?: PermissionKey | PermissionKey[];
  children?: AppNavItem[];
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: '/', label: 'Start' },

  // Sales / admin block
  { href: '/crm', label: 'CRM', permission: 'crm.access' },
  // Two planning worlds are live during the CRM cutover: new jobs are planned in CRM, the legacy
  // Blikk-backed board runs its remaining jobs to completion. Both are listed so the office can
  // reach either; the legacy one is labelled so nobody plans new work there by mistake. They stay
  // flat and adjacent — putting the current one behind a group would hide the destination people
  // actually want and leave the legacy board as the one you reach by reflex.
  // BÅDA: sidan ligger bakom CRM-layoutens crm.access, datan bakom planning.schedule.read. En
  // arbetsledare med bara planeringsnyckeln hade annars fått en rad som studsar till Start.
  { href: '/crm/planering', label: 'Planering', permission: ['crm.access', 'planning.schedule.read'] },
  { href: '/plannering', label: 'Planering (äldre)', roles: ['sales', 'admin'] },
  { href: '/crm/korjournal', label: 'Körjournal', permission: 'crm.access' },

  // Kalkylatorn (/offert/kalkylator) är MEDVETET UTE UR MENYN. Ytan används inte alls just nu och
  // ska byggas om eller tas bort — en meny-rad till något ingen ska använda är bara en väg att
  // råka gå fel. Rutten lever kvar, så gamla bokmärken och länkar fungerar som förut. Lägg tillbaka
  // raden här när ytan är ombyggd och beslutad:
  //   { href: '/offert/kalkylator', label: 'Kalkylator', roles: ['sales', 'admin'] },
  // (⚠️ startsidans snabblänkar i components/dashboard/ClientDashboard.tsx pekar fortfarande dit.)

  // Installer / member block
  { href: '/mina-jobb', label: 'Mina jobb', permission: 'app.jobs.read' },
  // Egenkontrollerna delade tidigare toppnivå som "Egenkontroll" och "Egenkontroller" — en bokstav
  // isär för två olika saker. De hör ihop, så de bor i en egen grupp med namnen utskrivna.
  // Sälj ser bara arkivet; enbarnsregeln nedan fäller då ihop gruppen till just den raden.
  {
    href: 'group:egenkontroll',
    label: 'Egenkontroll',
    children: [
      { href: '/egenkontroll', label: 'Ny egenkontroll', permission: 'app.egenkontroll.write' },
      { href: '/archive', label: 'Sparade egenkontroller', permission: 'app.archive.read' },
    ],
  },
  // ⚠️ TIDRAPPORTEN PEKAR PÅ VÅR EGEN /tid — bytet gjordes 2026-09-01 på Williams uttryckliga
  // instruktion, och det är den enda sortens beslut som får flytta den här raden.
  //
  // Blikks /tidrapport ligger kvar OFÖRÄNDRAD som rutt (bokmärken och gamla länkar fungerar), men
  // den har ingen rad här längre. Det är hela poängen: menyn är det som styr var folk rapporterar,
  // och två rader med samma namn hade delat besättningen mellan två system mitt i en löneperiod.
  // Lägg inte tillbaka en "Tidrapport (Blikk)"-rad utan att fråga.
  //
  // Rollerna är MEDVETET oförändrade. Bytet gällde adressen, inte vem som ser raden — sälj och
  // kontor når /tid via adressen precis som förut. Den ligger kvar platt: en grupp är ett extra steg.
  { href: '/tid', label: 'Tidrapport', roles: ['member', 'admin'] },

  // Shared — the long tail, grouped.
  {
    href: 'group:dokument',
    label: 'Dokument',
    children: [
      { href: '/mina-dokument', label: 'Mina dokument', permission: 'app.documents.read' },
      // Was "Dokument", which read as a fourth sibling of the three document rows.
      { href: '/crm/dokument', label: 'Dokumentbibliotek', roles: ['sales', 'admin'] },
      { href: '/dokument-information', label: 'Dokument & information', permission: 'app.access' },
    ],
  },
  {
    href: 'group:ovrigt',
    label: 'Övrigt',
    children: [
      { href: '/kontakt-lista', label: 'Kontakt & adresser', permission: 'app.contacts.read' },
      { href: '/nyheter', label: 'Nyheter', permission: 'app.news.read' },
      { href: '/material-kvalitet', label: 'Materialkvalitet', permission: 'app.material.read' },
      { href: '/bestallning-klader', label: 'Beställ kläder', permission: 'app.clothing.order' },
      // Sist i gruppen: det man söker upp när något är fel, inte något man gör i förbifarten.
      { href: '/felanmalan', label: 'Felanmälan', permission: 'app.access' },
    ],
  },

  // Tid & lön — lönebyråns enda yta, och admins genväg till attesten utan omvägen via /admin.
  //
  // Rollgatad som alla andra rader, men ÅTKOMSTEN till sidan avgörs av behörigheten time.approve
  // (app/ekonomi/page.tsx). Raden och grinden svarar alltså på olika frågor med flit: den som får
  // nyckeln per användarundantag når sidan via adressen men får ingen rad här. Samma medvetna glapp
  // som /tid har.
  //
  // Platt och näst sist: för `ekonomi` är den hela hennes app, och för admin är den en destination
  // man går till, inte något man letar upp i en grupp.
  { href: '/ekonomi', label: 'Tid & lön', roles: ['ekonomi', 'admin'] },

  // Fakturaunderlaget — arbetsordrarna, skrivskyddade. Samma konstruktion som raden ovan: rollen
  // bär raden, nycklarna (crm.access + crm.workorder.read) bär åtkomsten.
  //
  // ⚠️ `roles` MÅSTE nämna 'ekonomi' vid namn. Rollen står i EXPLICIT_ONLY_ROLES nedan, alltså ser
  // den BARA rader som räknar upp den — en rad utan `roles` (eller med bara 'admin') hade varit
  // osynlig för just den roll den är byggd för. Det är hela poängen med opt-in-listan, och det är
  // också den enda vägen den biter fel.
  //
  // ⛔ INTE under `/crm`-raden och inte i CRM:ets egen nav (app/crm/_lib/nav.ts): hela /crm ligger
  // bakom en rollgrind som kastar ut ekonomi till startsidan. Ytan har en egen adress just därför.
  //
  // Admin har medvetet INGEN rad här — de når samma ordrar via CRM, med skrivrätt. Två rader till
  // samma ordrar, varav den ena tyst tar bort knapparna, är en fälla att gå i, inte en genväg.
  { href: '/ekonomi/arbetsorder', label: 'Arbetsordrar', roles: ['ekonomi'] },

  // Admin
  { href: '/admin', label: 'Admin', roles: ['admin'] },
];

// ⚠️ ROLLER SOM BARA SER DET DE UTTRYCKLIGEN FÅTT.
//
// En rad utan `roles` har hittills betytt "alla" — men vad den EGENTLIGEN betyder är "alla
// anställda": Start, Dokument & information, Kontakt & adresser och Felanmälan är internt material
// för folk som jobbar här. `ekonomi` är lönebyrån, extern, och fick dem alla gratis bara genom att
// existera.
//
// Det är samma felklass som redan bitit två gånger i den här ändringen: startsidans schema var
// villkorat "alla utom sales", och "Rapportera tid" hade ingen rollspärr alls. **Utelämnad spärr =
// öppen dörr för varje NY roll.** Vändningen är att göra det opt-in i stället: en roll här ser bara
// rader som nämner den vid namn, så nästa externa roll ärver ingenting av misstag.
//
// Rör INTE de andra rollerna. `null` (okänd roll) ser fortfarande de ospärrade raderna — sedan
// nycklarna är det bara Start — ett test vaktar det, och att logga in och se en tom meny är ett sämre
// fel än att se Start.
//
// Sedan nycklarna (2026-09-26) gäller listan bara rader UTAN `permission`: Dokument & information,
// Kontakt & adresser och Felanmälan gatas nu på app.access / app.contacts.read, som ekonomi inte har.
// Start är den enda raden helt utan grind — med flit, se getVisibleAppNavItems.
const EXPLICIT_ONLY_ROLES: UserRole[] = ['ekonomi'];

export type CanFn = (key: PermissionKey) => boolean;

function isItemVisible(item: AppNavItem, role: UserRole | null, can: CanFn) {
  if (item.permission) return (Array.isArray(item.permission) ? item.permission : [item.permission]).every(can);
  if (role && EXPLICIT_ONLY_ROLES.includes(role)) return !!item.roles?.includes(role);
  return !item.roles || (!!role && item.roles.includes(role));
}

// A group is nothing but its children, so what role gating leaves behind decides whether
// it still earns a row. None: it has no destination left to offer, and its `group:` key is
// not a URL to fall back on — drop it, or the sidebar's plain-link branch would render
// `href="group:…"`. One: a chevron that opens onto a single link is a click for nothing,
// so the child takes the row and names it.
function collapseGroup(item: AppNavItem, role: UserRole | null, can: CanFn): AppNavItem[] {
  if (!item.children) return [item];
  const children = item.children.filter((child) => isItemVisible(child, role, can));
  if (children.length === 0) return [];
  if (children.length === 1) return [children[0]];
  return [{ ...item, children }];
}

// `role` är den EFFEKTIVA rollen (toEffectiveRole) och styr bara rader utan `permission`. `can` svarar
// för den inloggades effektiva behörigheter — tom mängd (utloggad, eller läsningen misslyckades) ger
// bara de rollstyrda raderna, aldrig en tom meny: Start har ingen nyckel med flit.
export function getVisibleAppNavItems(role: UserRole | null, can: CanFn): AppNavItem[] {
  return APP_NAV_ITEMS.filter((item) => isGroupWithoutGate(item) || isItemVisible(item, role, can)).flatMap((item) =>
    collapseGroup(item, role, can),
  );
}

// En grupp utan egen grind avgörs HELT av sina barn (collapseGroup släpper den om inget barn syns).
// Utan det här föll gruppen på rollregeln först — och för en EXPLICIT_ONLY-roll (ekonomi), som bara ser
// rader som nämner den, försvann då varje nyckelstyrt barn, även med ett personligt undantag.
function isGroupWithoutGate(item: AppNavItem) {
  return !!item.children && !item.roles && !item.permission;
}
