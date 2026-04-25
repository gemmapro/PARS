// Soba Yönetim — Tam Tip Tanımları

export interface Partner {
  id: string;
  name: string;
  share?: number;
  phone?: string;
  note?: string;
  createdAt: string;
}

// ─── Ürün Kategorisi ─────────────────────────────────────────────────────────
export interface ProductCategory {
  id: string;        // 'soba', 'aksesuar', vb.
  name: string;      // 'Soba', 'Aksesuar', vb.
  icon: string;      // '🔥', '🔧', vb.
  createdAt: string;
}

// ─── Ürün ────────────────────────────────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  category: string;  // dinamik — productCategories tablosundan gelir
  supplierId?: string; // opsiyonel tedarikçi bağlantısı
  brand?: string;
  cost: number;
  costCurrency?: 'TRY' | 'USD' | 'EUR'; // alış para birimi
  price: number;
  stock: number;
  minStock: number;
  barcode?: string;
  description?: string;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Satış ───────────────────────────────────────────────────────────────────
export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  total: number;
}

export interface Sale {
  id: string;
  customerId?: string;
  cariId?: string;
  cariName?: string;
  customerName?: string;
  productId?: string;
  productName: string;
  productCategory?: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  discount: number;
  discountAmount: number;
  subtotal: number;
  total: number;
  profit: number;
  payment: string;
  status: 'tamamlandi' | 'iade' | 'iptal' | 'completed';
  items: SaleItem[];
  returnedAt?: string;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Kasa ─────────────────────────────────────────────────────────────────────
export interface Kasa {
  id: string;
  name: string;
  icon: string;
}

export interface KasaEntry {
  id: string;
  type: 'gelir' | 'gider';
  category: string;
  amount: number;
  kasa: string;
  description?: string;
  relatedId?: string;
  cariId?: string;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Cari ─────────────────────────────────────────────────────────────────────
export interface Cari {
  id: string;
  name: string;
  type: 'musteri' | 'tedarikci';
  ortak?: boolean;
  partnerId?: string;
  taxNo?: string;
  phone?: string;
  email?: string;
  address?: string;
  balance: number;
  note?: string;
  lastTransaction?: string;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Tedarikçi & Sipariş ─────────────────────────────────────────────────────
export interface Supplier {
  id: string;
  name: string;
  category?: string;
  taxNo?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  totalOrders: number;
  totalAmount: number;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface OrderPayment {
  id: string;
  amount: number;
  kasa: string;
  date: string;
  note?: string;
}

export interface Order {
  id: string;
  supplierId: string;
  items: OrderItem[];
  amount: number;
  nakliye?: number;
  paidAmount: number;
  remainingAmount: number;
  payments: OrderPayment[];
  deliveryDate?: string;
  note?: string;
  status: 'bekliyor' | 'yolda' | 'tamamlandi' | 'iptal';
  stockCompleted?: boolean;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Fatura ──────────────────────────────────────────────────────────────────
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  type: 'satis' | 'alis';
  cariId?: string;
  cariName: string;
  cariTaxNo?: string;
  cariAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  vatTotal: number;
  discount: number;
  total: number;
  payment: 'nakit' | 'kart' | 'havale' | 'cari' | 'cek';
  status: 'taslak' | 'onaylandi' | 'odendi' | 'iptal';
  kasaEntryId?: string;
  cariUpdated?: boolean;
  saleId?: string;
  dueDate?: string;
  note?: string;
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Stok Hareketi ───────────────────────────────────────────────────────────
export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: 'satis' | 'iade' | 'giris' | 'cikis' | 'duzeltme';
  amount: number;
  before: number;
  after: number;
  note: string;
  date: string;
}

// ─── Pelet ───────────────────────────────────────────────────────────────────
export interface PeletSupplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  tonPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface PeletOrder {
  id: string;
  supplierId: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  deliveryDate?: string;
  note?: string;
  status: 'bekliyor' | 'yolda' | 'tamamlandi' | 'iptal';
  createdAt: string;
  updatedAt: string;
}

// ─── Boru ─────────────────────────────────────────────────────────────────────
export interface BoruSupplier {
  id: string;
  name: string;
  type?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoruOrder {
  id: string;
  supplierId: string;
  items?: string;
  amount: number;
  deliveryDate?: string;
  note?: string;
  status: 'bekliyor' | 'yolda' | 'tamamlandi' | 'iptal';
  createdAt: string;
  updatedAt: string;
}

// ─── Bütçe ───────────────────────────────────────────────────────────────────
export interface BudgetCategory {
  id: string;
  name: string;
  icon: string;
  monthlyLimit: number;
  color: string;
  kasaCategories: string[];
}

export interface Budget {
  id: string;
  name: string;
  icon?: string;
  category: string;
  amount: number;
  monthlyLimit?: number;
  color?: string;
  kasaCategories?: string[];
  spent: number;
  period: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Taksit ──────────────────────────────────────────────────────────────────
export interface Installment {
  id: string;
  invoiceId: string;
  dueDate: string;
  amount: number;
  paid: boolean;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Banka ───────────────────────────────────────────────────────────────────
export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit' | 'income' | 'expense';
  status?: 'unmatched' | 'matched' | 'confirmed';
  matchedId?: string;
  matchedCariId?: string;
  matchScore?: number;
  updatedAt?: string;
  createdAt: string;
}

// ─── Sistem ──────────────────────────────────────────────────────────────────
export interface MonitorRule {
  id: string;
  isDefault?: boolean;
  name: string;
  type: string;
  level: 'critical' | 'warning' | 'info';
  interval: number;
  popup: boolean;
  active: boolean;
  threshold?: number;
  kasa?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorLog {
  id: string;
  ruleId: string;
  message: string;
  level: string;
  time: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  detail: string;
  time: string;
}

export interface OrtakEmanet {
  id: string;
  partnerId: string;
  description: string;
  amount: number;
  note?: string;
  type: 'emanet' | 'iade';
  createdAt: string;
  updatedAt?: string;
}

// ─── Şirket ──────────────────────────────────────────────────────────────────
export interface Company {
  id: string;
  name?: string;
  taxNo?: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: string;
}

// ─── Not Defteri ──────────────────────────────────────────────────────────────
export interface Note {
  id: string;
  title: string;
  content: string;
  color?: string;   // '#fbbf24', '#10b981', vb.
  pinned?: boolean;
  tags?: string[];
  deleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Rule Engine ─────────────────────────────────────────────────────────────
export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  message: string;
  severity: 'block' | 'warn';
  relatedIds?: string[];
}

// ─── Audit Engine ─────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  prevValue?: unknown;   // computeDiff() sonucu — tüm DB değil
  nextValue?: unknown;   // computeDiff() sonucu — tüm DB değil
  userId?: string;
  sessionId: string;     // sessionStorage UUID
  status: 'applied' | 'blocked' | 'warned';
  violations?: RuleViolation[];
  detail?: string;
  time: string;          // ISO string
}

// ─── BFCE Uyarlamaları ────────────────────────────────────────────────────────
export interface AuditAnomaly {
  entryId: string;
  issue: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface AuditReport {
  anomalies: AuditAnomaly[];
  balanceDrifts: string[];      // "kasaId: hesaplanan X, kayıtlı Y" formatı
  riskFlags: string[];          // TRANSACTION_LIMIT aşımları, onaysız işlemler
  totalEntries: number;
  appliedCount: number;
  blockedCount: number;
  warnedCount: number;
}

// ─── Veritabanı (Kök) ────────────────────────────────────────────────────────
export interface DB {
  _version: number;
  products: Product[];
  sales: Sale[];
  suppliers: Supplier[];
  orders: Order[];
  cari: Cari[];
  kasa: KasaEntry[];
  kasalar: Kasa[];
  bankTransactions: BankTransaction[];
  matchRules: unknown[];
  monitorRules: MonitorRule[];
  monitorLog: MonitorLog[];
  stockMovements: StockMovement[];
  peletSuppliers: PeletSupplier[];
  peletOrders: PeletOrder[];
  boruSuppliers: BoruSupplier[];
  boruOrders: BoruOrder[];
  invoices: Invoice[];
  budgets: BudgetCategory[];
  returns: unknown[];
  _activityLog: ActivityLog[];
  company: Company;
  settings: Record<string, unknown>;
  pelletSettings: { gramaj: number; kgFiyat: number; cuvalKg: number; critDays: number };
  ortakEmanetler: OrtakEmanet[];
  installments: Installment[];
  partners: Partner[];
  productCategories: ProductCategory[];
  notes: Note[];
  _auditLog: AuditEntry[];
}

