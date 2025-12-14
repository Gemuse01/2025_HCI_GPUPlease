export enum UserPersona {
  HELPER_SEEKER = 'HELPER_SEEKER',
  STRUGGLER = 'STRUGGLER',
  OPTIMIST = 'OPTIMIST',
  APATHETIC = 'APATHETIC',
  UNDECIDED = 'UNDECIDED'
}

export type MarketCondition = 'NORMAL' | 'BULL' | 'BEAR' | 'CRASH' | 'LIVE';

export interface UserProfile {
  name: string;
  is_onboarded: boolean;
  persona: UserPersona;
  risk_tolerance: 'low' | 'medium' | 'high';
  goal: 'learning' | 'practice' | 'wealth';
  initial_capital: number;
}

export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  sector: string;
  volatility: 'low' | 'medium' | 'high';
}

export interface Asset {
  symbol: string;
  quantity: number;
  avg_price: number;
}

export interface Portfolio {
  cash: number; // USD
  cash_krw: number; // KRW
  assets: Asset[];
  total_value_history: { date: string; value: number }[];
}

export interface Transaction {
  id: string;
  date: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  price: number;
}

export interface DiaryEntry {
  id: string;
  date: string;
  related_symbol?: string;
  emotion: 'confident' | 'anxious' | 'excited' | 'regretful' | 'neutral';
  reason: 'news' | 'analysis' | 'impulse' | 'recommendation';
  note: string;
  aiFeedback?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  date: string;
  summary: string;
  impact: 'positive' | 'negative' | 'neutral';
  related_symbols: string[];
  link?: string;
  fullText?: string;
}

export interface AppState {
  user: UserProfile;
  portfolio: Portfolio;
  transactions: Transaction[];
  diary: DiaryEntry[];
  marketCondition: MarketCondition;
}

export interface AppContextType extends AppState {
  updateUser: (user: Partial<UserProfile>) => void;
  setMarketCondition: (condition: MarketCondition) => void;
  executeTrade: (type: 'BUY' | 'SELL', symbol: string, quantity: number, price: number) => void;
  addDiaryEntry: (entry: Omit<DiaryEntry, 'id' | 'date'>) => string; // Return ID
  updateDiaryEntry: (id: string, updates: Partial<DiaryEntry>) => void;
  resetApp: () => void;
}