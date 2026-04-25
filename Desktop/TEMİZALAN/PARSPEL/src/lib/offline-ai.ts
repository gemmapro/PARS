import type { ExcelFile } from "./excel";

export interface LearnedPattern {
  columnNamePatterns: Record<string, number>;
  keyColumnPreferences: Record<string, number>;
  mergeStrategyPreferences: Record<string, number>;
  fileTypePatterns: Record<string, string[]>;
  analysisHistory: AnalysisHistoryEntry[];
  totalAnalyses: number;
  lastUpdated: number;
}

export interface AnalysisHistoryEntry {
  timestamp: number;
  fileCount: number;
  keyColumnChosen: string;
  strategy: string;
  outcome?: "success" | "failed";
}

export interface AnomalyResult {
  column: string;
  type: "empty" | "outlier" | "duplicate" | "inconsistent_type" | "suspicious";
  severity: "low" | "medium" | "high";
  description: string;
  affectedRows: number[];
}

export interface OfflineAnalysis {
  keyColumnSuggestions: Array<{ column: string; confidence: number; reason: string }>;
  dataQuality: Array<{ column: string; score: number; issues: string[] }>;
  anomalies: AnomalyResult[];
  duplicateCount: number;
  emptyCount: number;
  overallScore: number;
  recommendations: string[];
}

const DB_NAME = "excelmerge-ai";
const DB_VERSION = 1;
const STORE_NAME = "patterns";
const PATTERN_KEY = "main-pattern";

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadPatterns(): Promise<LearnedPattern> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(PATTERN_KEY);
      req.onsuccess = () => {
        resolve(
          req.result ?? {
            columnNamePatterns: {},
            keyColumnPreferences: {},
            mergeStrategyPreferences: {},
            fileTypePatterns: {},
            analysisHistory: [],
            totalAnalyses: 0,
            lastUpdated: Date.now(),
          }
        );
      };
      req.onerror = () =>
        resolve({
          columnNamePatterns: {},
          keyColumnPreferences: {},
          mergeStrategyPreferences: {},
          fileTypePatterns: {},
          analysisHistory: [],
          totalAnalyses: 0,
          lastUpdated: Date.now(),
        });
    });
  } catch {
    return {
      columnNamePatterns: {},
      keyColumnPreferences: {},
      mergeStrategyPreferences: {},
      fileTypePatterns: {},
      analysisHistory: [],
      totalAnalyses: 0,
      lastUpdated: Date.now(),
    };
  }
}

async function savePatterns(patterns: LearnedPattern): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(patterns, PATTERN_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
  }
}

export async function learnFromUserAction(action: {
  keyColumn: string;
  strategy: string;
  fileCount: number;
  outcome?: "success" | "failed";
}): Promise<void> {
  const patterns = await loadPatterns();

  const col = action.keyColumn.toLowerCase();
  patterns.keyColumnPreferences[col] = (patterns.keyColumnPreferences[col] ?? 0) + 1;
  patterns.mergeStrategyPreferences[action.strategy] =
    (patterns.mergeStrategyPreferences[action.strategy] ?? 0) + 1;

  patterns.analysisHistory.push({
    timestamp: Date.now(),
    fileCount: action.fileCount,
    keyColumnChosen: action.keyColumn,
    strategy: action.strategy,
    outcome: action.outcome,
  });

  if (patterns.analysisHistory.length > 100) {
    patterns.analysisHistory = patterns.analysisHistory.slice(-100);
  }

  patterns.totalAnalyses++;
  patterns.lastUpdated = Date.now();

  await savePatterns(patterns);
}

export async function getLearnedPatterns(): Promise<LearnedPattern> {
  return loadPatterns();
}

const KEY_COLUMN_INDICATORS = [
  { keywords: ["id", "no", "numara", "number", "kod", "code", "key"], weight: 10 },
  { keywords: ["tc", "kimlik", "identity"], weight: 12 },
  { keywords: ["siparis", "order", "sira"], weight: 8 },
  { keywords: ["musteri", "customer", "client"], weight: 7 },
  { keywords: ["urun", "product", "item", "stok"], weight: 6 },
  { keywords: ["fatura", "invoice", "belge", "document"], weight: 9 },
];

export async function suggestKeyColumns(
  headers: string[]
): Promise<Array<{ column: string; confidence: number; reason: string }>> {
  const patterns = await loadPatterns();
  const suggestions: Array<{ column: string; confidence: number; reason: string }> = [];

  for (const header of headers) {
    const lowerHeader = header.toLowerCase();
    let score = 0;
    const reasons: string[] = [];

    for (const indicator of KEY_COLUMN_INDICATORS) {
      for (const kw of indicator.keywords) {
        if (lowerHeader.includes(kw)) {
          score += indicator.weight;
          reasons.push(`"${kw}" iceriyor`);
          break;
        }
      }
    }

    const learnedScore = patterns.keyColumnPreferences[lowerHeader] ?? 0;
    if (learnedScore > 0) {
      score += learnedScore * 3;
      reasons.push(`${learnedScore} kez kullanildi (ogrenildi)`);
    }

    if (score > 0) {
      suggestions.push({
        column: header,
        confidence: Math.min(100, score * 5),
        reason: reasons.join(", "),
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

export function analyzeOffline(files: ExcelFile[]): OfflineAnalysis {
  const anomalies: AnomalyResult[] = [];
  const dataQuality: Array<{ column: string; score: number; issues: string[] }> = [];
  let duplicateCount = 0;
  let emptyCount = 0;

  for (const file of files) {
    for (const sheet of file.sheets) {
      const { headers, rows } = sheet;

      for (const header of headers) {
        const values = rows.map((r) => r[header]);
        const nonEmpty = values.filter((v) => v != null && v !== "");
        const empty = values.length - nonEmpty.length;
        const issues: string[] = [];

        if (empty > 0) {
          emptyCount += empty;
          const pct = Math.round((empty / values.length) * 100);
          if (pct > 50) {
            issues.push(`%${pct} bos hucre`);
            anomalies.push({
              column: `${file.name} > ${sheet.name} > ${header}`,
              type: "empty",
              severity: pct > 80 ? "high" : "medium",
              description: `${empty} bos hucre bulundu (%${pct})`,
              affectedRows: [],
            });
          } else if (pct > 20) {
            issues.push(`%${pct} bos hucre`);
          }
        }

        const strVals = nonEmpty.map((v) => String(v));
        const numVals = strVals.map(Number).filter((n) => !isNaN(n));

        if (numVals.length > 0 && numVals.length < strVals.length * 0.8 && numVals.length > 0) {
          issues.push("Karisik veri tipleri (sayı + metin)");
          anomalies.push({
            column: `${file.name} > ${sheet.name} > ${header}`,
            type: "inconsistent_type",
            severity: "medium",
            description: `${numVals.length} sayısal, ${strVals.length - numVals.length} metin değer`,
            affectedRows: [],
          });
        }

        if (numVals.length > 4) {
          const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
          const std = Math.sqrt(
            numVals.reduce((a, b) => a + (b - mean) ** 2, 0) / numVals.length
          );
          if (std > 0) {
            const outliers = numVals.filter((n) => Math.abs(n - mean) > 3 * std);
            if (outliers.length > 0) {
              anomalies.push({
                column: `${file.name} > ${sheet.name} > ${header}`,
                type: "outlier",
                severity: "low",
                description: `${outliers.length} olasilikla hatalı değer (istatistiksel aykırı)`,
                affectedRows: [],
              });
            }
          }
        }

        const uniqueVals = new Set(strVals);
        const dupCount = strVals.length - uniqueVals.size;
        if (dupCount > 0 && strVals.length > 2) {
          duplicateCount += dupCount;
        }

        const qualityScore = Math.max(
          0,
          100 - (empty / Math.max(1, values.length)) * 60 - issues.length * 10
        );
        dataQuality.push({ column: `${sheet.name} > ${header}`, score: Math.round(qualityScore), issues });
      }
    }
  }

  const overallScore =
    dataQuality.length > 0
      ? Math.round(dataQuality.reduce((a, b) => a + b.score, 0) / dataQuality.length)
      : 100;

  const recommendations: string[] = [];
  if (files.some((f) => f.isRecovery)) {
    recommendations.push("Kurtarma dosyalarini orijinal dosyayla karsilastirin — 'Karsilastir' sekmesini kullanin");
  }
  if (duplicateCount > 0) {
    recommendations.push(`${duplicateCount} tekrar eden deger bulundu — birlesimde 'Son Dosyayi Tercih Et' stratejisini deneyin`);
  }
  if (emptyCount > 10) {
    recommendations.push(`${emptyCount} bos hucre var — birlesimde 'Birlesim (Bos Dolum)' stratejisi bos hucrelerinizi doldurabilir`);
  }
  if (anomalies.filter((a) => a.severity === "high").length > 0) {
    recommendations.push("Yuksek oncelikli veri kalite sorunlari tespit edildi — lutfen anomalileri inceleyin");
  }

  return {
    keyColumnSuggestions: [],
    dataQuality: dataQuality.slice(0, 20),
    anomalies: anomalies.slice(0, 15),
    duplicateCount,
    emptyCount,
    overallScore,
    recommendations,
  };
}

export function buildFileContext(files: ExcelFile[]) {
  return {
    files: files.map((file) => ({
      name: file.name,
      isRecovery: file.isRecovery,
      sheets: file.sheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rows.length,
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, 3),
      })),
    })),
  };
}
