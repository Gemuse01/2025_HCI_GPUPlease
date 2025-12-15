// Diary.tsx (root-level): shared design for Investment Diary
import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "./contexts/AppContext";
import { EMOTION_OPTIONS, REASON_OPTIONS } from "./constants";
import { getYFinanceQuotes } from "./services/stockService";
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
  Filter,
  Tag,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  Percent,
  FileText,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

const QUOTE_CACHE_KEY = "finguide_live_quotes_v1";
const TIMEZONE = "Asia/Seoul";
const WEEKLY_GOAL = 5; // ✅ Weekly target (you can adjust if needed)

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

/** Small tooltip component (hover/focus) */
const Tooltip: React.FC<{
  text: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
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

/** ✅ Chip group container (Trade / Plan / Performance) */
const ChipGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 ${className}`}>
      {children}
    </div>
  );
};

/* -----------------------------
 * Date helpers (KST-safe keys)
 * ----------------------------- */
function kstDateKey(input: Date | string | number): string {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // YYYY-MM-DD
}
function kstMonthKey(input: Date | string | number): string {
  return kstDateKey(input).slice(0, 7); // YYYY-MM
}
function weekdayShortKST(input: Date | string | number): string {
  const d = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(d);
}
function weekdayNumFromShort(short: string): number {
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? 0;
}
function dateFromKstKey(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}
function addDaysToKstKey(key: string, deltaDays: number): string {
  const base = dateFromKstKey(key).getTime();
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return kstDateKey(next);
}
function getWeekStartKeyFromDate(dateLike: Date | string | number): string {
  const wd = weekdayNumFromShort(weekdayShortKST(dateLike));
  const offsetToMon = (wd + 6) % 7;
  const todayKey = kstDateKey(dateLike);
  return addDaysToKstKey(todayKey, -offsetToMon);
}

function isRecheckNow(movePct?: number, recheckPct?: number) {
  if (typeof movePct !== "number" || !Number.isFinite(movePct)) return false;
  if (typeof recheckPct !== "number" || !Number.isFinite(recheckPct)) return false;
  return recheckPct < 0 ? movePct <= recheckPct : movePct >= recheckPct;
}

/** Match key: KST day + type + symbol + qty + price */
function makeTradeKeyKSTDay(params: { date: string | number | Date; type?: string; symbol?: string; quantity?: number; price?: number }) {
  const day = kstDateKey(params.date);
  const type = String(params.type || "").toUpperCase();
  const symbol = String(params.symbol || "").toUpperCase();
  const qty = Number(params.quantity);
  const price = Number(params.price);

  const qtyKey = Number.isFinite(qty) ? String(qty) : "";
  const priceKey = Number.isFinite(price) ? String(price) : "";

  return `${day}|${type}|${symbol}|${qtyKey}|${priceKey}`;
}

/* -----------------------------
 * Weekly report helpers
 * ----------------------------- */
function stripCodeFences(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  // ```json ... ``` or ``` ... ```
  if (t.startsWith("```")) {
    const withoutFirst = t.replace(/^```[a-zA-Z0-9]*\s*/m, "");
    const withoutLast = withoutFirst.replace(/```$/m, "");
    return withoutLast.trim();
  }
  return t;
}

// At runtime, if generateWeeklyReport exists in geminiService.ts, use it automatically.
// (Dynamic import so Diary.tsx can compile even before the generator is implemented.)
async function tryGenerateWeeklyReport(payload: any): Promise<any> {
  const mod: any = await import("./services/geminiService");
  if (typeof mod?.generateWeeklyReport === "function") {
    return await mod.generateWeeklyReport(payload);
  }
  throw new Error("Weekly report generator is not implemented yet. (Add generateWeeklyReport in geminiService.ts)");
}

const Diary: React.FC = () => {
  const { user, diary, transactions } = useApp() as any;

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
    return (diary ?? []).slice().sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [diary]);

  // ✅ Per‑ticker latest diary entry id (Recheck tags only shown on latest entry)
  const latestEntryIdByTicker = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of sortedDiary) {
      const symbol = String(d?.related_symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      if (!map[symbol]) map[symbol] = d.id; // sortedDiary is newest-first, so first occurrence is latest
    }
    return map;
  }, [sortedDiary]);

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
  // Helpers: current price + move%
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

  function effectiveMovePct(entry: any, movePct?: number) {
    if (typeof movePct !== "number" || !Number.isFinite(movePct)) return undefined;
    if (entry?.trade_type === "SELL") return -movePct;
    return movePct;
  }

  // -----------------------------
  // ✅ Weekly goal (global, "this week")
  // -----------------------------
  const todayKey = useMemo(() => kstDateKey(Date.now()), []);
  const dayCountMap = useMemo(() => {
    const map = new Map<string, number>();
    (diary ?? []).forEach((d: any) => {
      const key = kstDateKey(d.date);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [diary]);

  const weeklyProgress = useMemo(() => {
    const weekStartKey = getWeekStartKeyFromDate(Date.now());
    const weekEndKeyExclusive = addDaysToKstKey(weekStartKey, 7);

    let count = 0;
    for (const [k, v] of dayCountMap.entries()) {
      if (k >= weekStartKey && k < weekEndKeyExclusive) count += v;
    }

    const pct = Math.max(0, Math.min(100, Math.round((count / WEEKLY_GOAL) * 100)));
    return { weekStartKey, weekEndKeyExclusive, count, pct };
  }, [dayCountMap]);

  // -----------------------------
  // ✅ Trade → Diary coverage (all time)
  // -----------------------------
  const tradeDiaryCoverage = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    const entries = Array.isArray(diary) ? diary : [];

    const txKeys: string[] = txs
      .map((t: any) =>
        makeTradeKeyKSTDay({
          date: t.date,
          type: t.type,
          symbol: t.symbol,
          quantity: t.quantity,
          price: t.price,
        })
      )
      .filter((k) => k.split("|").every((p) => p !== ""));

    const diaryKeys = new Set(
      entries
        .map((d: any) =>
          makeTradeKeyKSTDay({
            date: d.date,
            type: d.trade_type,
            symbol: d.related_symbol,
            quantity: d.trade_qty,
            price: d.trade_price,
          })
        )
        .filter((k) => k.split("|").every((p) => p !== ""))
    );

    let covered = 0;
    for (const k of txKeys) if (diaryKeys.has(k)) covered += 1;

    const total = txKeys.length;
    const pct = total ? Math.round((covered / total) * 100) : 0;

    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      months.push(kstMonthKey(d));
    }

    const txByMonth = new Map<string, string[]>();
    for (const t of txs) {
      const mk = kstMonthKey(t.date);
      const key = makeTradeKeyKSTDay({
        date: t.date,
        type: t.type,
        symbol: t.symbol,
        quantity: t.quantity,
        price: t.price,
      });
      if (!txByMonth.has(mk)) txByMonth.set(mk, []);
      txByMonth.get(mk)!.push(key);
    }

    const monthly = months.map((m) => {
      const list = txByMonth.get(m) ?? [];
      let cov = 0;
      for (const k of list) if (diaryKeys.has(k)) cov += 1;
      const tot = list.length;
      const p = tot ? Math.round((cov / tot) * 100) : 0;
      return { month: m, covered: cov, total: tot, pct: p };
    });

    return { covered, total, pct, monthly };
  }, [transactions, diary]);

  // -----------------------------
  // ✅ Stats reward: emotion/driver win-rate + avg move% (all time)
  // -----------------------------
  type GroupStat = { key: string; label: string; n: number; win: number; avgMove: number };

  const performanceStats = useMemo(() => {
    const entries = (diary ?? []).filter((e: any) => e?.trade_price && e?.related_symbol);

    const byEmotion = new Map<string, { n: number; win: number; sumMove: number }>();
    const byDriver = new Map<string, { n: number; win: number; sumMove: number }>();
    const byCombo = new Map<string, { n: number; win: number; sumMove: number; emo: string; drv: string }>();

    for (const entry of entries) {
      const symbol = String(entry.related_symbol || "").toUpperCase();
      const current = symbol ? getCurrentPrice(symbol, entry?.trade_price) : undefined;

      const move = computeMovePct(current, entry?.trade_price);
      const eff = effectiveMovePct(entry, move);
      if (typeof eff !== "number" || !Number.isFinite(eff)) continue;

      const emo = String(entry.emotion || "unknown");
      const drv = String(entry.reason || "unknown");
      const comboKey = `${emo}__${drv}`;

      const win = eff > 0 ? 1 : 0;

      const a = byEmotion.get(emo) ?? { n: 0, win: 0, sumMove: 0 };
      a.n += 1;
      a.win += win;
      a.sumMove += eff;
      byEmotion.set(emo, a);

      const b = byDriver.get(drv) ?? { n: 0, win: 0, sumMove: 0 };
      b.n += 1;
      b.win += win;
      b.sumMove += eff;
      byDriver.set(drv, b);

      const c = byCombo.get(comboKey) ?? { n: 0, win: 0, sumMove: 0, emo, drv };
      c.n += 1;
      c.win += win;
      c.sumMove += eff;
      byCombo.set(comboKey, c);
    }

    const toList = (m: Map<string, { n: number; win: number; sumMove: number }>, kind: "emotion" | "driver"): GroupStat[] => {
      const out: GroupStat[] = [];
      for (const [k, v] of m.entries()) {
        const label = kind === "emotion" ? getEmotionLabel(k) : getReasonLabel(k);
        out.push({ key: k, label, n: v.n, win: v.win, avgMove: v.n ? v.sumMove / v.n : 0 });
      }
      return out.sort((x, y) => y.n - x.n);
    };

    const emotionList = toList(byEmotion, "emotion");
    const driverList = toList(byDriver, "driver");

    let worst: null | { emo: string; drv: string; n: number; winRate: number; avgMove: number } = null;
    for (const v of byCombo.values()) {
      if (v.n < 2) continue;
      const avgMove = v.sumMove / v.n;
      if (!worst || avgMove < worst.avgMove) {
        worst = { emo: v.emo, drv: v.drv, n: v.n, winRate: v.n ? v.win / v.n : 0, avgMove };
      }
    }

    return {
      emotionList,
      driverList,
      worstCombo: worst,
      sampleN: emotionList.reduce((acc, x) => acc + x.n, 0),
    };
  }, [diary, livePrices]);

  /* =========================================================
   * ✅ Weekly Report (Button + Modal + Week-filter Aggregation)
   * ========================================================= */
  const [reportOpen, setReportOpen] = useState(false);

  // “Report base week” (default: this week's Monday, in KST)
  const [reportWeekStartKey, setReportWeekStartKey] = useState<string>(() => getWeekStartKeyFromDate(Date.now()));

  // AI result state
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string>("");
  const [reportOutput, setReportOutput] = useState<string>("");

  const reportWeekEndExclusive = useMemo(() => addDaysToKstKey(reportWeekStartKey, 7), [reportWeekStartKey]);
  const reportWeekRangeLabel = useMemo(() => {
    const endInclusive = addDaysToKstKey(reportWeekStartKey, 6);
    return `${reportWeekStartKey} ~ ${endInclusive}`;
  }, [reportWeekStartKey]);

  // Filter diary entries / transactions for the selected week
  const weekDiaryEntries = useMemo(() => {
    return (diary ?? []).filter((d: any) => {
      const k = kstDateKey(d.date);
      return k >= reportWeekStartKey && k < reportWeekEndExclusive;
    });
  }, [diary, reportWeekStartKey, reportWeekEndExclusive]);

  const weekTransactions = useMemo(() => {
    return (transactions ?? []).filter((t: any) => {
      const k = kstDateKey(t.date);
      return k >= reportWeekStartKey && k < reportWeekEndExclusive;
    });
  }, [transactions, reportWeekStartKey, reportWeekEndExclusive]);

  // Weekly goal stats for the selected week
  const weekGoal = useMemo(() => {
    const count = weekDiaryEntries.length;
    const pct = Math.max(0, Math.min(100, Math.round((count / WEEKLY_GOAL) * 100)));
    return { count, pct };
  }, [weekDiaryEntries]);

  // Coverage for the selected week
  const weekCoverage = useMemo(() => {
    const txKeys: string[] = (weekTransactions ?? [])
      .map((t: any) =>
        makeTradeKeyKSTDay({
          date: t.date,
          type: t.type,
          symbol: t.symbol,
          quantity: t.quantity,
          price: t.price,
        })
      )
      .filter((k) => k.split("|").every((p) => p !== ""));

    const diaryKeys = new Set(
      (weekDiaryEntries ?? [])
        .map((d: any) =>
          makeTradeKeyKSTDay({
            date: d.date,
            type: d.trade_type,
            symbol: d.related_symbol,
            quantity: d.trade_qty,
            price: d.trade_price,
          })
        )
        .filter((k) => k.split("|").every((p) => p !== ""))
    );

    let covered = 0;
    for (const k of txKeys) if (diaryKeys.has(k)) covered += 1;

    const total = txKeys.length;
    const pct = total ? Math.round((covered / total) * 100) : 0;

    return { covered, total, pct };
  }, [weekTransactions, weekDiaryEntries]);

  // Weekly "Your Patterns" for the selected week
  const weekPatterns = useMemo(() => {
    type Stat = { n: number; win: number; sumMove: number };
    const byEmotion = new Map<string, Stat>();
    const byDriver = new Map<string, Stat>();

    const entries = (weekDiaryEntries ?? []).filter((e: any) => e?.trade_price && e?.related_symbol);

    for (const entry of entries) {
      const symbol = String(entry.related_symbol || "").toUpperCase();
      const current = symbol ? getCurrentPrice(symbol, entry?.trade_price) : undefined;

      const move = computeMovePct(current, entry?.trade_price);
      const eff = effectiveMovePct(entry, move);
      if (typeof eff !== "number" || !Number.isFinite(eff)) continue;

      const emo = String(entry.emotion || "unknown");
      const drv = String(entry.reason || "unknown");
      const win = eff > 0 ? 1 : 0;

      const a = byEmotion.get(emo) ?? { n: 0, win: 0, sumMove: 0 };
      a.n += 1;
      a.win += win;
      a.sumMove += eff;
      byEmotion.set(emo, a);

      const b = byDriver.get(drv) ?? { n: 0, win: 0, sumMove: 0 };
      b.n += 1;
      b.win += win;
      b.sumMove += eff;
      byDriver.set(drv, b);
    }

    const toList = (m: Map<string, Stat>, kind: "emotion" | "driver") => {
      const out: Array<{ key: string; label: string; n: number; winRate: number; avgMove: number }> = [];
      for (const [k, v] of m.entries()) {
        const label = kind === "emotion" ? getEmotionLabel(k) : getReasonLabel(k);
        out.push({
          key: k,
          label,
          n: v.n,
          winRate: v.n ? v.win / v.n : 0,
          avgMove: v.n ? v.sumMove / v.n : 0,
        });
      }
      return out.sort((x, y) => y.n - x.n);
    };

    const emotion = toList(byEmotion, "emotion");
    const driver = toList(byDriver, "driver");
    const sampleN = emotion.reduce((acc, x) => acc + x.n, 0);

    return { emotion, driver, sampleN };
  }, [weekDiaryEntries, livePrices]);

  const openReport = () => {
    setReportWeekStartKey(getWeekStartKeyFromDate(Date.now()));
    setReportOutput("");
    setReportError("");
    setReportOpen(true);
  };

  const closeReport = () => {
    setReportOpen(false);
    setReportLoading(false);
    setReportError("");
  };

  const goPrevWeek = () => setReportWeekStartKey((prev) => addDaysToKstKey(prev, -7));
  const goNextWeek = () => setReportWeekStartKey((prev) => addDaysToKstKey(prev, +7));

  const generateWeeklyReport = async () => {
    setReportError("");
    setReportOutput("");
    setReportLoading(true);

    try {
      // Weekly context to send to the LLM (kept compact)
      const compactEntries = (weekDiaryEntries ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((d: any) => ({
          date: d.date,
          emotion: d.emotion,
          reason: d.reason,
          related_symbol: d.related_symbol,
          trade_type: d.trade_type,
          trade_qty: d.trade_qty,
          trade_price: d.trade_price,
          recheck_pct: d.recheck_pct,
          what_if: d.what_if,
          note: String(d.note || "").slice(0, 600),
        }));

      const payload = {
        weekRange: reportWeekRangeLabel,
        metrics: {
          diaryCoverage: weekCoverage, // {covered,total,pct}
          weeklyGoal: { goal: WEEKLY_GOAL, ...weekGoal }, // {goal,count,pct}
          patterns: {
            sampleN: weekPatterns.sampleN,
            topEmotion: weekPatterns.emotion.slice(0, 5),
            topDriver: weekPatterns.driver.slice(0, 5),
          },
        },
        entries: compactEntries,
        persona: user?.persona,
      };

      const raw = await tryGenerateWeeklyReport(payload);
      const text = stripCodeFences(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));

      setReportOutput(text);
    } catch (err: any) {
      setReportError(String(err?.message || err));
    } finally {
      setReportLoading(false);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <BookHeart className="text-primary-600" />
            Investment Diary
          </h1>
          <p className="text-gray-600">Entries are created after trades (Virtual Trading Floor). Click a card to review details.</p>
        </div>

        {/* ✅ Weekly Report button */}
        <Tooltip text="Generate a weekly report (metrics + AI coach summary)">
          <button
            type="button"
            onClick={openReport}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-extrabold text-gray-800 hover:bg-gray-50"
          >
            <FileText size={16} />
            Weekly Report
          </button>
        </Tooltip>
      </div>

      {/* ✅ Row 1: Diary Coverage (L) + Weekly Goal (R) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Diary Coverage */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gray-50 rounded-full border border-gray-200">
              <Percent size={16} className="text-gray-700" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-gray-900">Diary Coverage</div>
              <div className="text-xs font-semibold text-gray-500">trades that have a diary entry</div>
            </div>
          </div>

          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold text-gray-700">Overall</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <div className="text-4xl font-extrabold text-gray-900">{tradeDiaryCoverage.pct}%</div>
                  <div className="text-sm font-bold text-gray-600">coverage</div>
                </div>
                <div className="mt-1 text-xs font-semibold text-gray-500">
                  {tradeDiaryCoverage.covered} / {tradeDiaryCoverage.total} trades
                </div>
              </div>

              <div className="w-full sm:w-[240px]">
                <div className="text-xs font-semibold text-gray-500 mb-1 text-right">progress</div>
                <div className="w-full h-2.5 rounded-full bg-white border border-gray-200 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${tradeDiaryCoverage.pct}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs font-extrabold text-gray-700 mb-2">Last 6 months</div>
              <div className="space-y-2">
                {tradeDiaryCoverage.monthly.map((m) => (
                  <Tooltip key={m.month} text={`${m.month} · ${m.covered}/${m.total} trades (${m.pct}%)`} side="top">
                    <div className="flex items-center gap-2">
                      <div className="w-14 text-[11px] font-bold text-gray-600 tabular-nums">{m.month}</div>
                      <div className="flex-1 h-2 rounded-full bg-white border border-gray-200 overflow-hidden">
                        <div className="h-full bg-emerald-400" style={{ width: `${m.pct}%` }} />
                      </div>
                      <div className="w-10 text-right text-[11px] font-extrabold text-gray-700 tabular-nums">{m.pct}%</div>
                    </div>
                  </Tooltip>
                ))}
              </div>

              <div className="mt-3 text-[11px] font-semibold text-gray-500">
                * Matching rule: (KST date + BUY/SELL + ticker + qty + price)
              </div>
            </div>
          </div>
        </div>

        {/* Weekly Goal */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gray-50 rounded-full border border-gray-200">
              <Target size={16} className="text-gray-700" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-gray-900">Weekly goal</div>
              <div className="text-xs font-semibold text-gray-500">this week</div>
            </div>
          </div>

          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-extrabold text-gray-900">
                {weeklyProgress.count}/{WEEKLY_GOAL} entries
              </div>
              <div className="text-xs font-semibold text-gray-500">since {weeklyProgress.weekStartKey}</div>
            </div>

            <div className="mt-3 w-full h-2.5 rounded-full bg-white border border-gray-200 overflow-hidden">
              <div className="h-full bg-primary-500" style={{ width: `${weeklyProgress.pct}%` }} />
            </div>

            <div className="mt-2 text-xs font-semibold text-gray-500">
              {weeklyProgress.pct >= 100 ? "Goal achieved 🎉" : "Small wins add up."}
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Your patterns */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
        <div>
          <div className="text-sm font-extrabold text-gray-900">Your patterns</div>
          <div className="text-xs font-semibold text-gray-500">
            Win rate & Avg Move% (based on current price)
          </div>
        </div>

        {performanceStats.sampleN === 0 ? (
          <div className="text-sm text-gray-500">
            There is not enough data yet to build statistics (entries need both trade_price and ticker).
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-2xl p-4">
              <div className="text-xs font-extrabold text-gray-700 mb-3">By emotion</div>
              <div className="space-y-2">
                {performanceStats.emotionList.slice(0, 6).map((s) => {
                  const winRate = s.n ? Math.round((s.win / s.n) * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-gray-900 truncate">{s.label}</div>
                        <div className="text-[11px] font-semibold text-gray-500">{s.n} samples</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-extrabold text-gray-900">{winRate}%</div>
                        <div className={`text-[11px] font-bold ${s.avgMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          Avg {s.avgMove >= 0 ? "+" : ""}
                          {s.avgMove.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border border-gray-200 rounded-2xl p-4">
              <div className="text-xs font-extrabold text-gray-700 mb-3">By driver</div>
              <div className="space-y-2">
                {performanceStats.driverList.slice(0, 6).map((s) => {
                  const winRate = s.n ? Math.round((s.win / s.n) * 100) : 0;
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-gray-900 truncate">{s.label}</div>
                        <div className="text-[11px] font-semibold text-gray-500">{s.n} samples</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-extrabold text-gray-900">{winRate}%</div>
                        <div className={`text-[11px] font-bold ${s.avgMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          Avg {s.avgMove >= 0 ? "+" : ""}
                          {s.avgMove.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sm:col-span-2 border border-gray-200 rounded-2xl p-4 bg-gray-50">
              <div className="text-xs font-extrabold text-gray-700 mb-2">Pattern watch</div>
              {performanceStats.worstCombo ? (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-gray-900">
                      "{getEmotionLabel(performanceStats.worstCombo.emo)}" + "{getReasonLabel(performanceStats.worstCombo.drv)}"
                    </div>
                    <div className="text-[11px] font-semibold text-gray-500">
                      {performanceStats.worstCombo.n} samples · Win rate {Math.round(performanceStats.worstCombo.winRate * 100)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-extrabold ${performanceStats.worstCombo.avgMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      Avg {performanceStats.worstCombo.avgMove >= 0 ? "+" : ""}
                      {performanceStats.worstCombo.avgMove.toFixed(2)}%
                    </div>
                    <div className="text-[11px] font-semibold text-gray-500">
                      If this combination keeps repeating, it’s a good idea to write down stricter rules or
                      pre-conditions for yourself.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  There is not enough data yet to build combination patterns (need at least 2 entries with the
                  same emotion + driver).
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ✅ Filter */}
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

      {/* ✅ List */}
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

            const recheckText = formatRecheckLabel(entry?.recheck_pct);
            const recheckNow = isRecheckNow(movePct, entry?.recheck_pct);

            // ✅ Show Recheck-related tags only on the latest entry for each ticker
            const isLatestForTicker = !!symbol && latestEntryIdByTicker[symbol] === entry.id;
            const showRecheckTags = isLatestForTicker && (recheckNow || recheckText);

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setViewingId(entry.id)}
                className="w-full text-left bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 flex flex-wrap gap-2">
                    {/* TRADE */}
                    <ChipGroup>
                      <Tooltip text="Emotion selected when you wrote this entry">
                        <span tabIndex={0} className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${getEmotionColor(entry.emotion)}`}>
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
                          <span tabIndex={0} className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200">
                            Entry {formatPrice(entryPrice, symbol)}
                          </span>
                        </Tooltip>
                      )}

                      {Number.isFinite(qty) && (
                        <Tooltip text="Executed quantity at the time of trade">
                          <span tabIndex={0} className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200">
                            Qty {qty}
                          </span>
                        </Tooltip>
                      )}
                    </ChipGroup>

                    {/* PLAN (✅ shown only for the latest entry of each ticker) */}
                    {showRecheckTags && (
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
                            <span tabIndex={0} className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-bold border border-amber-100">
                              {recheckText}
                            </span>
                          </Tooltip>
                        )}
                      </ChipGroup>
                    )}

                    {/* PERFORMANCE */}
                    {Number.isFinite(current as number) && symbol && (
                      <ChipGroup>
                        <Tooltip text="Current live price (polled/cached)">
                          <span tabIndex={0} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-100">
                            Now {formatPrice(current!, symbol)}
                          </span>
                        </Tooltip>

                        {Number.isFinite(movePct as number) && (
                          <Tooltip text="Move% from entry (based on current price)">
                            <span
                              tabIndex={0}
                              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1.5 ${
                                (effectiveMovePct(entry, movePct) ?? 0) >= 0
                                  ? "bg-green-50 text-green-700 border border-green-100"
                                  : "bg-red-50 text-red-700 border border-red-100"
                              }`}
                            >
                              {(effectiveMovePct(entry, movePct) ?? 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              Move {(effectiveMovePct(entry, movePct) ?? 0) >= 0 ? "+" : ""}
                              {(effectiveMovePct(entry, movePct) ?? 0).toFixed(2)}%
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
                        timeZone: TIMEZONE,
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

                  {/* Trade snapshot */}
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

      {/* ✅ Weekly Report Modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end sm:items-center justify-center min-h-full p-4 text-center sm:p-0">
            <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity" onClick={closeReport} />

            <div className="relative bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-3xl w-full animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-white px-6 py-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Weekly Report</div>
                    <div className="text-xl font-extrabold text-gray-900">{reportWeekRangeLabel}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Tooltip text="Previous week">
                      <button
                        type="button"
                        onClick={goPrevWeek}
                        className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50"
                      >
                        <ChevronLeft size={18} />
                      </button>
                    </Tooltip>
                    <Tooltip text="Next week">
                      <button
                        type="button"
                        onClick={goNextWeek}
                        className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </Tooltip>

                    <button
                      onClick={closeReport}
                      className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full ml-2"
                      type="button"
                    >
                      <X size={22} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left: metrics */}
                  <div className="space-y-4">
                    {/* Coverage */}
                    <div className="border border-gray-200 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-extrabold text-gray-700">Diary Coverage (this week)</div>
                          <div className="text-[11px] font-semibold text-gray-500">trades that have a diary entry</div>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-extrabold text-gray-900">{weekCoverage.pct}%</div>
                          <div className="text-[11px] font-semibold text-gray-500">
                            {weekCoverage.covered}/{weekCoverage.total}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 w-full h-2.5 rounded-full bg-white border border-gray-200 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${weekCoverage.pct}%` }} />
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-gray-500">
                        * Matching rule: (KST date + BUY/SELL + ticker + qty + price)
                      </div>
                    </div>

                    {/* Weekly goal */}
                    <div className="border border-gray-200 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-extrabold text-gray-700">Weekly Goal (this week)</div>
                          <div className="text-[11px] font-semibold text-gray-500">entries written this week</div>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-extrabold text-gray-900">
                            {weekGoal.count}/{WEEKLY_GOAL}
                          </div>
                          <div className="text-[11px] font-semibold text-gray-500">{weekGoal.pct}%</div>
                        </div>
                      </div>

                      <div className="mt-3 w-full h-2.5 rounded-full bg-white border border-gray-200 overflow-hidden">
                        <div className="h-full bg-primary-500" style={{ width: `${weekGoal.pct}%` }} />
                      </div>
                    </div>

                    {/* Week patterns */}
                    <div className="border border-gray-200 rounded-2xl p-4">
                      <div className="text-xs font-extrabold text-gray-700">Your Patterns (this week)</div>
                      <div className="text-[11px] font-semibold text-gray-500">Win rate & Avg Move% (current price)</div>

                      {weekPatterns.sampleN === 0 ? (
                        <div className="mt-3 text-sm text-gray-500">
                          There are not enough samples this week to compute meaningful patterns.
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="text-[11px] font-extrabold text-gray-700 mb-1">Top emotions</div>
                            <div className="space-y-1">
                              {weekPatterns.emotion.slice(0, 3).map((s) => (
                                <div key={s.key} className="flex items-center justify-between">
                                  <div className="text-sm font-extrabold text-gray-900 truncate">{s.label}</div>
                                  <div className="text-right">
                                    <div className="text-sm font-extrabold text-gray-900">{Math.round(s.winRate * 100)}%</div>
                                    <div className={`text-[11px] font-bold ${s.avgMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                      Avg {s.avgMove >= 0 ? "+" : ""}
                                      {s.avgMove.toFixed(2)}%
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-extrabold text-gray-700 mb-1">Top drivers</div>
                            <div className="space-y-1">
                              {weekPatterns.driver.slice(0, 3).map((s) => (
                                <div key={s.key} className="flex items-center justify-between">
                                  <div className="text-sm font-extrabold text-gray-900 truncate">{s.label}</div>
                                  <div className="text-right">
                                    <div className="text-sm font-extrabold text-gray-900">{Math.round(s.winRate * 100)}%</div>
                                    <div className={`text-[11px] font-bold ${s.avgMove >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                      Avg {s.avgMove >= 0 ? "+" : ""}
                                      {s.avgMove.toFixed(2)}%
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="text-[11px] font-semibold text-gray-500">sample {weekPatterns.sampleN}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: AI coach summary */}
                  <div className="border border-gray-200 rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-extrabold text-gray-700">AI Coach Summary</div>
                        <div className="text-[11px] font-semibold text-gray-500">
                          This uses all entries in the selected week (emotion~what_if~note).
                        </div>
                      </div>

                      <Tooltip text="Generate weekly report summary (LLM)">
                        <button
                          type="button"
                          onClick={generateWeeklyReport}
                          disabled={reportLoading || weekDiaryEntries.length === 0}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-primary-200 bg-primary-50 text-xs font-extrabold text-primary-700 hover:bg-primary-100 hover:border-primary-300 disabled:opacity-50 disabled:hover:bg-primary-50"
                        >
                          {reportLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Generate
                        </button>
                      </Tooltip>
                    </div>

                    <div className="mt-4 flex-1 min-h-[220px]">
                      {weekDiaryEntries.length === 0 ? (
                        <div className="text-sm text-gray-500">
                          There are no diary entries for the selected week.
                        </div>
                      ) : reportError ? (
                        <div className="text-sm font-semibold text-red-600 whitespace-pre-wrap break-words">{reportError}</div>
                      ) : reportOutput ? (
                        <pre className="text-xs font-semibold text-gray-800 whitespace-pre-wrap break-words bg-gray-50 border border-gray-200 rounded-xl p-3 overflow-auto max-h-[420px]">
                          {reportOutput}
                        </pre>
                      ) : (
                        <div className="text-sm text-gray-500">
                          Click <span className="font-bold">Generate</span> in the top-right to create a weekly
                          summary and AI coach report.
                        </div>
                      )}
                    </div>

                    {/* Footer actions */}
                    <div className="mt-4 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={closeReport}
                        className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-extrabold text-gray-700 hover:bg-gray-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>

                {/* Optional: show included entries count */}
                <div className="mt-4 text-[11px] font-semibold text-gray-500">
                  Included entries: <span className="font-extrabold text-gray-700">{weekDiaryEntries.length}</span>
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
