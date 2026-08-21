// Blockmodellen för /dokument-information.
//
// Redigeraren i /admin är en contentEditable-ruta med en verktygsrad, men det som lämnar
// klienten är ALDRIG html. Den här modulen är whitelisten: allt som inte matchar en känd
// blocktyp eller en känd inline-nod kastas, och sidan renderar sedan modellen som riktiga
// React-element. Därför finns ingen väg in för inklistrad markup — inte för att vi filtrerar
// bort det farliga, utan för att vi bara släpper igenom det vi känner igen.
//
// Ren modul med flit: den här logiken är gränsen mellan "admin skrev något" och "alla får se
// det", och den måste gå att testa utan webbläsare.

export type InlineNode =
  | { type: 'text'; text: string; bold?: true }
  | { type: 'link'; href: string; text: string; bold?: true };

export type Block =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] };

// Tak som skyddar mot en klistrad bok snarare än mot en angripare — en sektion är ett dragspel
// på en informationssida, inte ett dokumentarkiv.
export const MAX_BLOCKS = 200;
export const MAX_ITEMS_PER_LIST = 200;
export const MAX_TEXT_LENGTH = 20_000;

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'tel:', 'mailto:']);

const PHONE_LIKE = /^[+()\d][\d\s().-]{4,}$/;
const EMAIL_LIKE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Gör en länk säker och användbar, eller kastar den.
 *
 * Returnerar null för allt som inte går att lita på. Den som skriver får se resultatet i
 * förhandsvisningen, så en tyst bortkastad länk syns innan den sparas.
 */
export function normalizeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  // Kontrolltecken bort FÖRST. "java\tscript:alert(1)" tar sig förbi en naiv prefixkontroll
  // men körs ändå av webbläsaren, som struntar i dem inuti ett schemanamn.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) return null;

  // Protokollrelativt: //exempel.se ärver sidans schema och pekar ut ur appen utan att se ut
  // som en absolut adress. Backslash räknas likadant av webbläsaren — new URL('/\\evil.com',
  // 'https://app.example.com/') blir 'https://evil.com/' — så /\ måste kastas på samma villkor
  // som //, annars passerar den som en intern väg och renderas dessutom utan rel=noopener.
  if (/^[/\\]{2}/.test(cleaned)) return null;
  if (/^\/[\\]/.test(cleaned)) return null;

  // Intern väg i appen.
  if (cleaned.startsWith('/')) return cleaned;

  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(cleaned);
  if (scheme) {
    return ALLOWED_SCHEMES.has(`${scheme[1].toLowerCase()}:`) ? cleaned : null;
  }

  // Inget schema alls: gissa vad personen menade i stället för att tappa länken. Ordningen
  // spelar roll — ett telefonnummer innehåller siffror och bindestreck som annars hade blivit
  // en webbadress.
  if (PHONE_LIKE.test(cleaned)) return `tel:${cleaned.replace(/[\s().-]/g, '')}`;
  if (EMAIL_LIKE.test(cleaned)) return `mailto:${cleaned}`;
  return `https://${cleaned}`;
}

function normalizeInline(raw: unknown): InlineNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;

  const text = typeof node.text === 'string' ? node.text.slice(0, MAX_TEXT_LENGTH) : '';
  if (!text) return null;

  const bold = node.bold === true ? ({ bold: true } as const) : null;

  if (node.type === 'link') {
    const href = normalizeHref(node.href);
    // En länk utan giltig adress degraderar till text i stället för att försvinna — texten
    // är innehåll, adressen är bara hur den nås.
    if (!href) return { type: 'text', text, ...(bold ?? {}) };
    return { type: 'link', href, text, ...(bold ?? {}) };
  }

  if (node.type === 'text') return { type: 'text', text, ...(bold ?? {}) };

  return null;
}

// Slår ihop grannar med samma formatering. contentEditable delar gärna en mening i fem
// textnoder när man klickar runt i den, och utan det här växer body:n varje gång någon
// öppnar och sparar utan att ändra något.
function mergeAdjacent(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.type === 'text' &&
      node.type === 'text' &&
      prev.bold === node.bold &&
      prev.text.length + node.text.length <= MAX_TEXT_LENGTH
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + node.text };
      continue;
    }
    out.push(node);
  }
  return out;
}

function normalizeChildren(raw: unknown): InlineNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes = raw.map(normalizeInline).filter((n): n is InlineNode => n !== null);
  return mergeAdjacent(nodes);
}

function hasVisibleText(nodes: InlineNode[]): boolean {
  return nodes.some((n) => n.text.trim().length > 0);
}

function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const block = raw as Record<string, unknown>;

  if (block.type === 'list') {
    const rawItems = Array.isArray(block.items) ? block.items.slice(0, MAX_ITEMS_PER_LIST) : [];
    const items = rawItems.map(normalizeChildren).filter(hasVisibleText);
    if (items.length === 0) return null;
    return { type: 'list', ordered: block.ordered === true, items };
  }

  if (block.type === 'paragraph') {
    const children = normalizeChildren(block.children);
    // Ett tomt stycke är inte innehåll. contentEditable lämnar ett efter varje radering, och
    // utan det här samlar sidan på sig luft som ingen ser i redigeraren.
    if (!hasVisibleText(children)) return null;
    return { type: 'paragraph', children };
  }

  return null;
}

/**
 * Whitelisten. Tar vad som helst och ger tillbaka en modell som är säker att rendera.
 */
export function normalizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BLOCKS)
    .map(normalizeBlock)
    .filter((b): b is Block => b !== null);
}
