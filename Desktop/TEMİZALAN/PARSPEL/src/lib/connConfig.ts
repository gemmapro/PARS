/**
 * Bağlantı Konfigürasyonu
 * Firebase ve Supabase ayarları — önce Firebase'den, fallback localStorage
 */

export interface FirebaseConfig {
  enabled: boolean;
  projectId: string;
  apiKey: string;
  docPath: string;
}

export interface SupabaseConfig {
  enabled: boolean;
  url: string;
  anonKey: string;
  tableName: string;
}

export interface ConnConfig {
  firebase: FirebaseConfig;
  supabase: SupabaseConfig;
  activeProvider: 'firebase' | 'supabase' | 'none';
}

const CONN_KEY = 'sobaConnConfig';

export const DEFAULT_CONN: ConnConfig = {
  firebase: {
    enabled: true,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'pars-001-bae2d',
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    docPath: import.meta.env.VITE_FIREBASE_DOC_PATH || 'sync/main',
  },
  supabase: { enabled: false, url: '', anonKey: '', tableName: 'soba_sync' },
  activeProvider: 'firebase',
};

// ── Yardımcı: default config'den Firebase URL oluştur ──────────────────────
function getDefaultFirebaseUrl(path: string): string {
  const { projectId, apiKey } = DEFAULT_CONN.firebase;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}?key=${apiKey}`;
}

// ── localStorage fallback (hızlı senkron okuma) ────────────────────────────
export function loadConnConfig(): ConnConfig {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    if (raw) return { ...DEFAULT_CONN, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONN };
}

export function saveConnConfig(cfg: ConnConfig): void {
  localStorage.setItem(CONN_KEY, JSON.stringify(cfg));
  // Arka planda Firebase'e de yaz
  saveConnConfigToFirebase(cfg).catch(() => {});
}

// ── Firebase sync ──────────────────────────────────────────────────────────
const CONN_FB_URL = getDefaultFirebaseUrl('config/connConfig');

export async function loadConnConfigFromFirebase(): Promise<ConnConfig | null> {
  try {
    const res = await fetch(CONN_FB_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) return null;
    return { ...DEFAULT_CONN, ...JSON.parse(raw) };
  } catch { return null; }
}

export async function saveConnConfigToFirebase(cfg: ConnConfig): Promise<boolean> {
  try {
    const res = await fetch(CONN_FB_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          data: { stringValue: JSON.stringify(cfg) },
          updatedAt: { stringValue: new Date().toISOString() },
        }
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

/** Firebase Firestore REST URL'ini oluştur */
export function getFirebaseDocUrl(cfg: FirebaseConfig): string {
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${cfg.docPath}?key=${cfg.apiKey}`;
}

/** Firebase bağlantısını test et */
export async function testFirebase(cfg: FirebaseConfig): Promise<{ ok: boolean; msg: string }> {
  if (!cfg.projectId || !cfg.apiKey) return { ok: false, msg: 'Project ID ve API Key gerekli' };
  try {
    const url = getFirebaseDocUrl(cfg);
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (res.ok || res.status === 404) return { ok: true, msg: `Bağlantı başarılı (HTTP ${res.status})` };
    return { ok: false, msg: `HTTP ${res.status} — API Key veya Project ID hatalı olabilir` };
  } catch (e) {
    return { ok: false, msg: `Bağlantı hatası: ${String(e).slice(0, 80)}` };
  }
}

/** Supabase bağlantısını test et */
export async function testSupabase(cfg: SupabaseConfig): Promise<{ ok: boolean; msg: string }> {
  if (!cfg.url || !cfg.anonKey) return { ok: false, msg: 'URL ve Anon Key gerekli' };
  try {
    const url = `${cfg.url.replace(/\/$/, '')}/rest/v1/${cfg.tableName}?select=id&limit=1`;
    const res = await fetch(url, {
      headers: { 'apikey': cfg.anonKey, 'Authorization': `Bearer ${cfg.anonKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, msg: 'Bağlantı başarılı' };
    if (res.status === 404) return { ok: false, msg: `"${cfg.tableName}" tablosu bulunamadı` };
    if (res.status === 401) return { ok: false, msg: 'Anon Key hatalı' };
    return { ok: false, msg: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, msg: `Bağlantı hatası: ${String(e).slice(0, 80)}` };
  }
}
