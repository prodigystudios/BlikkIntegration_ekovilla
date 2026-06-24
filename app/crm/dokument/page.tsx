export const dynamic = 'force-dynamic';

import { getUserProfile } from '../../../lib/getUserProfile';
import DocumentsClient from './DocumentsClient';

// Auth and the sales/admin gate are handled by app/crm/layout.tsx, which also
// provides the page shell (<main>). This page only resolves the admin edit flag
// and composes the client surface inside the CRM shell.
export default async function CrmDokumentPage() {
  const profile = await getUserProfile();
  const canEdit = profile?.role === 'admin';

  return <DocumentsClient canEdit={canEdit} />;
}
