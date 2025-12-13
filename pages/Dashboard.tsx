import React, { useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, PieChart, Activity, ArrowRight, Wallet, History, BookOpen, Clock, X, Lightbulb, GraduationCap, CheckCircle2, XCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { MOCK_DAILY_ADVICE, MOCK_STOCKS, INITIAL_CAPITAL, INITIAL_CAPITAL_KRW, DAILY_QUIZZES } from '../constants';
import { generateDashboardLearningCards, generateDashboardQuizzes, type LearningCard, type DashboardQuiz } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

const DEFAULT_LEARNING_CARDS: LearningCard[] = [
  {
    id: 1,
    title: "What is Volatility?",
    duration: "3 min",
    category: "Basic Term",
    content:
      "**Volatility** is a statistical measure of how much the price of an asset moves around its average.\n\n" +
      "In practice, it tells you how \"shaky\" a stock is. High volatility means the price can move a lot in a short time (both up and down). " +
      "Low‑volatility stocks move more slowly and are often used as defensive positions.",
  },
  {
    id: 2,
    title: "Bull vs. Bear Markets",
    duration: "4 min",
    category: "Market Concepts",
    content:
      "A **Bull Market** is a period when prices and sentiment are rising for many months or years.\n\n" +
      "A **Bear Market** is when broad indexes fall 20% or more from a recent high and pessimism dominates. " +
      "Most investors cannot time these perfectly, so a better approach is to keep a long‑term plan and rebalance instead of reacting to every headline.",
  },
  {
    id: 3,
    title: "The Power of Diversification",
    duration: "5 min",
    category: "Strategy",
    content:
      "**Diversification** means not letting a single idea decide your entire future return.\n\n" +
      "By combining assets that do not move in the same way (for example, US tech, Korean exporters, dividend stocks, and some cash), " +
      "you can reduce the chance that one bad event wipes out your progress.",
  },
  {
    id: 4,
    title: "Dollar‑Cost Averaging",
    duration: "4 min",
    category: "Practical Tip",
    content:
      "**Dollar‑cost averaging (DCA)** means investing a fixed amount at regular intervals instead of trying to find the perfect entry price.\n\n" +
      "This reduces timing risk and is especially helpful for beginners who feel nervous about buying at the top.",
  },
  {
    id: 5,
    title: "Reading a Candle Chart Quickly",
    duration: "5 min",
    category: "Charts",
    content:
      "Each **candlestick** shows the open, high, low and close for a period.\n\n" +
      "- A long body means strong buying or selling pressure.\n" +
      "- Long wicks mean the price moved a lot intraday but was rejected.\n" +
      "You don't need complex patterns at first — just notice whether recent candles are mostly strong up, strong down, or indecisive.",
  },
  {
    id: 6,
    title: "KOSPI vs. KOSDAQ vs. US Stocks",
    duration: "5 min",
    category: "Market Concepts",
    content:
      "**KOSPI** is Korea's main large‑cap index, **KOSDAQ** hosts more growth‑oriented and smaller companies, " +
      "and US markets like the S&P 500/Nasdaq contain many global leaders.\n\n" +
      "Mixing these markets can give you both local familiarity and global diversification.",
  },
];

const Dashboard: React.FC = () => {
  const { user, portfolio, transactions, marketCondition } = useApp();
  const [selectedCard, setSelectedCard] = useState<LearningCard | null>(null);
  const [learningCards, setLearningCards] = useState<LearningCard[]>(DEFAULT_LEARNING_CARDS);

  // Quiz state: 슬라이드 형태로 여러 문제를 순서대로 보여주기 위한 상태
  const [quizStates, setQuizStates] = useState<Record<number, { answered: boolean; selectedIndex: number | null }>>({});
  const [activeQuizIdx, setActiveQuizIdx] = useState(0);
  const [quizPool, setQuizPool] = useState<DashboardQuiz[]>(DAILY_QUIZZES);
  const [isLoadingLearning, setIsLoadingLearning] = useState(false);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  // Separate seeds so learning cards and quizzes can be regenerated independently
  const [learningSeed, setLearningSeed] = useState(0);
  const [quizSeed, setQuizSeed] = useState(0);
  // Persisted flags so we don't refetch on every page change
  const [learningInitialized, setLearningInitialized] = useState(false);
  const [quizInitialized, setQuizInitialized] = useState(false);

  const LS_LEARNING_KEY = "dashboard_learning_v1";
  const LS_QUIZ_KEY = "dashboard_quizzes_v1";

  // 한국 주식인지 확인하는 헬퍼 함수
  const isKoreanStock = (symbol: string) => {
    return symbol.endsWith('.KS') || symbol.endsWith('.KQ');
  };

  // Calculate current total portfolio value (한국 주식과 나스닥 구분)
  const { nasdaqHoldingsValue, koreanHoldingsValue } = useMemo(() => {
    let nasdaq = 0;
    let korean = 0;
    
    portfolio.assets.forEach(asset => {
      const currentPrice = MOCK_STOCKS.find(s => s.symbol === asset.symbol)?.price || asset.avg_price;
      const value = asset.quantity * currentPrice;
      
      if (isKoreanStock(asset.symbol)) {
        korean += value;
      } else {
        nasdaq += value;
      }
    });
    
    return { nasdaqHoldingsValue: nasdaq, koreanHoldingsValue: korean };
  }, [portfolio.assets]);

  const nasdaqTotalValue = portfolio.cash + nasdaqHoldingsValue;
  const koreanTotalValue = portfolio.cash_krw + koreanHoldingsValue;
  
  const nasdaqReturn = nasdaqTotalValue - INITIAL_CAPITAL;
  const koreanReturn = koreanTotalValue - INITIAL_CAPITAL_KRW;
  
  const nasdaqReturnPct = (nasdaqReturn / INITIAL_CAPITAL) * 100;
  const koreanReturnPct = (koreanReturn / INITIAL_CAPITAL_KRW) * 100;
  
  // 전체 Total Value (표시용, 달러 기준으로만)
  const totalValue = nasdaqTotalValue;

  const dailyAdvice = useMemo(() => {
    const dayOfYear = Math.floor(
      (new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
        1000 /
        60 /
        60 /
        24
    );
    return MOCK_DAILY_ADVICE[dayOfYear % MOCK_DAILY_ADVICE.length];
  }, []);

  // 오늘 날짜를 기준으로 퀴즈 풀 전체를 회전시켜 보여줌 (슬라이드로 몇 개든 이동 가능)
  const visibleQuizzes = useMemo(() => {
    if (!quizPool.length) return [];
    const dayOfYear = Math.floor(
      (new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
        1000 /
        60 /
        60 /
        24
    );
    const items: { quiz: DashboardQuiz; index: number }[] = [];
    const start = dayOfYear % quizPool.length;
    for (let i = 0; i < quizPool.length; i++) {
      const idx = (start + i) % quizPool.length;
      items.push({ quiz: quizPool[idx], index: idx });
    }
    return items;
  }, [quizPool]);

  const handleQuizAnswer = (quizIndex: number, optionIndex: number) => {
    setQuizStates((prev) => {
      const current = prev[quizIndex];
      if (current?.answered) return prev; // 이미 답변한 퀴즈는 무시
      return {
        ...prev,
        [quizIndex]: { answered: true, selectedIndex: optionIndex },
      };
    });
  };

  // Load / regenerate learning cards (with localStorage cache to persist across page changes)
  React.useEffect(() => {
    let cancelled = false;

    const loadLearning = async () => {
      // 1) 초기 한 번은 localStorage 에서 복원 시도
      if (!learningInitialized && typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(LS_LEARNING_KEY);
          if (stored) {
            const parsed = JSON.parse(stored) as { seed?: number; cards?: LearningCard[] };
            if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
              setLearningCards(parsed.cards);
              setLearningInitialized(true);
              return;
            }
          }
        } catch {
          // ignore JSON / localStorage errors
        }
      }

      // 2) learningSeed 변경 시에는 실제 API 호출 (3개만 요청)
      setIsLoadingLearning(true);
      try {
        const cards = await generateDashboardLearningCards(3, learningSeed);
        if (!cancelled && cards && cards.length > 0) {
          setLearningCards(cards);
          setLearningInitialized(true);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(
                LS_LEARNING_KEY,
                JSON.stringify({ seed: learningSeed, cards })
              );
            } catch {
              // ignore localStorage failures
            }
          }
        }
      } catch (err) {
        console.warn("[Dashboard] learning cards AI error (fallback to defaults):", err);
      } finally {
        if (!cancelled) setIsLoadingLearning(false);
      }
    };

    loadLearning();

    return () => {
      cancelled = true;
    };
  }, [learningSeed]);

  // Load / regenerate quiz questions (with localStorage cache to persist across page changes)
  React.useEffect(() => {
    let cancelled = false;

    const loadQuizzes = async () => {
      // 1) 초기 한 번은 localStorage 에서 복원 시도
      if (!quizInitialized && typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(LS_QUIZ_KEY);
          if (stored) {
            const parsed = JSON.parse(stored) as {
              seed?: number;
              quizzes?: DashboardQuiz[];
              states?: Record<number, { answered: boolean; selectedIndex: number | null }>;
              activeIndex?: number;
            };
            if (parsed && Array.isArray(parsed.quizzes) && parsed.quizzes.length > 0) {
              setQuizPool(parsed.quizzes);
              if (parsed.states) {
                setQuizStates(parsed.states);
              }
              if (typeof parsed.activeIndex === "number" && parsed.activeIndex >= 0) {
                setActiveQuizIdx(parsed.activeIndex);
              }
              setQuizInitialized(true);
              return;
            }
          }
        } catch {
          // ignore
        }
      }

      // 2) quizSeed 변경 시에는 실제 API 호출 (3문제만 요청)
      setIsLoadingQuiz(true);
      try {
        const quizzes = await generateDashboardQuizzes(3, quizSeed);
        if (!cancelled && quizzes && quizzes.length > 0) {
          setQuizPool(quizzes);
          setQuizInitialized(true);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(
                LS_QUIZ_KEY,
                JSON.stringify({
                  seed: quizSeed,
                  quizzes,
                  states: quizStates,
                  activeIndex: activeQuizIdx,
                })
              );
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        console.warn("[Dashboard] quizzes AI error (fallback to defaults):", err);
      } finally {
        if (!cancelled) setIsLoadingQuiz(false);
      }
    };

    loadQuizzes();

    return () => {
      cancelled = true;
    };
  }, [quizSeed]);

  // Persist quiz state (questions + answers + active index) whenever it changes
  React.useEffect(() => {
    if (!quizInitialized || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        LS_QUIZ_KEY,
        JSON.stringify({
          seed: quizSeed,
          quizzes: quizPool,
          states: quizStates,
          activeIndex: activeQuizIdx,
        })
      );
    } catch {
      // ignore localStorage errors
    }
  }, [quizInitialized, quizSeed, quizPool, quizStates, activeQuizIdx]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Welcome & Daily Tip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900">Welcome back, {user.name} 👋</h1>
          <p className="text-gray-600 mt-1">Here's your {user.goal} portfolio overview.</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl flex items-start max-w-md shadow-sm">
           <Lightbulb className="text-indigo-600 shrink-0 mr-3" size={24} />
           <p className="text-sm text-indigo-900 font-medium leading-relaxed">{dailyAdvice}</p>
        </div>
      </div>

      {/* Key Metrics - Responsive Font Sizing Applied */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Total Value Card - NASDAQ */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0">Net Worth (NASDAQ)</h3>
            <div className="p-1.5 bg-primary-50 text-primary-600 rounded-lg shrink-0">
              <PieChart size={16} />
            </div>
          </div>
          <p className="text-lg sm:text-xl md:text-2xl font-extrabold text-gray-900 mb-2 truncate" title={`$${nasdaqTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
            ${nasdaqTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className={`flex items-center gap-1 text-xs font-bold ${nasdaqReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {nasdaqReturn >= 0 ? <TrendingUp size={14} className="shrink-0" /> : <TrendingDown size={14} className="shrink-0" />}
            <span className="truncate min-w-0">{nasdaqReturn >= 0 ? '+' : ''}${nasdaqReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({nasdaqReturnPct.toFixed(2)}%)</span>
            <span className="text-gray-400 font-medium shrink-0 text-[10px]">all time</span>
          </div>
        </div>
        
        {/* Total Value Card - KRW / Korea */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0">Net Worth (KRW / Korea)</h3>
            <div className="p-1.5 bg-primary-50 text-primary-600 rounded-lg shrink-0">
              <PieChart size={16} />
            </div>
          </div>
          <p className="text-lg sm:text-xl md:text-2xl font-extrabold text-gray-900 mb-2 truncate" title={`₩${koreanTotalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
            ₩{koreanTotalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className={`flex items-center gap-1 text-xs font-bold ${koreanReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {koreanReturn >= 0 ? <TrendingUp size={14} className="shrink-0" /> : <TrendingDown size={14} className="shrink-0" />}
            <span className="truncate min-w-0">{koreanReturn >= 0 ? '+' : ''}₩{koreanReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({koreanReturnPct.toFixed(2)}%)</span>
            <span className="text-gray-400 font-medium shrink-0 text-[10px]">all time</span>
          </div>
        </div>

        {/* Cash Card */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
           <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0">Available Cash</h3>
            <div className="p-1.5 bg-green-50 text-green-600 rounded-lg shrink-0">
              <Wallet size={16} />
            </div>
          </div>
          <p className="text-lg sm:text-xl md:text-2xl font-extrabold text-gray-900 mb-2 truncate" title={`$${portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
            ${portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className="flex items-center text-xs font-medium text-gray-500">
             <span>Ready to deploy</span>
          </div>
        </div>

        {/* Market Status Card */}
        <div className={`p-4 rounded-2xl shadow-sm border min-w-0 ${marketCondition === 'BULL' ? 'bg-green-50 border-green-100' : marketCondition === 'BEAR' ? 'bg-orange-50 border-orange-100' : marketCondition === 'CRASH' ? 'bg-red-50 border-red-100' : marketCondition === 'LIVE' ? 'bg-purple-50 border-purple-100' : 'bg-blue-50 border-blue-100'}`}>
           <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className={`text-xs font-bold uppercase tracking-wider truncate min-w-0 ${marketCondition === 'BULL' ? 'text-green-800' : marketCondition === 'BEAR' ? 'text-orange-800' : marketCondition === 'CRASH' ? 'text-red-800' : marketCondition === 'LIVE' ? 'text-purple-800' : 'text-blue-800'}`}>Market Condition</h3>
            <div className={`p-1.5 rounded-lg shrink-0 ${marketCondition === 'BULL' ? 'bg-green-100 text-green-800' : marketCondition === 'BEAR' ? 'bg-orange-100 text-orange-800' : marketCondition === 'CRASH' ? 'bg-red-100 text-red-800' : marketCondition === 'LIVE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
              <Activity size={16} />
            </div>
          </div>
          <p className={`text-lg sm:text-xl md:text-2xl font-extrabold mb-2 truncate ${marketCondition === 'BULL' ? 'text-green-900' : marketCondition === 'BEAR' ? 'text-orange-900' : marketCondition === 'CRASH' ? 'text-red-900' : marketCondition === 'LIVE' ? 'text-purple-900' : 'text-blue-900'}`}>
            {marketCondition}
          </p>
          <div className={`flex items-center text-sm font-medium ${marketCondition === 'BULL' ? 'text-green-700' : marketCondition === 'BEAR' ? 'text-orange-700' : marketCondition === 'CRASH' ? 'text-red-700' : marketCondition === 'LIVE' ? 'text-purple-700' : 'text-blue-700'}`}>
             <span>Simulated Environment</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Learning & Quiz Column */}
        <div className="lg:col-span-3 space-y-6">
           {/* Daily 5-Minute Learning Section */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BookOpen className="text-primary-600" size={24} />
                Daily 5-Minute Learning
              </h2>
              <button
                type="button"
                onClick={() => setLearningSeed((v) => v + 1)}
                className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-1 transition-colors"
              >
                <RefreshCw size={14} className={isLoadingLearning ? "animate-spin" : ""} />
                <span>Regenerate</span>
              </button>
            </div>
            {isLoadingLearning && (
              <p className="text-xs text-gray-400 mb-2">Loading learning cards from AI...</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {learningCards.map(card => (
                <button
                  key={card.id}
                  onClick={() => setSelectedCard(card)}
                  className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md hover:border-primary-300 transition-all text-left group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className="px-2.5 py-1 bg-primary-50 text-primary-700 text-xs font-bold rounded-md uppercase tracking-wider group-hover:bg-primary-100 transition-colors">
                      {card.category}
                    </span>
                    <div className="flex items-center text-xs font-medium text-gray-400">
                      <Clock size={14} className="mr-1" />
                      {card.duration}
                    </div>
                  </div>
                  <h3 className="font-bold text-gray-900 group-hover:text-primary-700 transition-colors">{card.title}</h3>
                </button>
              ))}
            </div>
          </div>

          {/* Daily Quiz Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 bg-gradient-to-r from-indigo-500 to-primary-600 text-white flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <GraduationCap size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Daily Financial Quiz</h2>
                <p className="text-indigo-100 text-sm">
                  Questions are generated by AI. Click the button to get a new set.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuizSeed((v) => v + 1)}
                className="ml-auto px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1 transition-colors"
              >
                <RefreshCw size={14} className={isLoadingQuiz ? "animate-spin" : ""} />
                <span>Regenerate</span>
              </button>
            </div>
            <div className="p-6">
              {isLoadingQuiz && visibleQuizzes.length === 0 && (
                <div className="text-center text-sm text-gray-500">Loading quiz questions...</div>
              )}
              {!isLoadingQuiz && visibleQuizzes.length > 0 && (
                <>
                  {(() => {
                    const { quiz, index: quizIndex } =
                      visibleQuizzes[activeQuizIdx % visibleQuizzes.length];
                    const state =
                      quizStates[quizIndex] || {
                        answered: false,
                        selectedIndex: null,
                      };
                    const isCorrect =
                      state.answered && state.selectedIndex === quiz.correctIndex;

                    return (
                      <div key={quizIndex}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                            Question {activeQuizIdx + 1} / {visibleQuizzes.length}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setActiveQuizIdx(
                                  (prev) =>
                                    (prev - 1 + visibleQuizzes.length) %
                                    visibleQuizzes.length
                                )
                              }
                              className="p-1.5 rounded-full bg-white border border-indigo-100 text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              <ChevronLeft size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setActiveQuizIdx(
                                  (prev) => (prev + 1) % visibleQuizzes.length
                                )
                              }
                              className="p-1.5 rounded-full bg-white border border-indigo-100 text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              <ChevronRight size={18} />
                            </button>
                          </div>
                        </div>

                        <h3 className="text-lg font-bold text-gray-900 mb-4">
                          {quiz.question}
                        </h3>
                        <div className="space-y-3">
                          {quiz.options.map((option, optionIdx) => {
                            let btnClass =
                              "w-full text-left p-4 rounded-xl border-2 font-medium transition-all ";
                            if (!state.answered) {
                              btnClass +=
                                "border-gray-200 hover:border-primary-500 hover:bg-primary-50 text-gray-700";
                            } else {
                              if (optionIdx === quiz.correctIndex) {
                                btnClass +=
                                  "border-green-500 bg-green-50 text-green-800 font-bold";
                              } else if (state.selectedIndex === optionIdx) {
                                btnClass +=
                                  "border-red-300 bg-red-50 text-red-800 opacity-70";
                              } else {
                                btnClass +=
                                  "border-gray-100 text-gray-400 opacity-50 cursor-not-allowed";
                              }
                            }

                            return (
                              <button
                                key={optionIdx}
                                onClick={() =>
                                  handleQuizAnswer(quizIndex, optionIdx)
                                }
                                disabled={state.answered}
                                className={btnClass}
                              >
                                <div className="flex items-center justify-between">
                                  <span>{option}</span>
                                  {state.answered &&
                                    optionIdx === quiz.correctIndex && (
                                      <CheckCircle2
                                        className="text-green-600 shrink-0 ml-2"
                                        size={20}
                                      />
                                    )}
                                  {state.answered &&
                                    state.selectedIndex === optionIdx &&
                                    optionIdx !== quiz.correctIndex && (
                                      <XCircle
                                        className="text-red-500 shrink-0 ml-2"
                                        size={20}
                                      />
                                    )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Quiz Explanation */}
                        {state.answered && (
                          <div
                            className={`mt-4 p-4 rounded-xl animate-in fade-in slide-in-from-top-2 ${
                              isCorrect
                                ? "bg-green-50 border border-green-100"
                                : "bg-indigo-50 border border-indigo-100"
                            }`}
                          >
                            <p
                              className={`font-bold mb-1 ${
                                isCorrect ? "text-green-800" : "text-indigo-800"
                              }`}
                            >
                              {isCorrect ? "🎉 Correct!" : "💡 Learning Opportunity"}
                            </p>
                            <p className="text-gray-700 text-sm leading-relaxed">
                              {quiz.explanation}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 슬라이드용 인디케이터 점 */}
                  <div className="mt-6 flex items-center justify-center gap-2">
                    {visibleQuizzes.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActiveQuizIdx(i)}
                        className={`h-2.5 w-2.5 rounded-full transition-colors ${
                          i === activeQuizIdx
                            ? "bg-indigo-600"
                            : "bg-indigo-100 hover:bg-indigo-200"
                        }`}
                        aria-label={`Go to question ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Holdings Section */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-[300px]">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900">Current Holdings</h2>
            <Link to="/trading" className="text-primary-600 text-sm font-bold hover:underline flex items-center">
              Trade <ArrowRight size={16} className="ml-1" />
            </Link>
          </div>
          <div className="overflow-x-auto flex-1">
            {portfolio.assets.length === 0 ? (
              <div className="p-8 text-center text-gray-500 flex flex-col items-center justify-center h-full">
                <div className="bg-gray-50 p-4 rounded-full mb-4">
                  <PieChart size={32} className="text-gray-300" />
                </div>
                <p className="font-medium mb-4">Your portfolio is currently empty.</p>
                <Link to="/trading" className="px-5 py-2.5 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-colors shadow-sm">
                  Make your first trade
                </Link>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-3 px-6 text-xs font-bold text-gray-500 uppercase tracking-wider">Asset</th>
                    <th className="text-right py-3 px-6 text-xs font-bold text-gray-500 uppercase tracking-wider">Qty</th>
                    <th className="text-right py-3 px-6 text-xs font-bold text-gray-500 uppercase tracking-wider">Avg Cost</th>
                    <th className="text-right py-3 px-6 text-xs font-bold text-gray-500 uppercase tracking-wider">Current</th>
                    <th className="text-right py-3 px-6 text-xs font-bold text-gray-500 uppercase tracking-wider">Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {portfolio.assets.map(asset => {
                    const currentPrice = MOCK_STOCKS.find(s => s.symbol === asset.symbol)?.price || 0;
                    const marketValue = asset.quantity * currentPrice;
                    const costBasis = asset.quantity * asset.avg_price;
                    const gainLoss = marketValue - costBasis;
                    const gainLossPct = (gainLoss / costBasis) * 100;

                    return (
                      <tr key={asset.symbol} className="hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-bold text-gray-900">{asset.symbol}</div>
                        </td>
                        <td className="py-4 px-6 text-right font-medium text-gray-700">
                          {asset.quantity}
                        </td>
                        <td className="py-4 px-6 text-right text-gray-600">
                          ${asset.avg_price.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 text-right font-bold text-gray-900">
                          ${currentPrice.toFixed(2)}
                        </td>
                         <td className={`py-4 px-6 text-right font-bold ${gainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {gainLoss >= 0 ? '+' : ''}{gainLossPct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col max-h-[500px]">
           <div className="p-6 border-b border-gray-100 flex items-center gap-2 shrink-0">
             <History className="text-gray-400" size={20} />
             <h2 className="text-xl font-bold text-gray-900">Recent Activity</h2>
           </div>
           <div className="overflow-y-auto flex-1 p-4 space-y-3 custom-scrollbar">
             {transactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 italic py-6">
                  <History size={32} className="mb-2 opacity-50" />
                  <p>No transactions yet.</p>
                </div>
             ) : (
               transactions.slice(0, 10).map(tx => (
                 <div key={tx.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${tx.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {tx.type === 'BUY' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{tx.type === 'BUY' ? 'Bought' : 'Sold'} {tx.symbol}</p>
                        <p className="text-xs text-gray-500 font-medium">{new Date(tx.date).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{tx.quantity} @ ${tx.price.toFixed(2)}</p>
                      <p className="text-xs font-medium text-gray-500">${(tx.quantity * tx.price).toFixed(2)} total</p>
                    </div>
                 </div>
               ))
             )}
           </div>
        </div>
      </div>

      {/* Learning Card Modal */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4 text-center">
            <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity" onClick={() => setSelectedCard(null)} />
            <div className="relative bg-white rounded-2xl max-w-md w-full p-6 text-left shadow-xl transform transition-all animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-4">
                 <div>
                   <span className="px-2.5 py-1 bg-primary-50 text-primary-700 text-xs font-bold rounded-md uppercase tracking-wider mb-2 inline-block">
                      {selectedCard.category}
                    </span>
                   <h3 className="text-2xl font-extrabold text-gray-900">{selectedCard.title}</h3>
                 </div>
                 <button onClick={() => setSelectedCard(null)} className="text-gray-400 hover:text-gray-500 p-1 rounded-full hover:bg-gray-100 transition-colors">
                    <X size={24} />
                  </button>
              </div>
              <div className="prose prose-sm prose-indigo max-w-none text-gray-700">
                 <ReactMarkdown>{selectedCard.content}</ReactMarkdown>
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
                 <div className="flex items-center text-sm font-medium text-gray-500">
                  <Clock size={16} className="mr-1" />
                  {selectedCard.duration} read
                </div>
                <button
                  onClick={() => setSelectedCard(null)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-colors"
                >
                  Got it!
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
