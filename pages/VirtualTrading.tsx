import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { MOCK_STOCKS, INITIAL_CAPITAL, INITIAL_CAPITAL_KRW } from '../constants';
import { Stock } from '../types';
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
} from 'lucide-react';
import { searchNasdaqStocks, getYFinanceQuotes } from '../services/stockService';

const QUOTE_CACHE_KEY = 'finguide_live_quotes_v1';

const VirtualTrading: React.FC = () => {
  const { user, portfolio, transactions, executeTrade, addDiaryEntry } = useApp();
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState<number | string>(1);

  // --- 검색 & 실시간 시세 상태 ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchCache, setSearchCache] = useState<Record<string, Stock[]>>({});
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; change_pct: number }>>({});
  const [stockNames, setStockNames] = useState<Record<string, string>>({}); // 종목 이름 캐시
  const [lastTrade, setLastTrade] = useState<{ type: 'BUY' | 'SELL'; symbol: string } | null>(null);
  const [showReflection, setShowReflection] = useState(false);
  const [reflectionData, setReflectionData] = useState({
    emotion: 'neutral',
    reason: 'analysis',
    note: '',
  });

  // 화면에 보여줄 종목 리스트 (검색 결과가 있으면 그걸 우선 사용)
  const visibleStocks: Stock[] =
    searchQuery.trim() && searchResults.length > 0 ? searchResults : MOCK_STOCKS;

  // 한국 주식인지 확인하는 헬퍼 함수 (useMemo보다 먼저 정의)
  const isKoreanStock = (symbol: string) => {
    return symbol.endsWith('.KS') || symbol.endsWith('.KQ');
  };

  // --- 로컬 캐시에서 마지막 실시간 시세 복원 ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUOTE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, { price: number; change_pct: number }>;
        setLivePrices(parsed);
      }
    } catch (e) {
      console.warn('Failed to load quote cache', e);
    }
  }, []);

  // --- Portfolio Calculations (실시간 시세를 반영한 총 평가액) ---
  const { nasdaqHoldingsValue, koreanHoldingsValue } = useMemo(() => {
    let nasdaq = 0;
    let korean = 0;
    
    portfolio.assets.forEach(asset => {
      const live = livePrices[asset.symbol];
      const currentPrice = live?.price ?? asset.avg_price;
      const value = asset.quantity * currentPrice;
      
      if (isKoreanStock(asset.symbol)) {
        korean += value;
      } else {
        nasdaq += value;
      }
    });
    
    return { nasdaqHoldingsValue: nasdaq, koreanHoldingsValue: korean };
  }, [livePrices, portfolio.assets]);

  const nasdaqEquity = portfolio.cash + nasdaqHoldingsValue;
  const koreanEquity = portfolio.cash_krw + koreanHoldingsValue;
  
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

    // 같은 쿼리는 캐시에서 즉시 반환 (API 한도 회피 + 안정성)
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
        // API 한도 초과나 일시 오류일 수 있으므로, 이전 결과는 유지하고 메시지만 보여줌
        setSearchError('지금은 외부 주가 API 한도/오류로 검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      } else {
        setSearchResults(results);
        setSearchCache((prev) => ({ ...prev, [q]: results }));
      }
    } catch (err) {
      console.error("Stock search failed:", err);
      setSearchError('검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSearching(false);
    }
  };

  // --- 실시간 시세 업데이트 (폴링: 기본 6종목 + 검색 종목 + 보유 종목 전체에 대해, 몇 분에 한 번만) ---
  useEffect(() => {
    const symbols = Array.from(
      new Set([
        ...MOCK_STOCKS.map((s) => s.symbol),
        ...searchResults.map((s) => s.symbol),
        ...portfolio.assets.map((a) => a.symbol),
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
              console.warn('Failed to save quote cache', e);
            }
            return merged;
          });
        }
      } catch (err) {
        console.error("Realtime quote fetch error:", err);
      }
    };

    // 첫 로딩 + 3분마다 갱신 (너무 자주 바뀌지 않도록)
    fetchQuotes();
    const id = window.setInterval(fetchQuotes, 3 * 60 * 1000);
    return () => {
      isCancelled = true;
      window.clearInterval(id);
    };
  }, [searchResults, portfolio.assets]);

  // --- Handlers ---
  const handleOpenTrade = (stock: Stock) => {
    const live = livePrices[stock.symbol];
    const stockWithLivePrice: Stock = live
      ? { ...stock, price: live.price, change_pct: live.change_pct }
      : stock;
    setSelectedStock(stockWithLivePrice);
    setTradeType('BUY');
    setQuantity(1);
  };

  const handleCloseTrade = () => {
    setSelectedStock(null);
  };

  const handleExecute = () => {
    if (!selectedStock) return;
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid quantity.");
      return;
    }

    executeTrade(tradeType, selectedStock.symbol, qty, selectedStock.price);
    setLastTrade({ type: tradeType, symbol: selectedStock.symbol });
    setShowReflection(true);
  };

  const getOwnedQuantity = (symbol: string) => {
    return portfolio.assets.find((a) => a.symbol === symbol)?.quantity || 0;
  };

  // 통화 포맷팅 헬퍼 함수
  const formatPrice = (price: number, symbol: string) => {
    if (isKoreanStock(symbol)) {
      return `₩${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  // 심볼로 종목 이름 찾기
  const getStockName = (symbol: string): string => {
    // 캐시에서 찾기
    if (stockNames[symbol]) return stockNames[symbol];
    
    // visibleStocks에서 찾기
    const found = visibleStocks.find(s => s.symbol === symbol);
    if (found) {
      setStockNames(prev => ({ ...prev, [symbol]: found.name }));
      return found.name;
    }
    
    // searchResults에서 찾기
    const foundInSearch = searchResults.find(s => s.symbol === symbol);
    if (foundInSearch) {
      setStockNames(prev => ({ ...prev, [symbol]: foundInSearch.name }));
      return foundInSearch.name;
    }
    
    // MOCK_STOCKS에서 찾기
    const foundInMock = MOCK_STOCKS.find(s => s.symbol === symbol);
    if (foundInMock) {
      setStockNames(prev => ({ ...prev, [symbol]: foundInMock.name }));
      return foundInMock.name;
    }
    
    // 못 찾으면 심볼 반환
    return symbol;
  };

  // 보유 종목과 거래 내역의 종목 이름 가져오기
  useEffect(() => {
    const fetchStockNames = async () => {
      const symbolsToFetch: string[] = [];
      const allSymbols = new Set<string>();
      
      // 보유 종목의 심볼
      portfolio.assets.forEach(asset => {
        allSymbols.add(asset.symbol);
      });
      
      // 거래 내역의 심볼
      transactions.forEach(tx => {
        allSymbols.add(tx.symbol);
      });
      
      // 이미 이름을 알고 있는 종목 제외
      allSymbols.forEach(symbol => {
        if (!stockNames[symbol] 
            && !visibleStocks.find(s => s.symbol === symbol) 
            && !searchResults.find(s => s.symbol === symbol) 
            && !MOCK_STOCKS.find(s => s.symbol === symbol)) {
          symbolsToFetch.push(symbol);
        }
      });
      
      if (symbolsToFetch.length === 0) return;
      
      // 백엔드 API로 종목 이름 가져오기
      const namePromises = symbolsToFetch.map(async (symbol) => {
        try {
          const res = await fetch(`http://localhost:5002/api/search?query=${encodeURIComponent(symbol)}`);
          if (!res.ok) return null;
          const data = await res.json();
          const result = data.results?.find((r: any) => r.symbol === symbol);
          if (result && result.name) {
            return { symbol, name: result.name };
          }
        } catch (err) {
          console.error(`[yfinance] Failed to fetch name for ${symbol}:`, err);
        }
        return null;
      });
      
      const results = await Promise.all(namePromises);
      const newNames: Record<string, string> = {};
      results.forEach(result => {
        if (result) {
          newNames[result.symbol] = result.name;
        }
      });
      
      if (Object.keys(newNames).length > 0) {
        setStockNames(prev => ({ ...prev, ...newNames }));
      }
    };
    
    fetchStockNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.assets.map(a => a.symbol).join(','), transactions.map(t => t.symbol).join(',')]);

  const handleSaveReflection = () => {
    if (lastTrade) {
       addDiaryEntry({
         emotion: reflectionData.emotion as any,
         reason: reflectionData.reason as any,
         note: `[Post-Trade Reflection for ${lastTrade.type} ${lastTrade.symbol}] ${reflectionData.note}`,
        related_symbol: lastTrade.symbol,
       });
    }
    setShowReflection(false);
    setReflectionData({ emotion: 'neutral', reason: 'analysis', note: '' });
  };

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
            나스닥 및 한국 주식의 <strong>심볼(ticker)</strong>을 검색해서 가상으로 매매해보세요. 
            한국 주식은 코스피는 <strong>.KS</strong>, 코스닥은 <strong>.KQ</strong>를 붙여주세요.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
                <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <PieChart size={14} className="shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider truncate">Equity (NASDAQ)</span>
                </div>
            <p className="text-sm sm:text-base font-extrabold text-gray-900 truncate" title={`$${nasdaqEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
              ${nasdaqEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            </div>
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
                <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <PieChart size={14} className="shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider truncate">Equity (한국)</span>
                </div>
            <p className="text-sm sm:text-base font-extrabold text-gray-900 truncate" title={`₩${koreanEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
              ₩{koreanEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            </div>
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
                <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <Wallet size={14} className="shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider truncate">Buying Power</span>
                </div>
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs sm:text-sm font-extrabold text-gray-900 truncate" title={`$${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}>
                ${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] sm:text-xs font-bold text-gray-600 truncate" title={`₩${portfolio.cash_krw.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
                ₩{portfolio.cash_krw.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
                nasdaqPL >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
                    <span className="truncate min-w-0">
                      {nasdaqPL >= 0 ? '+' : ''}${nasdaqPL.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
              <span
                className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                  nasdaqPL >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                        {nasdaqPLPercent.toFixed(2)}%
                    </span>
                </div>
            </div>
            <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 min-w-0">
                 <div className="flex items-center gap-1.5 text-gray-500 mb-1">
                    <BarChart2 size={14} className="shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider truncate">P/L (한국)</span>
                </div>
            <div
              className={`flex items-center gap-1 text-xs sm:text-sm font-extrabold ${
                koreanPL >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
                    <span className="truncate min-w-0">
                      {koreanPL >= 0 ? '+' : ''}₩{koreanPL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
              <span
                className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                  koreanPL >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                        {koreanPLPercent.toFixed(2)}%
                    </span>
                </div>
            </div>
        </div>
      </div>

      {/* 검색 + 종목 그리드 */}
      <div className="space-y-4">
        {/* 검색 바 */}
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
              placeholder="심볼(ticker)만 검색 가능 (예: AAPL, 005930.KS, 123456.KQ)..."
              className="w-full border-none focus:ring-0 text-sm md:text-base text-gray-900 placeholder-gray-400"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {searchError && (
          <p className="text-xs text-red-500 px-1">{searchError}</p>
        )}

        {/* 종목 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleStocks.map((stock) => {
          const owned = getOwnedQuantity(stock.symbol);
            const live = livePrices[stock.symbol];
            // 1순위: 마지막으로 성공적으로 받은 실시간 API 가격
            // 2순위: 과거에 저장돼 있는 stock.price (검색 직후 0일 수 있음)
            // 3순위: 0 (아예 정보가 없을 때만)
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
                          ? 'text-green-600 bg-green-50 px-2 py-1 rounded-md'
                          : 'text-red-600 bg-red-50 px-2 py-1 rounded-md'
                      }`}
                    >
                      {changePct >= 0 ? (
                        <ArrowUpRight size={16} className="mr-1" />
                      ) : (
                        <ArrowDownRight size={16} className="mr-1" />
                      )}
                      {changePct > 0 ? '+' : ''}
                      {changePct.toFixed(2)}%
                  </div>
                </div>

                <div className="flex justify-between items-end mb-6">
                   <div>
                      <p className="text-3xl font-extrabold text-gray-900">
                        {formatPrice(price, stock.symbol)}
                      </p>
                   </div>
                   <div className="text-right">
                      <span className="inline-block px-2 py-1 text-xs font-bold rounded-md uppercase tracking-wider bg-blue-100 text-blue-800">
                        Live
                      </span>
                   </div>
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
                >
                  Trade
                </button>
              </div>
            </div>
          );
        })}
          </div>
      </div>

      {/* 선택한 종목에 대한 간단한 거래 패널 */}
      {selectedStock && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex justify-between items-center">
                <div>
              <h2 className="text-xl font-extrabold text-gray-900">
                     {tradeType === 'BUY' ? 'Buy' : 'Sell'} {selectedStock.symbol}
                   </h2>
              <p className="text-sm text-gray-500">
                현재가 {formatPrice(selectedStock.price, selectedStock.symbol)} · 보유 수량 {getOwnedQuantity(selectedStock.symbol)}
              </p>
                    </div>
            <div className="flex p-1 bg-gray-100 rounded-xl">
                    <button
                className={`flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  tradeType === 'BUY' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                      onClick={() => setTradeType('BUY')}
                    >
                      BUY
                    </button>
                    <button
                className={`flex-1 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                  tradeType === 'SELL' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                      onClick={() => setTradeType('SELL')}
                    >
                      SELL
                    </button>
            </div>
                  </div>

          <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
              수량 {tradeType === 'SELL' && `(최대: ${getOwnedQuantity(selectedStock.symbol)})`}
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
            <span className="text-gray-500 font-medium">예상 거래금액</span>
                    <span className="font-extrabold text-gray-900 text-lg">
              {formatPrice(Number(quantity || 0) * selectedStock.price, selectedStock.symbol)}
                    </span>
                  </div>

          {tradeType === 'BUY' && (() => {
            const totalCost = Number(quantity) * selectedStock.price;
            const isKorean = isKoreanStock(selectedStock.symbol);
            const insufficient = isKorean 
              ? totalCost > portfolio.cash_krw 
              : totalCost > portfolio.cash;
            
            return insufficient && (
              <div className="mb-1 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold">
                       <AlertCircle size={18} />
                {isKorean ? '원화 잔액이 부족합니다.' : '보유 현금이 부족합니다.'}
                     </div>
            );
          })()}

                  {tradeType === 'SELL' && Number(quantity) > getOwnedQuantity(selectedStock.symbol) && (
            <div className="mb-1 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm font-bold">
                        <AlertCircle size={18} />
              보유 수량보다 많이 팔 수 없습니다.
                      </div>
                  )}

          <div className="flex gap-3">
                  <button
                    onClick={handleExecute}
                    disabled={(() => {
                      const qty = Number(quantity);
                      if (qty <= 0) return true;
                      
                      if (tradeType === 'BUY') {
                        const totalCost = qty * selectedStock.price;
                        const isKorean = isKoreanStock(selectedStock.symbol);
                        if (isKorean) {
                          return totalCost > portfolio.cash_krw;
                        } else {
                          return totalCost > portfolio.cash;
                        }
                      }
                      
                      if (tradeType === 'SELL') {
                        return qty > getOwnedQuantity(selectedStock.symbol);
                      }
                      
                      return false;
                    })()}
              className={`flex-1 py-3 rounded-xl font-extrabold text-white text-lg transition-all ${
                      tradeType === 'BUY' 
                        ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-300' 
                        : 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
                    }`}
                  >
                    Confirm {tradeType}
                  </button>
            <button
              type="button"
              onClick={handleCloseTrade}
              className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

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
            <h3 className="text-sm font-bold text-gray-700 mb-3">보유 종목</h3>
            {portfolio.assets.length === 0 ? (
              <p className="text-sm text-gray-400">아직 보유 중인 종목이 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                      Symbol
                    </th>
                    <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                      Name
                    </th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                      Qty
                    </th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                      Avg
                    </th>
                    <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                      Mkt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {portfolio.assets.map((asset) => {
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
                        <td className="py-2 px-2 text-right font-bold">
                          {formatPrice(currentPrice, asset.symbol)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Trade history */}
          <div className="p-4 md:p-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">가상 매매 내역</h3>
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-400">아직 실행된 주문이 없습니다.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Date
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Type
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Symbol
                      </th>
                      <th className="text-left py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Name
                      </th>
                      <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Qty
                      </th>
                      <th className="text-right py-2 px-2 text-xs font-bold text-gray-500 uppercase">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.map((tx) => {
                      const stockName = getStockName(tx.symbol);
                      return (
                        <tr key={tx.id}>
                          <td className="py-2 px-2 text-xs text-gray-500">
                            {new Date(tx.date).toLocaleString()}
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-bold rounded-md uppercase ${
                                tx.type === 'BUY'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-bold text-gray-900">{tx.symbol}</td>
                          <td className="py-2 px-2 text-sm text-gray-600">{stockName}</td>
                          <td className="py-2 px-2 text-right">{tx.quantity}</td>
                          <td className="py-2 px-2 text-right text-gray-600">
                            {formatPrice(tx.price, tx.symbol)}
                          </td>
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

      {/* Post-Trade Reflection Modal (트레이딩 다이어리 연동) */}
      {showReflection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-xl font-extrabold text-gray-900 mb-4">Trade Executed</h2>
            <p className="text-sm text-gray-600 mb-4">
              방금 실행한 가상 매매에 대해 간단히 기록해두면, 트레이딩 다이어리에서 다시 볼 수 있어요.
            </p>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-2">Main Reason</label>
                            <select 
                                className="w-full p-3 bg-blue-50 border-gray-200 rounded-xl font-medium text-gray-900 focus:ring-primary-500 focus:border-primary-500"
                                value={reflectionData.reason}
                  onChange={(e) => setReflectionData({ ...reflectionData, reason: e.target.value })}
                            >
                                <option value="analysis">📈 My Analysis</option>
                                <option value="news">📰 News Event</option>
                                <option value="impulse">⚡ Impulse / FOMO</option>
                                <option value="recommendation">🗣️ Recommendation</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-2">Current Emotion</label>
                             <select 
                                className="w-full p-3 bg-blue-50 border-gray-200 rounded-xl font-medium text-gray-900 focus:ring-primary-500 focus:border-primary-500"
                                value={reflectionData.emotion}
                  onChange={(e) => setReflectionData({ ...reflectionData, emotion: e.target.value })}
                            >
                                <option value="neutral">😐 Neutral</option>
                                <option value="confident">😌 Confident</option>
                                <option value="excited">🤩 Excited</option>
                                <option value="anxious">😰 Anxious</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-900 mb-2">Quick Note (Optional)</label>
                            <textarea 
                                className="w-full p-3 bg-blue-50 border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-primary-500 focus:border-primary-500"
                                rows={2}
                  placeholder="예: 실적 기대감으로 단기 상승을 노렸음..."
                                value={reflectionData.note}
                  onChange={(e) => setReflectionData({ ...reflectionData, note: e.target.value })}
                            />
                        </div>

              <div className="flex gap-3 mt-2">
                        <button 
                            onClick={handleSaveReflection}
                  className="flex-1 py-3.5 bg-primary-600 text-white rounded-xl font-bold text-lg hover:bg-primary-700 transition-colors"
                        >
                            Save to Diary
                        </button>
                <button
                  type="button"
                  onClick={() => setShowReflection(false)}
                  className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  건너뛰기
                        </button>
                    </div>
                </div>
             </div>
        </div>
      )}
    </div>
  );
};

export default VirtualTrading;