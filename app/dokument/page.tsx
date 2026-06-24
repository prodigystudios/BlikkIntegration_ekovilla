import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The document library moved into the CRM shell (sales/admin only). Keep this
// stub so existing bookmarks and links to /dokument land on the new location.
// Non-sales/admin users are bounced to '/' by app/crm/layout.tsx, by design.
export default function DokumentRedirectPage({
  searchParams,
}: {
  searchParams?: { folderId?: string };
}) {
  const folderId = searchParams?.folderId;
  redirect(folderId ? `/crm/dokument?folderId=${encodeURIComponent(folderId)}` : '/crm/dokument');
}
