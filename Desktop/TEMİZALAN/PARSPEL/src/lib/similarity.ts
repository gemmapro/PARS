// Türkçe normalize ve benzerlik fonksiyonları

export function normalizeTR(s: string): string {
  return s.trim().toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Bigram bazlı benzerlik skoru (0-100). %60+ uyarı, %80+ engel için uygundur. */
export function similarity(a: string, b: string): number {
  const na = normalizeTR(a), nb = normalizeTR(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;

  // Kelime bazlı eşleşme
  const wordsA = new Set(na.split(' ').filter(Boolean));
  const wordsB = new Set(nb.split(' ').filter(Boolean));
  const common = [...wordsA].filter(w => wordsB.has(w)).length;
  if (common > 0) {
    const score = Math.round((common / Math.max(wordsA.size, wordsB.size)) * 90);
    if (score >= 60) return score;
  }

  // Bigram bazlı (Dice coefficient)
  const bigrams = (s: string): Set<string> => {
    const b = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2));
    return b;
  };
  const ba = bigrams(na), bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  const inter = [...ba].filter(x => bb.has(x)).length;
  return Math.round((2 * inter) / (ba.size + bb.size) * 100);
}

/** Tam eşleşme kontrolü (normalize edilmiş) */
export function isExactMatch(a: string, b: string): boolean {
  return normalizeTR(a) === normalizeTR(b);
}
