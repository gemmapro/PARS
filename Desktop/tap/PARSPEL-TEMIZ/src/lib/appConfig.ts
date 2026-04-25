/**
 * PARSPEL — Uygulama Konfigürasyonu
 * Uygulama adı, versiyon ve ikon sistemi buradan yönetilir.
 */

export const APP_NAME = 'PARSPEL';
export const APP_SUBTITLE = 'Yönetim Sistemi';
export const APP_DEFAULT_VERSION = '2.0.0';
export const APP_STORAGE_KEY = 'parspelConfig';

// ── Versiyon Yönetimi ──────────────────────────────────────────────────────

export interface AppConfig {
  version: string;       // örn: "2.1.0", "2.1.0-beta", "3.0.0-rc1"
  appName: string;       // özelleştirilebilir uygulama adı
  appIcon: string;       // emoji veya URL
  updatedAt: string;
}

export function loadAppConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultConfig();
}

export function saveAppConfig(cfg: AppConfig): void {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }));
}

function defaultConfig(): AppConfig {
  return {
    version: APP_DEFAULT_VERSION,
    appName: APP_NAME,
    appIcon: '🔥',
    updatedAt: new Date().toISOString(),
  };
}

// ── İkon Sistemi ───────────────────────────────────────────────────────────

export type IconSource = 'emoji' | 'url' | 'lucide';

export interface AppIcon {
  type: IconSource;
  value: string;  // emoji karakteri, URL veya lucide icon adı
}

/** Emoji kategorileri — IconPicker'da kullanılır */
export const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: 'İş & Finans',
    icons: ['💰','💵','💳','🏦','📊','📈','📉','🧾','💼','🏢','🤝','📋','📌','📎','🔖'],
  },
  {
    label: 'Ürün & Stok',
    icons: ['📦','🛒','🏪','🏭','⚙️','🔧','🔩','🪛','🔨','🪚','🔥','🪵','🔩','🧱','🪜'],
  },
  {
    label: 'Kişi & İletişim',
    icons: ['👤','👥','🧑‍💼','📞','📱','✉️','📬','🔔','🔕','📢','📣','🗣️','👋','🤝','🫱'],
  },
  {
    label: 'Araç & Ulaşım',
    icons: ['🚛','🚚','🚗','🏎️','🚐','🚌','✈️','🚢','🚂','🛵','🚲','⛽','🛣️','🗺️','📍'],
  },
  {
    label: 'Doğa & Çevre',
    icons: ['🌿','🌱','🌲','🌳','🍃','🌾','🌻','🌊','⛰️','🏔️','🌍','☀️','🌙','⭐','❄️'],
  },
  {
    label: 'Sistem & Teknik',
    icons: ['⚡','🔌','💡','🖥️','💻','📡','🛰️','🔐','🔑','🗝️','🛡️','⚠️','✅','❌','🔄'],
  },
];

/** Tüm emoji ikonları düz liste */
export const ALL_EMOJIS = ICON_CATEGORIES.flatMap(c => c.icons);

/** İkon render yardımcısı — emoji, URL veya lucide adını alır, string döndürür */
export function resolveIcon(icon: string | AppIcon | undefined, fallback = '📦'): string {
  if (!icon) return fallback;
  if (typeof icon === 'string') return icon || fallback;
  if (icon.type === 'emoji') return icon.value || fallback;
  if (icon.type === 'url') return icon.value || fallback; // URL'ler <img> ile render edilmeli
  return fallback;
}

/** Versiyon formatı doğrulama: "2.1.0", "2.1.0-beta", "3.0.0-rc1" */
export function validateVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(v.trim());
}
