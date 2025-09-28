"use client";
import React from 'react';
import AdminUsers from './users/AdminUsers';
import dynamic from 'next/dynamic';

const AdminContacts = dynamic(() => import('./contacts/AdminContacts'), { ssr: false });

export default function AdminTabsClient() {
  const [tab, setTab] = React.useState<'users'|'contacts'>('users');
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', gap:8, padding:24, paddingBottom:8 }}>
        <button onClick={()=>setTab('users')} style={tabBtn(tab==='users')}>Användare</button>
        <button onClick={()=>setTab('contacts')} style={tabBtn(tab==='contacts')}>Kontakter</button>
      </div>
      <div>
        {tab==='users' && <AdminUsers />}
        {tab==='contacts' && <AdminContacts />}
      </div>
    </div>
  );
}

const tabBtn = (active:boolean): React.CSSProperties => ({ padding:'8px 14px', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:500, border:'1px solid '+(active?'#111827':'#d1d5db'), background: active? '#111827':'#fff', color: active? '#fff':'#111827' });
