import { Stock, UserPersona, AppState, NewsItem } from "./types";

export const INITIAL_CAPITAL = 100000; // $100k virtual money
export const INITIAL_CAPITAL_KRW = 100000000; // 1억원 virtual money

export const DEFAULT_STATE: AppState = {
  user: {
    name: '',
    is_onboarded: false,
    persona: UserPersona.UNDECIDED,
    risk_tolerance: 'medium',
    goal: 'learning',
    initial_capital: INITIAL_CAPITAL,
  },
  portfolio: {
    cash: INITIAL_CAPITAL,
    cash_krw: INITIAL_CAPITAL_KRW,
    assets: [],
    total_value_history: [
      { date: '2024-05-01', value: INITIAL_CAPITAL },
    ],
  },
  transactions: [],
  diary: [],
  marketCondition: 'NORMAL',
};

export const MOCK_STOCKS: Stock[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 185.50, change_pct: 1.2, sector: 'Tech', volatility: 'medium' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 172.30, change_pct: -0.5, sector: 'Tech', volatility: 'medium' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 175.80, change_pct: 3.5, sector: 'Auto', volatility: 'high' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', price: 148.20, change_pct: 0.1, sector: 'Healthcare', volatility: 'low' },
  { symbol: 'KO', name: 'Coca-Cola Co.', price: 62.50, change_pct: 0.3, sector: 'Consumer', volatility: 'low' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 950.00, change_pct: 2.8, sector: 'Tech', volatility: 'high' },
];

export const MOCK_NEWS: NewsItem[] = [
  {
    id: '1',
    title: 'Fed Signals Potential Rate Cuts Later This Year',
    source: 'Financial Times',
    date: '2 hours ago',
    summary: 'The Federal Reserve has indicated it may cut interest rates if inflation continues to cool. This is generally positive for tech stocks and the broader market as borrowing costs decrease, potentially boosting corporate profits and consumer spending.',
    impact: 'positive',
    related_symbols: ['AAPL', 'GOOGL', 'NVDA']
  },
  {
    id: '2',
    title: 'Tesla Faces New Supply Chain Hurdles in Asia',
    source: 'Bloomberg',
    date: '5 hours ago',
    summary: 'Reports suggest new logistical challenges could delay shipments for Tesla this quarter. Analysts are concerned this might impact short-term delivery targets and weigh on the stock price until resolved.',
    impact: 'negative',
    related_symbols: ['TSLA']
  },
  {
    id: '3',
    title: 'Consumer Spending Remains Resilient Despite Inflation',
    source: 'Wall Street Journal',
    date: '1 day ago',
    summary: 'Latest data shows retail sales are holding steady, benefiting staple consumer goods companies. This suggests underlying economic strength, which is good for defensive stocks like Coca-Cola and J&J.',
    impact: 'neutral',
    related_symbols: ['KO', 'JNJ']
  }
];

export const PERSONA_DETAILS = {
  [UserPersona.HELPER_SEEKER]: {
    label: "Help Seeker",
    description: "You prefer expert guidance before making moves.",
    advice: "We'll provide more detailed explanations and confirm your understanding before trades."
  },
  [UserPersona.STRUGGLER]: {
    label: "Solo Struggler",
    description: "You try to figure it out yourself but often feel overwhelmed.",
    advice: "We'll offer checklists and simplified summaries to reduce overwhelm."
  },
  [UserPersona.OPTIMIST]: {
    label: "Optimist",
    description: "You believe in opportunities and are quick to act.",
    advice: "We'll add gentle 'speed bumps' like risk reminders to help you double-check."
  },
  [UserPersona.APATHETIC]: {
    label: "Motivation Seeker",
    description: "You find it hard to stay interested or consistent.",
    advice: "We'll keep things very brief and focus on automated alerts and weekly check-ins."
  },
  [UserPersona.UNDECIDED]: {
    label: "New User",
    description: "",
    advice: ""
  }
};

export const EMOTION_OPTIONS = [
  { value: 'confident', label: '😌 Confident', color: 'bg-blue-100 text-blue-800' },
  { value: 'excited', label: '🤩 Excited', color: 'bg-green-100 text-green-800' },
  { value: 'anxious', label: '😰 Anxious', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'regretful', label: '😞 Regretful', color: 'bg-red-100 text-red-800' },
  { value: 'neutral', label: '😐 Neutral', color: 'bg-gray-100 text-gray-800' },
];

export const REASON_OPTIONS = [
  { value: 'analysis', label: '📈 My Analysis' },
  { value: 'news', label: '📰 News Event' },
  { value: 'recommendation', label: '🗣️ Expert Rec.' },
  { value: 'impulse', label: '⚡ Impulse' },
];

export const MOCK_STOCK_ANALYSIS: Record<string, string> = {
  AAPL: "Apple Inc. (AAPL) remains a strong buy in normal market conditions due to its robust ecosystem and consistent services revenue growth. \n\n• **Key Strength**: High cash reserves and loyal customer base.\n• **Risk Factor**: Supply chain dependencies in Asia.\n• **Outlook**: Stable with moderate growth potential.",
  GOOGL: "Alphabet (GOOGL) is facing increased competition in AI but maintains dominance in search advertising. \n\n• **Key Strength**: Market leader in digital ads.\n• **Risk Factor**: Regulatory scrutiny and AI disruption.\n• **Outlook**: Hold for long-term value, monitor AI product rollouts.",
  TSLA: "Tesla (TSLA) is highly volatile and sensitive to interest rate changes and delivery numbers. \n\n• **Key Strength**: EV market leadership and brand value.\n• **Risk Factor**: High valuation multiples and CEO unpredictability.\n• **Outlook**: High risk, potentially high reward. Suitable for aggressive portfolios.",
  JNJ: "Johnson & Johnson (JNJ) offers stability and dividends, making it a classic defensive stock. \n\n• **Key Strength**: Diversified healthcare products and steady cash flow.\n• **Risk Factor**: Ongoing litigation risks (talc).\n• **Outlook**: Conservative buy for capital preservation.",
  KO: "Coca-Cola (KO) is a resilient staple stock that tends to perform well even during economic downturns. \n\n• **Key Strength**: Powerful global brand and pricing power.\n• **Risk Factor**: Currency headwinds from global operations.\n• **Outlook**: Low volatility, good for defensive posturing.",
  NVDA: "NVIDIA (NVDA) is the current leader in AI hardware, experiencing explosive growth but with high volatility. \n\n• **Key Strength**: Dominant market share in AI GPUs.\n• **Risk Factor**: Extremely high valuation expectations.\n• **Outlook**: Aggressive growth play, be prepared for sharp price swings."
};

export const MOCK_DAILY_ADVICE = [
  // 하루에 하나씩 보여줄 실전형 팁
  "Before opening new positions today, check if any single stock exceeds 20% of your total portfolio. If it does, think about diversification.",
  "Volatility is slightly up. Avoid averaging down repeatedly on losers; instead, review your initial thesis and risk limit.",
  "Earnings season is coming. For stocks on your watchlist, skim the last quarter's results and guidance before reacting to headlines.",
  "Remember, cash is also a position. If you feel emotional or tired, it's better to pause trading than to force a decision.",
  "For Korean stocks, check whether your idea depends heavily on a single macro theme (e.g., semiconductors, EV). Concentrated themes can reverse quickly.",
  "If a stock doubled in a short time, ask yourself: if I had only cash today, would I still buy it here? If not, consider trimming.",
];

export type DailyQuiz = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

// 실제 금융/투자 개념 기반 퀴즈 여러 개 (하루에 하나씩 로테이션)
export const DAILY_QUIZZES: DailyQuiz[] = [
  {
    question: "What typically happens to bond prices when interest rates rise?",
    options: [
      "Bond prices rise",
      "Bond prices fall",
      "Bond prices stay the same",
      "Stock prices always fall simultaneously",
    ],
    correctIndex: 1,
    explanation:
      "Bond prices and interest rates have an inverse relationship. When new bonds are issued with higher rates, existing bonds with lower coupons become less attractive, so their market prices fall.",
  },
  {
    question: "Which description best explains a diversified portfolio?",
    options: [
      "Putting all money into one high‑conviction stock",
      "Holding multiple stocks from different sectors and regions",
      "Keeping only cash in a savings account",
      "Buying and selling the same stock repeatedly",
    ],
    correctIndex: 1,
    explanation:
      "Diversification means spreading investments across sectors, regions and asset classes so that a single event does not dominate your total return.",
  },
  {
    question: "In the Korean stock market, what does '005930.KS' represent?",
    options: [
      "A US‑listed ADR",
      "A KOSDAQ growth stock",
      "A KOSPI‑listed company ticker with exchange suffix",
      "An unlisted OTC stock",
    ],
    correctIndex: 2,
    explanation:
      "Tickers ending with '.KS' represent KOSPI‑listed companies on the Korea Exchange. '.KQ' is typically used for KOSDAQ listings.",
  },
  {
    question: "What is the main risk of using leverage (margin) in stock trading?",
    options: [
      "Lower transaction fees",
      "Profits are capped",
      "Losses can exceed your initial capital if the market moves sharply",
      "You cannot diversify your portfolio",
    ],
    correctIndex: 2,
    explanation:
      "Leverage amplifies both gains and losses. In a sharp downturn, margin calls can force you to sell at a loss and even lose more than your original cash.",
  },
  {
    question: "Which of the following is generally true about index ETFs (e.g., S&P 500 ETF)?",
    options: [
      "They try to beat the market by picking a few winning stocks",
      "They passively track a broad market index",
      "They are guaranteed not to lose money",
      "They only hold bonds",
    ],
    correctIndex: 1,
    explanation:
      "Index ETFs aim to replicate the performance of a benchmark index by holding the same or similar basket of securities, rather than actively picking a few names.",
  },
  {
    question: "What does a P/E (price‑to‑earnings) ratio of 30 imply?",
    options: [
      "The company is guaranteed to grow 30% every year",
      "Investors are paying 30 times the company’s annual earnings per share",
      "The dividend yield is 3.0%",
      "The stock is automatically overvalued",
    ],
    correctIndex: 1,
    explanation:
      "A P/E of 30 means the stock price is 30 times the company’s earnings per share. It suggests high expectations but is not by itself proof of overvaluation.",
  },
];

