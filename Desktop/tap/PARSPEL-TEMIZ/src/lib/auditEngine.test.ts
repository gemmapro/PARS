/**
 * Audit Engine — Birim ve Property Testleri
 *
 * Feature: rule-engine-audit
 * Test framework: Vitest + fast-check
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  computeDiff,
  createAuditEntry,
  trimAuditLog,
  runFullAudit,
  getSessionId,
} from './auditEngine';
import type { DB, AuditEntry, KasaEntry, Cari, RuleViolation } from '@/types';

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
    id: 'k1',
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

function makeCari(overrides: Partial<Cari> = {}): Cari {
  const now = new Date().toISOString();
  return {
    id: 'cari1',
    name: 'Test Müşteri',
    type: 'musteri',
    balance: 0,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `ae_${Math.random().toString(36).slice(2)}`,
    action: 'save',
    entity: 'DB',
    sessionId: 'test-session',
    status: 'applied',
    time: new Date().toISOString(),
    ...overrides,
  };
}

// ─── computeDiff Testleri ─────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('değişen alanlar diff\'te yer alır', () => {
    const prev = makeDB({ products: [] });
    const next = makeDB({ products: [{ id: 'p1', name: 'Ürün', category: 'soba', cost: 100, price: 150, stock: 10, minStock: 2, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
    const { prevValue, nextValue } = computeDiff(prev, next);
    expect(prevValue).toHaveProperty('products');
    expect(nextValue).toHaveProperty('products');
  });

  it('değişmeyen alanlar diff\'te yer almaz', () => {
    const db = makeDB({ _version: 5 });
    const { prevValue, nextValue } = computeDiff(db, db);
    expect(Object.keys(prevValue)).toHaveLength(0);
    expect(Object.keys(nextValue)).toHaveLength(0);
  });

  it('_auditLog diff\'e dahil edilmez (sonsuz döngü önlemi)', () => {
    const prev = makeDB({ _auditLog: [] });
    const next = makeDB({ _auditLog: [makeAuditEntry()] });
    const { prevValue, nextValue } = computeDiff(prev, next);
    expect(prevValue).not.toHaveProperty('_auditLog');
    expect(nextValue).not.toHaveProperty('_auditLog');
  });

  it('hata durumunda boş diff döner', () => {
    // null geçilse bile exception fırlatmamalı
    expect(() => computeDiff(null as unknown as DB, makeDB())).not.toThrow();
  });
});

// ─── createAuditEntry Testleri ────────────────────────────────────────────────

describe('createAuditEntry', () => {
  it('applied durumu için doğru status üretir', () => {
    const db = makeDB();
    const entry = createAuditEntry({ action: 'save', entity: 'DB', prevDB: db, nextDB: db, status: 'applied' });
    expect(entry.status).toBe('applied');
    expect(entry.violations).toBeUndefined();
  });

  it('blocked durumu için violations içerir', () => {
    const db = makeDB();
    const violations: RuleViolation[] = [{ ruleId: 'negative_stock', ruleName: 'Negatif Stok', message: 'Stok negatif', severity: 'block' }];
    const entry = createAuditEntry({ action: 'save', entity: 'DB', prevDB: db, nextDB: db, status: 'blocked', violations });
    expect(entry.status).toBe('blocked');
    expect(entry.violations).toHaveLength(1);
    expect(entry.violations![0].ruleId).toBe('negative_stock');
  });

  it('warned durumu için doğru status üretir', () => {
    const db = makeDB();
    const violations: RuleViolation[] = [{ ruleId: 'duplicate_transaction', ruleName: 'Mükerrer', message: 'Mükerrer işlem', severity: 'warn' }];
    const entry = createAuditEntry({ action: 'save', entity: 'DB', prevDB: db, nextDB: db, status: 'warned', violations });
    expect(entry.status).toBe('warned');
  });

  it('gerekli alanları içerir (id, time, sessionId)', () => {
    const db = makeDB();
    const entry = createAuditEntry({ action: 'test', entity: 'DB', prevDB: db, nextDB: db, status: 'applied' });
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.time).toBe('string');
    expect(typeof entry.sessionId).toBe('string');
  });

  it('boş violations dizisi → violations undefined olur', () => {
    const db = makeDB();
    const entry = createAuditEntry({ action: 'save', entity: 'DB', prevDB: db, nextDB: db, status: 'applied', violations: [] });
    expect(entry.violations).toBeUndefined();
  });
});

// ─── trimAuditLog Testleri ────────────────────────────────────────────────────

describe('trimAuditLog', () => {
  it('500 kayıt sınırını aşmaz', () => {
    const entries = Array.from({ length: 600 }, (_, i) => makeAuditEntry({ id: `ae_${i}` }));
    const trimmed = trimAuditLog(entries);
    expect(trimmed.length).toBeLessThanOrEqual(500);
  });

  it('500\'den az kayıt → değişmeden döner', () => {
    const entries = Array.from({ length: 100 }, (_, i) => makeAuditEntry({ id: `ae_${i}` }));
    const trimmed = trimAuditLog(entries);
    expect(trimmed).toHaveLength(100);
  });

  it('500 kayıt aşıldığında en eski kayıtlar silinir (ilk kayıtlar korunur)', () => {
    const entries = Array.from({ length: 600 }, (_, i) => makeAuditEntry({ id: `ae_${i}` }));
    const trimmed = trimAuditLog(entries);
    // İlk 500 kayıt korunmalı (en yeni = başta)
    expect(trimmed[0].id).toBe('ae_0');
    expect(trimmed[499].id).toBe('ae_499');
  });

  it('tam 500 kayıt → değişmeden döner', () => {
    const entries = Array.from({ length: 500 }, (_, i) => makeAuditEntry({ id: `ae_${i}` }));
    const trimmed = trimAuditLog(entries);
    expect(trimmed).toHaveLength(500);
  });
});

// ─── getSessionId Testleri ────────────────────────────────────────────────────

describe('getSessionId', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('string döner', () => {
    const id = getSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('aynı oturumda aynı ID döner', () => {
    const id1 = getSessionId();
    const id2 = getSessionId();
    expect(id1).toBe(id2);
  });

  it('sessionStorage temizlenince yeni ID üretir', () => {
    const id1 = getSessionId();
    sessionStorage.clear();
    const id2 = getSessionId();
    expect(id1).not.toBe(id2);
  });
});

// ─── runFullAudit Testleri ────────────────────────────────────────────────────

describe('runFullAudit', () => {
  it('boş DB → sıfır istatistik döner', () => {
    const db = makeDB();
    const report = runFullAudit(db);
    expect(report.totalEntries).toBe(0);
    expect(report.appliedCount).toBe(0);
    expect(report.blockedCount).toBe(0);
    expect(report.warnedCount).toBe(0);
    expect(report.balanceDrifts).toHaveLength(0);
    expect(report.anomalies).toHaveLength(0);
  });

  it('_auditLog istatistiklerini doğru hesaplar', () => {
    const db = makeDB({
      _auditLog: [
        makeAuditEntry({ status: 'applied' }),
        makeAuditEntry({ status: 'applied' }),
        makeAuditEntry({ status: 'blocked' }),
        makeAuditEntry({ status: 'warned' }),
      ],
    });
    const report = runFullAudit(db);
    expect(report.totalEntries).toBe(4);
    expect(report.appliedCount).toBe(2);
    expect(report.blockedCount).toBe(1);
    expect(report.warnedCount).toBe(1);
  });

  it('TRANSACTION_LIMIT aşımı → anomaly ve riskFlag üretir', () => {
    const db = makeDB({
      kasa: [makeKasaEntry({ id: 'k_big', amount: 150_000, kasa: 'nakit' })],
    });
    const report = runFullAudit(db);
    expect(report.anomalies.length).toBeGreaterThan(0);
    expect(report.riskFlags.some(f => f.includes('TRANSACTION_LIMIT'))).toBe(true);
  });

  it('AuditReport gerekli alanları içerir', () => {
    const db = makeDB();
    const report = runFullAudit(db);
    expect(report).toHaveProperty('anomalies');
    expect(report).toHaveProperty('balanceDrifts');
    expect(report).toHaveProperty('riskFlags');
    expect(report).toHaveProperty('totalEntries');
    expect(report).toHaveProperty('appliedCount');
    expect(report).toHaveProperty('blockedCount');
    expect(report).toHaveProperty('warnedCount');
  });
});

// ─── Property-Based Testler ───────────────────────────────────────────────────

// Arbitrary: minimal AuditEntry
const arbAuditEntry = () => fc.record({
  id: fc.uuid(),
  action: fc.string({ minLength: 1, maxLength: 20 }),
  entity: fc.constant('DB'),
  sessionId: fc.uuid(),
  status: fc.oneof(
    fc.constant('applied' as const),
    fc.constant('blocked' as const),
    fc.constant('warned' as const)
  ),
  time: fc.constant(new Date().toISOString()),
});

// Arbitrary: minimal DB
const arbDB = () => fc.record({
  _version: fc.integer({ min: 0, max: 100 }),
}).map(partial => makeDB(partial as Partial<DB>));

// Property 7: AuditEntry.status işlem sonucunu yansıtır
// Feature: rule-engine-audit, Property 7: AuditEntry status reflects transaction outcome
describe('Property 7: AuditEntry status reflects transaction outcome', () => {
  it('createAuditEntry status parametresini doğru yansıtır', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('applied' as const),
          fc.constant('blocked' as const),
          fc.constant('warned' as const)
        ),
        (status) => {
          const db = makeDB();
          const entry = createAuditEntry({ action: 'save', entity: 'DB', prevDB: db, nextDB: db, status });
          return entry.status === status;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 8: computeDiff yalnızca değişen alanları içerir
// Feature: rule-engine-audit, Property 8: computeDiff only includes changed top-level fields
describe('Property 8: computeDiff only includes changed top-level fields', () => {
  it('aynı DB için diff boş döner', () => {
    fc.assert(
      fc.property(arbDB(), (db) => {
        const { prevValue, nextValue } = computeDiff(db, db);
        return Object.keys(prevValue).length === 0 && Object.keys(nextValue).length === 0;
      }),
      { numRuns: 100 }
    );
  });
});

// Property 9: _auditLog 500 kayıt sınırını aşmaz
// Feature: rule-engine-audit, Property 9: _auditLog never exceeds 500 entries
describe('Property 9: _auditLog never exceeds 500 entries', () => {
  it('trimAuditLog çıktısı her zaman <= 500', () => {
    fc.assert(
      fc.property(fc.array(arbAuditEntry(), { minLength: 0, maxLength: 1000 }), (entries) => {
        const trimmed = trimAuditLog(entries as AuditEntry[]);
        return trimmed.length <= 500;
      }),
      { numRuns: 100 }
    );
  });
});
