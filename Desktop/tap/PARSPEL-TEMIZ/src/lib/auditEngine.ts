/**
 * PARSPEL — Audit Engine
 * Her finansal işlemin kim tarafından, ne zaman, hangi değerden hangi değere
 * yapıldığını ve sonucunu (applied/blocked/warned) kaydeder.
 *
 * BFCE auditEngine + stateEngine pattern'inden uyarlanmıştır.
 * Cloud Functions gerektirmez — tamamen client-side çalışır.
 */

import type { DB, AuditEntry, AuditReport, AuditAnomaly, RuleViolation, KasaEntry } from '@/types';
import { genId } from '@/lib/utils-tr';
import { logger } from '@/lib/logger';
import { TRANSACTION_LIMIT } from '@/lib/ruleEngine';

/** _auditLog maksimum kayıt sayısı */
const MAX_AUDIT_LOG = 500;

/** Bakiye tutarsızlığı için tolerans */
const BALANCE_DRIFT_TOLERANCE = 0.01;

// ─── Session ID ───────────────────────────────────────────────────────────────

const SESSION_KEY = 'parspel_audit_session_id';

/**
 * Oturum başına bir kez üretilen UUID.
 * sessionStorage'da saklanır — sekme kapanınca sıfırlanır.
 */
export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : genId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage erişim hatası (private mode vb.)
    return genId();
  }
}

// ─── Diff Hesaplama ───────────────────────────────────────────────────────────

/**
 * prevDB ile nextDB arasındaki farkı hesaplar.
 * Yalnızca değişen üst düzey alanları döndürür — tüm DB nesnesini değil.
 * Bu sayede audit log boyutu kontrol altında tutulur.
 */
export function computeDiff(
  prevDB: DB,
  nextDB: DB
): { prevValue: Partial<DB>; nextValue: Partial<DB> } {
  try {
    const prevValue: Partial<DB> = {};
    const nextValue: Partial<DB> = {};

    const keys = Object.keys(nextDB) as (keyof DB)[];
    for (const key of keys) {
      // _auditLog'u diff'e dahil etme — sonsuz döngü önlemi
      if (key === '_auditLog') continue;

      const prev = prevDB[key];
      const next = nextDB[key];

      // Basit referans karşılaştırması — dizi/nesne değişimini yakalar
      if (prev !== next) {
        // Dizi ise sadece uzunluk değişimini kaydet (boyut optimizasyonu)
        if (Array.isArray(prev) && Array.isArray(next)) {
          if (prev.length !== next.length) {
            (prevValue as Record<string, unknown>)[key] = `[${prev.length} kayıt]`;
            (nextValue as Record<string, unknown>)[key] = `[${next.length} kayıt]`;
          }
        } else {
          (prevValue as Record<string, unknown>)[key] = prev;
          (nextValue as Record<string, unknown>)[key] = next;
        }
      }
    }

    return { prevValue, nextValue };
  } catch (e) {
    logger.warn('auditEngine', 'computeDiff hatası — diff boş döndürülüyor', { error: String(e) });
    return { prevValue: {}, nextValue: {} };
  }
}

// ─── AuditEntry Oluşturma ─────────────────────────────────────────────────────

/**
 * Bir işlem için AuditEntry oluşturur.
 * _auditLog'a ekleme yapmaz — sadece entry nesnesi döndürür.
 * Ekleme useDB.ts içinde atomik olarak yapılır.
 */
export function createAuditEntry(params: {
  action: string;
  entity: string;
  entityId?: string;
  prevDB: DB;
  nextDB: DB;
  status: 'applied' | 'blocked' | 'warned';
  violations?: RuleViolation[];
  detail?: string;
  userId?: string;
}): AuditEntry {
  const { prevValue, nextValue } = computeDiff(params.prevDB, params.nextDB);

  return {
    id: genId(),
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    prevValue: Object.keys(prevValue).length > 0 ? prevValue : undefined,
    nextValue: Object.keys(nextValue).length > 0 ? nextValue : undefined,
    userId: params.userId,
    sessionId: getSessionId(),
    status: params.status,
    violations: params.violations && params.violations.length > 0 ? params.violations : undefined,
    detail: params.detail,
    time: new Date().toISOString(),
  };
}

// ─── Log Boyut Kontrolü ───────────────────────────────────────────────────────

/**
 * _auditLog'u MAX_AUDIT_LOG (500) kayıtla sınırlandırır.
 * Yalnızca length kontrolü yapar — JSON.stringify kullanmaz.
 * En yeni kayıtlar korunur (baştan alınır).
 */
export function trimAuditLog(log: AuditEntry[]): AuditEntry[] {
  if (log.length <= MAX_AUDIT_LOG) return log;
  return log.slice(0, MAX_AUDIT_LOG);
}

// ─── Full Audit ───────────────────────────────────────────────────────────────

/**
 * Tüm KasaEntry kayıtlarından kasa bakiyelerini sıfırdan yeniden hesaplar
 * (BFCE recomputeStateFromHistory pattern) ve Cari.balance ile karşılaştırır.
 * Onaysız işlemleri ve TRANSACTION_LIMIT aşımlarını tespit eder.
 *
 * @param db - Mevcut DB durumu
 * @returns AuditReport — bakiye tutarsızlıkları, anomaliler, risk flag'leri
 */
export function runFullAudit(db: DB): AuditReport {
  const anomalies: AuditAnomaly[] = [];
  const balanceDrifts: string[] = [];
  const riskFlags: string[] = [];

  // ── 1. Kasa bakiyelerini sıfırdan yeniden hesapla ──────────────────────────
  const recomputedBalances = new Map<string, number>();
  for (const entry of db.kasa) {
    if (entry.deleted) continue;
    const cur = recomputedBalances.get(entry.kasa) ?? 0;
    recomputedBalances.set(entry.kasa, cur + (entry.type === 'gelir' ? entry.amount : -entry.amount));
  }

  // ── 2. Cari bakiyeleriyle karşılaştır ─────────────────────────────────────
  // Müşteri cari bakiyelerini kasa tahsilat kayıtlarından hesapla
  const cariKasaBalances = new Map<string, number>();
  for (const entry of db.kasa) {
    if (entry.deleted || !entry.cariId) continue;
    const cur = cariKasaBalances.get(entry.cariId) ?? 0;
    // Gelir = tahsilat (bakiye azalır), gider = ödeme (bakiye artar)
    cariKasaBalances.set(entry.cariId, cur + (entry.type === 'gelir' ? -entry.amount : entry.amount));
  }

  // Satışlardan cari bakiye katkısını hesapla
  const cariSaleBalances = new Map<string, number>();
  for (const sale of db.sales) {
    if (sale.deleted || sale.status !== 'tamamlandi') continue;
    const cariId = sale.cariId || sale.customerId;
    if (!cariId) continue;
    const cur = cariSaleBalances.get(cariId) ?? 0;
    cariSaleBalances.set(cariId, cur + sale.total);
  }

  // Cari bakiye tutarsızlığı kontrolü
  for (const cari of db.cari) {
    if (cari.deleted) continue;
    const kasaContrib = cariKasaBalances.get(cari.id) ?? 0;
    const saleContrib = cariSaleBalances.get(cari.id) ?? 0;
    const recomputed = saleContrib + kasaContrib;
    const drift = Math.abs(recomputed - cari.balance);

    if (drift > BALANCE_DRIFT_TOLERANCE) {
      balanceDrifts.push(
        `${cari.name} (${cari.id}): hesaplanan ${recomputed.toFixed(2)} ₺, kayıtlı ${cari.balance.toFixed(2)} ₺, fark ${drift.toFixed(2)} ₺`
      );
    }
  }

  // ── 3. Onaysız işlem tespiti ───────────────────────────────────────────────
  // _auditLog'da 'applied' kaydı olmayan KasaEntry'leri tespit et
  const auditedEntryIds = new Set(
    (db._auditLog || [])
      .filter(a => a.status === 'applied')
      .map(a => a.entityId)
      .filter(Boolean)
  );

  // Sadece son 24 saatteki kayıtları kontrol et (performans)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentKasaEntries = db.kasa.filter(k =>
    !k.deleted &&
    new Date(k.createdAt).getTime() > oneDayAgo
  );

  // _auditLog henüz boşsa (yeni kurulum) bu kontrolü atla
  if ((db._auditLog || []).length > 0) {
    for (const entry of recentKasaEntries) {
      if (!auditedEntryIds.has(entry.id)) {
        riskFlags.push(
          `Denetim kaydı olmayan kasa işlemi: ${entry.id} (${entry.type}, ${entry.amount} ₺, ${entry.kasa})`
        );
      }
    }
  }

  // ── 4. TRANSACTION_LIMIT aşımı ─────────────────────────────────────────────
  for (const entry of db.kasa) {
    if (entry.deleted) continue;
    if (entry.amount > TRANSACTION_LIMIT) {
      anomalies.push({
        entryId: entry.id,
        issue: `Yüksek tutarlı işlem: ${entry.amount.toFixed(2)} ₺ (limit: ${TRANSACTION_LIMIT.toLocaleString('tr-TR')} ₺)`,
        severity: 'HIGH',
      });
      riskFlags.push(
        `TRANSACTION_LIMIT aşımı: kasa kaydı ${entry.id}, tutar ${entry.amount} ₺`
      );
    }
  }

  // ── 5. _auditLog istatistikleri ────────────────────────────────────────────
  const auditLog = db._auditLog || [];
  const appliedCount = auditLog.filter(a => a.status === 'applied').length;
  const blockedCount = auditLog.filter(a => a.status === 'blocked').length;
  const warnedCount = auditLog.filter(a => a.status === 'warned').length;

  return {
    anomalies,
    balanceDrifts,
    riskFlags,
    totalEntries: auditLog.length,
    appliedCount,
    blockedCount,
    warnedCount,
  };
}
