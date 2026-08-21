import type { Block, InlineNode } from '@/lib/domains/info-page/blocks';

// Översättningen mellan redigeringsrutan (DOM) och blockmodellen.
//
// Den här filen rör DOM och går därför inte att enhetstesta utan webbläsare. Det är medvetet
// att den är tunn och dum: allt som avgör vad som faktiskt får sparas och visas bor i
// lib/domains/info-page/blocks.ts, som testas utan DOM. Här handlar det bara om att läsa av
// respektive fylla en ruta.

type RawInline = InlineNode | { br: true };

const BOLD_TAGS = new Set(['B', 'STRONG']);

function isBoldElement(el: HTMLElement): boolean {
  if (BOLD_TAGS.has(el.tagName)) return true;
  // execCommand('bold') ger <b> i de flesta webbläsare men kan ge en style i stället, och en
  // inklistrad text bär ofta font-weight direkt. Båda ska räknas som fet.
  const weight = el.style?.fontWeight;
  if (!weight) return false;
  return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
}

function collectInline(node: Node, bold: boolean, href: string | null, out: RawInline[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text) return;
    out.push(href ? { type: 'link', href, text, ...(bold ? { bold: true } as const : {}) }
                  : { type: 'text', text, ...(bold ? { bold: true } as const : {}) });
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;

  if (el.tagName === 'BR') {
    out.push({ br: true });
    return;
  }

  // En nästlad lista är egna punkter, inte text i den här. Utan den här raden råkade
  // collectInline vandra ned i den och klistra ihop "Förälder" + "Underpunkt" till EN post.
  if (el.tagName === 'UL' || el.tagName === 'OL') return;

  const nextBold = bold || isBoldElement(el);
  // Närmaste länk vinner. Nästlade <a> är ogiltig html men uppstår ändå vid inklistring.
  const nextHref = el.tagName === 'A' ? (el.getAttribute('href') || href) : href;

  el.childNodes.forEach((child) => collectInline(child, nextBold, nextHref, out));
}

// Plockar ut posterna ur en lista och plattar ut nästlade nivåer till egna poster.
// Modellen har bara en nivå; att platta ut behåller texten, medan att vandra ned hade slagit
// ihop den med föräldern.
function listItems(list: HTMLElement): InlineNode[][] {
  const items: InlineNode[][] = [];
  list.querySelectorAll(':scope > li').forEach((li) => {
    const raw: RawInline[] = [];
    li.childNodes.forEach((child) => collectInline(child, false, null, raw));
    items.push(raw.filter((n): n is InlineNode => !('br' in n)));
    li.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
      items.push(...listItems(nested as HTMLElement));
    });
  });
  return items;
}

// Delar upp på radbrytningar: ett <br> i rutan blir ett nytt stycke i modellen, eftersom
// modellen inte har någon egen radbrytning inuti ett stycke.
function splitOnBreaks(nodes: RawInline[]): InlineNode[][] {
  const paragraphs: InlineNode[][] = [];
  let current: InlineNode[] = [];
  for (const node of nodes) {
    if ('br' in node) {
      paragraphs.push(current);
      current = [];
      continue;
    }
    current.push(node);
  }
  paragraphs.push(current);
  return paragraphs;
}

function collectBlocks(nodes: NodeListOf<ChildNode> | ChildNode[], blocks: unknown[]): void {
  nodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      if (el.tagName === 'UL' || el.tagName === 'OL') {
        blocks.push({ type: 'list', ordered: el.tagName === 'OL', items: listItems(el) });
        return;
      }

      // En lista som webbläsaren lindat i en <div> hade annars fallit till stycke-grenen och
      // plattats till en enda rad utan punkter. Stig ned i omslaget i stället.
      if (el.querySelector(':scope > ul, :scope > ol')) {
        collectBlocks(el.childNodes, blocks);
        return;
      }
    }

    const raw: RawInline[] = [];
    collectInline(node, false, null, raw);
    for (const children of splitOnBreaks(raw)) {
      blocks.push({ type: 'paragraph', children });
    }
  });
}

/**
 * Läser av redigeringsrutan. Resultatet är ETT FÖRSLAG — det måste köras genom
 * normalizeBlocks innan det sparas eller visas.
 */
export function editorToBlocks(root: HTMLElement): unknown[] {
  const blocks: unknown[] = [];
  collectBlocks(root.childNodes, blocks);
  return blocks;
}

function inlineToNode(inline: InlineNode, doc: Document): Node {
  const text = doc.createTextNode(inline.text);
  let node: Node = text;

  if (inline.bold) {
    const strong = doc.createElement('strong');
    strong.appendChild(node);
    node = strong;
  }

  if (inline.type === 'link') {
    const anchor = doc.createElement('a');
    anchor.setAttribute('href', inline.href);
    anchor.appendChild(node);
    node = anchor;
  }

  return node;
}

/**
 * Bygger innehållet för redigeringsrutan som DOM-noder.
 *
 * Noder och inte en html-sträng med flit: texten sätts som text hela vägen, så ingenting som
 * en gång klistrats in kan bli markup igen när det laddas tillbaka in i rutan.
 */
export function blocksToFragment(blocks: Block[], doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();

  for (const block of blocks) {
    if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = doc.createElement('li');
        for (const inline of item) li.appendChild(inlineToNode(inline, doc));
        list.appendChild(li);
      }
      fragment.appendChild(list);
      continue;
    }

    const p = doc.createElement('p');
    for (const inline of block.children) p.appendChild(inlineToNode(inline, doc));
    fragment.appendChild(p);
  }

  // En tom ruta behöver ett stycke att sätta markören i, annars börjar webbläsaren skriva
  // direkt i rot-elementet och första raden blir en lös textnod.
  if (!fragment.firstChild) fragment.appendChild(doc.createElement('p'));

  return fragment;
}
