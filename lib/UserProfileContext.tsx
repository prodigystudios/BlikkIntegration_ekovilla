"use client";
import React, { createContext, useContext } from 'react';
import type { UserProfile } from './getUserProfile';

export interface UserProfileContextValue {
  profile: UserProfile | null;
}

const Ctx = createContext<UserProfileContextValue>({ profile: null });

export function UserProfileProvider({ profile, children }: { profile: UserProfile | null; children: React.ReactNode }) {
  return <Ctx.Provider value={{ profile }}>{children}</Ctx.Provider>;
}

export function useUserProfile() {
  return useContext(Ctx).profile;
}
