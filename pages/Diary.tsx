// Diary.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { EMOTION_OPTIONS, REASON_OPTIONS } from "../constants";
import { generateDiaryFeedback } from "../services/geminiService";
import { getYFinanceQuotes } from "../services/stockService";
import {
  BookHeart,
  X,
  SmilePlus,
  Frown,
  Meh,
  LineChart,
  Newspaper,
  MessageCircle,
  Zap,
  Sparkles,
  Loader2,
  Filter,
  Tag,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";

const QUOTE_CACHE_KEY = "finguide_live_quotes_v1";

function isKoreanStock(symbol: string) {
  return symbol.endsWith(".KS") || symbol.endsWith(".KQ");
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function formatPrice(price: number, symbol: string) {
  if (!Number.isFinite(price)) return "-";
  if (isKoreanStock(symbol)) return `₩${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function parseRetrySeconds(msg: string): number | null {
  const m1 = msg.match(/retry in\s+(\d+)s/i);
  if (m1?.[1]) return Number(m1[1]);

  const m2 = msg.match(/retry in\s+([0-9.]+)s/i);
  if (m2?.[1]) {
    const sec = Number(m2[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec);
  }
  return null;
}

function formatRecheckLabel(recheckPct?: number) {
  if (typeof recheckPct !== "number" || !Number.isFinite(recheckPct)) return "";
  const sign = recheckPct > 0 ? "+" : "";
  return `Recheck at ${sign}${recheckPct}% move`;
}

function getEmotionLabel(val: string) {
  return EMOTION_OPTIONS.find((o: any) => o.value === val)?.label || val;
}
function getReasonLabel(val: string) {
  return REASON_OPTIONS.find((o: any) => o.value === val)?.label || val;
}
function getEmotionColor(val: string) {
  return EMOTION_OPTIONS.find((o: any) => o.value === val)?.color || "bg-gray-100 text-gray-800";
}

function getEmotionIcon(emotion: string) {
  switch (emotion) {
    case "confident":
      return <SmilePlus className="text-blue-500" size={16} />;
    case "excited":
      return <SmilePlus className="text-green-500" size={16} />;
    case "anxious":
      return <Frown className="text-yellow-500" size={16} />;
    case "regretful":
      return <Frown className="text-red-500" size={16} />;
    default:
      return <Meh className="text-gray-500" size={16} />;
  }
}

function getReasonIcon(reason: string) {
  switch (reason) {
    case "news":
      return <Newspaper size={16} />;
    case "analysis":
      return <LineChart size={16} />;
    case "recommendation":
      return <MessageCircle size={16} />;
    case "impulse":
      return <Zap size={16} />;
    default:
      return <LineChart size={16} />;
  }
}

/** 작은 Tooltip (hover/focus) */
const Tooltip: React.FC<{
  text: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  /** ✅ inputs/textarea 같은 "w-full" 요소 감쌀 때: "block w-full" 넣어주면 좌측 쏠림 방지 */
  wrapperClassName?: string;
}> = ({ text, children, side = "top", wrapperClassName = "" }) => {
  const pos =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : "top-full mt-2 left-1/2 -translate-x-1/2";

  const arrow =
    side === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-l-transparent border-r-transparent border-b-transparent"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-l-transparent border-r-transparent border-t-transparent";

  return (
    <span className={`relative inline-flex group outline-none ${wrapperClassName}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${pos} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150`}
      >
        <span className="relative inline-block max-w-[280px] whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg">
          {text}
          <span className={`pointer-events-none absolute ${arrow} border-[6px]`} />
        </span>
      </span>
    </span>
  );
};

/** ✅ Chip 그룹 컨테이너 (Trade / Plan / Performance) */
const ChipGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 ${className}`}>
      {children}
    </div>
  );
};

/**
 * Normalize model output into a single display string:
 * 1) 요약
 * 2) 규칙·인지편향 체크
 * 3) 다음 기록 질문 1개
 */
function normalizeFeedbackToText(raw: any): string {
  if (!raw) return "";

  if (typeof raw === "string") {
    const trimmed = raw.trim();

    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeFeedbackToText(parsed);
      } catch {
        // fallthrough
      }
    }

    return [
      "요약",
      trimmed,
      "",
      "규칙·인지편향 체크",
      "- (체크 결과를 구조화하지 못했어요) 위 내용을 보고, ‘근거/리스크/재평가 조건’이 빠졌는지 점검해보세요.",
      "",
      "다음 기록 질문(1개)",
      "이번 결정에서 가장 약한 가정 1개는 무엇이었나요?",
    ].join("\n");
  }

  const obj = raw as any;

  const oneLine = obj.oneLineSummary || obj.summary || obj.one_line_summary || obj.oneLine || "";

  const factArr: string[] = Array.isArray(obj.fact) ? obj.fact : [];
  const interpArr: string[] = Array.isArray(obj.interpretation) ? obj.interpretation : [];
  const actionArr: string[] = Array.isArray(obj.actionTaken) ? obj.actionTaken : [];

  const missingPieces: string[] = Array.isArray(obj.missingPieces) ? obj.missingPieces : [];

  const biasChecklist: Array<{ name?: string; evidenceSpan?: string }> = Array.isArray(obj.biasChecklist)
    ? obj.biasChecklist
    : [];

  const question: string =
    obj.oneQuestion || obj.nextQuestion || obj.one_question || "이번 결정에서 가장 약한 가정 1개는 무엇이었나요?";

  const summaryLines: string[] = [];
  if (oneLine) summaryLines.push(`- ${oneLine}`);
  if (factArr.length) summaryLines.push(`- 사실(FACT): ${factArr.join(" / ")}`);
  if (interpArr.length) summaryLines.push(`- 해석(INTERP): ${interpArr.join(" / ")}`);
  if (actionArr.length) summaryLines.push(`- 행동(ACTION): ${actionArr.join(" / ")}`);

  if (!summaryLines.length) {
    summaryLines.push("- (요약을 생성하지 못했어요) 그래도 아래 체크를 참고해 복기해보세요.");
  }

  const checkLines: string[] = [];
  if (missingPieces.length) checkLines.push(...missingPieces.map((m) => `- (규칙 누락) ${m}`));
  if (biasChecklist.length) {
    for (const b of biasChecklist.slice(0, 5)) {
      const nm = b?.name ? String(b.name) : "인지편향 가능성";
      checkLines.push(`- (인지편향) ${nm}`);
    }
  }
  if (!checkLines.length) {
    checkLines.push("- 큰 누락은 없어 보여요. 그래도 ‘틀렸을 때 시나리오’와 ‘재평가 조건’이 구체적인지 확인해보세요.");
  }

  return ["요약", ...summaryLines, "", "규칙·인지편향 체크", ...checkLines, "", "다음 기록 질문(1개)", `- ${question}`].join("\n");
}

const Diary: React.FC = () => {
  const { user, diary, transactions, updateDiaryEntry } = useApp() as any;

  // -----------------------------
  // Quotes (current price on cards)
  // -----------------------------
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change_pct: number }>>({});

  useEffect(() => {
    const cached = safeJsonParse<Record<string, { price: number; change_pct: number }>>(localStorage.getItem(QUOTE_CACHE_KEY));
    if (cached) setLivePrices(cached);
  }, []);

  const diarySymbols = useMemo(() => {
    const set = new Set<string>();
    (diary ?? []).forEach((d: any) => {
      const s = (d?.related_symbol || "").trim().toUpperCase();
      if (s) set.add(s);
    });
    return Array.from(set);
  }, [diary]);

  useEffect(() => {
    if (diarySymbols.length === 0) return;

    let isCancelled = false;

    const fetchQuotes = async () => {
      try {
        const quotes = await getYFinanceQuotes(diarySymbols);
        if (!isCancelled) {
          setLivePrices((prev) => {
            const merged = { ...prev, ...quotes };
            try {
              localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      } catch (err) {
        console.error("[Diary] quote fetch error:", err);
      }
    };

    fetchQuotes();
    const id = window.setInterval(fetchQuotes, 3 * 60 * 1000);
    return () => {
      isCancelled = true;
      window.clearInterval(id);
    };
  }, [diarySymbols]);

  // -----------------------------
  // AI feedback on-demand (no infinite loading)
  // -----------------------------
  const [insightLoadingId, setInsightLoadingId] = useState<string | null>(null);
  const [disabledUntil, setDisabledUntil] = useState<Record<string, number>>({});
  const [entryError, setEntryError] = useState<Record<string, string>>({});
  const insightLockRef = useRef(false);

  const isCooldown = (id: string) => (disabledUntil[id] ?? 0) > Date.now();
  const cooldownLeft = (id: string) => Math.max(0, Math.ceil(((disabledUntil[id] ?? 0) - Date.now()) / 1000));

  const requestFeedback = async (entry: any) => {
    if (!entry?.id) return;

    if (insightLoadingId) return;
    if (insightLockRef.current) return;

    const until = disabledUntil[entry.id] ?? 0;
    if (until > Date.now()) return;

    setEntryError((prev) => ({ ...prev, [entry.id]: "" }));

    insightLockRef.current = true;
    setInsightLoadingId(entry.id);

    try {
      const recentTxs = (transactions ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 20)
        .map((tx: any) => ({
          date: tx.date,
          type: tx.type,
          symbol: tx.symbol,
          quantity: tx.quantity,
          price: tx.price,
        }));

      const recentDiaryLite = (diary ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 10)
        .map((d: any) => ({
          date: d.date,
          emotion: d.emotion,
          reason: d.reason,
          related_symbol: d.related_symbol,
          what_if: d.what_if,
          recheck_pct: d.recheck_pct,
          trade_type: d.trade_type,
          trade_qty: d.trade_qty,
          trade_price: d.trade_price,
          note: (d.note || "").slice(0, 200),
        }));

      const rawFeedback = await generateDiaryFeedback(entry, user, recentTxs, recentDiaryLite);
      const normalized = normalizeFeedbackToText(rawFeedback);

      updateDiaryEntry(entry.id, { aiFeedback: normalized });
    } catch (err: any) {
      const msg = String(err?.message || err);

      if (msg.includes("429")) {
        const sec = parseRetrySeconds(msg) ?? 60;

        setDisabledUntil((prev) => ({
          ...prev,
          [entry.id]: Date.now() + sec * 1000,
        }));

        setEntryError((prev) => ({
          ...prev,
          [entry.id]: `You've reached the AI limit. Try again in ${sec}s.`,
        }));

        return;
      }

      setEntryError((prev) => ({
        ...prev,
        [entry.id]: "AI is unavailable right now. Please try again.",
      }));
      console.error("[Diary] AI feedback error:", err);
    } finally {
      setInsightLoadingId(null);
      insightLockRef.current = false;
    }
  };

  // -----------------------------
  // Sorting + Ticker filter
  // -----------------------------
  const [selectedTicker, setSelectedTicker] = useState<string>("ALL");

  const tickerOptions = useMemo(() => {
    const set = new Set<string>();
    (diary ?? []).forEach((d: any) => {
      const t = (d?.related_symbol || "").trim().toUpperCase();
      if (t) set.add(t);
    });
    return ["ALL", ...Array.from(set).sort()];
  }, [diary]);

  const sortedDiary = useMemo(() => {
    return (diary ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [diary]);

  const filteredDiary = useMemo(() => {
    if (selectedTicker === "ALL") return sortedDiary;
    return sortedDiary.filter((d: any) => (d?.related_symbol || "").toUpperCase() === selectedTicker);
  }, [sortedDiary, selectedTicker]);

  // -----------------------------
  // View entry modal (click card -> open)
  // -----------------------------
  const [viewingId, setViewingId] = useState<string | null>(null);

  const viewingEntry = useMemo(() => {
    if (!viewingId) return null;
    return (diary ?? []).find((d: any) => d.id === viewingId) || null;
  }, [diary, viewingId]);

  const closeViewModal = () => setViewingId(null);

  // -----------------------------
  // Helpers: current price + pnl chips
  // -----------------------------
  function getCurrentPrice(symbol: string, fallback?: number) {
    const live = livePrices[symbol];
    const p = live?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) return p;
    if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
    return undefined;
  }

  function computeMovePct(current?: number, entryPrice?: number) {
    if (!Number.isFinite(current as number) || !Number.isFinite(entryPrice as number) || !entryPrice) return undefined;
    return ((current! - entryPrice!) / entryPrice!) * 100;
  }

  function computePL(entry: any, current?: number) {
    const qty = entry?.trade_qty;
    const entryPrice = entry?.trade_price;
    if (!Number.isFinite(current as number) || !Number.isFinite(qty) || !Number.isFinite(entryPrice)) return undefined;

    const raw = (current! - entryPrice) * qty;
    // If SELL, interpret as "you sold at entryPrice; if current below, that was good"
    if (entry?.trade_type === "SELL") return -raw;
    return raw;
  }

  function isRecheckNow(movePct?: number, recheckPct?: number) {
    if (typeof movePct !== "number" || !Number.isFinite(movePct)) return false;
    if (typeof recheckPct !== "number" || !Number.isFinite(recheckPct)) return false;
    // e.g. -7 → trigger when movePct <= -7
    // e.g. +5 → trigger when movePct >= +5
    return recheckPct < 0 ? movePct <= recheckPct : movePct >= recheckPct;
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header (New Entry 버튼 제거) */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <BookHeart className="text-primary-600" />
            Investment Diary
          </h1>
          <p className="text-gray-600">Entries are created after trades (Virtual Trading Floor). Click a card to review details.</p>
        </div>
      </div>

      {/* Filter row */}
      {tickerOptions.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gray-50 rounded-full border border-gray-200">
              <Filter size={16} className="text-gray-600" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-gray-900">Filter</div>
              <div className="text-xs font-semibold text-gray-500">by ticker</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {tickerOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedTicker(t)}
                className={`px-3 py-1.5 rounded-full text-sm font-bold border transition-all ${
                  selectedTicker === t ? "bg-primary-600 text-white border-primary-600" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "ALL" ? "All" : t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {filteredDiary.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-3xl border-2 border-gray-100 border-dashed flex flex-col items-center">
            <div className="w-24 h-24 bg-primary-50 rounded-full flex items-center justify-center mb-6 shadow-inner">
              <BookHeart size={48} className="text-primary-300" />
            </div>
            <h3 className="text-2xl font-extrabold text-gray-900 mb-3">
              {selectedTicker === "ALL" ? "Your diary is empty" : "No entries for this ticker"}
            </h3>
            <p className="text-gray-500 max-w-md mx-auto text-lg">
              {selectedTicker === "ALL"
                ? "Make a trade and write a reflection right after — it will appear here."
                : "Try selecting a different ticker or clear the filter."}
            </p>
          </div>
        ) : (
          filteredDiary.map((entry: any) => {
            const symbol = (entry?.related_symbol || "").toUpperCase();
            const current = symbol ? getCurrentPrice(symbol, entry?.trade_price) : undefined;

            const entryPrice = entry?.trade_price;
            const qty = entry?.trade_qty;

            const movePct = computeMovePct(current, entryPrice);
            const pl = computePL(entry, current);

            const recheckText = formatRecheckLabel(entry?.recheck_pct);
            const recheckNow = isRecheckNow(movePct, entry?.recheck_pct);

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setViewingId(entry.id)}
                className="w-full text-left bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  {/* ✅ Grouped chips (Trade / Plan / Performance) */}
                  <div className="min-w-0 flex-1 flex flex-wrap gap-2">
                    {/* TRADE */}
                    <ChipGroup>
                      <Tooltip text="Emotion selected when you wrote this entry">
                        <span
                          tabIndex={0}
                          className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${getEmotionColor(entry.emotion)}`}
                        >
                          {getEmotionIcon(entry.emotion)}
                          {getEmotionLabel(entry.emotion).split(" ")[1] || getEmotionLabel(entry.emotion)}
                        </span>
                      </Tooltip>

                      {symbol && (
                        <Tooltip text="Ticker linked to this entry (also used for filtering)">
                          <span
                            tabIndex={0}
                            className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 flex items-center gap-1.5"
                          >
                            <Tag size={14} />
                            {symbol}
                          </span>
                        </Tooltip>
                      )}

                      {entry?.trade_type && (
                        <Tooltip text="Trade direction for this entry">
                          <span
                            tabIndex={0}
                            className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border ${
                              entry.trade_type === "BUY"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                : "bg-rose-50 text-rose-700 border-rose-100"
                            }`}
                          >
                            {entry.trade_type}
                          </span>
                        </Tooltip>
                      )}

                      {Number.isFinite(entryPrice) && symbol && (
                        <Tooltip text="Executed price at the time of trade">
                          <span
                            tabIndex={0}
                            className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                          >
                            Entry {formatPrice(entryPrice, symbol)}
                          </span>
                        </Tooltip>
                      )}

                      {Number.isFinite(qty) && (
                        <Tooltip text="Executed quantity at the time of trade">
                          <span
                            tabIndex={0}
                            className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                          >
                            Qty {qty}
                          </span>
                        </Tooltip>
                      )}
                    </ChipGroup>

                    {/* PLAN */}
                    {(recheckNow || recheckText) && (
                      <ChipGroup>
                        {recheckNow && (
                          <Tooltip text="Current move% meets your recheck trigger — review your thesis now.">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-red-50 text-red-700 rounded-lg text-xs font-extrabold border border-red-100 flex items-center gap-1.5"
                            >
                              <AlertTriangle size={14} />
                              Recheck Now
                            </span>
                          </Tooltip>
                        )}

                        {recheckText && (
                          <Tooltip text="Recheck trigger threshold">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-bold border border-amber-100"
                            >
                              {recheckText}
                            </span>
                          </Tooltip>
                        )}
                      </ChipGroup>
                    )}

                    {/* PERFORMANCE */}
                    {(Number.isFinite(current as number) ||
                      (Number.isFinite(movePct as number) && Number.isFinite(pl as number))) && (
                      <ChipGroup>
                        {Number.isFinite(current as number) && symbol && (
                          <Tooltip text="Current live price (polled/cached)">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-100"
                            >
                              Now {formatPrice(current!, symbol)}
                            </span>
                          </Tooltip>
                        )}

                        {Number.isFinite(movePct as number) && Number.isFinite(pl as number) && symbol && (
                          <Tooltip text="Move% from entry and unrealized P/L.">
                            <span
                              tabIndex={0}
                              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5 ${
                                (pl as number) >= 0
                                  ? "bg-green-50 text-green-700 border border-green-100"
                                  : "bg-red-50 text-red-700 border border-red-100"
                              }`}
                            >
                              {(movePct as number) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              Move {(movePct as number) >= 0 ? "+" : ""}
                              {(movePct as number).toFixed(2)}% · P/L {(pl as number) >= 0 ? "+" : ""}
                              {isKoreanStock(symbol)
                                ? `₩${Math.round(pl as number).toLocaleString()}`
                                : `$${(pl as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                            </span>
                          </Tooltip>
                        )}
                      </ChipGroup>
                    )}
                  </div>

                  {/* Timestamp */}
                  <Tooltip text="Timestamp (Asia/Seoul)">
                    <span tabIndex={0} className="shrink-0 text-xs font-medium text-gray-400 whitespace-nowrap">
                      {new Date(entry.date).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Seoul",
                      })}
                    </span>
                  </Tooltip>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* View entry modal */}
      {viewingEntry && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end sm:items-center justify-center min-h-full p-4 text-center sm:p-0">
            <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity" onClick={closeViewModal} />
            <div className="relative bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg w-full animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-white px-6 py-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-extrabold text-gray-900">Journal Entry</h3>
                  <button onClick={closeViewModal} className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full" type="button">
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-5">
                  {/* Emotion */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">How were you feeling?</label>
                    <Tooltip text="How you felt">
                      <div
                        tabIndex={0}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold border ${
                          getEmotionColor(viewingEntry.emotion) || "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {getEmotionIcon(viewingEntry.emotion)}
                        {getEmotionLabel(viewingEntry.emotion)}
                      </div>
                    </Tooltip>
                  </div>

                  {/* Reason + Ticker */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2">Primary Driver</label>
                      <Tooltip text="Reason/driver you chose while writing" wrapperClassName="block w-full">
                        <div
                          tabIndex={0}
                          className="block w-full border border-gray-300 rounded-xl py-3 px-4 bg-gray-50 text-gray-900 font-bold flex items-center gap-2"
                        >
                          {getReasonIcon(viewingEntry.reason)}
                          {getReasonLabel(viewingEntry.reason)}
                        </div>
                      </Tooltip>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2">Ticker</label>
                      <Tooltip text="Ticker linked to this entry" wrapperClassName="block w-full">
                        <div
                          tabIndex={0}
                          className="block w-full border border-gray-300 rounded-xl py-3 px-4 bg-gray-50 text-gray-900 font-extrabold uppercase"
                        >
                          {(viewingEntry.related_symbol || "").toUpperCase() || "-"}
                        </div>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Trade snapshot chips inside modal */}
                  {(viewingEntry.trade_type || viewingEntry.trade_price || viewingEntry.trade_qty) && (
                    <div className="bg-white border border-gray-200 rounded-2xl p-4">
                      <div className="text-xs font-extrabold text-gray-700 mb-2">Trade Snapshot</div>
                      <div className="flex flex-wrap gap-2">
                        {viewingEntry.trade_type && (
                          <Tooltip text="Trade direction">
                            <span
                              tabIndex={0}
                              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border ${
                                viewingEntry.trade_type === "BUY"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                  : "bg-rose-50 text-rose-700 border-rose-100"
                              }`}
                            >
                              {viewingEntry.trade_type}
                            </span>
                          </Tooltip>
                        )}

                        {Number.isFinite(viewingEntry.trade_price) && viewingEntry.related_symbol && (
                          <Tooltip text="Executed price at the time of trade">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                            >
                              Entry {formatPrice(viewingEntry.trade_price, viewingEntry.related_symbol)}
                            </span>
                          </Tooltip>
                        )}

                        {Number.isFinite(viewingEntry.trade_qty) && (
                          <Tooltip text="Executed quantity at the time of trade">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                            >
                              Qty {viewingEntry.trade_qty}
                            </span>
                          </Tooltip>
                        )}

                        {typeof viewingEntry.recheck_pct === "number" && Number.isFinite(viewingEntry.recheck_pct) && (
                          <Tooltip text="Recheck trigger threshold (move% from entry)">
                            <span
                              tabIndex={0}
                              className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-bold border border-amber-100"
                            >
                              {formatRecheckLabel(viewingEntry.recheck_pct)}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  )}

                  {/* WHAT IF */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">WHAT IF (one failure scenario)</label>
                    <Tooltip text="Your 'what could go wrong' scenario" wrapperClassName="block w-full">
                      <textarea
                        rows={3}
                        value={viewingEntry.what_if || ""}
                        readOnly
                        className="block w-full border-gray-300 rounded-xl py-3 px-4 bg-gray-50 text-gray-900 placeholder-gray-400"
                        placeholder="-"
                      />
                    </Tooltip>
                  </div>

                  {/* PLAN */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">PLAN (recheck trigger %)</label>
                    <div className="flex items-center gap-3">
                      <Tooltip text="Recheck trigger (%) — shown as 'Recheck Now' when condition is met" wrapperClassName="block w-full">
                        <input
                          type="text"
                          readOnly
                          value={
                            typeof viewingEntry.recheck_pct === "number" && Number.isFinite(viewingEntry.recheck_pct)
                              ? String(viewingEntry.recheck_pct)
                              : ""
                          }
                          className="block w-full border-gray-300 rounded-xl py-3 px-4 bg-gray-50 text-gray-900 font-semibold"
                          placeholder="-"
                        />
                      </Tooltip>
                      <span className="text-sm font-semibold text-gray-600 whitespace-nowrap">%</span>
                    </div>
                  </div>

                  {/* Your Thoughts */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">Your Thoughts</label>
                    <Tooltip text="Your original note (as written)" wrapperClassName="block w-full">
                      <textarea
                        rows={5}
                        value={viewingEntry.note || ""}
                        readOnly
                        className="block w-full border-gray-300 rounded-xl py-3 px-4 bg-gray-50 text-gray-900 placeholder-gray-400 whitespace-pre-wrap break-words"
                        placeholder="-"
                      />
                    </Tooltip>
                  </div>

                  {/* AI feedback button */}
                  <div className="flex items-center gap-3">
                    <Tooltip text="Generate coaching feedback for this entry (may have rate limit)">
                      <button
                        type="button"
                        onClick={() => requestFeedback(viewingEntry)}
                        disabled={insightLoadingId === viewingEntry.id || isCooldown(viewingEntry.id)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary-200 bg-primary-50 text-xs font-bold text-primary-700 hover:bg-primary-100 hover:border-primary-300 disabled:opacity-50 disabled:hover:bg-primary-50"
                      >
                        {insightLoadingId === viewingEntry.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        AI Feedback
                      </button>
                    </Tooltip>

                    {isCooldown(viewingEntry.id) && <span className="text-[11px] font-medium text-gray-400">Try again in {cooldownLeft(viewingEntry.id)}s</span>}
                    {!!entryError[viewingEntry.id] && <span className="text-[11px] font-semibold text-red-500">{entryError[viewingEntry.id]}</span>}
                  </div>

                  {/* Feedback panel */}
                  {viewingEntry.aiFeedback && (
                    <div className="pt-2 animate-in fade-in duration-500">
                      <div className="flex items-start gap-3 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                        <div className="p-2 bg-white rounded-full border border-indigo-100 shrink-0">
                          <Sparkles size={18} className="text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-indigo-900 leading-relaxed font-medium whitespace-pre-wrap break-words">
                            {viewingEntry.aiFeedback}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Close */}
                  <button
                    type="button"
                    onClick={closeViewModal}
                    className="w-full py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Small footer hint */}
      <div className="text-xs text-gray-400 flex items-center gap-2">
        <Tag size={14} />
        Tip: Hover tags to see what they mean.
      </div>
    </div>
  );
};

export default Diary;
