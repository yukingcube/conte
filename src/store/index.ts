import type { DataStore, UserInfo } from './types';
import { localStore } from './local';
import { HAS_SUPABASE, supabase, supabaseStore } from './supabase';

export { HAS_SUPABASE };
export type { DataStore, UserInfo };

export function getStore(): DataStore {
  return HAS_SUPABASE ? supabaseStore : localStore;
}

const LOCAL_USER: UserInfo = { id: 'local', name: 'お試し', email: '', avatarUrl: null };

interface SbUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

function toUser(u: SbUser): UserInfo {
  const md = u.user_metadata ?? {};
  const name =
    (typeof md.full_name === 'string' && md.full_name) ||
    (typeof md.name === 'string' && md.name) ||
    u.email ||
    'ユーザー';
  const avatar = typeof md.avatar_url === 'string' ? md.avatar_url : null;
  return { id: u.id, name, email: u.email ?? '', avatarUrl: avatar };
}

export async function currentUser(): Promise<UserInfo | null> {
  if (!HAS_SUPABASE) return LOCAL_USER;
  const { data } = await supabase().auth.getSession();
  return data.session ? toUser(data.session.user) : null;
}

export function onAuthChange(cb: (user: UserInfo | null) => void): () => void {
  if (!HAS_SUPABASE) return () => {};
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    cb(session ? toUser(session.user) : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  // ログイン後に戻ってくる場所。今開いているページ（# より前）にする
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw new Error(`ログインを始められなかった（${error.message}）`);
}

export async function signOut(): Promise<void> {
  if (!HAS_SUPABASE) return;
  await supabase().auth.signOut();
}
