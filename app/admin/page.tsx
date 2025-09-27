import { redirect } from 'next/navigation';
import { getUserProfile } from '../../lib/getUserProfile';
import AdminUsers from '../admin/users/AdminUsers';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') {
    redirect('/');
  }
  return <AdminUsers />;
}
