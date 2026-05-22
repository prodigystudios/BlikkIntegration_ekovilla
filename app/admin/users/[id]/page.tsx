import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminSupabase } from '../../../../lib/adminSupabase';
import { getUserProfile } from '../../../../lib/getUserProfile';
import PageShell from '../../../../components/ui/PageShell';
import AdminUserProfileEditor from './AdminUserProfileEditor';
import {
  asRecord,
  attachSensitiveStatus,
  mergeEmployeeProfile,
  mergeSensitiveDetails,
  PROFILE_DETAILS_SELECT,
  PROFILE_SELECT,
  SENSITIVE_PROFILE_SELECT,
} from '../../../../lib/profileDetails';

export const dynamic = 'force-dynamic';

export default async function AdminUserProfilePage({ params }: { params: { id: string } }) {
  const current = await getUserProfile();
  if (!current || current.role !== 'admin') {
    redirect('/');
  }

  if (!adminSupabase) {
    return (
      <PageShell className="max-w-[1280px] gap-5">
        <section className="rounded-[24px] border border-ui-border bg-white p-[22px] shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
          Service role saknas. Kan inte visa användarprofilen.
        </section>
      </PageShell>
    );
  }

  const [
    { data: profileRow, error: profileError },
    { data: detailRow, error: detailError },
    { data: sensitiveRow, error: sensitiveError },
    authUser,
  ] = await Promise.all([
    adminSupabase.from('profiles').select(PROFILE_SELECT).eq('id', params.id).maybeSingle(),
    adminSupabase.from('employee_profile_details').select(PROFILE_DETAILS_SELECT).eq('user_id', params.id).maybeSingle(),
    adminSupabase.from('employee_sensitive_details').select(SENSITIVE_PROFILE_SELECT).eq('user_id', params.id).maybeSingle(),
    adminSupabase.auth.admin.getUserById(params.id),
  ]);

  if (profileError || detailError || sensitiveError) {
    return (
      <PageShell className="max-w-[1280px] gap-5">
        <section className="rounded-[24px] border border-ui-border bg-white p-[22px] shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
          Kunde inte ladda användarprofilen.
        </section>
      </PageShell>
    );
  }

  const profile = attachSensitiveStatus(
    mergeEmployeeProfile(
      asRecord(profileRow),
      asRecord(detailRow),
    ),
    asRecord(sensitiveRow),
  );
  if (!profile) {
    notFound();
  }

  const sensitive = mergeSensitiveDetails(asRecord(sensitiveRow));

  const authEmail = authUser.data.user?.email || 'Saknas';

  return <AdminUserProfileEditor userId={params.id} authEmail={authEmail} profile={profile} sensitive={sensitive} />;
}