"use client";
import React, { createContext, useContext, useMemo } from 'react';
import type { UserProfile } from './getUserProfile';
import type { PermissionKey } from './auth/permissions';

export interface UserProfileContextValue {
  profile: UserProfile | null;
  permissions: ReadonlySet<string>;
}

const Ctx = createContext<UserProfileContextValue>({ profile: null, permissions: new Set() });

// `permissions` kommer från servern (app/layout.tsx → getEffectivePermissions) som en ARRAY, med flit:
// en Set överlever inte gränsen server → klient — den kommer fram som `{}`, och varje kontroll hade
// tyst svarat nej. Mängden byggs här i stället.
export function UserProfileProvider({
  profile,
  permissions,
  children,
}: {
  profile: UserProfile | null;
  permissions: readonly string[];
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ profile, permissions: new Set(permissions) }), [profile, permissions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserProfile() {
  return useContext(Ctx).profile;
}

/**
 * Har den inloggade nyckeln? Samma effektiva behörigheter som serverns requirePermission() och RLS:ens
 * has_permission() — rollens knippe, minus nekanden, plus undantag per användare. Failar stängt: utan
 * inloggning, eller om läsningen misslyckades på servern, är mängden tom.
 *
 * Läses en gång per full sidladdning (rotlayouten renderas inte om vid klientnavigering) — precis som
 * rollen. En ändrad behörighet syns i skalet först efter omladdning.
 *
 * ⚠️ En UI-spärr, aldrig en säkerhetsgräns. Grinden sitter i rutten och i RLS.
 */
export function useCan(key: PermissionKey): boolean {
  return useContext(Ctx).permissions.has(key);
}
