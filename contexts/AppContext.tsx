import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppContextType, AppState, UserProfile, DiaryEntry, Transaction, MarketCondition } from '../types';
import { DEFAULT_STATE } from '../constants';

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
