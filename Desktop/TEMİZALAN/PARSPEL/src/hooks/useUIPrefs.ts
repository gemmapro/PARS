/**
 * UI Tercihleri Hook
 * Tema rengi, arka plan, font boyutu, animasyon hızı, kompakt mod
 * CSS değişkenleri üzerinden çalışır — tüm uygulama anında güncellenir
 */

export interface UIPrefs {
  accent: string;
  bgBase: string;
  fontScale: number;
  animSpeed: 'hizli' | 'normal' | 'yavas' | 'yok';
  compactMode: boolean;
  sidebarStyle: 'default' | 'minimal' | 'colored';
  cardRadius: number;
  lightMode: boolean;
  // Floating buton ayarları
  showAIButton: boolean;
  showFABButton: boolean;
  showReportButton: boolean;
  aiBtnPos: { x: number; y: number };
  fabBtnPos: { x: number; y: number };
  reportBtnPos: { x: number; y: number };
}

export const DEFAULT_PREFS: UIPrefs = {
  accent: '#ff5722',
  bgBase: '#070e1c',
  fontScale: 1,
  animSpeed: 'normal',
  compactMode: false,
  sidebarStyle: 'default',
  cardRadius: 12,
  lightMode: false,
  showAIButton: true,
  showFABButton: true,
  showReportButton: true,
  aiBtnPos: { x: 28, y: 28 },
  fabBtnPos: { x: 28, y: 28 },
  reportBtnPos: { x: 90, y: 28 },
};

const STORAGE_KEY = 'sobaUI';

// ── Firebase sync ──────────────────────────────────────────────────────────
function getUiPrefsUrl(): string {
  const { projectId, apiKey } = { projectId: 'pars-001-bae2d', apiKey: 'AIzaSyDxr7PNnh_-kt04sX2VcwER8coM2UWPg5k' };
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/uiPrefs?key=${apiKey}`;
}

export async function loadUIPrefsFromFirebase(): Promise<UIPrefs | null> {
  try {
    const res = await fetch(getUiPrefsUrl(), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) return null;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return null; }
}

async function saveUIPrefsToFirebase(prefs: UIPrefs): Promise<void> {
  try {
    await fetch(getUiPrefsUrl(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          data: { stringValue: JSON.stringify(prefs) },
          updatedAt: { stringValue: new Date().toISOString() },
        }
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* sessizce geç */ }
}

export function loadUIPrefs(): UIPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_PREFS };
}

export function saveUIPrefs(prefs: UIPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  // Aynı sekmedeki dinleyicileri tetikle
  window.dispatchEvent(new CustomEvent('sobaUI:updated'));
  // Arka planda Firebase'e de yaz
  saveUIPrefsToFirebase(prefs).catch(() => {});
}

/** CSS değişkenlerini DOM'a uygula */
export function applyUIPrefs(prefs: UIPrefs): void {
  const root = document.documentElement;
  const isLight = prefs.lightMode;

  if (isLight) {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark-mode');
  } else {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  }

  // Accent rengi ve türevleri
  root.style.setProperty('--accent', prefs.accent);
  root.style.setProperty('--accent-light', lighten(prefs.accent, 20));
  root.style.setProperty('--accent-glow', hexToRgba(prefs.accent, 0.35));
  root.style.setProperty('--accent-soft', hexToRgba(prefs.accent, 0.12));

  if (isLight) {
    // Açık tema — yüksek kontrast, güneş altında okunabilir
    const bg = prefs.bgBase;
    const isDarkAccent = isColorDark(prefs.accent);

    root.style.setProperty('--bg-base', bg);
    root.style.setProperty('--bg-card', 'rgba(255,255,255,0.92)');
    root.style.setProperty('--bg-sidebar', adjustBrightness(bg, -12));
    root.style.setProperty('--bg-elevated', '#ffffff');
    root.style.setProperty('--border', 'rgba(0,0,0,0.12)');
    root.style.setProperty('--border-strong', 'rgba(0,0,0,0.22)');
    // Metin renkleri — çok koyu, güneş altında net
    root.style.setProperty('--text-primary', '#0a0a0a');
    root.style.setProperty('--text-secondary', '#1e293b');
    root.style.setProperty('--text-muted', '#475569');
    // Buton metin rengi — accent koyu ise beyaz, açık ise siyah
    root.style.setProperty('--accent-text', isDarkAccent ? '#ffffff' : '#0a0a0a');
    // Sidebar için biraz daha koyu zemin
    root.style.setProperty('--sidebar-text', '#0f172a');
  } else {
    root.style.setProperty('--bg-base', prefs.bgBase);
    root.style.setProperty('--bg-card', adjustBrightness(prefs.bgBase, 20));
    root.style.setProperty('--bg-sidebar', adjustBrightness(prefs.bgBase, -5));
    root.style.setProperty('--bg-elevated', adjustBrightness(prefs.bgBase, 30));
    root.style.setProperty('--border', 'rgba(255,255,255,0.07)');
    root.style.setProperty('--border-strong', 'rgba(255,255,255,0.12)');
    root.style.setProperty('--text-primary', '#f0f6ff');
    root.style.setProperty('--text-secondary', '#94a3b8');
    root.style.setProperty('--text-muted', '#475569');
    root.style.setProperty('--accent-text', '#ffffff');
    root.style.setProperty('--sidebar-text', '#f0f6ff');
  }

  root.style.setProperty('--font-size-base', `${prefs.fontScale * 16}px`);
  document.documentElement.style.fontSize = `${prefs.fontScale * 16}px`;

  const speedMap = { hizli: '0.1s', normal: '0.2s', yavas: '0.4s', yok: '0s' };
  root.style.setProperty('--transition-speed', speedMap[prefs.animSpeed]);
  root.style.setProperty('--radius', `${prefs.cardRadius}px`);

  if (prefs.compactMode) {
    document.body.classList.add('compact-mode');
  } else {
    document.body.classList.remove('compact-mode');
  }
}

/** Renk koyu mu? (buton metin rengi için) */
function isColorDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r)) return true;
  // Luminance hesabı
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

// ── Renk yardımcıları ──────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255,87,34,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function adjustBrightness(hex: string, amount: number): string {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amount));
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Hazır tema paketleri
export const THEMES = [
  // ── Koyu Temalar ──────────────────────────────────────────────────────────
  { id: 'kor',       label: '🔥 Kor',        accent: '#ff5722', bg: '#070e1c', desc: 'Varsayılan — turuncu ateş',   light: false },
  { id: 'okyanus',   label: '🌊 Okyanus',    accent: '#0ea5e9', bg: '#050f1a', desc: 'Derin mavi',                  light: false },
  { id: 'orman',     label: '🌿 Orman',      accent: '#10b981', bg: '#061410', desc: 'Koyu yeşil',                  light: false },
  { id: 'mor',       label: '💜 Mor',        accent: '#8b5cf6', bg: '#0a0714', desc: 'Derin mor',                   light: false },
  { id: 'altin',     label: '✨ Altın',      accent: '#f59e0b', bg: '#0f0c04', desc: 'Amber altın',                 light: false },
  { id: 'pembe',     label: '🌸 Pembe',      accent: '#ec4899', bg: '#0f0510', desc: 'Neon pembe',                  light: false },
  { id: 'gri',       label: '🩶 Gri',        accent: '#94a3b8', bg: '#0a0f18', desc: 'Minimal gri',                 light: false },
  { id: 'kirmizi',   label: '❤️ Kırmızı',   accent: '#ef4444', bg: '#0f0505', desc: 'Canlı kırmızı',               light: false },

  // ── Açık Temalar (Güneş Altında Okunabilir) ───────────────────────────────
  // Beyaz zemin + çok koyu metin → kontrast 7:1+ (WCAG AAA)
  { id: 'kartal',    label: '🦅 Kartal',     accent: '#1d4ed8', bg: '#ffffff', desc: 'Beyaz + koyu mavi — max kontrast',  light: true },
  { id: 'siyah_ak',  label: '⬛ Siyah/Ak',   accent: '#111827', bg: '#f9fafb', desc: 'Siyah metin — güneş altında ideal', light: true },
  { id: 'amber',     label: '🟡 Amber',      accent: '#92400e', bg: '#fffbeb', desc: 'Sarı zemin — en yüksek görünürlük', light: true },
  { id: 'deniz',     label: '🌊 Deniz',      accent: '#0c4a6e', bg: '#f0f9ff', desc: 'Açık mavi — ferah ve net',          light: true },
  { id: 'cimen_ac',  label: '🌿 Çimen',      accent: '#14532d', bg: '#f0fdf4', desc: 'Açık yeşil — doğal ve net',         light: true },
  { id: 'gunes_ac',  label: '☀️ Güneş',     accent: '#7c2d12', bg: '#fff7ed', desc: 'Turuncu zemin — sıcak ve okunur',   light: true },
  { id: 'beton',     label: '🏗️ Beton',     accent: '#1e293b', bg: '#f8fafc', desc: 'Gri zemin — nötr ve net',           light: true },
  { id: 'kontrast',  label: '⚡ Kontrast',   accent: '#000000', bg: '#ffffff', desc: 'Saf siyah/beyaz — max okunabilirlik', light: true },
] as const;
