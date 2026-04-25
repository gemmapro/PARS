import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Send, Wifi, WifiOff, Brain, Sparkles, RefreshCw, ChevronRight, AlertTriangle, CheckCircle, TrendingUp, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ExcelFile } from "@/lib/excel-merge";
import {
  analyzeOffline,
  buildFileContext,
  getLearnedPatterns,
  suggestKeyColumns,
  type OfflineAnalysis,
  type LearnedPattern,
} from "@/lib/offline-ai";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AiAsistanPageProps {
  files: ExcelFile[];
}

const BASE_URL = import.meta.env.BASE_URL;

async function streamAIResponse(
  url: string,
  body: object,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const resp = await fetch(`${BASE_URL.replace(/\/$/, "")}/api${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    onError("API'ye ulasilamadi. Cevrimdisi mod kullaniliyor.");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) onChunk(data.content);
          if (data.done) onDone();
          if (data.error) onError(data.error);
        } catch {
        }
      }
    }
  }
  onDone();
}

export default function AiAsistanPage({ files }: AiAsistanPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineAnalysis, setOfflineAnalysis] = useState<OfflineAnalysis | null>(null);
  const [learnedPatterns, setLearnedPatterns] = useState<LearnedPattern | null>(null);
  const [keyColumnSuggestions, setKeyColumnSuggestions] = useState<
    Array<{ column: string; confidence: number; reason: string }>
  >([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [tab, setTab] = useState<"chat" | "analiz" | "ogrenilen">("chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<boolean>(false);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    getLearnedPatterns().then(setLearnedPatterns);
  }, []);

  useEffect(() => {
    if (files.length > 0) {
      const allHeaders = files.flatMap((f) => f.sheets.flatMap((s) => s.headers));
      const uniqueHeaders = Array.from(new Set(allHeaders));
      suggestKeyColumns(uniqueHeaders).then(setKeyColumnSuggestions);
    }
  }, [files]);

  const runOfflineAnalysis = useCallback(() => {
    if (files.length === 0) return;
    const result = analyzeOffline(files);
    setOfflineAnalysis(result);
  }, [files]);

  useEffect(() => {
    if (files.length > 0) {
      runOfflineAnalysis();
    }
  }, [files, runOfflineAnalysis]);

  const runAIAnalysis = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    const fileContext = buildFileContext(files);

    if (!isOnline) {
      const offResult = analyzeOffline(files);
      setOfflineAnalysis(offResult);
      const msg = `**Cevrimdisi Analiz Tamamlandi** (AI internet gerektiriyor)\n\n**Veri Kalite Skoru:** ${offResult.overallScore}/100\n\n**Oneriler:**\n${offResult.recommendations.map((r) => `- ${r}`).join("\n")}`;
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      setTab("analiz");
      setAnalyzing(false);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: "Yuklenen dosyalarimi analiz et ve ayrintili rapor ver.",
      },
    ]);

    let aiText = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setStreaming(true);
    abortRef.current = false;

    try {
      await streamAIResponse(
        "/ai/analyze",
        { fileContext },
        (chunk) => {
          if (abortRef.current) return;
          aiText += chunk;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: aiText };
            return next;
          });
        },
        () => {
          setStreaming(false);
          setAnalyzing(false);
        },
        (err) => {
          const offResult = analyzeOffline(files);
          setOfflineAnalysis(offResult);
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: `**Cevrimdisi analiz:** ${err}\n\nVeri Kalite Skoru: ${offResult.overallScore}/100\n\n${offResult.recommendations.map((r) => `- ${r}`).join("\n")}`,
            };
            return next;
          });
          setStreaming(false);
          setAnalyzing(false);
        }
      );
    } catch {
      const offResult = analyzeOffline(files);
      setOfflineAnalysis(offResult);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: `**Cevrimdisi analiz sonucu:**\n\nVeri Kalite Skoru: ${offResult.overallScore}/100\n\n${offResult.recommendations.map((r) => `- ${r}`).join("\n")}`,
        };
        return next;
      });
      setStreaming(false);
      setAnalyzing(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);

    if (!isOnline) {
      const offResult = analyzeOffline(files);
      const offline = `**Cevrimdisi moddasınız.** Internet baglantisi olmadan tam AI yaniti verilemiyor.\n\nBenim yapabileceklerim:\n- Dosya karsilastir (Karsilastir sekmesi)\n- Veri birlestir (Birlestir sekmesi)\n- Veri ara (Arama sekmesi)\n\nVeri Kalite Skoru: ${offResult.overallScore}/100`;
      setMessages([...newMessages, { role: "assistant", content: offline }]);
      return;
    }

    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setStreaming(true);
    abortRef.current = false;

    const fileContext = files.length > 0 ? buildFileContext(files) : undefined;
    let aiText = "";

    try {
      await streamAIResponse(
        "/ai/chat",
        {
          messages: newMessages,
          fileContext,
        },
        (chunk) => {
          if (abortRef.current) return;
          aiText += chunk;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: aiText };
            return next;
          });
        },
        () => setStreaming(false),
        (err) => {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: `Hata: ${err}` };
            return next;
          });
          setStreaming(false);
        }
      );
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: "Baglantiyi kontrol edin veya tekrar deneyin." };
        return next;
      });
      setStreaming(false);
    }
  };

  const suggestedQuestions = [
    "Bu dosyalarda hangi sutunu anahtar olarak kullanmaliyim?",
    "Veri kalitesi nasil? Sorunlu satirlar var mi?",
    "Kurtarma dosyasi ile orijinal dosya arasindaki farki nasil bulabilirim?",
    "Bu verileri en iyi nasil birlestirebilirim?",
    "Olagandisi veya hatalı gorunen veri var mi?",
  ];

  const renderMarkdown = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n\n/g, "<br/><br/>")
      .replace(/\n- /g, "<br/>• ")
      .replace(/\n/g, "<br/>");
  };

  return (
    <div className="flex flex-col h-full max-h-screen">
      <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-none">AI Asistan</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isOnline ? "Cevrimici — GPT ile guclu analiz" : "Cevrimdisi — yerel analiz modu"}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`ml-2 ${isOnline ? "text-green-600 border-green-400" : "text-yellow-600 border-yellow-400"}`}
          >
            {isOnline ? <><Wifi className="w-3 h-3 mr-1" />Cevrimici</> : <><WifiOff className="w-3 h-3 mr-1" />Cevrimdisi</>}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {(["chat", "analiz", "ogrenilen"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              data-testid={`tab-${t}`}
            >
              {t === "chat" ? "Sohbet" : t === "analiz" ? "Analiz" : "Ogrenilen"}
            </button>
          ))}
        </div>
      </div>

      {tab === "chat" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="max-w-2xl mx-auto mt-8 space-y-4">
                <div className="text-center">
                  <div className="inline-flex p-4 rounded-2xl bg-primary/10 mb-3">
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Excel AI Asistani</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    {files.length > 0
                      ? `${files.length} dosya yuklendi. Analiz veya soru sorun.`
                      : "Once Dosya Yukle sekmesinden Excel dosyasi yukleyin."}
                  </p>
                </div>

                {files.length > 0 && (
                  <Button onClick={runAIAnalysis} disabled={analyzing} className="w-full" data-testid="button-ai-analyze">
                    {analyzing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Analiz yapiliyor...
                      </>
                    ) : (
                      <>
                        <Brain className="w-4 h-4 mr-2" />
                        Dosyalarimi AI ile Analiz Et
                      </>
                    )}
                  </Button>
                )}

                {files.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Hizli Sorular
                    </p>
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => setInput(q)}
                        className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/20 transition-colors text-sm text-foreground flex items-center gap-2"
                        data-testid={`suggested-question-${i}`}
                      >
                        <ChevronRight className="w-4 h-4 text-primary shrink-0" />
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-card-border text-foreground"
                  }`}
                  data-testid={`message-${i}`}
                >
                  {msg.role === "assistant" ? (
                    <>
                      {msg.content === "" && streaming ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-xs">Dusunuyor...</span>
                        </div>
                      ) : (
                        <div
                          className="prose prose-sm max-w-none dark:prose-invert"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      )}
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="p-4 border-t border-border bg-card/30 shrink-0">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={
                  files.length === 0
                    ? "Once dosya yukleyin..."
                    : "Bir soru sorun veya analiz isteyin... (Enter gonder)"
                }
                disabled={files.length === 0 || streaming}
                className="min-h-[60px] max-h-32 resize-none"
                data-testid="input-ai-message"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || streaming || files.length === 0}
                size="icon"
                className="h-auto shrink-0"
                data-testid="button-send"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              {isOnline
                ? "Dosyalariniz AI'ya gonderilmez — sadece sutun adlari ve ornek degerler kullanilir"
                : "Cevrimdisi: Yerel analiz aktif, sohbet AI internet gerektirir"}
            </p>
          </div>
        </div>
      )}

      {tab === "analiz" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto w-full">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Yerel AI Analizi</h2>
            <Button variant="outline" size="sm" onClick={runOfflineAnalysis} data-testid="button-refresh-analysis">
              <RefreshCw className="w-4 h-4 mr-1" />
              Yenile
            </Button>
          </div>

          {files.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>Analiz icin dosya yukleyin</p>
            </div>
          ) : offlineAnalysis ? (
            <>
              <div className={`p-5 rounded-xl border text-center ${
                offlineAnalysis.overallScore >= 80 ? "bg-green-50 dark:bg-green-900/20 border-green-200" :
                offlineAnalysis.overallScore >= 60 ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200" :
                "bg-red-50 dark:bg-red-900/20 border-red-200"
              }`}>
                <div className={`text-4xl font-bold ${
                  offlineAnalysis.overallScore >= 80 ? "text-green-600" :
                  offlineAnalysis.overallScore >= 60 ? "text-yellow-600" : "text-red-600"
                }`}>
                  {offlineAnalysis.overallScore}/100
                </div>
                <p className="text-sm text-muted-foreground mt-1">Genel Veri Kalite Skoru</p>
                <div className="flex justify-center gap-4 mt-3 text-sm">
                  <span className="text-red-600"><AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{offlineAnalysis.emptyCount} bos hucre</span>
                  <span className="text-yellow-600"><TrendingUp className="w-3.5 h-3.5 inline mr-1" />{offlineAnalysis.duplicateCount} tekrar</span>
                  <span className="text-orange-600">{offlineAnalysis.anomalies.length} anomali</span>
                </div>
              </div>

              {offlineAnalysis.recommendations.length > 0 && (
                <Card className="border border-card-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-yellow-500" />
                      AI Onerileri
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {offlineAnalysis.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {keyColumnSuggestions.length > 0 && (
                <Card className="border border-card-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Anahtar Sutun Onerileri (AI)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {keyColumnSuggestions.map((s, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                        <div>
                          <span className="font-medium text-sm text-foreground">{s.column}</span>
                          <p className="text-xs text-muted-foreground">{s.reason}</p>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${s.confidence >= 70 ? "text-green-600" : s.confidence >= 40 ? "text-yellow-600" : "text-muted-foreground"}`}>
                            %{s.confidence}
                          </div>
                          <div className="text-xs text-muted-foreground">guven</div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {offlineAnalysis.anomalies.length > 0 && (
                <Card className="border border-card-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Tespit Edilen Anomaliler</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {offlineAnalysis.anomalies.map((anomaly, i) => (
                      <div key={i} className={`p-3 rounded-lg border text-sm ${
                        anomaly.severity === "high" ? "bg-red-50 dark:bg-red-900/20 border-red-200" :
                        anomaly.severity === "medium" ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200" :
                        "bg-blue-50 dark:bg-blue-900/20 border-blue-200"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={`text-xs ${
                            anomaly.severity === "high" ? "text-red-600 border-red-400" :
                            anomaly.severity === "medium" ? "text-yellow-600 border-yellow-400" :
                            "text-blue-600 border-blue-400"
                          }`}>
                            {anomaly.severity === "high" ? "Yuksek" : anomaly.severity === "medium" ? "Orta" : "Dusuk"}
                          </Badge>
                          <span className="font-medium text-foreground">{anomaly.column}</span>
                        </div>
                        <p className="text-muted-foreground">{anomaly.description}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <Button onClick={runOfflineAnalysis}>Analizi Baslat</Button>
            </div>
          )}
        </div>
      )}

      {tab === "ogrenilen" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Ogrenilen Kaliplar</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Sistem, sizin tercihlerinizden ogrenerek zamanla daha iyi oneriler sunmaktadir.
            Veriler cihazinizda saklanir, hicbir yere gonderilmez.
          </p>

          {learnedPatterns ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-card border border-card-border text-center">
                  <div className="text-2xl font-bold text-primary">{learnedPatterns.totalAnalyses}</div>
                  <div className="text-xs text-muted-foreground mt-1">Toplam Analiz</div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-card-border text-center">
                  <div className="text-2xl font-bold text-primary">
                    {Object.keys(learnedPatterns.keyColumnPreferences).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Ogrenilen Sutun</div>
                </div>
                <div className="p-4 rounded-xl bg-card border border-card-border text-center">
                  <div className="text-2xl font-bold text-primary">
                    {learnedPatterns.analysisHistory.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Gecmis Kayit</div>
                </div>
              </div>

              {Object.keys(learnedPatterns.keyColumnPreferences).length > 0 && (
                <Card className="border border-card-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Tercih Edilen Anahtar Sutunlar</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Object.entries(learnedPatterns.keyColumnPreferences)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([col, count]) => (
                        <div key={col} className="flex items-center justify-between">
                          <span className="text-sm text-foreground">{col}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{
                                  width: `${Math.min(100, (count / Math.max(...Object.values(learnedPatterns.keyColumnPreferences))) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">{count}x</span>
                          </div>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}

              {learnedPatterns.analysisHistory.length > 0 && (
                <Card className="border border-card-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Son Islemler</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {learnedPatterns.analysisHistory
                      .slice(-8)
                      .reverse()
                      .map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                          <div>
                            <span className="text-foreground font-medium">{entry.keyColumnChosen || "—"}</span>
                            <span className="text-muted-foreground ml-2">({entry.strategy})</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleDateString("tr-TR")}
                          </span>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}

              {learnedPatterns.totalAnalyses === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Brain className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Henuz ogrenilmis kalip yok.</p>
                  <p className="text-xs mt-1">Dosya birlestirme veya AI analiz yaptikca sistem ogrenmeye baslar.</p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

