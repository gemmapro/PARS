import { useState, useMemo } from "react";
import { Search, FileSpreadsheet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ExcelFile, searchAcrossFiles, type SearchResult } from "@/lib/excel-merge";

interface SearchPageProps {
  files: ExcelFile[];
}

type MatchType = "contains" | "exact" | "wildcard" | "regex";

const matchTypeLabels: Record<MatchType, { label: string; hint: string }> = {
  contains: { label: "Icerir", hint: "Aramak istediginiz kelimeyi girin" },
  exact: { label: "Tam Eslesme", hint: "Hucrede tam olarak bu deger olmali" },
  wildcard: { label: "Joker Karakter (*?)", hint: 'ornek: "Ahmet*" veya "1234?"' },
  regex: { label: "Regex (Ileri)", hint: 'ornek: "^1[0-9]{3}" veya "ahmet|mehmet"' },
};

export default function SearchPage({ files }: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const handleSearch = () => {
    if (!query.trim()) return;
    const filesToSearch = selectedFiles.length > 0
      ? files.filter((f) => selectedFiles.includes(f.id))
      : files;
    const r = searchAcrossFiles(filesToSearch, query, matchType);
    setResults(r);
    setHasSearched(true);
    setExpandedRows(new Set());
  };

  const toggleRow = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const groupedResults = useMemo(() => {
    const groups: Record<string, Record<string, SearchResult[]>> = {};
    results.forEach((r) => {
      if (!groups[r.fileId]) groups[r.fileId] = {};
      if (!groups[r.fileId][r.sheetName]) groups[r.fileId][r.sheetName] = [];
      groups[r.fileId][r.sheetName].push(r);
    });
    return groups;
  }, [results]);

  if (files.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Arama icin dosya gerekli</h2>
          <p className="text-muted-foreground">Lutfen once Dosya Yukle sayfasindan Excel dosyalari yukleyin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Gelismis Arama</h1>
        <p className="text-muted-foreground mt-1">
          Tum dosyalarda ve sayfalarda ayni anda arama yapin. Joker karakter ve regex desteklenir.
        </p>
      </div>

      <Card className="border border-card-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                placeholder={matchTypeLabels[matchType].hint}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                data-testid="input-search"
                className="h-10"
              />
            </div>
            <Select value={matchType} onValueChange={(v) => setMatchType(v as MatchType)}>
              <SelectTrigger className="w-48" data-testid="select-match-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(matchTypeLabels) as [MatchType, { label: string; hint: string }][]).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} data-testid="button-search">
              <Search className="w-4 h-4 mr-2" />
              Ara
            </Button>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground mb-2">Dosya Filtresi (bos = hepsi)</p>
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <button
                  key={f.id}
                  data-testid={`button-file-filter-${f.id}`}
                  onClick={() => {
                    setSelectedFiles((prev) =>
                      prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                    );
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedFiles.includes(f.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:border-primary/50"
                  }`}
                >
                  <FileSpreadsheet className="w-3 h-3 inline mr-1" />
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          {matchType === "wildcard" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Joker karakterler: </span>
                <code className="bg-muted px-1 rounded">*</code> = sifir veya daha fazla karakter,{" "}
                <code className="bg-muted px-1 rounded">?</code> = tam olarak 1 karakter
              </div>
            </div>
          )}
          {matchType === "regex" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Regex ornek: </span>
                <code className="bg-muted px-1 rounded">{"^TC[0-9]{1}"}</code> ile TC kimlik numaralarini bulun.
                Buyuk/kucuk harf duyarsizdir.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {hasSearched && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {results.length === 0 ? "Sonuc bulunamadi" : `${results.length.toLocaleString("tr-TR")} sonuc bulundu`}
            </h2>
            {results.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {Object.keys(groupedResults).length} dosyada
              </span>
            )}
          </div>

          {results.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>"{query}" icin sonuc bulunamadi.</p>
              <p className="text-sm mt-1">Farkli bir arama tipi veya joker karakter kullanmayı deneyin.</p>
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(groupedResults).map(([fileId, sheets]) => {
              const file = files.find((f) => f.id === fileId);
              if (!file) return null;
              return (
                <Card key={fileId} className="border border-card-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileSpreadsheet className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-foreground">{file.name}</span>
                      {file.isRecovery && (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">Kurtarma</Badge>
                      )}
                      <Badge variant="secondary" className="ml-auto">
                        {Object.values(sheets).flat().length} eslesme
                      </Badge>
                    </div>

                    {Object.entries(sheets).map(([sheetName, sheetResults]) => (
                      <div key={sheetName} className="mb-4">
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                          {sheetName} sayfasi — {sheetResults.length} eslesme
                        </p>
                        <div className="space-y-1">
                          {sheetResults.map((r, idx) => {
                            const globalIdx = results.indexOf(r);
                            const isExpanded = expandedRows.has(globalIdx);
                            const sheetData = file.sheets.find((s) => s.name === r.sheetName);
                            const rowData = sheetData?.rows[r.rowIndex];

                            return (
                              <div
                                key={idx}
                                className="rounded-lg border border-border overflow-hidden"
                                data-testid={`result-row-${globalIdx}`}
                              >
                                <button
                                  onClick={() => toggleRow(globalIdx)}
                                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                                >
                                  <span className="text-xs text-muted-foreground w-16 shrink-0">
                                    Satir {r.rowIndex + 1}
                                  </span>
                                  <span className="text-xs text-muted-foreground shrink-0">{r.colName}:</span>
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {String(r.value ?? "")}
                                  </span>
                                  <span className="ml-auto text-muted-foreground text-xs">
                                    {isExpanded ? "▲" : "▼"}
                                  </span>
                                </button>

                                {isExpanded && rowData && (
                                  <div className="px-3 pb-3 pt-1 bg-muted/20 border-t border-border">
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                      {Object.entries(rowData).map(([col, val]) => (
                                        <div key={col} className={`p-2 rounded bg-card border ${col === r.colName ? "border-primary/50 bg-accent/30" : "border-border"}`}>
                                          <p className="text-xs text-muted-foreground truncate">{col}</p>
                                          <p className={`text-sm font-medium truncate ${col === r.colName ? "text-primary" : "text-foreground"}`}>
                                            {String(val ?? "—")}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

