import { useState, useCallback, useEffect, useRef } from 'react';
import type { DB, Kasa, ProductCategory, RuleViolation } from '@/types';
import { genId } from '@/lib/utils-tr';
import { logger } from '@/lib/logger';
import { loadConnConfig, getFirebaseDocUrl } from '@/lib/connConfig';
import { validateTransaction } from '@/lib/ruleEngine';
import { createAuditEntry, trimAuditLog } from '@/lib/auditEngine';

// Firebase config — localStorage'dan dinamik olarak okunur
function getFirebaseUrl(): string {
  const cfg = loadConnConfig();
  if (!cfg.firebase.enabled || !cfg.firebase.projectId || !cfg.firebase.apiKey) return '';
  return getFirebaseDocUrl(cfg.firebase);
}

// ── Sync durum yayıncısı ────────────────────────────────────────────────────
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'loading';
type SyncListener = (status: SyncStatus, detail?: string) => void;
const _syncListeners: SyncListener[] = [];
let _currentSyncStatus: SyncStatus = 'idle';

function emitSync(status: SyncStatus, detail?: string) {
  _currentSyncStatus = status;
  _syncListeners.forEach(fn => { try { fn(status, detail); } catch { /* ignore */ } });
}

export function onSyncStatus(fn: SyncListener): () => void {
  _syncListeners.push(fn);
  return () => { const i = _syncListeners.indexOf(fn); if (i >= 0) _syncListeners.splice(i, 1); };
}
export function getSyncStatus() { return _currentSyncStatus; }

const STORAGE_KEY = 'sobaYonetim';

function makeDefaultDB(): DB {
  const nowIso = new Date().toISOString();
  return {
    _version: 0,
    products: [],
    sales: [],
    suppliers: [],
    orders: [],
    cari: [],
    kasa: [],
    kasalar: [
      { id: 'nakit', name: 'Nakit', icon: '💵' },
      { id: 'banka', name: 'Banka', icon: '🏦' },
      { id: 'pos_ziraat', name: 'POS Ziraat', icon: '🏧' },
      { id: 'pos_is', name: 'POS İş', icon: '🏧' },
      { id: 'pos_yk', name: 'POS YapıKredi', icon: '🏧' },
    ] as Kasa[],
    bankTransactions: [],
    matchRules: [],
    monitorRules: [
      { id: genId(), isDefault: true, createdAt: nowIso, updatedAt: nowIso, name: 'Stok Tükendi Uyarısı', type: 'stok_sifir', level: 'critical', interval: 30, popup: true, active: true, threshold: 0 },
      { id: genId(), isDefault: true, createdAt: nowIso, updatedAt: nowIso, name: 'Düşük Stok Uyarısı', type: 'stok_min', level: 'warning', interval: 60, popup: true, active: true, threshold: undefined },
      { id: genId(), isDefault: true, createdAt: nowIso, updatedAt: nowIso, name: 'Düşük Kasa Bakiyesi', type: 'kasa_min', level: 'warning', interval: 300, popup: true, active: true, threshold: 1000, kasa: 'nakit' },
    ],
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
    company: { id: genId(), createdAt: nowIso },
    settings: {},
    pelletSettings: { gramaj: 14, kgFiyat: 6.5, cuvalKg: 15, critDays: 3 },
    ortakEmanetler: [],
    installments: [],
    partners: [],
    productCategories: [
      { id: 'soba',     name: 'Soba',        icon: '🔥', createdAt: nowIso },
      { id: 'aksesuar', name: 'Aksesuar',     icon: '🔧', createdAt: nowIso },
      { id: 'yedek',    name: 'Yedek Parça',  icon: '⚙️', createdAt: nowIso },
      { id: 'boru',     name: 'Boru',         icon: '🔩', createdAt: nowIso },
      { id: 'pelet',    name: 'Pelet',        icon: '🪵', createdAt: nowIso },
    ] as ProductCategory[],
    notes: [],
    _auditLog: [],
  };
}

function loadFromStorage(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeDefaultDB();
    const parsed = JSON.parse(raw);
    const def = makeDefaultDB();
    const merged = { ...def, ...parsed };
    if (!merged.kasalar || merged.kasalar.length === 0) merged.kasalar = def.kasalar;
    // POS kasalarını eksikse ekle
    const posIds = ['pos_ziraat', 'pos_is', 'pos_yk'];
    posIds.forEach(pid => {
      if (!merged.kasalar.find((k: Kasa) => k.id === pid)) {
        const defKasa = def.kasalar.find(k => k.id === pid);
        if (defKasa) merged.kasalar.push(defKasa);
      }
    });
    if (!merged.monitorRules || merged.monitorRules.length === 0) merged.monitorRules = def.monitorRules;
    if (!merged.pelletSettings) merged.pelletSettings = def.pelletSettings;
    if (!merged.company || typeof merged.company !== 'object') merged.company = def.company;
    if (!Array.isArray(merged.products)) merged.products = [];
    if (!Array.isArray(merged.sales)) merged.sales = [];
    if (!Array.isArray(merged.suppliers)) merged.suppliers = [];
    if (!Array.isArray(merged.orders)) merged.orders = [];
    if (!Array.isArray(merged.cari)) merged.cari = [];
    if (!Array.isArray(merged.kasa)) merged.kasa = [];
    if (!Array.isArray(merged.bankTransactions)) merged.bankTransactions = [];
    if (!Array.isArray(merged.matchRules)) merged.matchRules = [];
    if (!Array.isArray(merged.monitorLog)) merged.monitorLog = [];
    if (!Array.isArray(merged.stockMovements)) merged.stockMovements = [];
    if (!Array.isArray(merged.peletSuppliers)) merged.peletSuppliers = [];
    if (!Array.isArray(merged.peletOrders)) merged.peletOrders = [];
    if (!Array.isArray(merged.boruSuppliers)) merged.boruSuppliers = [];
    if (!Array.isArray(merged.boruOrders)) merged.boruOrders = [];
    if (!Array.isArray(merged.invoices)) merged.invoices = [];
    if (!Array.isArray(merged.budgets)) merged.budgets = [];
    if (!Array.isArray(merged.returns)) merged.returns = [];
    if (!Array.isArray(merged._activityLog)) merged._activityLog = [];
    if (!Array.isArray(merged.ortakEmanetler)) merged.ortakEmanetler = [];
    if (!Array.isArray(merged.installments)) merged.installments = [];
    if (!Array.isArray(merged.productCategories) || merged.productCategories.length === 0) merged.productCategories = def.productCategories;
    if (!Array.isArray(merged.notes)) merged.notes = [];
    if (!Array.isArray(merged._auditLog)) merged._auditLog = [];
    return merged;
  } catch {
    return makeDefaultDB();
  }
}

let _isSaving = false;
let _pendingDb: DB | null = null;

function saveToStorage(db: DB): boolean {
  if (_isSaving) {
    // Kayıt devam ederken yeni veri geldi → beklet
    _pendingDb = db;
    return false;
  }
  _isSaving = true;
  try {
    db._version = (db._version || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  } finally {
    _isSaving = false;
    // Bekleyen veri varsa hemen yaz
    if (_pendingDb) {
      const pending = _pendingDb;
      _pendingDb = null;
      saveToStorage(pending);
    }
  }
}

// ── Firebase REST API ───────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000]; // üstel geri çekilme

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = RETRY_DELAYS[attempt] ?? 8000;
        logger.warn('firebase', `Bağlantı denemesi ${attempt + 1}/${retries + 1} başarısız — ${delay}ms bekleyip tekrar denenecek`, { error: String(e) });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function saveToFirebase(db: DB): Promise<void> {
  const url = getFirebaseUrl();
  if (!url) { emitSync('idle'); return; }
  const t = logger.time('firebase', `Firebase kayıt v${db._version}`);
  emitSync('saving');
  try {
    const payload = {
      fields: {
        data: { stringValue: JSON.stringify(db) },
        version: { integerValue: String(db._version || 0) },
        updatedAt: { stringValue: new Date().toISOString() },
      }
    };
    const res = await fetchWithRetry(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ms = t.end({ version: db._version, ok: res.ok });
    if (res.ok) {
      emitSync('saved', `v${db._version} · ${ms}ms`);
      logger.info('sync', `Firebase\'e kaydedildi`, { version: db._version, ms });
      // Her 10 versiyonda bir otomatik yedek al
      if ((db._version || 0) % 10 === 0 && db._version > 0) {
        saveBackupToFirebase(db).catch(() => {});
      }
    } else {
      const body = await res.text().catch(() => '');
      emitSync('error', `HTTP ${res.status}`);
      logger.error('firebase', `Firebase kayıt hatası HTTP ${res.status}`, { body: body.slice(0, 200) });
    }
  } catch (e) {
    t.end({ error: String(e) });
    emitSync('error', 'Bağlantı hatası');
    logger.error('firebase', 'Firebase kayıt tamamen başarısız', { error: String(e) });
  }
}

// ── Firebase Yedekleme ──────────────────────────────────────────────────────

const MAX_BACKUPS = 20;

async function pruneOldBackups(cfg: ReturnType<typeof loadConnConfig>): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/backups?key=${cfg.firebase.apiKey}&pageSize=50`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const json = await res.json();
    const docs: { name: string; fields: { version?: { integerValue?: string }; createdAt?: { stringValue?: string } } }[] = json.documents || [];
    if (docs.length <= MAX_BACKUPS) return;
    // Versiyona göre sırala, en eskiler sonda
    const sorted = [...docs].sort((a, b) => {
      const va = parseInt(a.fields?.version?.integerValue || '0');
      const vb = parseInt(b.fields?.version?.integerValue || '0');
      return vb - va;
    });
    const toDelete = sorted.slice(MAX_BACKUPS);
    for (const doc of toDelete) {
      const docUrl = `https://firestore.googleapis.com/v1/${doc.name}?key=${cfg.firebase.apiKey}`;
      await fetch(docUrl, { method: 'DELETE', signal: AbortSignal.timeout(8000) }).catch(() => {});
    }
    logger.info('db', `Eski yedekler temizlendi: ${toDelete.length} silindi`);
  } catch (e) {
    logger.warn('db', 'Yedek temizleme başarısız', { error: String(e) });
  }
}

async function saveBackupToFirebase(db: DB, label?: string): Promise<boolean> {
  const cfg = loadConnConfig();
  if (!cfg.firebase.enabled || !cfg.firebase.projectId || !cfg.firebase.apiKey) return false;
  const backupId = label || `v${db._version}_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/backups/${backupId}?key=${cfg.firebase.apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          data: { stringValue: JSON.stringify(db) },
          version: { integerValue: String(db._version || 0) },
          label: { stringValue: label || `Otomatik v${db._version}` },
          createdAt: { stringValue: new Date().toISOString() },
        }
      }),
      signal: AbortSignal.timeout(15000),
    });
    logger.info('db', `Yedek kaydedildi: ${backupId}`, { ok: res.ok });
    if (res.ok) {
      // Arka planda eski yedekleri temizle
      pruneOldBackups(cfg).catch(() => {});
    }
    return res.ok;
  } catch (e) {
    logger.warn('db', 'Yedek kaydedilemedi', { error: String(e) });
    return false;
  }
}

async function listBackupsFromFirebase(): Promise<{ id: string; version: number; label: string; createdAt: string }[]> {
  const cfg = loadConnConfig();
  if (!cfg.firebase.enabled || !cfg.firebase.projectId || !cfg.firebase.apiKey) return [];
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/backups?key=${cfg.firebase.apiKey}&pageSize=20`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const docs = json.documents || [];
    return docs.map((doc: any) => ({
      id: doc.name?.split('/').pop() || '',
      version: parseInt(doc.fields?.version?.integerValue || '0'),
      label: doc.fields?.label?.stringValue || '',
      createdAt: doc.fields?.createdAt?.stringValue || '',
    })).sort((a: any, b: any) => b.version - a.version);
  } catch {
    return [];
  }
}

async function restoreBackupFromFirebase(backupId: string): Promise<DB | null> {
  const cfg = loadConnConfig();
  if (!cfg.firebase.enabled || !cfg.firebase.projectId || !cfg.firebase.apiKey) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/backups/${backupId}?key=${cfg.firebase.apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) return null;
    return JSON.parse(raw) as DB;
  } catch {
    return null;
  }
}

// ── Geri yükleme sonrası referans bütünlüğü onarımı ───────────────────────
function repairReferentialIntegrity(db: DB): DB {
  const productIds = new Set(db.products.map(p => p.id));
  const cariIds = new Set(db.cari.map(c => c.id));
  const partnerIds = new Set(db.partners.map(p => p.id));

  let changed = false;

  // Satışlarda olmayan ürüne referans varsa productId'yi temizle (satış kaydı korunur)
  const sales = db.sales.map(s => {
    if (s.productId && !productIds.has(s.productId)) {
      changed = true;
      return { ...s, productId: undefined as unknown as string };
    }
    return s;
  });

  // Kasa kayıtlarında olmayan cari'ye referans varsa cariId'yi temizle
  const kasa = db.kasa.map(k => {
    if (k.cariId && !cariIds.has(k.cariId)) {
      changed = true;
      return { ...k, cariId: undefined };
    }
    return k;
  });

  // Faturalarda olmayan cari'ye referans varsa cariId'yi temizle
  const invoices = (db.invoices || []).map(inv => {
    if (inv.cariId && !cariIds.has(inv.cariId)) {
      changed = true;
      return { ...inv, cariId: undefined };
    }
    return inv;
  });

  // Ortak emanetlerde olmayan partner'a referans varsa soft-delete et
  const ortakEmanetler = (db.ortakEmanetler || []).map(e => {
    if (e.partnerId && !partnerIds.has(e.partnerId)) {
      changed = true;
      return { ...e, deleted: true };
    }
    return e;
  });

  if (!changed) return db;
  logger.info('db', 'Referans bütünlüğü onarıldı', { changed });
  return { ...db, sales, kasa, invoices, ortakEmanetler };
}

// ── Geri yükleme veri doğrulama ve tekerrür kontrolü ─────────────────────

export interface RestoreReport {
  added: number;
  skippedDuplicate: number;   // ID zaten mevcut
  skippedInvalidName: number; // Tek haneli / boş / sadece sayı
  skippedMissingField: number; // Zorunlu alan eksik
  warnings: string[];         // Kullanıcıya gösterilecek açıklamalar
}

/** Cari/ürün adı kalite kontrolü — geçersizse sebebini döndürür, geçerliyse null */
function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) return 'Ad boş olamaz';
  const trimmed = name.trim();
  if (trimmed.length < 2) return `"${trimmed}" — ad çok kısa (min 2 karakter)`;
  if (/^\d+$/.test(trimmed)) return `"${trimmed}" — ad sadece sayıdan oluşamaz`;
  return null; // geçerli
}

/**
 * Yedekten gelen cari listesini mevcut DB ile karşılaştırır.
 * - ID zaten varsa → mevcut kaydı koru (yedektekini atla)
 * - ID yoksa, ad geçerliyse → ekle
 * - Ad geçersizse → atla, raporla
 */
function mergeCariler(
  existing: DB['cari'],
  incoming: DB['cari'],
  report: RestoreReport
): DB['cari'] {
  const existingIds = new Set(existing.map(c => c.id));
  const result = [...existing];

  for (const c of incoming) {
    // Zorunlu alan kontrolü
    if (!c.id || !c.createdAt) {
      report.skippedMissingField++;
      report.warnings.push(`Cari atlandı: zorunlu alan eksik (id veya createdAt yok)`);
      continue;
    }
    // ID zaten mevcut → mevcut ID'yi koru
    if (existingIds.has(c.id)) {
      report.skippedDuplicate++;
      continue;
    }
    // Ad kalite kontrolü
    const nameErr = validateName(c.name);
    if (nameErr) {
      report.skippedInvalidName++;
      report.warnings.push(`Cari atlandı: ${nameErr}`);
      continue;
    }
    // type kontrolü
    if (c.type !== 'musteri' && c.type !== 'tedarikci') {
      report.skippedMissingField++;
      report.warnings.push(`Cari "${c.name}" atlandı: geçersiz tür "${c.type}"`);
      continue;
    }
    result.push(c);
    existingIds.add(c.id);
    report.added++;
  }
  return result;
}

/**
 * Yedekten gelen ürün listesini mevcut DB ile karşılaştırır.
 * Aynı kurallar: ID varsa atla, ad geçersizse atla.
 */
function mergeProducts(
  existing: DB['products'],
  incoming: DB['products'],
  report: RestoreReport
): DB['products'] {
  const existingIds = new Set(existing.map(p => p.id));
  const result = [...existing];

  for (const p of incoming) {
    if (!p.id || !p.createdAt) {
      report.skippedMissingField++;
      report.warnings.push(`Ürün atlandı: zorunlu alan eksik`);
      continue;
    }
    if (existingIds.has(p.id)) {
      report.skippedDuplicate++;
      continue;
    }
    const nameErr = validateName(p.name);
    if (nameErr) {
      report.skippedInvalidName++;
      report.warnings.push(`Ürün atlandı: ${nameErr}`);
      continue;
    }
    if (typeof p.price !== 'number' || typeof p.cost !== 'number' || typeof p.stock !== 'number') {
      report.skippedMissingField++;
      report.warnings.push(`Ürün "${p.name}" atlandı: fiyat/maliyet/stok sayısal değil`);
      continue;
    }
    result.push(p);
    existingIds.add(p.id);
    report.added++;
  }
  return result;
}

/**
 * Genel dizi birleştirici — sadece ID kontrolü yapar (cari/ürün dışı diziler için).
 * ID yoksa veya zorunlu alan eksikse atla.
 */
function mergeArray<T extends { id?: string; createdAt?: string }>(
  existing: T[],
  incoming: T[],
  label: string,
  report: RestoreReport
): T[] {
  const existingIds = new Set(existing.map(item => item.id).filter(Boolean));
  const result = [...existing];

  for (const item of incoming) {
    if (!item.id || !item.createdAt) {
      report.skippedMissingField++;
      report.warnings.push(`${label} kaydı atlandı: zorunlu alan eksik`);
      continue;
    }
    if (existingIds.has(item.id)) {
      report.skippedDuplicate++;
      continue;
    }
    result.push(item);
    existingIds.add(item.id);
    report.added++;
  }
  return result;
}

/**
 * Seçimli geri yükleme için: yedek DB'yi mevcut DB ile akıllıca birleştirir.
 * Tüm diziler için ID bazlı tekerrür kontrolü + cari/ürün için ad kalite kontrolü yapar.
 * Döndürülen rapor kullanıcıya gösterilir.
 */
export function mergeRestoreDB(current: DB, incoming: Partial<DB>, selectedKeys: Set<string>): { db: DB; report: RestoreReport } {
  const report: RestoreReport = { added: 0, skippedDuplicate: 0, skippedInvalidName: 0, skippedMissingField: 0, warnings: [] };
  let next = { ...current };

  if (selectedKeys.has('cari') && Array.isArray(incoming.cari)) {
    next.cari = mergeCariler(current.cari, incoming.cari, report);
  }
  if (selectedKeys.has('products') && Array.isArray(incoming.products)) {
    next.products = mergeProducts(current.products, incoming.products, report);
  }
  if (selectedKeys.has('sales') && Array.isArray(incoming.sales)) {
    next.sales = mergeArray(current.sales, incoming.sales as (DB['sales'][number] & { id?: string; createdAt?: string })[], 'Satış', report);
  }
  if (selectedKeys.has('kasa') && Array.isArray(incoming.kasa)) {
    next.kasa = mergeArray(current.kasa, incoming.kasa as (DB['kasa'][number] & { id?: string; createdAt?: string })[], 'Kasa', report);
  }
  if (selectedKeys.has('invoices') && Array.isArray(incoming.invoices)) {
    next.invoices = mergeArray(current.invoices, incoming.invoices as (DB['invoices'][number] & { id?: string; createdAt?: string })[], 'Fatura', report);
  }
  if (selectedKeys.has('suppliers') && Array.isArray(incoming.suppliers)) {
    next.suppliers = mergeArray(current.suppliers, incoming.suppliers as (DB['suppliers'][number] & { id?: string; createdAt?: string })[], 'Tedarikçi', report);
  }
  if (selectedKeys.has('orders') && Array.isArray(incoming.orders)) {
    next.orders = mergeArray(current.orders, incoming.orders as (DB['orders'][number] & { id?: string; createdAt?: string })[], 'Sipariş', report);
  }
  if (selectedKeys.has('bankTransactions') && Array.isArray(incoming.bankTransactions)) {
    next.bankTransactions = mergeArray(current.bankTransactions, incoming.bankTransactions as (DB['bankTransactions'][number] & { id?: string; createdAt?: string })[], 'Banka işlemi', report);
  }
  if (selectedKeys.has('partners') && Array.isArray(incoming.partners)) {
    next.partners = mergeArray(current.partners, incoming.partners as (DB['partners'][number] & { id?: string; createdAt?: string })[], 'Ortak', report);
  }
  if (selectedKeys.has('notes') && Array.isArray(incoming.notes)) {
    next.notes = mergeArray(current.notes, incoming.notes as (DB['notes'][number] & { id?: string; createdAt?: string })[], 'Not', report);
  }
  if (selectedKeys.has('ortakEmanetler') && Array.isArray(incoming.ortakEmanetler)) {
    next.ortakEmanetler = mergeArray(current.ortakEmanetler, incoming.ortakEmanetler as (DB['ortakEmanetler'][number] & { id?: string; createdAt?: string })[], 'Emanet', report);
  }
  if (selectedKeys.has('installments') && Array.isArray(incoming.installments)) {
    next.installments = mergeArray(current.installments, incoming.installments as (DB['installments'][number] & { id?: string; createdAt?: string })[], 'Taksit', report);
  }
  // Nesne alanları (company, pelletSettings) — doğrudan üzerine yaz
  if (selectedKeys.has('company') && incoming.company && typeof incoming.company === 'object') {
    next.company = { ...current.company, ...incoming.company };
  }
  if (selectedKeys.has('pelletSettings') && incoming.pelletSettings && typeof incoming.pelletSettings === 'object') {
    next.pelletSettings = { ...current.pelletSettings, ...incoming.pelletSettings };
  }

  // Referans bütünlüğünü onar
  next = repairReferentialIntegrity(next);
  return { db: next, report };
}

export { saveBackupToFirebase, listBackupsFromFirebase, restoreBackupFromFirebase };

/**
 * TAM GERİ YÜKLEME — Yedek kazanır, mevcut veri tamamen değişir.
 * Ad kalite kontrolü + referans onarımı çalışır.
 * Döndürülen rapor kullanıcıya gösterilir.
 */
export function fullRestoreDB(incoming: DB, def: DB): { db: DB; report: RestoreReport } {
  const report: RestoreReport = { added: 0, skippedDuplicate: 0, skippedInvalidName: 0, skippedMissingField: 0, warnings: [] };

  // Temel yapıyı default ile merge et (eksik alanları tamamla)
  let data: DB = { ...def, ...incoming };

  // Zorunlu array alanları
  const arrayKeys: (keyof DB)[] = ['products','sales','suppliers','orders','cari','kasa','bankTransactions',
    'matchRules','monitorRules','monitorLog','stockMovements','peletSuppliers','peletOrders',
    'boruSuppliers','boruOrders','invoices','budgets','returns','_activityLog',
    'ortakEmanetler','installments','partners','notes','_auditLog'];
  for (const key of arrayKeys) {
    if (!Array.isArray(data[key])) (data as unknown as Record<string, unknown>)[key] = [];
  }
  if (!data.kasalar || data.kasalar.length === 0) data.kasalar = def.kasalar;
  if (!data.company || typeof data.company !== 'object') data.company = def.company;
  if (!data.pelletSettings) data.pelletSettings = def.pelletSettings;
  if (!Array.isArray(data.productCategories) || data.productCategories.length === 0) data.productCategories = def.productCategories;

  // Cari ad kalite kontrolü — geçersizse soft-delete
  data.cari = data.cari.map(c => {
    const err = validateName(c.name);
    if (err) {
      report.skippedInvalidName++;
      report.warnings.push(`Cari işaretlendi (gizlendi): ${err}`);
      return { ...c, deleted: true };
    }
    return c;
  });

  // Ürün ad kalite kontrolü — geçersizse soft-delete
  data.products = data.products.map(p => {
    const err = validateName(p.name);
    if (err) {
      report.skippedInvalidName++;
      report.warnings.push(`Ürün işaretlendi (gizlendi): ${err}`);
      return { ...p, deleted: true };
    }
    return p;
  });

  // Referans bütünlüğünü onar
  data = repairReferentialIntegrity(data);

  report.added = data.cari.filter(c => !c.deleted).length
    + data.products.filter(p => !p.deleted).length
    + data.sales.length + data.kasa.length;

  return { db: data, report };
}

async function loadFromFirebase(): Promise<DB | null> {
  const url = getFirebaseUrl();
  if (!url) return null;
  const t = logger.time('firebase', 'Firebase yükle');
  try {
    const res = await fetchWithRetry(url, { method: 'GET' });
    if (!res.ok) { t.end({ status: res.status }); return null; }
    const json = await res.json();
    const raw = json?.fields?.data?.stringValue;
    if (!raw) { t.end({ empty: true }); return null; }
    const data = JSON.parse(raw) as DB;
    const ms = t.end({ version: data._version });
    logger.info('firebase', 'Firebase\'den yüklendi', { version: data._version, ms });
    return data;
  } catch (e) {
    t.end({ error: String(e) });
    logger.warn('firebase', 'Firebase yükleme başarısız (çevrimdışı?)', { error: String(e) });
    return null;
  }
}

export function useDB() {
  const [db, setDb] = useState<DB>(loadFromStorage);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Uygulama açılınca Firebase'den en güncel veriyi çek
  useEffect(() => {
    emitSync('loading');
    logger.info('db', 'Uygulama DB yükleniyor', { localVersion: db._version });
    loadFromFirebase().then(cloudDb => {
      if (!cloudDb) {
        emitSync('idle');
        logger.info('db', 'Firebase boş, yerel veri kullanılıyor');
        return;
      }
      const localDb = loadFromStorage();
      if ((cloudDb._version || 0) > (localDb._version || 0)) {
        logger.info('db', 'Bulut verisi daha güncel — güncelleniyor', {
          local: localDb._version, cloud: cloudDb._version
        });
        saveToStorage(cloudDb);
        setDb(cloudDb);
      } else {
        logger.info('db', 'Yerel veri güncel', { version: localDb._version });
      }
      emitSync('idle');
    });
    // Cleanup: unmount'ta pending Firebase sync'i iptal et
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback((updater: (prev: DB) => DB) => {
    setDb(prev => {
      const t = logger.time('db', 'save()');
      let next = updater(prev);
      // Sync timestamp ekle
      (next as DB & { _lastSyncAt?: string })._lastSyncAt = new Date().toISOString();
      // stockMovements limitini koru (max 1000 kayıt — en yeni kayıtlar korunur)
      if (next.stockMovements && next.stockMovements.length > 1000) {
        next = { ...next, stockMovements: next.stockMovements.slice(0, 1000) };
      }

      // ── Rule Engine değerlendirmesi ──────────────────────────────────────
      let violations: RuleViolation[] = [];
      try {
        violations = validateTransaction(prev, next);
      } catch (e) {
        logger.warn('db', 'Rule Engine değerlendirme hatası — atlandı', { error: String(e) });
      }

      const hasBlock = violations.some(v => v.severity === 'block');
      const hasWarn = violations.some(v => v.severity === 'warn');
      const auditStatus = hasBlock ? 'blocked' : hasWarn ? 'warned' : 'applied';

      // ── Audit Entry oluştur ──────────────────────────────────────────────
      const entry = createAuditEntry({
        action: 'save',
        entity: 'DB',
        prevDB: prev,
        nextDB: next,
        status: auditStatus,
        violations: violations.length > 0 ? violations : undefined,
      });

      // ── Block ihlali: sadece audit log'u yaz, next'i yazma ──────────────
      if (hasBlock) {
        const auditOnly: DB = {
          ...prev,
          _auditLog: trimAuditLog([entry, ...(prev._auditLog || [])]),
        };
        saveToStorage(auditOnly);
        t.end({ version: prev._version, blocked: true });
        logger.warn('db', 'İşlem engellendi (block ihlali)', {
          violations: violations.filter(v => v.severity === 'block').map(v => v.ruleId),
        });
        return auditOnly;
      }

      // ── Warn veya temiz: next + audit log birlikte yaz ───────────────────
      const withAudit: DB = {
        ...next,
        _auditLog: trimAuditLog([entry, ...(next._auditLog || [])]),
      };
      saveToStorage(withAudit);
      t.end({ version: withAudit._version, warned: hasWarn });

      // Debounce: 1.2 saniye bekle sonra Firebase'e gönder
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        saveToFirebase(withAudit);
      }, 1200);
      return withAudit;
    });
  }, []);

  const logActivity = useCallback((action: string, detail?: string) => {
    save(prev => {
      const log = [{ id: genId(), action, detail: detail || '', time: new Date().toISOString() }, ...(prev._activityLog || [])].slice(0, 200);
      return { ...prev, _activityLog: log };
    });
  }, [save]);

  // Otomatik aktivite loglayan save wrapper'ı
  const saveWithLog = useCallback((updater: (prev: DB) => DB, action?: string, detail?: string) => {
    save(prev => {
      let next = updater(prev);
      if (action) {
        const log = [{ id: genId(), action, detail: detail || '', time: new Date().toISOString() }, ...(next._activityLog || [])].slice(0, 200);
        next = { ...next, _activityLog: log };
      }
      return next;
    });
  }, [save]);

  /**
   * Kural korumalı save.
   * Block ihlali varsa: onViolation çağrılır, yazım yapılmaz.
   * Warn ihlali varsa: onViolation çağrılır ama yazım devam eder.
   * İhlal yoksa: normal save akışı.
   */
  const saveGuarded = useCallback((
    updater: (prev: DB) => DB,
    onViolation?: (violations: RuleViolation[]) => void,
    auditMeta?: { action: string; entity: string; entityId?: string; detail?: string }
  ) => {
    setDb(prev => {
      let next = updater(prev);
      (next as DB & { _lastSyncAt?: string })._lastSyncAt = new Date().toISOString();
      if (next.stockMovements && next.stockMovements.length > 1000) {
        next = { ...next, stockMovements: next.stockMovements.slice(0, 1000) };
      }

      // Kural değerlendirmesi
      let violations: RuleViolation[] = [];
      try {
        violations = validateTransaction(prev, next);
      } catch (e) {
        logger.warn('db', 'saveGuarded: Rule Engine hatası — atlandı', { error: String(e) });
      }

      const hasBlock = violations.some(v => v.severity === 'block');
      const hasWarn = violations.some(v => v.severity === 'warn');

      // İhlal varsa callback'i çağır
      if ((hasBlock || hasWarn) && onViolation) {
        try { onViolation(violations); } catch { /* callback hatası uygulamayı çökertmez */ }
      }

      const auditStatus = hasBlock ? 'blocked' : hasWarn ? 'warned' : 'applied';
      const entry = createAuditEntry({
        action: auditMeta?.action ?? 'saveGuarded',
        entity: auditMeta?.entity ?? 'DB',
        entityId: auditMeta?.entityId,
        prevDB: prev,
        nextDB: next,
        status: auditStatus,
        violations: violations.length > 0 ? violations : undefined,
        detail: auditMeta?.detail,
      });

      // Block ihlali: sadece audit log'u yaz
      if (hasBlock) {
        const auditOnly: DB = {
          ...prev,
          _auditLog: trimAuditLog([entry, ...(prev._auditLog || [])]),
        };
        saveToStorage(auditOnly);
        logger.warn('db', 'saveGuarded: İşlem engellendi', {
          violations: violations.filter(v => v.severity === 'block').map(v => v.ruleId),
        });
        return auditOnly;
      }

      // Warn veya temiz: normal akış
      const withAudit: DB = {
        ...next,
        _auditLog: trimAuditLog([entry, ...(next._auditLog || [])]),
      };
      saveToStorage(withAudit);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        saveToFirebase(withAudit);
      }, 1200);
      return withAudit;
    });
  }, []);

  const exportJSON = useCallback(async () => {
    const data = JSON.stringify(db, null, 2);
    const filename = `soba-yedek-${new Date().toISOString().slice(0, 10)}.json`;

    // Capacitor Android'de Filesystem API kullan
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: filename,
          data,
          directory: Directory.Documents,
          encoding: 'utf8' as never,
        });
        // Kullanıcıya bildir
        alert(`✅ Yedek kaydedildi!\nKonum: Belgeler/${filename}`);
        return;
      }
    } catch { /* web fallback */ }

    // Web fallback
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [db]);

  const manualBackup = useCallback(async (label?: string): Promise<boolean> => {
    return saveBackupToFirebase(db, label || `manuel_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`);
  }, [db]);

  const listBackups = useCallback(() => listBackupsFromFirebase(), []);

  const restoreBackup = useCallback(async (backupId: string): Promise<{ ok: boolean; report?: RestoreReport }> => {
    // Geri yükleme öncesi mevcut veriyi otomatik yedekle
    const preLabel = `onceki_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
    await saveBackupToFirebase(db, preLabel).catch(() => {});

    const restored = await restoreBackupFromFirebase(backupId);
    if (!restored) return { ok: false };

    const def = makeDefaultDB();
    const { db: data, report } = fullRestoreDB(restored, def);
    setDb(data);
    saveToStorage(data);
    await saveToFirebase(data);
    return { ok: true, report };
  }, [db]);

  const importJSON = useCallback((file: File): Promise<boolean> => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = JSON.parse(e.target?.result as string);
          const def = makeDefaultDB();
          const { db: data } = fullRestoreDB(raw as DB, def);
          setDb(data);
          saveToStorage(data);
          saveToFirebase(data);
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const getKasaBakiye = useCallback((kasaId: string) => {
    return db.kasa.filter(k => !k.deleted && k.kasa === kasaId).reduce((sum, k) => {
      return sum + (k.type === 'gelir' ? k.amount : -k.amount);
    }, 0);
  }, [db.kasa]);

  const getTotalKasa = useCallback(() => {
    return db.kasa.filter(k => !k.deleted).reduce((sum, k) => sum + (k.type === 'gelir' ? k.amount : -k.amount), 0);
  }, [db.kasa]);

  return { db, save, saveWithLog, saveGuarded, logActivity, exportJSON, importJSON, getKasaBakiye, getTotalKasa, emitSync, manualBackup, listBackups, restoreBackup };
}