import React, { useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, PieChart, Activity, ArrowRight, Wallet, Lightbulb, CheckCircle2, GraduationCap, Info } from 'lucide-react';
import { MOCK_DAILY_ADVICE, MOCK_STOCKS, INITIAL_CAPITAL, INITIAL_CAPITAL_KRW } from '../constants';

const Dashboard: React.FC = () => {
  const { user, portfolio, transactions, diary, marketCondition } = useApp();
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [streak, setStreak] = useState(0);
  const [lastCheckDate, setLastCheckDate] = useState<string | null>(null);
  const [learningMissionDates, setLearningMissionDates] = useState<string[]>([]);

  const todayKey = useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

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

  const ATTENDANCE_KEY = 'dashboard_attendance_v1';
  const LEARNING_MISSIONS_KEY = 'learning_missions_v1';

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(ATTENDANCE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { lastDate?: string; streak?: number };
      const todayStr = new Date().toISOString().slice(0, 10);
      if (parsed.lastDate) {
        setLastCheckDate(parsed.lastDate);
        setHasCheckedInToday(parsed.lastDate === todayStr);
      }
      if (typeof parsed.streak === 'number') {
        setStreak(parsed.streak);
      }
    } catch {
      // ignore
    }
  }, []);

  // Load learning mission completion dates (for stamps)
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LEARNING_MISSIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setLearningMissionDates(parsed.filter((d) => typeof d === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

  const hasTodayLearning = useMemo(
    () => learningMissionDates.includes(todayKey),
    [learningMissionDates, todayKey]
  );

  const hasTodayTrade = useMemo(
    () =>
      transactions.some(
        (tx) => new Date(tx.date).toISOString().slice(0, 10) === todayKey
      ),
    [transactions, todayKey]
  );

  const hasTodayDiary = useMemo(
    () =>
      diary.some(
        (entry) => new Date(entry.date).toISOString().slice(0, 10) === todayKey
      ),
    [diary, todayKey]
  );

  const loopSteps = [
    { key: 'learn', label: 'Learn (3–5 min)', done: hasTodayLearning },
    { key: 'trade', label: 'Trade (Practice)', done: hasTodayTrade },
    { key: 'reflect', label: 'Reflect (1 min)', done: hasTodayDiary },
  ] as const;

  const completedCount = loopSteps.filter((s) => s.done).length;
  const loopProgressPct = (completedCount / loopSteps.length) * 100;
  const firstIncompleteIndex = loopSteps.findIndex((s) => !s.done);

  const handleCheckIn = () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (lastCheckDate === todayStr) {
      return;
    }

    let newStreak = 1;
    if (lastCheckDate === yesterdayStr) {
      newStreak = streak + 1;
    }

    setStreak(newStreak);
    setLastCheckDate(todayStr);
    setHasCheckedInToday(true);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          ATTENDANCE_KEY,
          JSON.stringify({ lastDate: todayStr, streak: newStreak })
        );
      } catch {
        // ignore
      }
    }
  };

  const nextBestAction = useMemo(() => {
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(now.getDate() - 3);

    const hasTransactions = transactions.length > 0;
    const recentTransaction = transactions.find((tx) => new Date(tx.date) >= threeDaysAgo);
    const hasRecentDiary = diary.some((entry) => new Date(entry.date) >= threeDaysAgo);

    // Case 1: First visit & no trades yet -> encourage first virtual trade
    if (!hasTransactions) {
      return {
        type: 'first_trade' as const,
        title: 'Try your first virtual trade',
        description: 'Make a risk-free practice trade to see how your simulated portfolio reacts.',
        ctaLabel: 'Go to Virtual Trading',
        ctaTo: '/trading',
      };
    }

    // Case 2: Recent trades in the last 3 days, but no recent diary entries -> suggest writing a diary
    if (recentTransaction && !hasRecentDiary) {
      return {
        type: 'write_diary' as const,
        title: 'Reflect on your recent trade',
        description:
          'Capture what you were thinking and feeling in a short diary entry so future you can learn from it.',
        ctaLabel: 'Go to Diary',
        ctaTo: '/diary',
      };
    }

    return null;
  }, [transactions, diary]);

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

  const learningStampDays = useMemo(() => {
    const today = new Date();
    const completed = new Set(learningMissionDates);
    const days: { label: string; dateStr: string; completed: boolean }[] = [];
    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = weekdayLabels[d.getDay()];
      days.push({
        label,
        dateStr,
        completed: completed.has(dateStr),
      });
    }
    return days;
  }, [learningMissionDates]);

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

      {/* Your Loop Today (Learn → Trade → Reflect) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-extrabold text-gray-900">
              Your Loop Today
            </h2>
            <div className="relative group">
              <button
                type="button"
                className="p-1 rounded-full border border-gray-200 text-gray-500 bg-white hover:bg-gray-50"
              >
                <Info size={14} />
              </button>
              <div className="absolute left-0 mt-2 w-64 rounded-xl bg-gray-900 text-white text-xs font-semibold px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                Learn → Trade → Reflect 순서로 하루 루프를 한 번만 완성하면 충분해요.
                각 카드를 눌러 바로 해당 화면으로 이동할 수 있어요.
              </div>
            </div>
          </div>
          <div className="text-[11px] sm:text-xs font-semibold text-gray-500 whitespace-nowrap">
            Current streak: {streak} day{streak === 1 ? '' : 's'} ·{' '}
            {Math.round(loopProgressPct)}%
          </div>
        </div>

        <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all"
            style={{ width: `${loopProgressPct}%` }}
          />
        </div>

        <div className="flex flex-col gap-2">
          {loopSteps.map((step, idx) => {
            const isActive =
              !step.done &&
              (firstIncompleteIndex === -1 ? idx === 0 : idx === firstIncompleteIndex);

            const baseClasses =
              'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-all';
            const stateClasses = step.done
              ? 'bg-primary-50 border-primary-100'
              : isActive
              ? 'bg-blue-50 border-blue-200'
              : 'bg-gray-50 border-gray-100';

            const stepNumber = idx + 1;

            const to =
              step.key === 'learn'
                ? '/learning'
                : step.key === 'trade'
                ? '/trading'
                : '/diary';

            return (
              <Link key={step.key} to={to} className="block">
                <div className={`${baseClasses} ${stateClasses}`}>
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold border ${
                        step.done
                          ? 'bg-primary-600 text-white border-primary-600'
                          : isActive
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300'
                      }`}
                    >
                      {step.done ? (
                        <CheckCircle2 size={16} className="text-white" />
                      ) : (
                        stepNumber
                      )}
                    </div>
                    <div>
                      <div className="text-sm sm:text-base font-extrabold text-gray-900">
                        {stepNumber}.{' '}
                        {step.key === 'learn'
                          ? 'Learn'
                          : step.key === 'trade'
                          ? 'Trade'
                          : 'Reflect'}
                      </div>
                      <div className="text-[11px] sm:text-xs font-medium text-gray-500 mt-0.5">
                        {step.key === 'learn' &&
                          'Review today’s lesson & complete a quick quiz.'}
                        {step.key === 'trade' &&
                          'Make a virtual trade to put your learning into action.'}
                        {step.key === 'reflect' &&
                          'Write a short diary entry to reflect on your practice trade.'}
                      </div>
                    </div>
                  </div>

                  {/* Right-side CTA buttons for step 1 & 3 */}
                  {step.key === 'learn' && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl bg-primary-600 text-white text-xs sm:text-sm font-bold hover:bg-primary-700 whitespace-nowrap"
                    >
                      Start today&apos;s quiz
                    </button>
                  )}
                  {step.key === 'reflect' && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl bg-primary-600 text-white text-xs sm:text-sm font-bold hover:bg-primary-700 whitespace-nowrap"
                    >
                      Write trade diary
                    </button>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Daily Check-in & Learning Stamps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <CheckCircle2 className="text-primary-600" size={18} />
              Daily Check-in
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              Keep your investing habit alive by checking in once a day.
            </p>
            <p className="mt-2 text-xs font-semibold text-gray-800">
              Current streak:{' '}
              <span className="font-bold">
                {streak > 0 ? `${streak} day${streak > 1 ? 's' : ''}` : 'No streak yet'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={hasCheckedInToday}
            className={`inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              hasCheckedInToday
                ? 'bg-gray-100 text-gray-500 cursor-default'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            {hasCheckedInToday ? 'Checked in today' : 'Check in for today'}
          </button>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <GraduationCap className="text-indigo-600" size={18} />
              Learning Stamps (Last 7 days)
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              A stamp is earned when you complete today's learning quiz set.
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {learningStampDays.map((d) => (
                <div key={d.dateStr} className="flex flex-col items-center gap-1">
                  <div
                    className={`h-6 w-6 rounded-full border text-[11px] font-bold flex items-center justify-center ${
                      d.completed
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-400'
                    }`}
                  >
                    {d.label[0]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Next Best Action - focuses user on 1 key task */}
      {nextBestAction && (
        <div className="mt-2 bg-white border border-primary-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
          <div>
            <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider mb-1">
              Next best action
            </p>
            <h2 className="text-sm font-bold text-gray-900">
              {nextBestAction.title}
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              {nextBestAction.description}
            </p>
          </div>
          <Link
            to={nextBestAction.ctaTo}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-700 transition-colors whitespace-nowrap"
          >
            {nextBestAction.ctaLabel}
            <ArrowRight size={14} className="ml-1" />
          </Link>
        </div>
      )}

      {/* Key Metrics - Responsive Font Sizing Applied */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Total Value Card - NASDAQ */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3
              className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0"
              title="Total value of your virtual US stock account (cash + holdings)."
            >
              Net Worth (NASDAQ)
            </h3>
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
          <p className="mt-1 text-[11px] text-gray-500">
            Total value of your virtual US stock account (cash + holdings).
          </p>
        </div>
        
        {/* Total Value Card - KRW / Korea */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3
              className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0"
              title="Total value of your virtual Korean stock account in KRW (cash + holdings)."
            >
              Net Worth (KRW / Korea)
            </h3>
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
          <p className="mt-1 text-[11px] text-gray-500">
            Total value of your virtual Korean stock account in KRW (cash + holdings).
          </p>
        </div>

        {/* Cash Card (USD + KRW) */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 min-w-0">
           <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider truncate min-w-0">
              Available Cash
            </h3>
            <div className="p-1.5 bg-green-50 text-green-600 rounded-lg shrink-0">
              <Wallet size={16} />
            </div>
          </div>
          {/* USD balance */}
          <p
            className="text-lg sm:text-xl md:text-2xl font-extrabold text-gray-900 truncate"
            title={`$${portfolio.cash.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
          >
            ${portfolio.cash.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          {/* KRW balance */}
          <p
            className="text-sm sm:text-base font-extrabold text-gray-900 mt-1 truncate"
            title={`₩${portfolio.cash_krw.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}`}
          >
            ₩{portfolio.cash_krw.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className="mt-2 text-[11px] text-gray-500">
            <p className="font-medium">Ready to deploy in your practice accounts.</p>
            <p>Top: virtual USD cash · Bottom: virtual KRW cash for Korean stocks.</p>
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
          <p className="mt-1 text-[11px] text-gray-500">
            Scenario label for your practice environment, not live market data.
          </p>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
