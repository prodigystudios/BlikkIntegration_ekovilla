"use client";
import React from 'react';
import AdminUsers from './users/AdminUsers';
import dynamic from 'next/dynamic';
import AdminBlikkUsersMapping from './blikk/AdminBlikkUsersMapping';

const AdminContacts = dynamic(() => import('./contacts/AdminContacts'), { ssr: false });
const AdminDepotUsage = dynamic(() => import('./depots/AdminDepotUsage'), { ssr: false });
const AdminNews = dynamic(() => import('./news/AdminNews'), { ssr: false });

type AdminTab = 'users'|'contacts'|'depots'|'blikk'|'news';

const tabs: Array<{ id: AdminTab; label: string; summary: string }> = [
  { id: 'users', label: 'Användare', summary: 'Konton, roller och taggar' },
  { id: 'contacts', label: 'Kontakter', summary: 'Kategorier, personer och adresser' },
  { id: 'depots', label: 'Depå-uttag', summary: 'Förbrukning och senaste uttag' },
  { id: 'blikk', label: 'Blikk-koppling', summary: 'Matchning mellan profiler och Blikk' },
  { id: 'news', label: 'Nyheter', summary: 'Skapa och publicera dashboardnyheter' },
];

export default function AdminTabsClient() {
  const [tab, setTab] = React.useState<AdminTab>('users');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tab');
    const fromStorage = window.localStorage.getItem('admin.activeTab');
    const candidate = [fromQuery, fromStorage].find((value): value is AdminTab => tabs.some((tabDef) => tabDef.id === value));
    if (candidate) setTab(candidate);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('admin.activeTab', tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  const currentTab = tabs.find((item) => item.id === tab) || tabs[0];

  return (
    <div style={{ display:'grid', gap:20, padding:'20px 20px 28px', maxWidth: 1460, margin:'0 auto' }}>
      <section style={{ border:'1px solid #dbe4ef', borderRadius:28, padding:'20px 20px 18px', background:'linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)', boxShadow:'0 18px 46px rgba(15,23,42,0.05)', display:'grid', gap:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
          <div style={{ display:'grid', gap:8, maxWidth:760 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span style={adminEyebrowStyle}>Admincenter</span>
              <span style={adminChipStyle}>{tabs.length} arbetsytor</span>
              <span style={adminChipStyle}>Aktiv: {currentTab.label}</span>
            </div>
            <div style={{ display:'grid', gap:6 }}>
              <h1 style={{ margin:0, fontSize:34, lineHeight:1.04, color:'#0f172a' }}>Administration med bättre överblick</h1>
              <p style={{ margin:0, fontSize:14, color:'#475569', lineHeight:1.55 }}>
                Hantera användare, kontakter, depåer, Blikk-matchning och nyheter från en tydligare gemensam adminyta.
              </p>
            </div>
          </div>
          <div style={{ display:'grid', gap:8, minWidth:220 }}>
            <div style={adminQuickCardStyle}>
              <span style={adminQuickLabelStyle}>Aktiv vy</span>
              <strong style={adminQuickValueStyle}>{currentTab.label}</strong>
              <span style={adminQuickMetaStyle}>{currentTab.summary}</span>
            </div>
          </div>
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {tabs.map((tabDef) => (
            <button key={tabDef.id} onClick={()=>setTab(tabDef.id)} style={tabBtn(tab===tabDef.id)}>
              <span style={{ fontWeight:700 }}>{tabDef.label}</span>
              <span style={{ fontSize:12, opacity: tab===tabDef.id ? 0.92 : 0.74 }}>{tabDef.summary}</span>
            </button>
          ))}
        </div>
      </section>
      <div>
        {tab==='users' && <AdminUsers />}
        {tab==='contacts' && <AdminContacts />}
        {tab==='depots' && <AdminDepotUsage />}
        {tab==='blikk' && <AdminBlikkUsersMapping />}
        {tab==='news' && <AdminNews />}
      </div>
    </div>
  );
}

const tabBtn = (active:boolean): React.CSSProperties => ({
  display:'grid',
  gap:4,
  minWidth: 168,
  padding:'12px 14px',
  borderRadius:16,
  cursor:'pointer',
  fontSize:14,
  textAlign:'left',
  border:'1px solid '+(active?'#bfdbfe':'#dbe4ef'),
  background: active? 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)':'#fff',
  color: '#0f172a',
  boxShadow: active ? '0 10px 24px rgba(37,99,235,0.12)' : 'none'
});

const adminEyebrowStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 10px',
  borderRadius:999,
  background:'#dbeafe',
  border:'1px solid #bfdbfe',
  color:'#2563eb',
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.35,
  textTransform:'uppercase'
};

const adminChipStyle: React.CSSProperties = {
  display:'inline-flex',
  alignItems:'center',
  padding:'4px 8px',
  borderRadius:999,
  background:'#f8fafc',
  border:'1px solid #e2e8f0',
  color:'#475569',
  fontSize:12,
  fontWeight:700
};

const adminQuickCardStyle: React.CSSProperties = {
  display:'grid',
  gap:5,
  padding:'14px 14px 12px',
  borderRadius:18,
  border:'1px solid #dbe4ef',
  background:'#fff'
};

const adminQuickLabelStyle: React.CSSProperties = {
  fontSize:11,
  fontWeight:800,
  letterSpacing:0.3,
  textTransform:'uppercase',
  color:'#64748b'
};

const adminQuickValueStyle: React.CSSProperties = {
  fontSize:18,
  fontWeight:800,
  color:'#0f172a'
};

const adminQuickMetaStyle: React.CSSProperties = {
  fontSize:12,
  color:'#64748b'
};
