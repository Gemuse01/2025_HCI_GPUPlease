import React, { useMemo, useState } from 'react';
import { BookOpen, Clock, GraduationCap, CheckCircle2, X, XCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { DAILY_QUIZZES } from '../constants';
import { generateDashboardLearningCards, generateDashboardQuizzes, type LearningCard, type DashboardQuiz } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../contexts/AppContext';

const DEFAULT_LEARNING_CARDS: LearningCard[] = [
  {
    id: 1,
    title: 'What is Volatility?',
    duration: '3 min',
    category: 'Basic Term',
    content:
      '**Volatility** is a statistical measure of how much the price of an asset moves around its average.\n\n' +
      'In practice, it tells you how "shaky" a stock is. High volatility means the price can move a lot in a short time (both up and down). ' +
      'Low‑volatility stocks move more slowly and are often used as defensive positions.',
  },
  {
    id: 2,
    title: 'Bull vs. Bear Markets',
    duration: '4 min',
    category: 'Market Concepts',
    content:
      'A **Bull Market** is a period when prices and sentiment are rising for many months or years.\n\n' +
      'A **Bear Market** is when broad indexes fall 20% or more from a recent high and pessimism dominates. ' +
      'Most investors cannot time these perfectly, so a better approach is to keep a long‑term plan and rebalance instead of reacting to every headline.',
  },
  {
    id: 3,
    title: 'The Power of Diversification',
    duration: '5 min',
    category: 'Strategy',
    content:
      '**Diversification** means not letting a single idea decide your entire future return.\n\n' +
      'By combining assets that do not move in the same way (for example, US tech, Korean exporters, dividend stocks, and some cash), ' +
      'you can reduce the chance that one bad event wipes out your progress.',
  },
  {
    id: 4,
    title: 'Dollar‑Cost Averaging',
    duration: '4 min',
    category: 'Practical Tip',
    content:
      '**Dollar‑cost averaging (DCA)** means investing a fixed amount at regular intervals instead of trying to find the perfect entry price.\n\n' +
      'This reduces timing risk and is especially helpful for beginners who feel nervous about buying at the top.',
  },
  {
    id: 5,
    title: 'Reading a Candle Chart Quickly',
    duration: '5 min',
    category: 'Charts',
    content:
      'Each **candlestick** shows the open, high, low and close for a period.\n\n' +
      '- A long body means strong buying or selling pressure.\n' +
      '- Long wicks mean the price moved a lot intraday but was rejected.\n' +
      "You don't need complex patterns at first — just notice whether recent candles are mostly strong up, strong down, or indecisive.",
  },
  {
    id: 6,
    title: 'KOSPI vs. KOSDAQ vs. US Stocks',
    duration: '5 min',
    category: 'Market Concepts',
    content:
      "**KOSPI** is Korea's main large‑cap index, **KOSDAQ** hosts more growth‑oriented and smaller companies, " +
      'and US markets like the S&P 500/Nasdaq contain many global leaders.\n\n' +
      'Mixing these markets can give you both local familiarity and global diversification.',
  },
];

const LS_LEARNING_KEY = 'dashboard_learning_v1';
const LS_LEARNING_MISSIONS_KEY = 'learning_missions_v1';

const Learning: React.FC = () => {
  const { user } = useApp();

  const [selectedCard, setSelectedCard] = useState<LearningCard | null>(null);
  const [learningCards, setLearningCards] = useState<LearningCard[]>(DEFAULT_LEARNING_CARDS);

  // Quiz state: slide-style multi-question flow
  const [quizStates, setQuizStates] = useState<Record<number, { answered: boolean; selectedIndex: number | null }>>({});
  const [activeQuizIdx, setActiveQuizIdx] = useState(0);
  const [quizPool, setQuizPool] = useState<DashboardQuiz[]>(DAILY_QUIZZES);
  const [isLoadingLearning, setIsLoadingLearning] = useState(false);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [learningSeed, setLearningSeed] = useState(0);
  const [quizSeed, setQuizSeed] = useState(0);
  const [learningInitialized, setLearningInitialized] = useState(false);
  const [quizInitialized, setQuizInitialized] = useState(false);

  // Load / regenerate learning cards (with localStorage cache to persist across page changes)
  React.useEffect(() => {
    let cancelled = false;

    const loadLearning = async () => {
      if (!learningInitialized && typeof window !== 'undefined') {
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

      setIsLoadingLearning(true);
      try {
        const cards = await generateDashboardLearningCards(3, learningSeed);
        if (!cancelled && cards && cards.length > 0) {
          setLearningCards(cards);
          setLearningInitialized(true);
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.setItem(LS_LEARNING_KEY, JSON.stringify({ seed: learningSeed, cards }));
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        console.warn('[Learning] learning cards AI error (fallback to defaults):', err);
      } finally {
        if (!cancelled) setIsLoadingLearning(false);
      }
    };

    loadLearning();

    return () => {
      cancelled = true;
    };
  }, [learningSeed, learningInitialized]);

  // Load / regenerate quiz questions (always fresh per visit/seed, no localStorage persistence)
  React.useEffect(() => {
    let cancelled = false;

    const loadQuizzes = async () => {
      setIsLoadingQuiz(true);
      try {
        const quizzes = await generateDashboardQuizzes(3, quizSeed);
        if (!cancelled && quizzes && quizzes.length > 0) {
          setQuizPool(quizzes);
          setQuizInitialized(true);
        }
      } catch (err) {
        console.warn('[Learning] quizzes AI error (fallback to defaults):', err);
      } finally {
        if (!cancelled) setIsLoadingQuiz(false);
      }
    };

    loadQuizzes();

    return () => {
      cancelled = true;
    };
  }, [quizSeed]);

  // Rotate quiz pool based on day-of-year
  const visibleQuizzes = useMemo(() => {
    if (!quizPool.length) return [];
    const dayOfYear = Math.floor(
      (new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24,
    );
    const items: { quiz: DashboardQuiz; index: number }[] = [];
    const start = dayOfYear % quizPool.length;
    for (let i = 0; i < quizPool.length; i++) {
      const idx = (start + i) % quizPool.length;
      items.push({ quiz: quizPool[idx], index: idx });
    }
    return items;
  }, [quizPool]);

  const quizProgress = useMemo(() => {
    const total = visibleQuizzes.length;
    if (total === 0) return { total: 0, answered: 0, allCompleted: false };

    let answered = 0;
    visibleQuizzes.forEach(({ index }) => {
      if (quizStates[index]?.answered) answered += 1;
    });

    return {
      total,
      answered,
      allCompleted: answered === total,
    };
  }, [visibleQuizzes, quizStates]);

  const handleQuizAnswer = (quizIndex: number, optionIndex: number) => {
    setQuizStates((prev) => {
      const current = prev[quizIndex];
      if (current?.answered) return prev;
      return {
        ...prev,
        [quizIndex]: { answered: true, selectedIndex: optionIndex },
      };
    });
  };

  // When today's quiz set is fully completed, mark mission as done for today (for dashboard stamps)
  React.useEffect(() => {
    if (!quizProgress.allCompleted) return;
    if (typeof window === 'undefined') return;

    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const raw = window.localStorage.getItem(LS_LEARNING_MISSIONS_KEY);
      let dates: string[] = [];
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) {
          dates = parsed;
        }
      }
      if (!dates.includes(todayStr)) {
        const updated = [...dates, todayStr].slice(-60); // keep last ~2 months
        window.localStorage.setItem(LS_LEARNING_MISSIONS_KEY, JSON.stringify(updated));
      }
    } catch {
      // ignore localStorage failures
    }
  }, [quizProgress.allCompleted]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <GraduationCap className="text-primary-600" size={26} />
            Learning Hub
          </h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">
            Short lessons and daily quizzes to help {user.name || 'you'} build a consistent investing habit.
          </p>
        </div>
      </div>

      <div className="space-y-6">
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
              <RefreshCw size={14} className={isLoadingLearning ? 'animate-spin' : ''} />
              <span>Regenerate</span>
            </button>
          </div>
          {isLoadingLearning && (
            <p className="text-xs text-gray-400 mb-2">Loading learning cards from AI...</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {learningCards.map((card) => (
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
                <h3 className="font-bold text-gray-900 group-hover:text-primary-700 transition-colors">
                  {card.title}
                </h3>
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
              <RefreshCw size={14} className={isLoadingQuiz ? 'animate-spin' : ''} />
              <span>Regenerate</span>
            </button>
          </div>
          <div className="p-6">
            {quizProgress.allCompleted && (
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-green-700">
                <CheckCircle2 size={16} className="text-green-600" />
                <span>Today's learning routine completed ✅</span>
              </div>
            )}
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
                                  visibleQuizzes.length,
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
                                (prev) => (prev + 1) % visibleQuizzes.length,
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
                            'w-full text-left p-4 rounded-xl border-2 font-medium transition-all ';
                          if (!state.answered) {
                            btnClass +=
                              'border-gray-200 hover:border-primary-500 hover:bg-primary-50 text-gray-700';
                          } else {
                            if (optionIdx === quiz.correctIndex) {
                              btnClass +=
                                'border-green-500 bg-green-50 text-green-800 font-bold';
                            } else if (state.selectedIndex === optionIdx) {
                              btnClass +=
                                'border-red-300 bg-red-50 text-red-800 opacity-70';
                            } else {
                              btnClass +=
                                'border-gray-100 text-gray-400 opacity-50 cursor-not-allowed';
                            }
                          }

                          return (
                            <button
                              key={optionIdx}
                              onClick={() => handleQuizAnswer(quizIndex, optionIdx)}
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
                              ? 'bg-green-50 border border-green-100'
                              : 'bg-indigo-50 border border-indigo-100'
                          }`}
                        >
                          <p
                            className={`font-bold mb-1 ${
                              isCorrect ? 'text-green-800' : 'text-indigo-800'
                            }`}
                          >
                            {isCorrect ? '🎉 Correct!' : '💡 Learning Opportunity'}
                          </p>
                          <p className="text-gray-700 text-sm leading-relaxed">
                            {quiz.explanation}
                          </p>
                          <p className="mt-2 text-xs text-gray-500">
                            This is a practice environment — getting questions wrong is part of learning.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Slide indicators */}
                <div className="mt-6 flex items-center justify-center gap-2">
                  {visibleQuizzes.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveQuizIdx(i)}
                      className={`h-2.5 w-2.5 rounded-full transition-colors ${
                        i === activeQuizIdx
                          ? 'bg-indigo-600'
                          : 'bg-indigo-100 hover:bg-indigo-200'
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

      {/* Learning Card Modal */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4 text-center">
            <div
              className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity"
              onClick={() => setSelectedCard(null)}
            />
            <div className="relative bg-white rounded-2xl max-w-md w-full p-6 text-left shadow-xl transform transition-all animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="px-2.5 py-1 bg-primary-50 text-primary-700 text-xs font-bold rounded-md uppercase tracking-wider mb-2 inline-block">
                    {selectedCard.category}
                  </span>
                  <h3 className="text-2xl font-extrabold text-gray-900">{selectedCard.title}</h3>
                </div>
                <button
                  onClick={() => setSelectedCard(null)}
                  className="text-gray-400 hover:text-gray-500 p-1 rounded-full hover:bg-gray-100 transition-colors"
                  type="button"
                >
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
                  type="button"
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

export default Learning;


