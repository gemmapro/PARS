import * as XLSX from "xlsx";

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
  rawRows: (string | number | boolean | null)[][];
}

export interface ExcelFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: Date;
  sheets: SheetData[];
  isRecovery: boolean;
  fileType: "excel" | "csv" | "json" | "xml";
}

export interface DiffRow {
  rowIndex: number;
  status: "added" | "removed" | "modified" | "unchanged";
  oldValues?: Record<string, string | number | boolean | null>;
  newValues?: Record<string, string | number | boolean | null>;
  changedCells?: string[];
}

export interface SheetDiff {
  sheetName: string;
  rows: DiffRow[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}

export interface FileDiff {
  fileA: ExcelFile;
  fileB: ExcelFile;
  sheets: SheetDiff[];
}

export interface SearchResult {
  fileId: string;
  fileName: string;
  sheetName: string;
  rowIndex: number;
  colName: string;
  value: string | number | boolean | null;
  matchType: "exact" | "contains" | "regex" | "wildcard";
}

export type JoinType = "inner" | "left" | "right" | "fullOuter" | "verticalUnion";

export interface CleanOptions {
  trimWhitespace: boolean;
  deduplicateRows: boolean;
  fillNullsWithEmpty: boolean;
  standardizeCase: "none" | "upper" | "lower" | "title";
  standardizeDates: boolean;
}

export interface MergeOptions {
  keyColumn: string;
  strategy: "latest" | "first" | "union" | "intersection";
  joinType: JoinType;
  sheets: string[];
  fuzzyMatch: boolean;
  fuzzyThreshold: number;
  cleanOptions: CleanOptions;
}

export interface MergeReport {
  totalInputRows: number;
  matchedRows: number;
  unmatchedFromA: number;
  unmatchedFromB: number;
  totalOutputRows: number;
  duplicatesRemoved: number;
  nullsFilled: number;
  fuzzyMatchCount: number;
  columnConflicts: Array<{ column: string; conflictCount: number }>;
  skippedRows: number;
}

export interface MergeResult {
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
  sourceInfo: Record<number, { fileId: string; fileName: string; sheetName: string }>;
  report: MergeReport;
}

export interface CleanResult {
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
  originalCount: number;
  cleanedCount: number;
  duplicatesRemoved: number;
  nullsFilled: number;
  trimmedCells: number;
}

export function detectRecoveryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.includes("kurtarma") ||
    lower.includes("recovery") ||
    lower.includes("autosave") ||
    lower.includes("~$") ||
    lower.startsWith("~") ||
    /\(\d+\)\.(xlsx|xls|xlsm|csv|json|xml)$/.test(lower) ||
    lower.includes("_backup") ||
    lower.includes("_bak") ||
    lower.includes("kopya") ||
    lower.includes("copy")
  );
}

export async function parseExcelFile(file: File): Promise<ExcelFile> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

  if (ext === ".csv") return parseCsvFile(file);
  if (ext === ".json") return parseJsonFile(file);
  if (ext === ".xml") return parseXmlFile(file);

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheets: SheetData[] = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
      worksheet,
      { header: 1, defval: null, blankrows: true }
    );

    if (rawData.length === 0) {
      return { name: sheetName, headers: [], rows: [], rawRows: [] };
    }

    const headerRow = rawData[0] as (string | number | boolean | null)[];
    const headers = headerRow.map((h, i) =>
      h != null ? String(h) : `Sütun ${i + 1}`
    );

    const rows = rawData.slice(1).map((rawRow) => {
      const arr = rawRow as (string | number | boolean | null | Date)[];
      const obj: Record<string, string | number | boolean | null> = {};
      headers.forEach((header, i) => {
        const val = arr[i] ?? null;
        obj[header] = val instanceof Date ? val.toLocaleDateString("tr-TR") : (val as string | number | boolean | null);
      });
      return obj;
    });

    const rawRows = rawData.slice(1) as (string | number | boolean | null)[][];
    return { name: sheetName, headers, rows, rawRows };
  });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    uploadedAt: new Date(),
    sheets,
    isRecovery: detectRecoveryFile(file.name),
    fileType: "excel",
  };
}

export async function parseCsvFile(file: File): Promise<ExcelFile> {
  const text = await file.text();
  const workbook = XLSX.read(text, { type: "string" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    worksheet,
    { header: 1, defval: null }
  );

  const headers =
    rawData.length > 0
      ? (rawData[0] as (string | number | boolean | null)[]).map((h, i) =>
          h != null ? String(h) : `Sütun ${i + 1}`
        )
      : [];

  const rows = rawData.slice(1).map((rawRow) => {
    const arr = rawRow as (string | number | boolean | null)[];
    const obj: Record<string, string | number | boolean | null> = {};
    headers.forEach((header, i) => {
      obj[header] = arr[i] ?? null;
    });
    return obj;
  });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    uploadedAt: new Date(),
    sheets: [{ name: "Sayfa1", headers, rows, rawRows: rawData.slice(1) as (string | number | boolean | null)[][] }],
    isRecovery: detectRecoveryFile(file.name),
    fileType: "csv",
  };
}

export async function parseJsonFile(file: File): Promise<ExcelFile> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Geçersiz JSON dosyası");
  }

  const arr: Record<string, unknown>[] = Array.isArray(data) ? data as Record<string, unknown>[] : [data as Record<string, unknown>];
  const headers = arr.length > 0 ? Object.keys(arr[0]) : [];
  const rows: Record<string, string | number | boolean | null>[] = arr.map((item) => {
    const row: Record<string, string | number | boolean | null> = {};
    headers.forEach((h) => {
      const v = item[h];
      if (v == null) row[h] = null;
      else if (typeof v === "object") row[h] = JSON.stringify(v);
      else row[h] = v as string | number | boolean;
    });
    return row;
  });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    uploadedAt: new Date(),
    sheets: [{ name: "JSON Veri", headers, rows, rawRows: [] }],
    isRecovery: detectRecoveryFile(file.name),
    fileType: "json",
  };
}

export async function parseXmlFile(file: File): Promise<ExcelFile> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Geçersiz XML dosyası");

  const root = doc.documentElement;
  const children = Array.from(root.children);

  if (children.length === 0) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      uploadedAt: new Date(),
      sheets: [{ name: "XML Veri", headers: [], rows: [], rawRows: [] }],
      isRecovery: detectRecoveryFile(file.name),
      fileType: "xml",
    };
  }

  const headerSet = new Set<string>();
  children.forEach((child) => {
    Array.from(child.children).forEach((el) => headerSet.add(el.tagName));
    Array.from(child.attributes).forEach((attr) => headerSet.add(`@${attr.name}`));
  });
  const headers = Array.from(headerSet);

  const rows: Record<string, string | number | boolean | null>[] = children.map((child) => {
    const row: Record<string, string | number | boolean | null> = {};
    headers.forEach((h) => {
      if (h.startsWith("@")) {
        row[h] = child.getAttribute(h.slice(1)) ?? null;
      } else {
        const el = child.querySelector(h);
        row[h] = el ? el.textContent : null;
      }
    });
    return row;
  });

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    uploadedAt: new Date(),
    sheets: [{ name: "XML Veri", headers, rows, rawRows: [] }],
    isRecovery: detectRecoveryFile(file.name),
    fileType: "xml",
  };
}

function cellToString(val: string | number | boolean | null): string {
  if (val == null) return "";
  return String(val).trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function fuzzyMatch(a: string, b: string, threshold: number): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return true;
  const dist = levenshtein(al, bl);
  const similarity = 1 - dist / maxLen;
  return similarity >= threshold;
}

function applyCleanOptions(
  rows: Record<string, string | number | boolean | null>[],
  headers: string[],
  opts: CleanOptions
): { rows: Record<string, string | number | boolean | null>[]; nullsFilled: number; trimmedCells: number; duplicatesRemoved: number } {
  let nullsFilled = 0;
  let trimmedCells = 0;
  let duplicatesRemoved = 0;

  let result = rows.map((row) => {
    const newRow: Record<string, string | number | boolean | null> = {};
    for (const h of headers) {
      let val = row[h];

      if (opts.fillNullsWithEmpty && val == null) {
        val = "";
        nullsFilled++;
      }

      if (typeof val === "string") {
        if (opts.trimWhitespace) {
          const trimmed = val.trim();
          if (trimmed !== val) trimmedCells++;
          val = trimmed;
        }
        if (opts.standardizeCase !== "none") {
          if (opts.standardizeCase === "upper") val = val.toUpperCase();
          else if (opts.standardizeCase === "lower") val = val.toLowerCase();
          else if (opts.standardizeCase === "title") {
            val = val.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
          }
        }
      }

      newRow[h] = val;
    }
    return newRow;
  });

  if (opts.deduplicateRows) {
    const seen = new Set<string>();
    const deduped: typeof result = [];
    for (const row of result) {
      const key = JSON.stringify(headers.map((h) => row[h]));
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(row);
      } else {
        duplicatesRemoved++;
      }
    }
    result = deduped;
  }

  return { rows: result, nullsFilled, trimmedCells, duplicatesRemoved };
}

export function cleanSheetData(sheet: SheetData, opts: CleanOptions): CleanResult {
  const originalCount = sheet.rows.length;
  const { rows, nullsFilled, trimmedCells, duplicatesRemoved } = applyCleanOptions(
    sheet.rows,
    sheet.headers,
    opts
  );
  return {
    headers: sheet.headers,
    rows,
    originalCount,
    cleanedCount: rows.length,
    duplicatesRemoved,
    nullsFilled,
    trimmedCells,
  };
}

export function diffSheets(
  sheetA: SheetData,
  sheetB: SheetData,
  keyColumn?: string
): SheetDiff {
  const headers = Array.from(new Set([...sheetA.headers, ...sheetB.headers]));
  const result: DiffRow[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;

  if (keyColumn && sheetA.headers.includes(keyColumn) && sheetB.headers.includes(keyColumn)) {
    const mapA = new Map<string, Record<string, string | number | boolean | null>>();
    const mapB = new Map<string, Record<string, string | number | boolean | null>>();

    sheetA.rows.forEach((row, i) => {
      const key = cellToString(row[keyColumn]) || `__row_${i}`;
      mapA.set(key, row);
    });
    sheetB.rows.forEach((row, i) => {
      const key = cellToString(row[keyColumn]) || `__row_${i}`;
      mapB.set(key, row);
    });

    let rowIndex = 0;
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    allKeys.forEach((key) => {
      const rowA = mapA.get(key);
      const rowB = mapB.get(key);

      if (rowA && !rowB) {
        result.push({ rowIndex: rowIndex++, status: "removed", oldValues: rowA });
        removedCount++;
      } else if (!rowA && rowB) {
        result.push({ rowIndex: rowIndex++, status: "added", newValues: rowB });
        addedCount++;
      } else if (rowA && rowB) {
        const changedCells: string[] = [];
        headers.forEach((h) => {
          if (cellToString(rowA[h]) !== cellToString(rowB[h])) changedCells.push(h);
        });
        if (changedCells.length > 0) {
          result.push({ rowIndex: rowIndex++, status: "modified", oldValues: rowA, newValues: rowB, changedCells });
          modifiedCount++;
        } else {
          result.push({ rowIndex: rowIndex++, status: "unchanged", oldValues: rowA, newValues: rowB });
          unchangedCount++;
        }
      }
    });
  } else {
    const maxLen = Math.max(sheetA.rows.length, sheetB.rows.length);
    for (let i = 0; i < maxLen; i++) {
      const rowA = sheetA.rows[i];
      const rowB = sheetB.rows[i];
      if (rowA && !rowB) {
        result.push({ rowIndex: i, status: "removed", oldValues: rowA });
        removedCount++;
      } else if (!rowA && rowB) {
        result.push({ rowIndex: i, status: "added", newValues: rowB });
        addedCount++;
      } else if (rowA && rowB) {
        const changedCells: string[] = [];
        headers.forEach((h) => {
          if (cellToString(rowA[h]) !== cellToString(rowB[h])) changedCells.push(h);
        });
        if (changedCells.length > 0) {
          result.push({ rowIndex: i, status: "modified", oldValues: rowA, newValues: rowB, changedCells });
          modifiedCount++;
        } else {
          result.push({ rowIndex: i, status: "unchanged", oldValues: rowA, newValues: rowB });
          unchangedCount++;
        }
      }
    }
  }

  return { sheetName: sheetB.name, rows: result, addedCount, removedCount, modifiedCount, unchangedCount };
}

export function searchAcrossFiles(
  files: ExcelFile[],
  query: string,
  matchType: "exact" | "contains" | "regex" | "wildcard",
  sheetsFilter?: string[]
): SearchResult[] {
  const results: SearchResult[] = [];
  if (!query.trim()) return results;

  let regex: RegExp | null = null;
  if (matchType === "regex") {
    try { regex = new RegExp(query, "i"); } catch { return results; }
  } else if (matchType === "wildcard") {
    const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    regex = new RegExp(`^${escaped}$`, "i");
  }

  const matchValue = (val: string | number | boolean | null): boolean => {
    const str = cellToString(val);
    if (!str) return false;
    switch (matchType) {
      case "exact": return str.toLowerCase() === query.toLowerCase();
      case "contains": return str.toLowerCase().includes(query.toLowerCase());
      case "regex":
      case "wildcard": return regex?.test(str) ?? false;
    }
  };

  files.forEach((file) => {
    file.sheets.forEach((sheet) => {
      if (sheetsFilter && sheetsFilter.length > 0 && !sheetsFilter.includes(sheet.name)) return;
      sheet.rows.forEach((row, rowIndex) => {
        sheet.headers.forEach((col) => {
          if (matchValue(row[col])) {
            results.push({ fileId: file.id, fileName: file.name, sheetName: sheet.name, rowIndex, colName: col, value: row[col], matchType });
          }
        });
      });
    });
  });

  return results;
}

export function mergeFiles(files: ExcelFile[], options: MergeOptions): MergeResult {
  const {
    keyColumn,
    strategy,
    joinType,
    sheets,
    fuzzyMatch: useFuzzy,
    fuzzyThreshold,
    cleanOptions,
  } = options;

  const report: MergeReport = {
    totalInputRows: 0,
    matchedRows: 0,
    unmatchedFromA: 0,
    unmatchedFromB: 0,
    totalOutputRows: 0,
    duplicatesRemoved: 0,
    nullsFilled: 0,
    fuzzyMatchCount: 0,
    columnConflicts: [],
    skippedRows: 0,
  };

  const allSheets: { sheet: SheetData; file: ExcelFile }[] = [];

  files.forEach((file) => {
    file.sheets.forEach((sheet) => {
      if (sheets.length === 0 || sheets.includes(sheet.name)) {
        allSheets.push({ sheet, file });
        report.totalInputRows += sheet.rows.length;
      }
    });
  });

  if (allSheets.length === 0) {
    return { headers: [], rows: [], sourceInfo: {}, report };
  }

  const allHeaders = Array.from(new Set(allSheets.flatMap(({ sheet }) => sheet.headers)));

  if (joinType === "verticalUnion") {
    const rows: Record<string, string | number | boolean | null>[] = [];
    const sourceInfo: Record<number, { fileId: string; fileName: string; sheetName: string }> = {};
    allSheets.forEach(({ sheet, file }) => {
      sheet.rows.forEach((row) => {
        const idx = rows.length;
        rows.push(row);
        sourceInfo[idx] = { fileId: file.id, fileName: file.name, sheetName: sheet.name };
      });
    });

    const cleanResult = applyCleanOptions(rows, allHeaders, cleanOptions);
    report.duplicatesRemoved = cleanResult.duplicatesRemoved;
    report.nullsFilled = cleanResult.nullsFilled;
    report.totalOutputRows = cleanResult.rows.length;

    const newSourceInfo: typeof sourceInfo = {};
    cleanResult.rows.forEach((_, i) => { newSourceInfo[i] = sourceInfo[i]; });

    return { headers: allHeaders, rows: cleanResult.rows, sourceInfo: newSourceInfo, report };
  }

  if (!keyColumn || !allSheets[0].sheet.headers.includes(keyColumn)) {
    const rows: Record<string, string | number | boolean | null>[] = [];
    const sourceInfo: Record<number, { fileId: string; fileName: string; sheetName: string }> = {};
    allSheets.forEach(({ sheet, file }) => {
      sheet.rows.forEach((row) => {
        const idx = rows.length;
        rows.push(row);
        sourceInfo[idx] = { fileId: file.id, fileName: file.name, sheetName: sheet.name };
      });
    });
    report.totalOutputRows = rows.length;
    return { headers: allHeaders, rows, sourceInfo, report };
  }

  type MapEntry = {
    row: Record<string, string | number | boolean | null>;
    source: { fileId: string; fileName: string; sheetName: string };
    fileIndex: number;
    originalKey: string;
  };

  const keyMapA = new Map<string, MapEntry>();
  const keyMapB = new Map<string, MapEntry>();

  const fileA = allSheets[0];
  const filesB = allSheets.slice(1);

  fileA.sheet.rows.forEach((row) => {
    const key = cellToString(row[keyColumn]);
    if (!key) return;
    keyMapA.set(key, {
      row: { ...row },
      source: { fileId: fileA.file.id, fileName: fileA.file.name, sheetName: fileA.sheet.name },
      fileIndex: 0,
      originalKey: key,
    });
  });

  filesB.forEach(({ sheet, file }, bIdx) => {
    sheet.rows.forEach((row) => {
      const key = cellToString(row[keyColumn]);
      if (!key) return;
      keyMapB.set(key, {
        row: { ...row },
        source: { fileId: file.id, fileName: file.name, sheetName: sheet.name },
        fileIndex: bIdx + 1,
        originalKey: key,
      });
    });
  });

  const lookupB = (keyA: string): MapEntry | undefined => {
    if (keyMapB.has(keyA)) return keyMapB.get(keyA);
    if (useFuzzy) {
      for (const [keyB, entry] of keyMapB) {
        if (fuzzyMatch(keyA, keyB, fuzzyThreshold)) {
          report.fuzzyMatchCount++;
          return entry;
        }
      }
    }
    return undefined;
  };

  const rows: Record<string, string | number | boolean | null>[] = [];
  const sourceInfo: Record<number, { fileId: string; fileName: string; sheetName: string }> = {};
  const matchedBKeys = new Set<string>();

  keyMapA.forEach((entryA, keyA) => {
    const entryB = lookupB(keyA);

    if (entryB) {
      matchedBKeys.add(entryB.originalKey);
      report.matchedRows++;

      let merged: Record<string, string | number | boolean | null>;
      if (strategy === "latest") {
        merged = { ...entryA.row, ...entryB.row };
      } else if (strategy === "first") {
        merged = { ...entryB.row, ...entryA.row };
      } else if (strategy === "union") {
        merged = { ...entryA.row };
        Object.entries(entryB.row).forEach(([k, v]) => {
          if (merged[k] == null || merged[k] === "") merged[k] = v;
        });
      } else {
        merged = { ...entryA.row };
      }

      const idx = rows.length;
      rows.push(merged);
      sourceInfo[idx] = entryA.source;
    } else {
      if (joinType === "left" || joinType === "fullOuter") {
        report.unmatchedFromA++;
        const idx = rows.length;
        rows.push({ ...entryA.row });
        sourceInfo[idx] = entryA.source;
      } else {
        report.skippedRows++;
      }
    }
  });

  if (joinType === "right" || joinType === "fullOuter") {
    keyMapB.forEach((entryB, keyB) => {
      if (!matchedBKeys.has(keyB)) {
        report.unmatchedFromB++;

        if (joinType === "right") {
          const idx = rows.length;
          rows.push({ ...entryB.row });
          sourceInfo[idx] = entryB.source;
        } else {
          const idx = rows.length;
          rows.push({ ...entryB.row });
          sourceInfo[idx] = entryB.source;
        }
      }
    });
  }

  if (joinType === "right") {
    const newRows: typeof rows = [];
    const newSourceInfo: typeof sourceInfo = {};
    keyMapB.forEach((entryB) => {
      const entryA = keyMapA.get(entryB.originalKey);
      if (entryA) {
        let merged: Record<string, string | number | boolean | null>;
        if (strategy === "latest") merged = { ...entryA.row, ...entryB.row };
        else if (strategy === "first") merged = { ...entryB.row, ...entryA.row };
        else if (strategy === "union") {
          merged = { ...entryA.row };
          Object.entries(entryB.row).forEach(([k, v]) => {
            if (merged[k] == null || merged[k] === "") merged[k] = v;
          });
        } else merged = { ...entryA.row };
        const idx = newRows.length;
        newRows.push(merged);
        newSourceInfo[idx] = entryA.source;
      } else {
        const idx = newRows.length;
        newRows.push({ ...entryB.row });
        newSourceInfo[idx] = entryB.source;
      }
    });
    const cleanResult = applyCleanOptions(newRows, allHeaders, cleanOptions);
    report.duplicatesRemoved = cleanResult.duplicatesRemoved;
    report.nullsFilled = cleanResult.nullsFilled;
    report.totalOutputRows = cleanResult.rows.length;
    return { headers: allHeaders, rows: cleanResult.rows, sourceInfo: newSourceInfo, report };
  }

  const cleanResult = applyCleanOptions(rows, allHeaders, cleanOptions);
  report.duplicatesRemoved = cleanResult.duplicatesRemoved;
  report.nullsFilled = cleanResult.nullsFilled;
  report.totalOutputRows = cleanResult.rows.length;

  return { headers: allHeaders, rows: cleanResult.rows, sourceInfo, report };
}

export function exportToExcel(
  headers: string[],
  rows: Record<string, string | number | boolean | null>[],
  fileName: string,
  sheetName = "Birleştirilmiş Veri"
): void {
  const data = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

export function exportReportToExcel(report: MergeReport, fileName: string): void {
  const rows = [
    ["Metrik", "Deger"],
    ["Toplam Girdi Satir", report.totalInputRows],
    ["Eslesen Satir", report.matchedRows],
    ["A Dosyasinda Eslesmeyen", report.unmatchedFromA],
    ["B Dosyasinda Eslesmeyen", report.unmatchedFromB],
    ["Toplam Cikti Satir", report.totalOutputRows],
    ["Kaldirilan Tekrar", report.duplicatesRemoved],
    ["Doldurulan Bos Hucre", report.nullsFilled],
    ["Bulank Eslestirme Sayisi", report.fuzzyMatchCount],
    ["Atlanan Satir", report.skippedRows],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Birlestirme Raporu");
  XLSX.writeFile(wb, fileName);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
