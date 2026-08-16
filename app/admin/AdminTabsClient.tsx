"use client";
import React from 'react';
import dynamic from 'next/dynamic';
// AdminUsers är default-fliken och importeras statiskt med flit: som dynamic-chunk
// betalade varje /admin-besök en extra nätverksrunda (chunk → mount → API-fetch)
// och visade en tom panel innan komponenten dök upp.
import AdminUsers from './users/AdminUsers';
import PageShell from '../../components/ui/PageShell';
import { TabsList, TabsTrigger } from '../../components/ui/Tabs';
import { crm } from '../crm/lib/crmTokens';
import { cn } from '../../lib/shared/cn';

// Övriga flikar lazy-laddas; fallbacken förhindrar tom-panel-blink vid flikbyte
// (crm.card saknar padding — p-5 här matchar flikkropparnas egen padding).
const tabLoading = () => <p className="m-0 p-5 text-sm text-slate-400">Laddar…</p>;
const AdminBlikkUsersMapping = dynamic(() => import('./blikk/AdminBlikkUsersMapping'), { ssr: false, loading: tabLoading });
const AdminContacts = dynamic(() => import('./contacts/AdminContacts'), { ssr: false, loading: tabLoading });
const AdminDepotUsage = dynamic(() => import('./depots/AdminDepotUsage'), { ssr: false, loading: tabLoading });
const AdminNews = dynamic(() => import('./news/AdminNews'), { ssr: false, loading: tabLoading });
const AdminPermissions = dynamic(() => import('./permissions/AdminPermissions'), { ssr: false, loading: tabLoading });
const AdminTimeReference = dynamic(() => import('./tid/AdminTimeReference'), { ssr: false, loading: tabLoading });
const AdminTimeApprovals = dynamic(() => import('./tid/AdminTimeApprovals'), { ssr: false, loading: tabLoading });
const AdminSupportTickets = dynamic(() => import('./support/AdminSupportTickets'), { ssr: false, loading: tabLoading });
const AdminChangelog = dynamic(() => import('./changelog/AdminChangelog'), { ssr: false, loading: tabLoading });

type AdminTab = 'users'|'permissions'|'contacts'|'depots'|'blikk'|'tid'|'attest'|'news'|'arenden'|'changelog';

const tabs: Array<{ id: AdminTab; label: string; summary: string }> = [
  { id: 'users', label: 'Användare', summary: 'Konton, roller och taggar' },
  { id: 'permissions', label: 'Behörigheter', summary: 'Roller och per-användar-behörigheter' },
  { id: 'contacts', label: 'Kontakter', summary: 'Kategorier, personer och adresser' },
  { id: 'depots', label: 'Depå-uttag', summary: 'Förbrukning och senaste uttag' },
  { id: 'blikk', label: 'Blikk-koppling', summary: 'Matchning mellan profiler och Blikk' },
  { id: 'tid', label: 'Tidkoder', summary: 'Tidkoder, internprojekt och frånvarotyper för tidrapporteringen' },
  { id: 'attest', label: 'Attest', summary: 'Lås tidrapporteringen per person och kalendermånad' },
  { id: 'news', label: 'Nyheter', summary: 'Skapa och publicera dashboardnyheter' },
  { id: 'arenden', label: 'Ärenden', summary: 'Buggar och önskemål som rapporterats i appen' },
  { id: 'changelog', label: 'Changelog', summary: 'Vad som fixats och tillkommit — visas i CRM' },
];

function resolveAdminTab(fromQuery: string | null, fromStorage: string | null): AdminTab | null {
  return [fromQuery, fromStorage].find((value): value is AdminTab => tabs.some((tabDef) => tabDef.id === value)) ?? null;
}

export default function AdminTabsClient() {
  const [tab, setTab] = React.useState<AdminTab>('users');
  const [hasResolvedInitialTab, setHasResolvedInitialTab] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tab');
    const fromStorage = window.localStorage.getItem('admin.activeTab');
    const candidate = resolveAdminTab(fromQuery, fromStorage);
    if (candidate) setTab(candidate);
    setHasResolvedInitialTab(true);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !hasResolvedInitialTab) return;
    window.localStorage.setItem('admin.activeTab', tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [hasResolvedInitialTab, tab]);

  return (
    <PageShell className="max-w-[1460px]">
      <section className={cn(crm.cardInner, 'grid gap-4')}>
        <h1 className={cn('m-0', crm.pageTitle)}>Administration</h1>

        <TabsList aria-label="Adminytor" className="gap-2">
          {tabs.map((tabDef) => (
            <TabsTrigger
              key={tabDef.id}
              id={`admin-tab-${tabDef.id}`}
              // Bara aktiv flik har sin panel i DOM — aria-controls på inaktiva
              // flikar vore dinglande referenser (axe: aria-valid-attr-value).
              aria-controls={tab === tabDef.id ? `admin-tabpanel-${tabDef.id}` : undefined}
              onClick={() => setTab(tabDef.id)}
              active={tab === tabDef.id}
              title={tabDef.summary}
            >
              {tabDef.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </section>

      <section
        role="tabpanel"
        id={`admin-tabpanel-${tab}`}
        aria-labelledby={`admin-tab-${tab}`}
        className={crm.card}
      >
        {tab==='users' && <AdminUsers />}
        {tab==='permissions' && <AdminPermissions />}
        {tab==='contacts' && <AdminContacts />}
        {tab==='depots' && <AdminDepotUsage />}
        {tab==='blikk' && <AdminBlikkUsersMapping />}
        {tab==='tid' && <AdminTimeReference />}
        {tab==='attest' && <AdminTimeApprovals />}
        {tab==='news' && <AdminNews />}
        {tab==='arenden' && <AdminSupportTickets />}
        {tab==='changelog' && <AdminChangelog />}
      </section>
    </PageShell>
  );
}
