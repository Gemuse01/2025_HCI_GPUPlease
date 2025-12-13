import React, { useState, useMemo, useEffect } from "react";
import { useApp } from "../contexts/AppContext";
import {
  MOCK_STOCKS,
  INITIAL_CAPITAL,
  INITIAL_CAPITAL_KRW,
  EMOTION_OPTIONS,
  REASON_OPTIONS,
} from "../constants";
import { Stock } from "../types";
import {
  TrendingUp,
  PieChart,
  Wallet,
  BarChart2,
  Briefcase,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  AlertCircle,
  History,
  Sparkles,
  X,
  Tag,
} from "lucide-react";
import { searchNasdaqStocks, getYFinanceQuotes } from "../services/stockService";

const QUOTE_CACHE_KEY = "finguide_live_quotes_v1";

type Tx = {
  id: string;
  date: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
};

type DiaryEntryLite = {
  id: string;
  date: string;
  emotion?: string;
  reason?: string;
  note?: string;
  related_symbol?: string;
  aiFeedback?: string;

  what_if?: string;
  recheck_pct?: number;
  trade_type?: "BUY" | "SELL";
  trade_qty?: number;
  trade_price?: number;
  trade_executed_at?: string;
};

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

function toNumberOrUndef(v: string): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function formatRecheckLabel(recheckPct?: number) {
  if (typeof recheckPct !== "number" || !Number.isFinite(recheckPct)) return "";
  const sign = recheckPct > 0 ? "+" : "";
  return `Recheck at ${sign}${recheckPct}% move`;
}

/** 작은 Tooltip (hover/focus) */
const Tooltip: React.FC<{
  text: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  /** ✅ form control 감쌀 때만 w-full로 펼치기 */
  fullWidth?: boolean;
}> = ({ text, children, side = "top", fullWidth = false }) => {
  const pos =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : "top-full mt-2 left-1/2 -translate-x-1/2";

  const arrow =
    side === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-l-transparent border-r-transparent border-b-transparent"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-l-transparent border-r-transparent border-t-transparent";

  // ✅ 핵심: inline-flex는 shrink-to-fit이라 w-full이 먹기 어려움 → form일 때만 block w-full
  const wrapperClass = fullWidth
    ? "relative block w-full group outline-none"
    : "relative inline-flex group outline-none";

  return (
    <span className={wrapperClass}>
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

const VirtualTrading: React.FC = () => {
  const app = useApp();
  const { portfolio, transactions, executeTrade, addDiaryEntry } = app as any;
  const diary: DiaryEntryLite[] = ((app as any).diary as DiaryEntryLite[]) || [];

  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState<number | string>(1);

  // --- 검색 & 실시간 시세 상태 ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchCache, setSearchCache] = useState<Record<string, Stock[]>>({});
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change_pct: number }>>({});
  const [stockNames, setStockNames] = useState<Record<string, string>>({});

  // --- Post-trade reflection ---
  const [lastTrade, setLastTrade] = useState<{
    type: "BUY" | "SELL";
    symbol: string;
    quantity: number;
    price: number;
    executedAt: string; // ISO
  } | null>(null);

  const [showReflection, setShowReflection] = useState(false);

  const [reflectionData, setReflectionData] = useState<{
    emotion: string;
    reason: string;
    note: string;
    related_symbol: string;
    what_if: string;
    recheck_pct: string; // controlled input
  }>({
    emotion: "neutral",
    reason: "analysis",
    note: "",
    related_symbol: "",
    what_if: "",
    recheck_pct: "",
  });

  const visibleStocks: Stock[] = searchQuery.trim() && searchResults.length > 0 ? searchResults : MOCK_STOCKS;

  // --- 로컬 캐시에서 마지막 실시간 시세 복원 ---
  useEffect(() => {
    const cached = safeJsonParse<Record<string, { price: number; change_pct: number }>>(
      localStorage.getItem(QUOTE_CACHE_KEY)
    );
    if (cached) setLivePrices(cached);
  }, []);

  // --- Portfolio Calculations (실시간 시세 반영) ---
  const { nasdaqHoldingsValue, koreanHoldingsValue } = useMemo(() => {
    let nasdaq = 0;
    let korean = 0;

    (portfolio?.assets || []).forEach((asset: any) => {
      const live = livePrices[asset.symbol];
      const currentPrice = live?.price ?? asset.avg_price;
      const value = asset.quantity * currentPrice;
      if (isKoreanStock(asset.symbol)) korean += value;
      else nasdaq += value;
    });

    return { nasdaqHoldingsValue: nasdaq, koreanHoldingsValue: korean };
  }, [livePrices, portfolio?.assets]);

  const nasdaqEquity = (portfolio?.cash || 0) + nasdaqHoldingsValue;
  const koreanEquity = (portfolio?.cash_krw || 0) + koreanHoldingsValue;

  const nasdaqPL = nasdaqEquity - INITIAL_CAPITAL;
  const koreanPL = koreanEquity - INITIAL_CAPITAL_KRW;

  const nasdaqPLPercent = (nasdaqPL / INITIAL_CAPITAL) * 100;
  const koreanPLPercent = (koreanPL / INITIAL_CAPITAL_KRW) * 100;

  // --- 나스닥 종목 검색 ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    if (searchCache[q]) {
      setSearchResults(searchCache[q]);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await searchNasdaqStocks(q);
      if (results.length === 0) {
        setSearchError("지금은 외부 주가 API 한도/오류로 검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        setSearchResults(results);
        setSearchCache((prev) => ({ ...prev, [q]: results }));
      }
    } catch (err) {
      console.error("Stock search failed:", err);
      setSearchError("An error occurred during the search. Please try again later.");
    } finally {
      setIsSearching(false);
    }
  };

  // --- 실시간 시세 업데이트 (폴링) ---
  useEffect(() => {
    const symbols = Array.from(
      new Set([
        ...MOCK_STOCKS.map((s) => s.symbol),
        ...searchResults.map((s) => s.symbol),
        ...(portfolio?.assets || []).map((a: any) => a.symbol),
      ])
    );
    if (symbols.length === 0) return;

    let isCancelled = false;

    const fetchQuotes = async () => {
      try {
        const quotes = await getYFinanceQuotes(symbols);
        if (!isCancelled) {
          setLivePrices((prev) => {
            const merged = { ...prev, ...quotes };
            try {
              localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(merged));
            } catch (e) {
              console.warn("Failed to save quote cache", e);
            }
            return merged;
          });
        }
      } catch (err) {
        console.error("Realtime quote fetch error:", err);
      }
    };

    fetchQuotes();
    const id = window.setInterval(fetchQuotes, 3 * 60 * 1000);
    return () => {
      isCancelled = true;
      window.clearInterval(id);
    };
  }, [searchResults, portfolio?.assets]);

  // --- Handlers ---
  const handleOpenTrade = (stock: Stock) => {
    const live = livePrices[stock.symbol];
    const stockWithLivePrice: Stock = live ? { ...stock, price: live.price, change_pct: live.change_pct } : stock;
    setSelectedStock(stockWithLivePrice);
    setTradeType("BUY");
    setQuantity(1);
  };

  const handleCloseTrade = () => setSelectedStock(null);

  const handleExecute = () => {
    if (!selectedStock) return;
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid quantity.");
      return;
    }

    executeTrade(tradeType, selectedStock.symbol, qty, selectedStock.price);

    const tradeSnapshot = {
      type: tradeType,
      symbol: selectedStock.symbol,
      quantity: qty,
      price: selectedStock.price,
      executedAt: new Date().toISOString(),
    };
    setLastTrade(tradeSnapshot);

    setReflectionData((prev) => ({
      ...prev,
      related_symbol: tradeSnapshot.symbol,
    }));

    setShowReflection(true);
  };

  const getOwnedQuantity = (symbol: string) =>
    (portfolio?.assets || []).find((a: any) => a.symbol === symbol)?.quantity || 0;

  const formatPrice = (price: number, symbol: string) => {
    if (isKoreanStock(symbol)) return `₩${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  const getStockName = (symbol: string): string => {
    if (stockNames[symbol]) return stockNames[symbol];

    const found =
      visibleStocks.find((s) => s.symbol === symbol) ||
      searchResults.find((s) => s.symbol === symbol) ||
      MOCK_STOCKS.find((s) => s.symbol === symbol);

    if (found) {
      setStockNames((prev) => ({ ...prev, [symbol]: found.name }));
      return found.name;
    }

    return symbol;
  };

  // 보유 종목과 거래 내역의 종목 이름 가져오기 (필요 시 백엔드로 조회)
  useEffect(() => {
    const fetchStockNames = async () => {
      const symbolsToFetch: string[] = [];
      const allSymbols = new Set<string>();

      (portfolio?.assets || []).forEach((asset: any) => allSymbols.add(asset.symbol));
      (transactions || []).forEach((tx: any) => allSymbols.add(tx.symbol));

      allSymbols.forEach((symbol) => {
        const alreadyKnown =
          stockNames[symbol] ||
          visibleStocks.find((s) => s.symbol === symbol) ||
          searchResults.find((s) => s.symbol === symbol) ||
          MOCK_STOCKS.find((s) => s.symbol === symbol);

        if (!alreadyKnown) symbolsToFetch.push(symbol);
      });

      if (symbolsToFetch.length === 0) return;

      const namePromises = symbolsToFetch.map(async (symbol) => {
        try {
          const res = await fetch(`http://localhost:5002/api/search?query=${encodeURIComponent(symbol)}`);
          if (!res.ok) return null;
          const data = await res.json();
          const result = data.results?.find((r: any) => r.symbol === symbol);
          if (result?.name) return { symbol, name: result.name };
        } catch (err) {
          console.error(`[yfinance] Failed to fetch name for ${symbol}:`, err);
        }
        return null;
      });

      const results = await Promise.all(namePromises);
      const newNames: Record<string, string> = {};
      results.forEach((r) => {
        if (r) newNames[r.symbol] = r.name;
      });

      if (Object.keys(newNames).length > 0) setStockNames((prev) => ({ ...prev, ...newNames }));
    };

    fetchStockNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (portfolio?.assets || []).map((a: any) => a.symbol).join(","),
    (transactions || []).map((t: any) => t.symbol).join(","),
  ]);

  const closeReflectionModal = () => {
    setShowReflection(false);
    setReflectionData({
      emotion: "neutral",
      reason: "analysis",
      note: "",
      related_symbol: "",
      what_if: "",
      recheck_pct: "",
    });
    setLastTrade(null);
  };

  const handleSaveReflection = () => {
    if (!reflectionData.note.trim()) return;

    const recheckPctNum = toNumberOrUndef(reflectionData.recheck_pct);

    // ✅ NOTE: user note is saved "as-is" (no forced Trade line prepend)
    addDiaryEntry({
      emotion: reflectionData.emotion as any,
      reason: reflectionData.reason as any,
      note: reflectionData.note.trim(),
      related_symbol: (reflectionData.related_symbol || lastTrade?.symbol || "").toUpperCase() || undefined,

      what_if: reflectionData.what_if?.trim() || undefined,
      recheck_pct: recheckPctNum,

      trade_type: lastTrade?.type,
      trade_qty: lastTrade?.quantity,
      trade_price: lastTrade?.price,
      trade_executed_at: lastTrade?.executedAt,
    });

    closeReflectionModal();
  };

  // -----------------------------
  // 거래내역 정렬
  // -----------------------------
  const txSorted: Tx[] = useMemo(() => {
    const arr = ([...(transactions || [])] as Tx[]).filter(Boolean);
    arr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return arr;
  }, [transactions]);

  // -----------------------------
  // Coach Facts (룰베이스만)
  // -----------------------------
  const coachFacts = useMemo(() => {
    const lastN = txSorted.slice(0, 30);
    const n = lastN.length;

    if (n === 0) {
      return {
        mostActiveLine: "Most active: —",
        tradeCountLine: "Trade count: —",
        diarySignalsLine: "Diary signals: —",
      };
    }

    const bySymbol = new Map<string, { trades: number }>();
    lastN.forEach((t) => {
      bySymbol.set(t.symbol, { trades: (bySymbol.get(t.symbol)?.trades || 0) + 1 });
    });

    const top = [...bySymbol.entries()].sort((a, b) => b[1].trades - a[1].trades)[0];
    const topSymbol = top?.[0] || "—";
    const topTrades = top?.[1]?.trades || 0;

    const buyCount = lastN.filter((t) => t.type === "BUY").length;
    const sellCount = n - buyCount;
    const avgQty = lastN.reduce((s, t) => s + Math.abs(t.quantity || 0), 0) / n;

    const diaryRecent = (diary || [])
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12);

    const emotionCounts: Record<string, number> = {};
    const reasonCounts: Record<string, number> = {};
    diaryRecent.forEach((d) => {
      if (d.emotion) emotionCounts[d.emotion] = (emotionCounts[d.emotion] || 0) + 1;
      if (d.reason) reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
    });

    const topEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      mostActiveLine: `Most active: ${topSymbol} (${topTrades} trades in last ${Math.min(n, 30)}).`,
      tradeCountLine: `Trade count (last ${n}): BUY ${buyCount} / SELL ${sellCount} · Avg qty ${avgQty.toFixed(1)}.`,
      diarySignalsLine:
        topEmotion || topReason
          ? `Diary signals: ${topEmotion ? `emotion=${topEmotion}` : ""}${topEmotion && topReason ? ", " : ""}${
              topReason ? `driver=${topReason}` : ""
            }.`
          : "Diary signals: —",
    };
  }, [txSorted, diary]);

  // --- JSX ---
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* 상단 요약 카드 */}
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <TrendingUp className="text-primary-600" size={28} />
            Virtual Trading Floor
          </h1>
          <p className="text-gray-600 mt-1">
            Search for NASDAQ and Korean stock <strong>ticker symbols</strong> and try virtual trading. For Korean
            stocks, add <strong>.KS</strong> for KOSPI and <strong>.KQ</strong> for KOSDAQ.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
            <div className="flex items-center gap-1.5 text-gray-500 mb-1">
              <PieChart size={14} className="shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider truncate">Equity (NASDAQ)</span>
            </div>
            <p className="text-sm sm:text-base font-extrabold text-gray-900 truncate">
              ${nasdaqEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
            <div className="flex items-center gap-1.5 text-gray-500 mb-1">
              <PieChart size={14} className="shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider truncate">Equity (Korea)</span>
            </div>
            <p className="text-sm sm:text-base font-extrabold text-gray-900 truncate">
              ₩{koreanEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
            <div className="flex items-center gap-1.5 text-gray-500 mb-1">
              <Wallet size={14} className="shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider truncate">Buying Power</span>
            </div>
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs sm:text-sm font-extrabold text-gray-900 truncate">
                ${(portfolio?.cash || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] sm:text-xs font-bold text-gray-600 truncate">
                ₩{(portfolio?.cash_krw || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
            <div className="flex items-center gap-1.5 text-gray-500 mb-1">
              <BarChart2 size={14} className="shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider truncate">P/L (NASDAQ)</span>
            </div>
            <div
              className={`flex items-center gap-1 text-xs sm:text-sm font-extrabold ${
                nasdaqPL >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              <span className="truncate min-w-0">
                {nasdaqPL >= 0 ? "+" : ""}${nasdaqPL.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span
                className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                  nasdaqPL >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}
              >
                {nasdaqPLPercent.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
            <div className="flex items-center gap-1.5 text-gray-500 mb-1">
              <BarChart2 size={14} className="shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider truncate">P/L (Korea)</span>
            </div>
            <div
              className={`flex items-center gap-1 text-xs sm:text-sm font-extrabold ${
                koreanPL >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              <span className="truncate min-w-0">
                {koreanPL >= 0 ? "+" : ""}₩{koreanPL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span
                className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                  koreanPL >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}
              >
                {koreanPLPercent.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 검색 */}
      <div className="space-y-4">
        <form
          onSubmit={handleSearch}
          className="flex flex-col md:flex-row gap-3 md:items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-200"
        >
          <div className="flex-1 flex items-center gap-2">
            <Search className="text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Only ticker symbols can be searched (e.g., AAPL, 005930.KS, 123456.KQ)..."
              className="w-full border-none focus:ring-0 text-sm md:text-base text-gray-900 placeholder-gray-400"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {searchError && <p className="text-xs text-red-500 px-1">{searchError}</p>}
      </div>

      {/* 종목 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleStocks.map((stock) => {
          const owned = getOwnedQuantity(stock.symbol);
          const live = livePrices[stock.symbol];
          const price = live?.price ?? stock.price ?? 0;
          const changePct = live?.change_pct ?? stock.change_pct ?? 0;

          return (
            <div
              key={stock.symbol}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all group"
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {stock.symbol}
                    </h3>
                    <p className="text-sm text-gray-500 font-medium">{stock.name}</p>
                  </div>

                  <div
                    className={`flex items-center text-sm font-bold ${
                      changePct >= 0
                        ? "text-green-600 bg-green-50 px-2 py-1 rounded-md"
                        : "text-red-600 bg-red-50 px-2 py-1 rounded-md"
                    }`}
                  >
                    {changePct >= 0 ? (
                      <ArrowUpRight size={16} className="mr-1" />
                    ) : (
                      <ArrowDownRight size={16} className="mr-1" />
                    )}
                    {changePct > 0 ? "+" : ""}
                    {changePct.toFixed(2)}%
                  </div>
                </div>

                <div className="flex justify-between items-end mb-6">
                  <p className="text-3xl font-extrabold text-gray-900">{formatPrice(price, stock.symbol)}</p>
                  <span className="inline-block px-2 py-1 text-xs font-bold rounded-md uppercase tracking-wider bg-blue-100 text-blue-800">
                    Live
                  </span>
                </div>

                {owned > 0 && (
                  <div className="mb-4 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg flex items-center text-sm font-medium">
                    <Briefcase size={16} className="mr-2" />
                    Owned:&nbsp;<strong>{owned}</strong>
                  </div>
                )}

                <button
                  onClick={() => handleOpenTrade({ ...stock, price })}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-primary-600 transition-colors flex items-center justify-center gap-2"
                  type="button"
                >
                  Trade
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 선택한 종목 거래 패널 */}
      {selectedStock && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">
                {tradeType === "BUY" ? "Buy" : "Sell"} {selectedStock.symbol}
              </h2>
              <p className="text-sm text-gray-500">
                Current Price {formatPrice(selectedStock.price, selectedStock.symbol)} · Quantity Held{" "}
                {getOwnedQuantity(selectedStock.symbol)}
              </p>
            </div>

            <div className="flex p-1 bg-gray-100 rounded-xl">
              <button
                className={`flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  tradeType === "BUY" ? "bg-white text-primary-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setTradeType("BUY")}
                type="button"
              >
                BUY
              </button>
              <button
                className={`flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  tradeType === "SELL" ? "bg-white text-primary-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setTradeType("SELL")}
                type="button"
              >
                SELL
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Quantity {tradeType === "SELL" && `(최대: ${getOwnedQuantity(selectedStock.symbol)})`}
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="block w-full border-gray-300 bg-blue-50 text-gray-900 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 text-lg font-bold"
            />
          </div>

          <div className="flex justify-between py-3 border-t border-b border-gray-100 text-sm">
            <span className="text-gray-500 font-medium">Estimated Trade Amount</span>
            <span className="font-extrabold text-gray-900 text-lg">
              {formatPrice(Number(quantity || 0) * selectedStock.price, selectedStock.symbol)}
            </span>
          </div>

          {tradeType === "BUY" &&
            (() => {
              const totalCost = Number(quantity) * selectedStock.price;
              const insufficient = isKoreanStock(selectedStock.symbol)
                ? totalCost > (portfolio?.cash_krw || 0)
                : totalCost > (portfolio?.cash || 0);

              return insufficient ? (
                <div className="mb-1 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold">
                  <AlertCircle size={18} />
                  {isKoreanStock(selectedStock.symbol) ? "Insufficient KRW balance." : "Insufficient cash balance."}
                </div>
              ) : null;
            })()}

          {tradeType === "SELL" && Number(quantity) > getOwnedQuantity(selectedStock.symbol) && (
            <div className="mb-1 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold">
              <AlertCircle size={18} />
              You can’t sell more than you hold.
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleExecute}
              disabled={(() => {
                const qty = Number(quantity);
                if (qty <= 0) return true;

                if (tradeType === "BUY") {
                  const totalCost = qty * selectedStock.price;
                  return isKoreanStock(selectedStock.symbol)
                    ? totalCost > (portfolio?.cash_krw || 0)
                    : totalCost > (portfolio?.cash || 0);
                }

                return qty > getOwnedQuantity(selectedStock.symbol);
              })()}
              className={`flex-1 py-3 rounded-xl font-extrabold text-white text-lg transition-all ${
                tradeType === "BUY"
                  ? "bg-green-600 hover:bg-green-700 disabled:bg-green-300"
                  : "bg-red-600 hover:bg-red-700 disabled:bg-red-300"
              }`}
              type="button"
            >
              Confirm {tradeType}
            </button>

            <button
              type="button"
              onClick={handleCloseTrade}
              className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ✅ Coach Snapshot */}
      <div className="bg-primary-50 border border-primary-100 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-white rounded-full border border-primary-100 shrink-0">
            <Sparkles size={18} className="text-primary-600" />
          </div>

          <div className="min-w-0 space-y-2">
            <p className="text-sm font-extrabold text-primary-950">Summary</p>

            <div className="text-xs text-primary-900 font-semibold space-y-1">
              <p className="break-words">{coachFacts.mostActiveLine}</p>
              <p className="break-words">{coachFacts.tradeCountLine}</p>
              <p className="break-words">{coachFacts.diarySignalsLine}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 보유 종목 / 거래 내역 섹션 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          <div className="flex-1 py-4 text-sm font-bold text-center flex items-center justify-center gap-2 bg-gray-50">
            <PieChart size={18} /> Current Holdings
          </div>
          <div className="flex-1 py-4 text-sm font-bold text-center flex items-center justify-center gap-2 bg-gray-50 border-l border-gray-200">
            <History size={18} /> Trade History
          </div>
        </div>

        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
          {/* Holdings */}
          <div className="p-4 md:p-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">Holdings</h3>
            {(portfolio?.assets || []).length === 0 ? (
              <p className="text-sm text-gray-400">You don’t have any holdings yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Symbol</th>
                    <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Name</th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">Qty</th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">Avg</th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">Mkt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(portfolio?.assets || []).map((asset: any) => {
                    const live = livePrices[asset.symbol];
                    const currentPrice = live?.price ?? asset.avg_price;
                    const stockName = getStockName(asset.symbol);
                    return (
                      <tr key={asset.symbol}>
                        <td className="py-2 px-2 font-bold text-gray-900">{asset.symbol}</td>
                        <td className="py-2 px-2 text-sm text-gray-600">{stockName}</td>
                        <td className="py-2 px-2 text-right">{asset.quantity}</td>
                        <td className="py-2 px-2 text-right text-gray-500">
                          {formatPrice(asset.avg_price, asset.symbol)}
                        </td>
                        <td className="py-2 px-2 text-right font-bold">{formatPrice(currentPrice, asset.symbol)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Trade history */}
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700">Virtual Trading History</h3>
              <span className="text-[11px] font-bold text-gray-400">Times shown in Asia/Seoul</span>
            </div>

            {txSorted.length === 0 ? (
              <p className="text-sm text-gray-400">You haven’t placed any orders yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Date</th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Type</th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Symbol</th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">Name</th>
                      <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">Qty</th>
                      <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {txSorted.map((tx) => {
                      const stockName = getStockName(tx.symbol);
                      return (
                        <tr key={tx.id}>
                          <td className="py-2 px-2 text-xs text-gray-500">
                            {new Date(tx.date).toLocaleString("en-US", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "Asia/Seoul",
                            })}
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-bold rounded-md uppercase ${
                                tx.type === "BUY" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-bold text-gray-900">{tx.symbol}</td>
                          <td className="py-2 px-2 text-sm text-gray-600">{stockName}</td>
                          <td className="py-2 px-2 text-right">{tx.quantity}</td>
                          <td className="py-2 px-2 text-right text-gray-600">{formatPrice(tx.price, tx.symbol)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Post-Trade Reflection Modal */}
      {showReflection && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end sm:items-center justify-center min-h-full p-4 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity"
              onClick={closeReflectionModal}
            />

            <div className="relative bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg w-full animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-white px-6 py-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-extrabold text-gray-900">New Journal Entry</h3>
                  <button
                    onClick={closeReflectionModal}
                    className="text-gray-400 hover:text-gray-600 p-1 bg-gray-50 rounded-full"
                    type="button"
                  >
                    <X size={24} />
                  </button>
                </div>

                {/* ✅ Trade snapshot as tags + tooltips */}
                {lastTrade && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Tooltip text="These are recorded at the exact moment you executed the trade.">
                      <span
                        tabIndex={0}
                        className="px-2.5 py-1 bg-indigo-50 text-indigo-800 rounded-lg text-xs font-extrabold border border-indigo-100"
                      >
                        Trade Snapshot
                      </span>
                    </Tooltip>

                    <Tooltip text="Trade direction">
                      <span
                        tabIndex={0}
                        className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border ${
                          lastTrade.type === "BUY"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                            : "bg-rose-50 text-rose-700 border-rose-100"
                        }`}
                      >
                        {lastTrade.type}
                      </span>
                    </Tooltip>

                    <Tooltip text="Ticker you traded">
                      <span
                        tabIndex={0}
                        className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 flex items-center gap-1.5"
                      >
                        <Tag size={14} />
                        {lastTrade.symbol}
                      </span>
                    </Tooltip>

                    <Tooltip text="Executed price">
                      <span
                        tabIndex={0}
                        className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                      >
                        Entry {formatPrice(lastTrade.price, lastTrade.symbol)}
                      </span>
                    </Tooltip>

                    <Tooltip text="Executed quantity">
                      <span
                        tabIndex={0}
                        className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold border border-gray-200"
                      >
                        Qty {lastTrade.quantity}
                      </span>
                    </Tooltip>
                  </div>
                )}

                <div className="space-y-5">
                  {/* Emotion pills */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">How are you feeling?</label>
                    <div className="flex flex-wrap gap-2">
                      {(EMOTION_OPTIONS as any[]).map((opt) => (
                        <Tooltip key={opt.value} text="How is your feeling?">
                          <button
                            onClick={() => setReflectionData((prev) => ({ ...prev, emotion: opt.value }))}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                              reflectionData.emotion === opt.value
                                ? `${opt.color} ring-2 ring-offset-1 ring-primary-300 border-transparent`
                                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                            type="button"
                          >
                            {opt.label}
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  </div>

                  {/* Reason + Ticker */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2">Primary Driver</label>
                      <Tooltip fullWidth text="What mainly drove your decision?">
                        <select
                          value={reflectionData.reason}
                          onChange={(e) => setReflectionData((prev) => ({ ...prev, reason: e.target.value }))}
                          className="block w-full border-gray-300 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 text-gray-900 font-medium"
                        >
                          {(REASON_OPTIONS as any[]).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Tooltip>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2">Ticker</label>
                      <Tooltip fullWidth text="The ticker you are trading">
                        <input
                          type="text"
                          value={(reflectionData.related_symbol || lastTrade?.symbol || "").toUpperCase()}
                          onChange={(e) => setReflectionData((prev) => ({ ...prev, related_symbol: e.target.value }))}
                          className="block w-full border-gray-300 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 text-gray-900 font-bold uppercase placeholder:text-gray-400 placeholder:normal-case placeholder:font-normal"
                          placeholder="e.g. AAPL"
                        />
                      </Tooltip>
                    </div>
                  </div>

                  {/* WHAT IF */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">WHAT IF (one failure scenario)</label>
                    <Tooltip fullWidth text="Write one reason your thesis could be wrong.">
                      <textarea
                        rows={3}
                        value={reflectionData.what_if}
                        onChange={(e) => setReflectionData((prev) => ({ ...prev, what_if: e.target.value }))}
                        placeholder="Example: If earnings disappoint or macro conditions shift, my thesis could be wrong."
                        className="block w-full border-gray-300 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 text-gray-900 placeholder-gray-400"
                      />
                    </Tooltip>
                    <p className="mt-1 text-xs text-gray-500">One sentence is enough.</p>
                  </div>

                  {/* PLAN */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">PLAN (recheck trigger %)</label>
                    <div className="flex items-center gap-3">
                      <Tooltip fullWidth text="Mark 'Recheck Now' if the move reaches threshold">
                        <input
                          type="number"
                          value={reflectionData.recheck_pct}
                          onChange={(e) => setReflectionData((prev) => ({ ...prev, recheck_pct: e.target.value }))}
                          placeholder="-7"
                          className="block w-full border-gray-300 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 text-gray-900 font-semibold"
                        />
                      </Tooltip>
                      <span className="text-sm font-semibold text-gray-600 whitespace-nowrap">%</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Example: <span className="font-semibold">-7</span> → {formatRecheckLabel(-7)}
                    </p>
                  </div>

                  {/* Note */}
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">Your Thoughts</label>
                    <Tooltip fullWidth text="This text is shown inside the entry when you open it from Diary.">
                      <textarea
                        rows={4}
                        value={reflectionData.note}
                        onChange={(e) => setReflectionData((prev) => ({ ...prev, note: e.target.value }))}
                        placeholder="What's on your mind? Why did you make this decision? What did you learn?"
                        className="block w-full border-gray-300 rounded-xl py-3 px-4 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 text-gray-900 placeholder-gray-400"
                      />
                    </Tooltip>
                  </div>

                  {/* Save */}
                  <button
                    onClick={handleSaveReflection}
                    disabled={!reflectionData.note.trim()}
                    className="w-full py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:shadow-none disabled:scale-100 text-lg"
                    type="button"
                  >
                    Save Entry
                  </button>

                  {/* Skip */}
                  <button
                    type="button"
                    onClick={closeReflectionModal}
                    className="w-full py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualTrading;
