import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminSupabase } from '../../../../lib/adminSupabase';
import { getUserProfile } from '../../../../lib/getUserProfile';
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
    return <main style={pageStyle}><section style={cardStyle}>Service role saknas. Kan inte visa användarprofilen.</section></main>;
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
    return <main style={pageStyle}><section style={cardStyle}>Kunde inte ladda användarprofilen.</section></main>;
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

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gap: 20,
  padding: '24px 20px 36px',
  maxWidth: 1280,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid #dbe4ef',
  background: '#fff',
  borderRadius: 24,
  padding: 22,
  boxShadow: '0 12px 32px rgba(15,23,42,0.04)',
};