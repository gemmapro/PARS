/**
 * PARSPEL — Rule Engine
 * save() çağrısından önce finansal kuralları senkron olarak değerlendirir.
 * İhlal durumunda işlemi engeller (severity: 'block') veya uyarır (severity: 'warn').
 *
 * BFCE ruleRunner pattern'inden uyarlanmıştır.
 * Cloud Functions gerektirmez — tamamen client-side çalışır.
 */

import type { DB, RuleViolation, KasaEntry, Sale } from '@/types';
import { logger } from '@/lib/logger';

/** Maksimum tek işlem tutarı (BFCE TRANSACTION_LIMIT uyarlaması — TRY için ölçeklendirildi) */
export const TRANSACTION_LIMIT = 100_000;

/** Mükerrer işlem kontrolü için zaman penceresi (ms) */
const DUPLICATE_WINDOW_MS = 60_000;

/** validateTransaction için maksimum çalışma süresi (ms) */
const RULE_TIMEOUT_MS = 50;

// ─── Kural Arayüzü ────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  name: string;
  severity: 'block' | 'warn';
  evaluate: (prevDB: DB, nextDB: DB) => RuleViolation[];
}

// ─── Yardımcı: Kasa Bakiyesi Hesapla ─────────────────────────────────────────

function computeKasaBalances(entries: KasaEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.deleted) continue;
    const cur = map.get(e.kasa) ?? 0;
    map.set(e.kasa, cur + (e.type === 'gelir' ? e.amount : -e.amount));
  }
  return map;
}

// ─── Kurallar ─────────────────────────────────────────────────────────────────

/**
 * Kural 1: Negatif Stok
 * Herhangi bir ürünün stock değeri 0'ın altına düşecekse engelle.
 */
const negativeStockRule: Rule = {
  id: 'negative_stock',
  name: 'Negatif Stok',
  severity: 'block',
  evaluate: (_prevDB: DB, nextDB: DB): RuleViolation[] => {
    const violations: RuleViolation[] = [];
    for (const p of nextDB.products) {
      if (!p.deleted && p.stock < 0) {
        violations.push({
          ruleId: 'negative_stock',
          ruleName: 'Negatif Stok',
          message: `"${p.name}" stoğu negatife düştü (${p.stock}). İşlem engellendi.`,
          severity: 'block',
          relatedIds: [p.id],
        });
      }
    }
    return violations;
  },
};

/**
 * Kural 2: Negatif Kasa Bakiyesi
 * Herhangi bir kasanın hesaplanan bakiyesi 0'ın altına düşecekse engelle.
 */
const negativeKasaRule: Rule = {
  id: 'negative_kasa',
  name: 'Negatif Kasa Bakiyesi',
  severity: 'block',
  evaluate: (_prevDB: DB, nextDB: DB): RuleViolation[] => {
    const violations: RuleViolation[] = [];
    const balances = computeKasaBalances(nextDB.kasa);
    for (const [kasaId, balance] of balances) {
      if (balance < -0.001) {
        violations.push({
          ruleId: 'negative_kasa',
          ruleName: 'Negatif Kasa Bakiyesi',
          message: `"${kasaId}" kasası negatife düştü (${balance.toFixed(2)} ₺). İşlem engellendi.`,
          severity: 'block',
          relatedIds: [kasaId],
        });
      }
    }
    return violations;
  },
};

/**
 * Kural 3: Mükerrer İşlem
 * Aynı cariId + amount + kasa kombinasyonu son 60 saniyede mevcutsa uyar.
 * (severity: 'warn' — işlemi engellemez, sadece uyarır)
 */
const duplicateTransactionRule: Rule = {
  id: 'duplicate_transaction',
  name: 'Mükerrer İşlem',
  severity: 'warn',
  evaluate: (prevDB: DB, nextDB: DB): RuleViolation[] => {
    const violations: RuleViolation[] = [];
    const now = Date.now();
    const windowStart = now - DUPLICATE_WINDOW_MS;

    // nextDB'de prevDB'de olmayan yeni kasa kayıtlarını bul
    const prevIds = new Set(prevDB.kasa.map(k => k.id));
    const newEntries = nextDB.kasa.filter(k => !prevIds.has(k.id) && !k.deleted);

    for (const newEntry of newEntries) {
      if (!newEntry.cariId || !newEntry.amount) continue;

      // Son 60 saniyede aynı cariId + amount + kasa kombinasyonu var mı?
      const duplicate = prevDB.kasa.find(k =>
        !k.deleted &&
        k.cariId === newEntry.cariId &&
        k.amount === newEntry.amount &&
        k.kasa === newEntry.kasa &&
        new Date(k.createdAt).getTime() > windowStart
      );

      if (duplicate) {
        violations.push({
          ruleId: 'duplicate_transaction',
          ruleName: 'Mükerrer İşlem',
          message: `Son 60 saniyede aynı cari (${newEntry.cariId}), tutar (${newEntry.amount} ₺) ve kasa (${newEntry.kasa}) kombinasyonu zaten kaydedildi. Mükerrer işlem olabilir.`,
          severity: 'warn',
          relatedIds: [duplicate.id, newEntry.id],
        });
      }
    }
    return violations;
  },
};

/**
 * Kural 4: Sıfır veya Negatif Tutar
 * KasaEntry.amount <= 0 veya Sale.total <= 0 olan işlemleri engelle.
 * (BFCE limitRule uyarlaması)
 */
const zeroAmountRule: Rule = {
  id: 'zero_amount',
  name: 'Sıfır veya Negatif Tutar',
  severity: 'block',
  evaluate: (prevDB: DB, nextDB: DB): RuleViolation[] => {
    const violations: RuleViolation[] = [];
    const prevKasaIds = new Set(prevDB.kasa.map(k => k.id));
    const prevSaleIds = new Set(prevDB.sales.map(s => s.id));

    // Yeni kasa kayıtlarında sıfır/negatif tutar kontrolü
    for (const k of nextDB.kasa) {
      if (!prevKasaIds.has(k.id) && !k.deleted && k.amount <= 0) {
        violations.push({
          ruleId: 'zero_amount',
          ruleName: 'Sıfır veya Negatif Tutar',
          message: `Kasa kaydı geçersiz tutar içeriyor (${k.amount} ₺). Tutar 0'dan büyük olmalıdır.`,
          severity: 'block',
          relatedIds: [k.id],
        });
      }
    }

    // Yeni satışlarda sıfır/negatif toplam kontrolü
    for (const s of nextDB.sales) {
      if (!prevSaleIds.has(s.id) && !s.deleted && s.total <= 0) {
        violations.push({
          ruleId: 'zero_amount',
          ruleName: 'Sıfır veya Negatif Tutar',
          message: `Satış kaydı geçersiz toplam içeriyor (${s.total} ₺). Toplam 0'dan büyük olmalıdır.`,
          severity: 'block',
          relatedIds: [s.id],
        });
      }
    }

    return violations;
  },
};

// ─── Kural Listesi (genişletilebilir) ────────────────────────────────────────

/**
 * Aktif kural listesi.
 * Yeni kural eklemek için bu diziye Rule nesnesi ekle — başka dosya değişikliği gerekmez.
 */
export const rules: Rule[] = [
  negativeStockRule,
  negativeKasaRule,
  duplicateTransactionRule,
  zeroAmountRule,
];

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

/**
 * Tüm kuralları çalıştırır ve ihlalleri döndürür.
 *
 * - Senkron çalışır (async/await yok)
 * - 50ms timeout korumalı
 * - Her kural kendi try/catch bloğuna sahip
 * - Tüm fonksiyon try/catch ile sarılı — hata durumunda boş dizi döner
 *
 * @param prevDB - Güncelleme öncesi DB durumu
 * @param nextDB - Güncelleme sonrası DB durumu (updater(prevDB) sonucu)
 * @returns İhlal listesi — boşsa kural ihlali yok
 */
export function validateTransaction(prevDB: DB, nextDB: DB): RuleViolation[] {
  const startTime = performance.now();

  try {
    const allViolations: RuleViolation[] = [];

    for (const rule of rules) {
      // Timeout kontrolü
      if (performance.now() - startTime > RULE_TIMEOUT_MS) {
        logger.warn('ruleEngine', `Kural değerlendirmesi ${RULE_TIMEOUT_MS}ms sınırını aştı — kalan kurallar atlandı`, {
          completedRules: allViolations.length,
          remainingRules: rules.length,
        });
        break;
      }

      try {
        const violations = rule.evaluate(prevDB, nextDB);
        allViolations.push(...violations);
      } catch (ruleError) {
        // Tek bir kuralın hatası diğer kuralları etkilemez
        logger.warn('ruleEngine', `Kural "${rule.id}" değerlendirme hatası — atlandı`, {
          error: String(ruleError),
        });
      }
    }

    return allViolations;
  } catch (e) {
    // Tüm fonksiyon hatası — fail-open: boş dizi döndür, uygulama çökmez
    logger.warn('ruleEngine', 'validateTransaction beklenmedik hata — kural değerlendirmesi atlandı', {
      error: String(e),
    });
    return [];
  }
}
