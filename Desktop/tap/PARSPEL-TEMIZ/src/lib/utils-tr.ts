export function genId(): string {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-4${s4().substring(1)}-${((8 + Math.random() * 4) | 0).toString(16)}${s4().substring(1)}-${s4()}${s4()}${s4()}`;
}

export function formatMoney(n: number): string {
  return (n || 0).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 });
}

export function formatMoneyShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + 'M ₺';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + 'K ₺';
  return formatMoney(n);
}

export function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function formatDateShort(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return iso; }
}

export function getCategoryName(cat: string): string {
  const map: Record<string, string> = {
    soba: 'Soba',
    aksesuar: 'Aksesuar',
    yedek: 'Yedek Parça',
    boru: 'Boru',
    pelet: 'Pelet',
  };
  return map[cat] || cat;
}

export function getCategoryIcon(cat: string): string {
  const map: Record<string, string> = {
    soba: '🔥',
    aksesuar: '🔧',
    yedek: '⚙️',
    boru: '🔩',
    pelet: '🪵',
  };
  return map[cat] || '📦';
}

export function getCategoryUnit(cat: string): string {
  if (cat === 'pelet') return 'kg';
  return 'adet';
}

// Maliyet üzeri kâr oranı (markup). Örn: maliyet 100₺, satış 150₺ → %50 markup
export function calcProfit(price: number, cost: number): number {
  if (!cost) return 0;
  return Math.round(((price - cost) / cost) * 100);
}

// calcMarkup: calcProfit ile aynı formül, daha açık isim
export function calcMarkup(price: number, cost: number): number {
  if (!cost) return 0;
  return Math.round(((price - cost) / cost) * 100);
}

// calcMargin: satış üzeri kâr oranı (gerçek kâr marjı). Örn: maliyet 100₺, satış 150₺ → %33 marj
export function calcMargin(price: number, cost: number): number {
  if (!price) return 0;
  return Math.round(((price - cost) / price) * 100);
}

// parseBankDate: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY → Date (UTC) | null
export function parseBankDate(s: string): Date | null {
  if (!s) return null;
  const match = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00.000Z`);
  return isNaN(date.getTime()) ? null : date;
}

// formatBankDate: Date → DD.MM.YYYY (UTC tabanlı, saat dilimi kayması yok)
export function formatBankDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

export function isUUID(v: string): boolean {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function todayISO(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function dateOnly(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}
