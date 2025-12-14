import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppContextType, AppState, UserProfile, DiaryEntry, Transaction, MarketCondition, NewsItem } from '../types';
import { DEFAULT_STATE } from '../constants';
import { generateDashboardLearningCards, generateDashboardQuizzes } from '../services/geminiService';

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'finguide_app_state_v3'; // Bump version for new diary shape

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const merged = { ...DEFAULT_STATE, ...parsed };
        // 기존 사용자 데이터 마이그레이션: cash_krw가 없으면 기본값 추가
        if (merged.portfolio && typeof merged.portfolio.cash_krw === 'undefined') {
          merged.portfolio.cash_krw = DEFAULT_STATE.portfolio.cash_krw;
        }
        return merged;
      } catch (e) {
        return DEFAULT_STATE;
      }
    }
    return DEFAULT_STATE;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Prefetch AI-generated learning content in the background on first app load.
  // This warms up the "Learning" page so that the first visit feels instant
  // (it will read from localStorage instead of waiting for a fresh API call).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const LS_LEARNING_KEY = 'dashboard_learning_v1';
    const LS_QUIZ_KEY = 'dashboard_quizzes_v1';
    const LS_NEWS_KEY = 'market_news_v1';

    const prefetch = async () => {
      try {
        // Prefetch learning cards if no cache exists yet
        try {
          const stored = window.localStorage.getItem(LS_LEARNING_KEY);
          if (!stored) {
            const cards = await generateDashboardLearningCards(3);
            window.localStorage.setItem(
              LS_LEARNING_KEY,
              JSON.stringify({ seed: 0, cards })
            );
          }
        } catch (err) {
          // Swallow errors so the app shell never breaks because of AI issues
          console.warn('[AppProvider] Failed to prefetch learning cards:', err);
        }

        // Prefetch quizzes if no cache exists yet
        try {
          const storedQuizzes = window.localStorage.getItem(LS_QUIZ_KEY);
          if (!storedQuizzes) {
            const quizzes = await generateDashboardQuizzes(3);
            window.localStorage.setItem(
              LS_QUIZ_KEY,
              JSON.stringify({ seed: 0, quizzes })
            );
          }
        } catch (err) {
          console.warn('[AppProvider] Failed to prefetch quizzes:', err);
        }

        // Prefetch default market news list (no symbol filter) if no cache exists yet
        try {
          const storedNews = window.localStorage.getItem(LS_NEWS_KEY);
          if (!storedNews) {
            const res = await fetch('http://localhost:5002/api/news');
            if (res.ok) {
              const data: any = await res.json();
              const raw = Array.isArray(data?.news) ? data.news : [];

              if (raw.length > 0) {
                const seenIds = new Set<string>();
                const seenTitleSource = new Set<string>();

                const formatted: NewsItem[] = raw
                  .map((item: any, index: number) => {
                    let newsId =
                      item.id ||
                      `${Date.now()}_${index}_${Math.random()
                        .toString(36)
                        .substr(2, 9)}`;
                    if (seenIds.has(newsId)) {
                      newsId = `${Date.now()}_${index}_${Math.random()
                        .toString(36)
                        .substr(2, 9)}`;
                    }
                    seenIds.add(newsId);

                    const timestamp = typeof item.date === 'number' ? item.date : 0;
                    const date = timestamp ? new Date(timestamp * 1000) : null;

                    const rawSymbols = Array.isArray(item.related_symbols)
                      ? item.related_symbols
                      : [];
                    const cleanedSymbols = Array.from(
                      new Set(
                        rawSymbols
                          .map((s: string) => (s || '').trim())
                          .filter(Boolean)
                          .map((s: string) =>
                            /^[a-zA-Z0-9.]+$/.test(s) ? s.toUpperCase() : s,
                          ),
                      ),
                    );

                    const title: string = (item.title || '').trim();
                    const source: string = (item.source || '').trim();
                    const titleKey = title.toLowerCase();
                    const sourceKey = source.toLowerCase();
                    if (!titleKey) return null;
                    const composite = `${titleKey}|${sourceKey}`;
                    if (seenTitleSource.has(composite)) {
                      return null;
                    }
                    seenTitleSource.add(composite);

                    return {
                      ...(item as any),
                      id: newsId,
                      title,
                      source,
                      date: date ? date.toLocaleDateString() : 'Recently',
                      impact: item.impact || 'neutral',
                      related_symbols: cleanedSymbols,
                    } as NewsItem;
                  })
                  .filter(Boolean) as NewsItem[];

                if (formatted.length > 0) {
                  window.localStorage.setItem(
                    LS_NEWS_KEY,
                    JSON.stringify({ news: formatted }),
                  );
                }
              }
            }
          }
        } catch (err) {
          console.warn('[AppProvider] Failed to prefetch market news:', err);
        }
      } catch {
        // Top-level safety: never block app load due to prefetch
      }
    };

    // Fire and forget – no need to await
    prefetch();
  }, []);

  const updateUser = useCallback((userData: Partial<UserProfile>) => {
    setState(prev => ({ ...prev, user: { ...prev.user, ...userData } }));
  }, []);

  const setMarketCondition = useCallback((condition: MarketCondition) => {
    setState(prev => ({ ...prev, marketCondition: condition }));
  }, []);

  const executeTrade = useCallback((type: 'BUY' | 'SELL', symbol: string, quantity: number, price: number) => {
    setState(prev => {
      const totalCost = quantity * price;
      const isKoreanStock = symbol.endsWith('.KS') || symbol.endsWith('.KQ');
      
      let newCash = prev.portfolio.cash;
      let newCashKrw = prev.portfolio.cash_krw;
      let newAssets = [...prev.portfolio.assets];

      if (type === 'BUY') {
        if (isKoreanStock) {
          if (newCashKrw < totalCost) {
            alert("Insufficient KRW balance in your practice account. Try a smaller size — this is a safe place to experiment.");
            return prev;
          }
          newCashKrw -= totalCost;
        } else {
          if (newCash < totalCost) {
            alert("Insufficient virtual funds in your practice account. Try a smaller size — mistakes here cost nothing.");
            return prev;
          }
          newCash -= totalCost;
        }
        
        const existingAssetIndex = newAssets.findIndex(a => a.symbol === symbol);
        if (existingAssetIndex >= 0) {
          const asset = newAssets[existingAssetIndex];
          const totalValue = (asset.quantity * asset.avg_price) + totalCost;
          const newQuantity = asset.quantity + quantity;
          newAssets[existingAssetIndex] = {
            ...asset,
            quantity: newQuantity,
            avg_price: totalValue / newQuantity
          };
        } else {
          newAssets.push({ symbol, quantity, avg_price: price });
        }
      } else {
        // SELL
        const existingAssetIndex = newAssets.findIndex(a => a.symbol === symbol);
        if (existingAssetIndex < 0 || newAssets[existingAssetIndex].quantity < quantity) {
          alert("You’re trying to sell more than you hold in this practice account. Adjust the quantity and try again.");
          return prev;
        }
        
        if (isKoreanStock) {
          newCashKrw += totalCost;
        } else {
          newCash += totalCost;
        }
        
        newAssets[existingAssetIndex].quantity -= quantity;
        if (newAssets[existingAssetIndex].quantity === 0) {
          newAssets.splice(existingAssetIndex, 1);
        }
      }

      // 포트폴리오 가치 계산 (달러 기준으로 통합)
      const currentPortfolioValue = newCash + newAssets.reduce((sum, asset) => {
        const assetPrice = asset.symbol === symbol ? price : asset.avg_price;
        return sum + (asset.quantity * assetPrice);
      }, 0);

      const newTransaction: Transaction = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        type,
        symbol,
        quantity,
        price
      };

      return {
        ...prev,
        portfolio: {
          ...prev.portfolio,
          cash: newCash,
          cash_krw: newCashKrw,
          assets: newAssets,
          total_value_history: [
            ...prev.portfolio.total_value_history,
            { date: new Date().toISOString().split('T')[0], value: currentPortfolioValue }
          ]
        },
        transactions: [newTransaction, ...prev.transactions]
      };
    });
  }, []);

  const addDiaryEntry = useCallback((entry: Omit<DiaryEntry, 'id' | 'date'>) => {
    const id = Date.now().toString();
    const newEntry: DiaryEntry = {
      ...entry,
      id,
      date: new Date().toISOString()
    };
    setState(prev => ({ ...prev, diary: [newEntry, ...prev.diary] }));
    return id;
  }, []);

  const updateDiaryEntry = useCallback((id: string, updates: Partial<DiaryEntry>) => {
    setState(prev => ({
      ...prev,
      diary: prev.diary.map(entry => entry.id === id ? { ...entry, ...updates } : entry)
    }));
  }, []);

  const resetApp = useCallback(() => {
    setState(DEFAULT_STATE);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AppContext.Provider value={{ ...state, updateUser, setMarketCondition, executeTrade, addDiaryEntry, updateDiaryEntry, resetApp }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
