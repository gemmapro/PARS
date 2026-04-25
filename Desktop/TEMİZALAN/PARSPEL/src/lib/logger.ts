/**
 * Üretim sınıfı yapılandırılmış loglama servisi
 * - Seviyeler: debug | info | warn | error | critical
 * - Kategoriler: auth | firebase | db | ui | sync | health | perf | system
 * - localStorage kalıcılığı (maks 500 kayıt)
 * - Abonelik sistemi (canlı log izleme)
 * - Performans zamanlayıcıları
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type LogCategory = 'auth' | 'firebase' | 'db' | 'ui' | 'sync' | 'health' | 'perf' | 'system';

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  cat: LogCategory;
  msg: string;
  data?: unknown;
  sessionId: string;
  ms?: number;
}

const LOG_KEY = 'sobaLogs_v2';
const MAX_LOGS = 500;
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, critical: 4,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#64748b',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
  critical: '#dc2626',
};

let _minLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info';
let _listeners: Array<(entry: LogEntry) => void> = [];
let _writeBuffer: LogEntry[] = [];
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

/** localStorage'a toplu yaz (debounced, 300ms) */
function flushBuffer() {
  if (!_writeBuffer.length) return;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const existing: LogEntry[] = raw ? JSON.parse(raw) : [];
    const merged = [..._writeBuffer, ...existing].slice(0, MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(merged));
    _writeBuffer = [];
  } catch {
    _writeBuffer = [];
  }
}

function scheduleFlush() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(flushBuffer, 300);
}

function emit(level: LogLevel, cat: LogCategory, msg: string, data?: unknown, ms?: number): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    ts: new Date().toISOString(),
    level, cat, msg, sessionId: SESSION_ID,
    ...(data !== undefined ? { data } : {}),
    ...(ms !== undefined ? { ms } : {}),
  };

  if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[_minLevel]) {
    const prefix = `%c[${level.toUpperCase()}] %c[${cat}] %c${msg}`;
    const styles = [
      `color:${LEVEL_COLORS[level]}; font-weight:bold`,
      'color:#8b5cf6; font-weight:600',
      'color:#cbd5e1',
    ];
    if (level === 'debug') console.debug(prefix, ...styles, data ?? '');
    else if (level === 'info') console.info(prefix, ...styles, data ?? '');
    else if (level === 'warn') console.warn(prefix, ...styles, data ?? '');
    else console.error(prefix, ...styles, data ?? '');
  }

  _writeBuffer.push(entry);
  scheduleFlush();

  _listeners.forEach(fn => { try { fn(entry); } catch { /* listener hatası ana akışı etkilemesin */ } });

  return entry;
}

export const logger = {
  debug:    (cat: LogCategory, msg: string, data?: unknown) => emit('debug',    cat, msg, data),
  info:     (cat: LogCategory, msg: string, data?: unknown) => emit('info',     cat, msg, data),
  warn:     (cat: LogCategory, msg: string, data?: unknown) => emit('warn',     cat, msg, data),
  error:    (cat: LogCategory, msg: string, data?: unknown) => emit('error',    cat, msg, data),
  critical: (cat: LogCategory, msg: string, data?: unknown) => emit('critical', cat, msg, data),

  /** Performans zamanlayıcısı: const t = logger.time('perf','etiket'); ... t.end() */
  time(cat: LogCategory, label: string) {
    const start = performance.now();
    return {
      end(data?: unknown) {
        const ms = Math.round(performance.now() - start);
        emit('debug', cat, `⏱ ${label} [${ms}ms]`, data, ms);
        return ms;
      },
    };
  },

  /** Minimum log seviyesini ayarla */
  setLevel(level: LogLevel) { _minLevel = level; },

  /** Yeni log girişlerine abone ol; abonelikten çıkmak için dönen fonksiyonu çağır */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
  },

  /** Kayıtlı logları al — opsiyonel filtre ile */
  getLogs(filter?: { level?: LogLevel; cat?: LogCategory; limit?: number; since?: string }): LogEntry[] {
    flushBuffer();
    try {
      const raw = localStorage.getItem(LOG_KEY);
      let logs: LogEntry[] = raw ? JSON.parse(raw) : [];
      if (filter?.level) {
        const minW = LEVEL_WEIGHT[filter.level];
        logs = logs.filter(l => LEVEL_WEIGHT[l.level] >= minW);
      }
      if (filter?.cat)   logs = logs.filter(l => l.cat === filter.cat);
      if (filter?.since) logs = logs.filter(l => l.ts >= filter.since!);
      if (filter?.limit) logs = logs.slice(0, filter.limit);
      return logs;
    } catch { return []; }
  },

  /** Log sayısını döndür */
  count(filter?: { level?: LogLevel }): number {
    return this.getLogs(filter).length;
  },

  /** Logları temizle */
  clearLogs() {
    _writeBuffer = [];
    try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
  },

  /** Mevcut oturum ID'si */
  getSessionId: () => SESSION_ID,

  /** Tüm logları JSON olarak indir */
  exportLogs() {
    flushBuffer();
    const logs = this.getLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soba-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logger.info('system', 'Loglar dışa aktarıldı', { count: logs.length });
  },
};

// ── Global hata yakalayıcılar ──────────────────────────────────────────────
window.addEventListener('unhandledrejection', (e) => {
  emit('error', 'system', 'Yakalanmamış Promise reddi', {
    reason: e.reason instanceof Error ? e.reason.message : String(e.reason),
    stack: e.reason instanceof Error ? e.reason.stack?.slice(0, 300) : undefined,
  });
});

window.addEventListener('error', (e) => {
  emit('error', 'system', e.message || 'Script hatası', {
    filename: e.filename,
    line: e.lineno,
    col: e.colno,
  });
});

// Başlangıç kaydı
emit('info', 'system', 'Uygulama başlatıldı', {
  sessionId: SESSION_ID,
  url: window.location.href,
  ua: navigator.userAgent.slice(0, 80),
  ts: new Date().toISOString(),
});
