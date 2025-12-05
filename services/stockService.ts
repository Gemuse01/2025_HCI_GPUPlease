// services/stockService.ts
import type { Stock } from "../types";

// yfinance 백엔드 프록시 URL
const YFINANCE_API_URL = "http://localhost:5002/api/quote";

// 여러 심볼의 실시간 시세 (yfinance 백엔드에 요청)
export async function getYFinanceQuotes(symbols: string[]): Promise<Record<string, { price: number; change_pct: number }>> {
  const quotes: Record<string, { price: number; change_pct: number }> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const url = `${YFINANCE_API_URL}?symbol=${encodeURIComponent(symbol)}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`[yfinance] Failed to fetch ${symbol}: ${res.status} ${res.statusText}`);
          return;
        }
        const data = await res.json();
        if (data.price && data.price > 0) {
          quotes[symbol] = { price: data.price, change_pct: data.change_pct || 0 };
        }
      } catch (err) {
        console.error(`[yfinance] Error fetching ${symbol}:`, err);
      }
    })
  );
  return quotes;
}

// --- 종목검색: yfinance 백엔드를 통한 실제 검색 (나스닥 + 한국 주식 전체)
export async function searchNasdaqStocks(query: string): Promise<Stock[]> {
  if (!query.trim()) return [];
  
  try {
    const res = await fetch(`http://localhost:5002/api/search?query=${encodeURIComponent(query.trim())}`);
    if (!res.ok) {
      console.warn(`[yfinance] Search failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      symbol: r.symbol,
      name: r.name,
      price: r.price || 0,
      change_pct: r.change_pct || 0,
      sector: r.sector || 'N/A',
      volatility: r.volatility || 'medium',
    }));
  } catch (err) {
    console.error("[yfinance] Search error:", err);
    return [];
  }
}


