// Hitta den inlämnade egenkontrollens nedladdningslänk bland arbetsorderns kommentarer.
//
// ── VARFÖR KOMMENTAREN ÄR KÄLLAN ─────────────────────────────────────────────
// När en egenkontroll sparas arkiveras PDF:en och en kommentar skrivs på arbetsordern med raden
// `Ladda ner här: <origin>/api/storage/download?path=…` (app/egenkontroll/page.tsx). Det är i dag
// den ENDA kopplingen mellan en order och dess egenkontroll som pekar ut just den filen —
// säckraderna (`kind: 'final'`) bevisar att en egenkontroll finns, men bär ingen sökväg, och
// arkivet går bara att söka i på filnamn.
//
// Priset är ett textparsningskontrakt mot en kommentar vi själva formaterar. Det accepterades med
// öppna ögon, mot alternativet att spara sökvägen i databasen: det senare är strukturellt renare
// men hjälper bara FRAMTIDA rapporter, och varje egenkontroll som redan lämnats in hade förblivit
// oåtkomlig. Skulle sökvägen börja sparas på ordern är det här reserven för bakåtkatalogen.
//
// ⚠️ URSPRUNGET I KOMMENTAREN KASTAS BORT — VI BYGGER LÄNKEN SJÄLVA.
//
// Det som återanvänds ur texten är BARA lagringssökvägen, och bara om den pekar in i
// `Egenkontroller/`. Adressen som renderas är alltid vår egen `/api/storage/download?path=…`.
//
// Två skäl, båda verkliga:
//
//  1. Knappen bär husets auktoritet. Den heter "Öppna egenkontrollen (PDF)" och sitter i orderns
//     eget kort, så den som klickar antar att filen är vår. Läste vi värdnamnet ur kommentaren
//     hade en inloggad kollega kunnat klistra in
//     `https://nagon-annan.example/api/storage/download?path=Egenkontroller/x.pdf` och fått det
//     renderat under den rubriken. Kommentaren visar fortfarande adressen som den skrevs — det
//     ska den, det är vad någon faktiskt skrev — men KNAPPEN är vår och pekar bara på oss.
//  2. Gamla kommentarer bär gammal domän. Länkar som skrevs före domänbytet pekar på
//     blikk-integration-ekovilla.vercel.app. Sökvägen är densamma och filen ligger i samma bucket,
//     så genom att bygga om adressen fungerar även de på app.ekovilla.se — och de slutar fungera
//     inte den dagen den gamla domänen stängs av.
//
// ⚠️ SÖKVÄGEN MÅSTE BÖRJA PÅ `Egenkontroller/`. Utan det hade vilken arkivlänk som helst i en
// kommentar — en ritning, ett kvitto — visats som "egenkontroll".
//
// ⚠️ SENASTE VINNER. En ny egenkontroll ERSÄTTER orderns tidigare (samma regel som final-raderna i
// säckboken följer). Visas den äldsta läser kontoret siffror som inte längre gäller.

export type EgenkontrollCommentLike = {
  body?: string | null;
  created_at?: string | null;
};

const ARCHIVE_PREFIX = 'Egenkontroller/';

// Sökvägen ligger URL-kodad i query-strängen: encodeURIComponent('Egenkontroller/x.pdf') ger
// 'Egenkontroller%2Fx.pdf'. Den okodade varianten accepteras också — billigare än att anta att
// varje länk som någonsin skrivits kodades likadant.
//
// Värddelen matchas men används inte: den finns i mönstret bara för att hitta träffen, aldrig för
// att hamna i utdata. `&` avslutar värdet, så en länk med fler parametrar inte drar med dem.
const DOWNLOAD_PATTERN = /https?:\/\/[^\s<>"']*\/api\/storage\/download\?path=([^\s<>"'&]+)/gi;

// Rå sökväg → vår egen nedladdningsadress, eller null om den inte hör hemma i arkivets
// egenkontrollmapp.
function toArchiveHref(rawPathValue: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathValue);
  } catch {
    // Trasig procentkodning. Ett `%` som inte följs av två hexsiffror kastar, och en halvtrasig
    // sökväg är inget vi ska försöka rädda.
    return null;
  }

  // Avslutande skiljetecken hör till meningen, inte till adressen.
  const path = decoded.replace(/[.,;:!?]+$/, '');

  if (!path.startsWith(ARCHIVE_PREFIX) || path.length <= ARCHIVE_PREFIX.length) return null;
  // Sökvägstraversering avvisas här och inte bara på servern: rutten sanerar också, men en sträng
  // ur en kommentar ska aldrig få formen av något annat än en fil i arkivmappen.
  if (path.includes('..')) return null;

  return `/api/storage/download?path=${encodeURIComponent(path)}`;
}

// Sista träffen i EN kommentar. Kommentaren innehåller normalt exakt en länk; skulle någon ha
// redigerat in fler är den sista den som står närmast raden "Ladda ner här:".
function lastEgenkontrollHrefIn(body: string): string | null {
  const re = new RegExp(DOWNLOAD_PATTERN.source, DOWNLOAD_PATTERN.flags);
  let found: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const href = toArchiveHref(match[1]);
    if (href) found = href;
  }
  return found;
}

export function findLatestEgenkontrollLink(
  comments: readonly EgenkontrollCommentLike[] | null | undefined,
): string | null {
  if (!Array.isArray(comments)) return null;

  let bestUrl: string | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  let bestIndex = -1;

  for (let index = 0; index < comments.length; index += 1) {
    const url = lastEgenkontrollHrefIn(String(comments[index]?.body ?? ''));
    if (!url) continue;

    // Otolkbart datum sorteras sist, men diskvalificerar inte kommentaren: en länk vi kan öppna är
    // bättre än ingen. Den faller då tillbaka på inmatningsordningen, där senare vinner.
    const parsed = Date.parse(String(comments[index]?.created_at ?? ''));
    const time = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;

    if (time > bestTime || (time === bestTime && index > bestIndex)) {
      bestUrl = url;
      bestTime = time;
      bestIndex = index;
    }
  }

  return bestUrl;
}
