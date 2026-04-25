/**
 * Üretim sınıfı sistem sağlık izleme modülü
 *
 * Metrikler:
 *  1. Firebase bağlantısı (gecikme ölçümü)
 *  2. Yerel depolama doluluk oranı
 *  3. Tarayıcı bellek kullanımı (Heap)
 *  4. Ağ bağlantısı kalitesi
 *  5. Veri bütünlüğü (DB şema kontrolü)
 *  6. Senkronizasyon gecikmesi
 */

import { logger } from './logger';

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export interface HealthMetric {
  id: string;
  name: string;
  status: HealthStatus;
  value: string | number;
  unit?: string;
  detail?: string;
  threshold?: { warn: number; crit: number };
  checkedAt: string;
}

export interface HealthReport {
  ts: string;
  overall: HealthStatus;
  metrics: HealthMetric[];
  score: number;        // 0–100
  duration: number;     // toplam kontrol süresi (ms)
  recommendations: string[];
}

// ── Sabitler ────────────────────────────────────────────────────────────────
const FIREBASE_PROJECT = 'pars-4850c';
const FIREBASE_API_KEY = 'AIzaSyBL2_YIVMPBwojAfK7pzd2Eg5AG1sUyfig';
const FIREBASE_PING_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/config/health?key=${FIREBASE_API_KEY}`;
const TIMEOUT_MS = 6000;

// ── Bireysel metrik kontrolleri ──────────────────────────────────────────────

async function checkFirebase(): Promise<HealthMetric> {
  const start = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(FIREBASE_PING_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const ms = Math.round(performance.now() - start);

    if (res.ok || res.status === 404) {
      const status: HealthStatus = ms < 800 ? 'healthy' : ms < 2500 ? 'degraded' : 'critical';
      return {
        id: 'firebase', name: 'Firebase Bağlantısı',
        status, value: ms, unit: 'ms',
        detail: `Yanıt: ${ms}ms — HTTP ${res.status}`,
        threshold: { warn: 800, crit: 2500 },
        checkedAt,
      };
    }
    return {
      id: 'firebase', name: 'Firebase Bağlantısı',
      status: 'critical', value: res.status,
      detail: `Sunucu hatası: HTTP ${res.status}`,
      checkedAt,
    };
  } catch (e: unknown) {
    const ms = Math.round(performance.now() - start);
    const isTimeout = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return {
      id: 'firebase', name: 'Firebase Bağlantısı',
      status: 'critical', value: ms, unit: 'ms',
      detail: isTimeout ? `Zaman aşımı (${TIMEOUT_MS / 1000}s)` : 'Ağ bağlantı hatası',
      checkedAt,
    };
  }
}

function checkLocalStorage(): HealthMetric {
  const checkedAt = new Date().toISOString();
  try {
    const keys = Object.keys(localStorage);
    let usedBytes = 0;
    const breakdown: Record<string, number> = {};
    for (const key of keys) {
      const val = localStorage.getItem(key) ?? '';
      const bytes = (key.length + val.length) * 2; // UTF-16
      usedBytes += bytes;
      breakdown[key] = Math.round(bytes / 1024);
    }
    const usedKB = Math.round(usedBytes / 1024);
    const limitKB = 5120; // 5 MB
    const pct = Math.round((usedKB / limitKB) * 100);

    // Canary yazma testi
    try {
      localStorage.setItem('__healthcheck__', '1');
      localStorage.removeItem('__healthcheck__');
    } catch {
      return { id: 'localStorage', name: 'Yerel Depolama', status: 'critical', value: pct, unit: '%', detail: 'Yazma başarısız — depolama dolu!', checkedAt };
    }

    return {
      id: 'localStorage', name: 'Yerel Depolama',
      value: pct, unit: '%',
      detail: `${usedKB} KB / ${limitKB} KB · ${keys.length} anahtar`,
      status: pct > 90 ? 'critical' : pct > 70 ? 'degraded' : 'healthy',
      threshold: { warn: 70, crit: 90 },
      checkedAt,
    };
  } catch {
    return { id: 'localStorage', name: 'Yerel Depolama', status: 'critical', value: '?', detail: 'localStorage erişim hatası', checkedAt };
  }
}

function checkMemory(): HealthMetric {
  const checkedAt = new Date().toISOString();
  type PerfWithMemory = Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  };
  const mem = (performance as PerfWithMemory).memory;

  if (mem) {
    const usedMB = Math.round(mem.usedJSHeapSize / (1024 * 1024));
    const limitMB = Math.round(mem.jsHeapSizeLimit / (1024 * 1024));
    const pct = Math.round((usedMB / limitMB) * 100);
    return {
      id: 'memory', name: 'JS Heap Belleği',
      value: pct, unit: '%',
      detail: `${usedMB} MB kullanımda / ${limitMB} MB limit`,
      status: pct > 85 ? 'critical' : pct > 65 ? 'degraded' : 'healthy',
      threshold: { warn: 65, crit: 85 },
      checkedAt,
    };
  }

  type NavWithDeviceMemory = Navigator & { deviceMemory?: number };
  const devMem = (navigator as NavWithDeviceMemory).deviceMemory;
  return {
    id: 'memory', name: 'Cihaz Belleği',
    value: devMem ? `${devMem} GB` : 'Bilinmiyor',
    status: 'healthy',
    detail: 'Heap API bu tarayıcıda desteklenmiyor',
    checkedAt,
  };
}

function checkNetwork(): HealthMetric {
  const checkedAt = new Date().toISOString();
  type NavWithConn = Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  const conn = (navigator as NavWithConn).connection;
  const online = navigator.onLine;

  if (!online) {
    return { id: 'network', name: 'Ağ Bağlantısı', status: 'critical', value: 'Çevrimdışı', detail: 'İnternet bağlantısı yok', checkedAt };
  }

  if (conn) {
    const { effectiveType = '?', rtt, downlink, saveData } = conn;
    const isSlow = effectiveType === 'slow-2g' || effectiveType === '2g' || (rtt !== undefined && rtt > 600);
    const isDegraded = effectiveType === '3g' || (rtt !== undefined && rtt > 200);
    const parts: string[] = [`Tür: ${effectiveType}`];
    if (rtt !== undefined)  parts.push(`RTT: ${rtt}ms`);
    if (downlink !== undefined) parts.push(`↓ ${downlink} Mbps`);
    if (saveData) parts.push('Veri tasarrufu aktif');
    return {
      id: 'network', name: 'Ağ Kalitesi',
      value: effectiveType,
      status: isSlow ? 'critical' : isDegraded ? 'degraded' : 'healthy',
      detail: parts.join(' · '),
      checkedAt,
    };
  }

  return { id: 'network', name: 'Ağ Bağlantısı', status: 'healthy', value: 'Çevrimiçi', detail: 'Bağlı (detay mevcut değil)', checkedAt };
}

function checkDBIntegrity(db: Record<string, unknown>): HealthMetric {
  const checkedAt = new Date().toISOString();
  const issues: string[] = [];

  const requiredArrays = ['products', 'sales', 'kasa', 'cari', 'suppliers', 'orders', 'invoices'];
  for (const key of requiredArrays) {
    if (!Array.isArray(db[key])) issues.push(`"${key}" dizi değil`);
  }

  if (db._version === undefined || db._version === null) issues.push('_version alanı eksik');

  if (!db.kasalar || !Array.isArray(db.kasalar) || (db.kasalar as unknown[]).length === 0) {
    issues.push('kasalar tanımlı değil');
  }

  const products = (db.products as Array<{ deleted?: boolean }>) ?? [];
  if (products.length > 0) {
    const deletedPct = Math.round((products.filter(p => p.deleted).length / products.length) * 100);
    if (deletedPct > 60) issues.push(`Ürünlerin %${deletedPct}'i soft-deleted`);
  }

  const sales = (db.sales as Array<{ total?: unknown }>) ?? [];
  const invalidSales = sales.filter(s => typeof s.total !== 'number').length;
  if (invalidSales > 0) issues.push(`${invalidSales} satışta geçersiz "total"`);

  return {
    id: 'dbIntegrity', name: 'Veri Bütünlüğü',
    value: issues.length === 0 ? 'Temiz' : `${issues.length} sorun`,
    status: issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'degraded' : 'critical',
    detail: issues.length ? issues.slice(0, 3).join('; ') : 'Tüm şema kontrolleri geçti',
    checkedAt,
  };
}

function checkSyncLag(db: Record<string, unknown>): HealthMetric {
  const checkedAt = new Date().toISOString();
  const lastSync = (db as { _lastSyncAt?: string })._lastSyncAt;

  if (!lastSync) {
    return { id: 'syncLag', name: 'Senkronizasyon', status: 'degraded', value: 'Bilinmiyor', detail: 'Henüz bulut senkronizasyonu yapılmamış', checkedAt };
  }

  const lagMs = Date.now() - new Date(lastSync).getTime();
  const lagMin = Math.round(lagMs / 60000);

  return {
    id: 'syncLag', name: 'Son Senkronizasyon',
    value: lagMin < 1 ? '< 1 dk' : `${lagMin} dk`,
    status: lagMs > 30 * 60 * 1000 ? 'critical' : lagMs > 10 * 60 * 1000 ? 'degraded' : 'healthy',
    detail: `Son sync: ${new Date(lastSync).toLocaleTimeString('tr-TR')}`,
    threshold: { warn: 10, crit: 30 },
    checkedAt,
  };
}

// ── Öneriler motoru ───────────────────────────────────────────────────────────
function buildRecommendations(metrics: HealthMetric[]): string[] {
  const recs: string[] = [];
  for (const m of metrics) {
    if (m.status === 'healthy') continue;
    if (m.id === 'firebase' && m.status === 'critical') recs.push('Firebase erişilemiyor — internet bağlantınızı kontrol edin veya Firebase proje ayarlarını gözden geçirin.');
    if (m.id === 'localStorage' && m.status === 'critical') recs.push('Yerel depolama dolmak üzere — JSON yedek alıp eski verilerinizi temizleyin.');
    if (m.id === 'localStorage' && m.status === 'degraded') recs.push('Yerel depolama %70\'in üzerinde — yakın zamanda bir yedek almanız önerilir.');
    if (m.id === 'memory') recs.push('Bellek kullanımı yüksek — diğer tarayıcı sekmelerini kapatmayı deneyin.');
    if (m.id === 'network' && m.status === 'critical') recs.push('İnternet bağlantısı yok — uygulama çevrimdışı modda çalışıyor, veriler yerel olarak korunuyor.');
    if (m.id === 'dbIntegrity') recs.push('Veri bütünlüğünde sorun tespit edildi — Ayarlar > Veriyi Onar seçeneğini deneyin.');
    if (m.id === 'syncLag' && m.status === 'critical') recs.push('Senkronizasyon 30 dakikadan uzun süredir yapılmamış — Firebase bağlantısını kontrol edin.');
  }
  return recs;
}

// ── Ana sağlık kontrolü ──────────────────────────────────────────────────────
export async function runHealthCheck(db?: Record<string, unknown>): Promise<HealthReport> {
  const timer = logger.time('health', 'Sağlık Kontrolü');

  const [firebaseMetric, lsMetric, memMetric, netMetric, dbMetric, syncMetric] = await Promise.all([
    checkFirebase(),
    Promise.resolve(checkLocalStorage()),
    Promise.resolve(checkMemory()),
    Promise.resolve(checkNetwork()),
    Promise.resolve(db ? checkDBIntegrity(db) : {
      id: 'dbIntegrity', name: 'Veri Bütünlüğü',
      value: 'DB mevcut değil', status: 'degraded' as HealthStatus,
      detail: 'DB nesnesi sağlanmadı',
      checkedAt: new Date().toISOString(),
    }),
    Promise.resolve(db ? checkSyncLag(db) : {
      id: 'syncLag', name: 'Senkronizasyon',
      value: '?', status: 'degraded' as HealthStatus,
      detail: 'DB nesnesi sağlanmadı',
      checkedAt: new Date().toISOString(),
    }),
  ]);

  const metrics: HealthMetric[] = [firebaseMetric, lsMetric, memMetric, netMetric, dbMetric, syncMetric];

  // Skor: her healthy = 2p, degraded = 1p, critical = 0p; max = metrics.length * 2
  const WEIGHT: Record<HealthStatus, number> = { healthy: 2, degraded: 1, critical: 0 };
  const score = Math.round((metrics.reduce((s, m) => s + WEIGHT[m.status], 0) / (metrics.length * 2)) * 100);

  const hasCritical = metrics.some(m => m.status === 'critical');
  const hasDegraded = metrics.some(m => m.status === 'degraded');
  const overall: HealthStatus = hasCritical ? 'critical' : hasDegraded ? 'degraded' : 'healthy';

  const recommendations = buildRecommendations(metrics);
  const duration = timer.end({ overall, score }) ?? 0;

  const report: HealthReport = { ts: new Date().toISOString(), overall, metrics, score, duration, recommendations };

  if (overall === 'healthy') {
    logger.info('health', `✅ Sağlık skoru: ${score}/100`, { duration });
  } else {
    logger.warn('health', `⚠️ Sağlık skoru: ${score}/100 — ${overall}`, {
      criticals: metrics.filter(m => m.status === 'critical').map(m => m.id),
      degraded: metrics.filter(m => m.status === 'degraded').map(m => m.id),
    });
  }

  return report;
}

/** Hızlı durum kontrolü (sadece localStorage + ağ, Firebase ping yok) */
export function quickHealthCheck(db?: Record<string, unknown>): Omit<HealthReport, 'duration'> {
  const metrics: HealthMetric[] = [
    checkLocalStorage(),
    checkMemory(),
    checkNetwork(),
    ...(db ? [checkDBIntegrity(db), checkSyncLag(db)] : []),
  ];

  const WEIGHT: Record<HealthStatus, number> = { healthy: 2, degraded: 1, critical: 0 };
  const score = Math.round((metrics.reduce((s, m) => s + WEIGHT[m.status], 0) / (metrics.length * 2)) * 100);
  const hasCritical = metrics.some(m => m.status === 'critical');
  const hasDegraded = metrics.some(m => m.status === 'degraded');
  const overall: HealthStatus = hasCritical ? 'critical' : hasDegraded ? 'degraded' : 'healthy';

  return { ts: new Date().toISOString(), overall, metrics, score, recommendations: buildRecommendations(metrics) };
}
