import type { Block, InlineNode } from '@/lib/domains/info-page/blocks';

// Renderar blockmodellen som riktiga React-element. Ingen dangerouslySetInnerHTML någonstans:
// texten kommer ur databasen som text och sätts som text, så det finns ingen väg för markup
// att bli markup — oavsett vad som en gång klistrades in i redigeraren.

function Inline({ node }: { node: InlineNode }) {
  const text = node.bold ? <strong className="font-semibold">{node.text}</strong> : node.text;

  if (node.type === 'link') {
    // Bara http/https lämnar appen och förtjänar en ny flik. tel: och mailto: ska hanteras av
    // telefonen respektive e-postklienten, och target="_blank" på dem lämnar en tom flik efter
    // sig. rel sätts ändå på allt utåtgående: noopener är skyddet, noreferrer artigheten.
    const opensElsewhere = /^https?:/i.test(node.href);
    return (
      <a
        href={node.href}
        {...(opensElsewhere ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="font-semibold text-emerald-700 underline hover:text-emerald-800"
      >
        {text}
      </a>
    );
  }

  return <>{text}</>;
}

function Inlines({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        // Index som nyckel är rätt här: listan är statiskt renderad från en oföränderlig
        // modell och sorteras eller filtreras aldrig i klienten.
        <Inline key={i} node={node} />
      ))}
    </>
  );
}

export default function BlockContent({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return null;

  return (
    <div className="grid gap-2.5 text-sm leading-6 text-slate-700">
      {blocks.map((block, i) => {
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={i} className={block.ordered ? 'my-0 list-decimal pl-5' : 'my-0 list-disc pl-5'}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={i} className="m-0">
            <Inlines nodes={block.children} />
          </p>
        );
      })}
    </div>
  );
}
