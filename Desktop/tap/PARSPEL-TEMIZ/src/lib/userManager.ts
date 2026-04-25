/**
 * Kullanıcı Yönetimi — Firebase tabanlı
 * config/users dökümanında saklanır
 */

const FIREBASE_PROJECT = 'pars-001-bae2d';
const FIREBASE_API_KEY = 'AIzaSyDxr7PNnh_-kt04sX2VcwER8coM2UWPg5k';
const USERS_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/config/users?key=${FIREBASE_API_KEY}`;

const SALT = 'solhan_soba_2026';

export type UserRole = 'admin' | 'user';

export interface AppUser {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLogin?: string;
}

// ── Hash ──────────────────────────────────────────────────────────────────
export async function hashPassword(pass: string): Promise<string> {
  const enc = new TextEncoder().encode(pass + SALT);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Firebase CRUD ─────────────────────────────────────────────────────────
export async function loadUsers(): Promise<AppUser[]> {
  try {
    const res = await fetch(USERS_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) return [];
    return JSON.parse(raw) as AppUser[];
  } catch { return []; }
}

export async function saveUsers(users: AppUser[]): Promise<boolean> {
  const body = JSON.stringify({
    fields: {
      data: { stringValue: JSON.stringify(users) },
      updatedAt: { stringValue: new Date().toISOString() },
    }
  });

  try {
    // Önce PATCH dene (döküman varsa günceller)
    const patchRes = await fetch(USERS_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    });

    if (patchRes.ok) return true;

    // 404 ise döküman yok — koleksiyon URL'i ile POST ile oluştur
    if (patchRes.status === 404) {
      const collectionUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/config?documentId=users&key=${FIREBASE_API_KEY}`;
      const postRes = await fetch(collectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (postRes.ok) return true;
      const errJson = await postRes.json().catch(() => ({}));
      console.error('Firebase POST hatası:', postRes.status, errJson);
      return false;
    }

    const errJson = await patchRes.json().catch(() => ({}));
    console.error('Firebase PATCH hatası:', patchRes.status, errJson);
    return false;
  } catch (e) {
    console.error('Firebase bağlantı hatası:', e);
    return false;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────
export async function loginUser(username: string, password: string): Promise<AppUser | null> {
  const users = await loadUsers();
  if (users.length === 0) {
    // İlk kurulum: admin oluştur
    return null;
  }
  const hash = await hashPassword(password);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.passwordHash === hash && u.active);
  if (!user) return null;
  // lastLogin güncelle
  const updated = users.map(u => u.id === user.id ? { ...u, lastLogin: new Date().toISOString() } : u);
  saveUsers(updated).catch(() => {});
  return user;
}

// ── Oturum ────────────────────────────────────────────────────────────────
const SESSION_KEY = 'sobaUser_session';
const REMEMBER_KEY = 'sobaUser_remember';

export function setUserSession(user: AppUser, remember: boolean) {
  const data = JSON.stringify({ userId: user.id, username: user.username, role: user.role, ts: Date.now() });
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, data);
  } else {
    sessionStorage.setItem(SESSION_KEY, data);
  }
}

export function getUserSession(): { userId: string; username: string; role: UserRole } | null {
  try {
    const remRaw = localStorage.getItem(REMEMBER_KEY);
    if (remRaw) {
      const d = JSON.parse(remRaw);
      if (Date.now() - d.ts < 30 * 24 * 60 * 60 * 1000) return d;
      localStorage.removeItem(REMEMBER_KEY);
    }
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.ts < 8 * 60 * 60 * 1000) return d;
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  } catch { return null; }
}

export function clearUserSession() {
  localStorage.removeItem(REMEMBER_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Kullanıcı işlemleri ───────────────────────────────────────────────────
export function genUserId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function createUser(username: string, password: string, role: UserRole): Promise<{ ok: boolean; msg: string }> {
  const users = await loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, msg: 'Bu kullanıcı adı zaten kullanılıyor' };
  }
  const hash = await hashPassword(password);
  const newUser: AppUser = {
    id: genUserId(),
    username: username.trim(),
    passwordHash: hash,
    role,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const ok = await saveUsers([...users, newUser]);
  return ok
    ? { ok: true, msg: 'Kullanıcı oluşturuldu' }
    : { ok: false, msg: 'Firebase kayıt hatası — internet bağlantısını kontrol edin veya konsol loglarına bakın' };
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<boolean> {
  const users = await loadUsers();
  const hash = await hashPassword(newPassword);
  const updated = users.map(u => u.id === userId ? { ...u, passwordHash: hash } : u);
  return saveUsers(updated);
}

export async function toggleUserActive(userId: string): Promise<boolean> {
  const users = await loadUsers();
  const updated = users.map(u => u.id === userId ? { ...u, active: !u.active } : u);
  return saveUsers(updated);
}

export async function deleteUser(userId: string): Promise<boolean> {
  const users = await loadUsers();
  return saveUsers(users.filter(u => u.id !== userId));
}

export async function updateUserRole(userId: string, role: UserRole): Promise<boolean> {
  const users = await loadUsers();
  const updated = users.map(u => u.id === userId ? { ...u, role } : u);
  return saveUsers(updated);
}
