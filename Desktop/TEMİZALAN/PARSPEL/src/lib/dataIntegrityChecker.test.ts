/**
 * Data Integrity Checker — detectAnomalies Birim ve Property Testleri
 *
 * Feature: rule-engine-audit
 * Test framework: Vitest + fast-check
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectAnomalies } from './dataIntegrityChecker';
import { runFullAudit } from './auditEngine';
import { TRANSACTION_LIMIT } from './ruleEngine';
import type { DB, KasaEntry, Sale, Cari } from '@/types';

// ─── Test Yardımcıları ────────────────────────────────────────────────────────

function makeDB(overrides: Partial<DB> = {}): DB {
  const now = new Date().toISOString();
  return {
    _version: 1,
    products: [],
    sales: [],
    suppliers: [],
    orders: [],
    cari: [],
    kasa: [],
    kasalar: [{ id: 'nakit', name: 'Nakit', icon: '💵' }],
    bankTransactions: [],
    matchRules: [],
    monitorRules: [],
    monitorLog: [],
    stockMovements: [],
    peletSuppliers: [],
    peletOrders: [],
    boruSuppliers: [],
    boruOrders: [],
    invoices: [],
    budgets: [],
    returns: [],
    _activityLog: [],
    _auditLog: [],
    company: { id: 'c1', createdAt: now },
    settings: {},
    pelletSettings: { gramaj: 14, kgFiyat: 6.5, cuvalKg: 15, critDays: 3 },
    ortakEmanetler: [],
    installments: [],
    partners: [],
    productCategories: [],
    notes: [],
    ...overrides,
  };
}

function makeKasaEntry(overrides: Partial<KasaEntry> = {}): KasaEntry {
  const now = new Date().toISOString();
  return {
    id: `k_${Math.random().toString(36).slice(2)}`,
    type: 'gelir',
    category: 'satis',
    amount: 500,
    kasa: 'nakit',
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSale(overrides: Partial<Sale> = {}): Sale {
  const now = new Date().toISOString();
  return {
    id: `s_${Math.random().toString(36).slice(2)}`,
    productName: 'Test Ürün',
    quantity: 1,
    unitPrice: 150,
    cost: 100,
    discount: 0,
    discountAmount: 0,
    subtotal: 150,
    total: 150,
    profit: 50,
    payment: 'nakit',
    status: 'tamamlandi',
    items: [],
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCari(overrides: Partial<Cari> = {}): Cari {
  const now = new Date().toISOString();
  return {
    id: `cari_${Math.random().toString(36).slice(2)}`,
    name: 'Test Müşteri',
    type: 'musteri',
    balance: 0,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Son N gün içinde tarih üretir */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ─── detectAnomalies Birim Testleri ──────────────────────────────────────────

describe('detectAnomalies — TRANSACTION_LIMIT aşımı', () => {
  it('amount > 100_000 → warning üretir', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ amount: 150_000 })],
    });
    const issues = detectAnomalies(db);
    expect(issues.some(i => i.severity === 'warning' && i.category === 'anomali')).toBe(true);
  });

  it('amount === 100_000 → ihlal üretmez (eşit, aşım değil)', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ amount: 100_000 })],
    });
    const issues = detectAnomalies(db);
    const limitIssues = issues.filter(i => i.title.includes('İşlem Limiti'));
    expect(limitIssues).toHaveLength(0);
  });

  it('amount < 100_000 → TRANSACTION_LIMIT ihlali üretmez', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ amount: 50_000 })],
    });
    const issues = detectAnomalies(db);
    const limitIssues = issues.filter(i => i.title.includes('İşlem Limiti'));
    expect(limitIssues).toHaveLength(0);
  });

  it('deleted kasa kaydı → ihlal üretmez', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ amount: 200_000, deleted: true })],
    });
    const issues = detectAnomalies(db);
    const limitIssues = issues.filter(i => i.title.includes('İşlem Limiti'));
    expect(limitIssues).toHaveLength(0);
  });
});

describe('detectAnomalies — uzun süreli alacak', () => {
  it('balance > 0 ve lastTransaction > 60 gün önce → info üretir', () => {
    const db = makeDB({
      cari: [makeCari({ balance: 1000, lastTransaction: daysAgo(70), type: 'musteri' })],
    });
    const issues = detectAnomalies(db);
    expect(issues.some(i => i.severity === 'info' && i.category === 'anomali')).toBe(true);
  });

  it('balance > 0 ama lastTransaction < 60 gün → ihlal üretmez', () => {
    const db = makeDB({
      cari: [makeCari({ balance: 1000, lastTransaction: daysAgo(30), type: 'musteri' })],
    });
    const issues = detectAnomalies(db);
    const alacakIssues = issues.filter(i => i.title.includes('Uzun Süreli Alacak'));
    expect(alacakIssues).toHaveLength(0);
  });

  it('balance === 0 → ihlal üretmez', () => {
    const db = makeDB({
      cari: [makeCari({ balance: 0, lastTransaction: daysAgo(90), type: 'musteri' })],
    });
    const issues = detectAnomalies(db);
    const alacakIssues = issues.filter(i => i.title.includes('Uzun Süreli Alacak'));
    expect(alacakIssues).toHaveLength(0);
  });

  it('lastTransaction yok → ihlal üretmez', () => {
    const db = makeDB({
      cari: [makeCari({ balance: 1000, lastTransaction: undefined, type: 'musteri' })],
    });
    const issues = detectAnomalies(db);
    const alacakIssues = issues.filter(i => i.title.includes('Uzun Süreli Alacak'));
    expect(alacakIssues).toHaveLength(0);
  });
});

describe('detectAnomalies — kasa hareketi anomalisi', () => {
  it('tek işlem > 30 günlük ort. × 10 ve min 3 işlem → warning üretir', () => {
    // Son 30 günde 3 normal işlem (100 ₺) + 1 dev işlem (50_000 ₺)
    // Ort: (300 + 50_000) / 30 ≈ 1677 ₺/gün
    // Dev işlem: 50_000 > 1677 × 10 = 16_770 → anomali
    const normalEntries = Array.from({ length: 3 }, (_, i) =>
      makeKasaEntry({ id: `k_norm_${i}`, amount: 100, kasa: 'nakit', createdAt: daysAgo(i + 1) })
    );
    const bigEntry = makeKasaEntry({ id: 'k_big', amount: 50_000, kasa: 'nakit', createdAt: daysAgo(1) });
    const db = makeDB({ kasa: [...normalEntries, bigEntry] });
    const issues = detectAnomalies(db);
    expect(issues.some(i => i.severity === 'warning' && i.title.includes('Kasa Hareketi Anomalisi'))).toBe(true);
  });

  it('son 30 günde < 3 işlem → istatistiksel anomali üretilmez', () => {
    // Sadece 2 işlem
    const entries = [
      makeKasaEntry({ id: 'k1', amount: 100, kasa: 'nakit', createdAt: daysAgo(1) }),
      makeKasaEntry({ id: 'k2', amount: 50_000, kasa: 'nakit', createdAt: daysAgo(2) }),
    ];
    const db = makeDB({ kasa: entries });
    const issues = detectAnomalies(db);
    const kasaAnomalies = issues.filter(i => i.title.includes('Kasa Hareketi Anomalisi'));
    expect(kasaAnomalies).toHaveLength(0);
  });
});

describe('detectAnomalies — günlük satış anomalisi', () => {
  it('aynı günde toplam satış > 30 günlük ort. × 5 ve min 3 işlem → warning üretir', () => {
    const cariId = 'cari_test';
    const today = new Date().toISOString().slice(0, 10);

    // Son 30 günde 3 normal satış (100 ₺/gün)
    const normalSales = Array.from({ length: 3 }, (_, i) =>
      makeSale({
        cariId,
        total: 100,
        createdAt: daysAgo(i + 5), // farklı günler
      })
    );

    // Bugün dev satış (10_000 ₺) — ort 100/30 ≈ 3.3 ₺/gün, 5× = 16.7 ₺ → 10_000 >> eşik
    const bigSale = makeSale({
      cariId,
      total: 10_000,
      createdAt: `${today}T10:00:00.000Z`,
    });

    const db = makeDB({ sales: [...normalSales, bigSale] });
    const issues = detectAnomalies(db);
    expect(issues.some(i => i.severity === 'warning' && i.title.includes('Günlük Satış Anomalisi'))).toBe(true);
  });

  it('son 30 günde < 3 işlem → istatistiksel anomali üretilmez', () => {
    const cariId = 'cari_test';
    const today = new Date().toISOString().slice(0, 10);

    // Sadece 2 satış
    const sales = [
      makeSale({ cariId, total: 100, createdAt: daysAgo(1) }),
      makeSale({ cariId, total: 10_000, createdAt: `${today}T10:00:00.000Z` }),
    ];

    const db = makeDB({ sales });
    const issues = detectAnomalies(db);
    const salesAnomalies = issues.filter(i => i.title.includes('Günlük Satış Anomalisi'));
    expect(salesAnomalies).toHaveLength(0);
  });
});

describe('detectAnomalies — genel davranış', () => {
  it('boş DB → boş dizi döner', () => {
    const db = makeDB();
    const issues = detectAnomalies(db);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('tüm issue\'lar category: anomali içerir', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ amount: 200_000 })],
      cari: [makeCari({ balance: 500, lastTransaction: daysAgo(90), type: 'musteri' })],
    });
    const issues = detectAnomalies(db);
    for (const issue of issues) {
      expect(issue.category).toBe('anomali');
    }
  });

  it('exception fırlatmaz', () => {
    expect(() => detectAnomalies(makeDB())).not.toThrow();
  });
});

// ─── runFullAudit — bakiye tutarsızlığı ──────────────────────────────────────

describe('runFullAudit — bakiye tutarsızlığı tespiti', () => {
  it('hesaplanan bakiye ile Cari.balance farkı > 0.01 → balanceDrifts\'e eklenir', () => {
    const cariId = 'cari_drift';
    // Satış: 1000 ₺ → cari bakiyesi 1000 olmalı
    // Ama kayıtlı balance: 500 → fark 500 > 0.01
    const db = makeDB({
      cari: [makeCari({ id: cariId, balance: 500, type: 'musteri' })],
      sales: [makeSale({ cariId, total: 1000, status: 'tamamlandi', payment: 'cari' })],
    });
    const report = runFullAudit(db);
    expect(report.balanceDrifts.length).toBeGreaterThan(0);
  });

  it('bakiye tutarlıysa balanceDrifts boş döner', () => {
    // Satış yok, balance 0 → tutarlı
    const db = makeDB({
      cari: [makeCari({ balance: 0 })],
    });
    const report = runFullAudit(db);
    expect(report.balanceDrifts).toHaveLength(0);
  });
});

// ─── Property-Based Testler ───────────────────────────────────────────────────

// Arbitrary: minimal DB
const arbDB = () => fc.record({
  _version: fc.integer({ min: 0, max: 10 }),
}).map(partial => makeDB(partial as Partial<DB>));

// Property 10: detectAnomalies her zaman güvenli döner
// Feature: rule-engine-audit, Property 10: detectAnomalies never throws and always returns IntegrityIssue[]
describe('Property 10: detectAnomalies never throws and always returns IntegrityIssue[]', () => {
  it('rastgele DB yapıları için exception fırlatmaz ve her issue category: anomali içerir', () => {
    fc.assert(
      fc.property(arbDB(), (db) => {
        let issues: ReturnType<typeof detectAnomalies> = [];
        expect(() => { issues = detectAnomalies(db); }).not.toThrow();
        expect(Array.isArray(issues)).toBe(true);
        for (const issue of issues) {
          expect(issue.category).toBe('anomali');
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Property 11: Günlük satış anomalisi eşik kontrolü
// Feature: rule-engine-audit, Property 11: Daily sales anomaly threshold check
describe('Property 11: Daily sales anomaly threshold check', () => {
  it('eşik aşımı + min 3 işlem → warning üretilir', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 100, max: 1000, noNaN: true }),  // normal satış tutarı
        fc.float({ min: 50_000, max: 200_000, noNaN: true }), // dev satış tutarı
        (normalAmount, bigAmount) => {
          const cariId = 'cari_prop';
          const today = new Date().toISOString().slice(0, 10);

          const normalSales = Array.from({ length: 3 }, (_, i) =>
            makeSale({ cariId, total: normalAmount, createdAt: daysAgo(i + 5) })
          );
          const bigSale = makeSale({ cariId, total: bigAmount, createdAt: `${today}T10:00:00.000Z` });

          const db = makeDB({ sales: [...normalSales, bigSale] });
          const issues = detectAnomalies(db);

          // Eşik: (normalAmount * 3) / 30 * 5
          const dailyAvg = (normalAmount * 3) / 30;
          const threshold = dailyAvg * 5;

          if (bigAmount > threshold) {
            return issues.some(i => i.severity === 'warning' && i.title.includes('Günlük Satış Anomalisi'));
          }
          return true; // eşik aşılmadıysa test geçer
        }
      ),
      { numRuns: 50 }
    );
  });
});

// Property 12: Yetersiz veri durumunda anomali üretilmez
// Feature: rule-engine-audit, Property 12: No anomaly produced with insufficient data
describe('Property 12: No anomaly produced with insufficient data', () => {
  it('son 30 günde < 3 kasa işlemi → kasa hareketi anomalisi üretilmez', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.float({ min: 1, max: 10_000, noNaN: true }),
          { minLength: 0, maxLength: 2 }
        ),
        (amounts) => {
          const entries = amounts.map((amount, i) =>
            makeKasaEntry({ id: `k_${i}`, amount, kasa: 'nakit', createdAt: daysAgo(i + 1) })
          );
          const db = makeDB({ kasa: entries });
          const issues = detectAnomalies(db);
          const kasaAnomalies = issues.filter(i => i.title.includes('Kasa Hareketi Anomalisi'));
          return kasaAnomalies.length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 13: TRANSACTION_LIMIT aşımı risk flag üretir
// Feature: rule-engine-audit, Property 13: TRANSACTION_LIMIT breach produces risk flag
describe('Property 13: TRANSACTION_LIMIT breach produces risk flag', () => {
  it('KasaEntry.amount > 100_000 → en az bir warning issue üretir', () => {
    fc.assert(
      fc.property(
        fc.float({ min: TRANSACTION_LIMIT + 1, max: 10_000_000, noNaN: true }),
        (amount) => {
          const db = makeDB({
            kasa: [makeKasaEntry({ amount })],
          });
          const issues = detectAnomalies(db);
          return issues.some(i => i.severity === 'warning');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 14: runFullAudit bakiye tutarsızlığını tespit eder
// Feature: rule-engine-audit, Property 14: runFullAudit detects balance drift
describe('Property 14: runFullAudit detects balance drift', () => {
  it('hesaplanan bakiye ile Cari.balance farkı > 0.01 → balanceDrifts en az bir kayıt içerir', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 100, max: 10_000, noNaN: true }),  // satış tutarı
        fc.float({ min: 0, max: 50, noNaN: true }),         // kayıtlı balance (düşük)
        (saleTotal, recordedBalance) => {
          const cariId = 'cari_drift_prop';
          const db = makeDB({
            cari: [makeCari({ id: cariId, balance: recordedBalance, type: 'musteri' })],
            sales: [makeSale({ cariId, total: saleTotal, status: 'tamamlandi', payment: 'cari' })],
          });
          const report = runFullAudit(db);
          // Hesaplanan: saleTotal, kayıtlı: recordedBalance
          // Fark: |saleTotal - recordedBalance| > 0.01 ise drift olmalı
          const drift = Math.abs(saleTotal - recordedBalance);
          if (drift > 0.01) {
            return report.balanceDrifts.length > 0;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
