import React from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Newspaper, Bot, BookHeart, GraduationCap, X, LogOut, CheckCircle2, Home } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

interface SidebarProps {
  isOpen: boolean;
  closeMobile: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, closeMobile }) => {
  const { resetApp, transactions, diary } = useApp() as any;
  const location = useLocation();

  const todayKey = React.useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

  const [learningMissionDates, setLearningMissionDates] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('learning_missions_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setLearningMissionDates(parsed.filter((d) => typeof d === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

  const hasTodayLearning = React.useMemo(
    () => learningMissionDates.includes(todayKey),
    [learningMissionDates, todayKey]
  );

  const hasTodayTrade = React.useMemo(
    () =>
      Array.isArray(transactions) &&
      transactions.some(
        (tx: any) => new Date(tx.date).toISOString().slice(0, 10) === todayKey
      ),
    [transactions, todayKey]
  );

  const hasTodayDiary = React.useMemo(
    () =>
      Array.isArray(diary) &&
      diary.some(
        (entry: any) => new Date(entry.date).toISOString().slice(0, 10) === todayKey
      ),
    [diary, todayKey]
  );

  const dashboardNav = { name: 'Dashboard', href: '/', icon: Home };

  const groupedNav = [
    {
      key: 'explore',
      label: 'Explore',
      step: 1,
      done: hasTodayLearning,
      routes: [
        { name: 'Market News', href: '/news', icon: Newspaper },
        { name: 'Learn', href: '/learning', icon: GraduationCap },
      ],
    },
    {
      key: 'practice',
      label: 'Practice',
      step: 2,
      done: hasTodayTrade,
      routes: [{ name: 'Virtual Trading', href: '/trading', icon: TrendingUp }],
    },
    {
      key: 'reflect',
      label: 'Reflect',
      step: 3,
      done: hasTodayDiary,
      routes: [{ name: 'Trading Diary', href: '/diary', icon: BookHeart }],
    },
  ] as const;

  const handleReset = () => {
    if (window.confirm("Are you sure you want to reset all data and start over? This action cannot be undone.")) {
      resetApp();
      // Reload to ensure clean state if needed, or let router handle redirection to onboarding
      window.location.reload(); 
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* Sidebar component */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 shadow-xl md:shadow-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header/Logo */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200 shrink-0">
            <Link
              to={dashboardNav.href}
              onClick={closeMobile}
              className="flex items-center gap-2 focus:outline-none"
            >
              <div className="bg-primary-600 rounded-lg p-1.5">
                <TrendingUp size={20} className="text-white" />
              </div>
              <span className="text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-primary-700 to-indigo-700">
                FinGuide
              </span>
            </Link>
            
            <button
              onClick={closeMobile}
              className="md:hidden p-2 -mr-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 rounded-full focus:outline-none active:bg-gray-200 transition-colors"
            >
              <span className="sr-only">Close sidebar</span>
              <X size={20} />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 py-6 space-y-4 overflow-y-auto custom-scrollbar">
            {/* Ask AI Mentor CTA (pill-style with gradient border) */}
            <div className="px-1.5 mb-4">
              <div className="rounded-full bg-gradient-to-r from-sky-200 via-indigo-300 to-purple-300 p-[1.6px] shadow-sm">
                <NavLink
                  to="/agent"
                  onClick={closeMobile}
                  className="block w-full rounded-full bg-white/95 px-4 py-2.5 text-sm font-extrabold text-primary-700 shadow-[0_1px_3px_rgba(15,23,42,0.12)] hover:bg-indigo-50 transition-all border border-white/70"
                >
                  <div className="flex items-center justify-center gap-2">
                    <span>Ask AI Mentor</span>
                  </div>
                </NavLink>
              </div>
            </div>

            {/* Overview: Dashboard at very top */}
            <div>
              <div className="mb-2 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Overview
              </div>
              <NavLink
                to={dashboardNav.href}
                end
                onClick={closeMobile}
                className={`group flex items-center px-3.5 py-3 text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                  location.pathname === dashboardNav.href
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <dashboardNav.icon
                  size={20}
                  className={`mr-3 flex-shrink-0 transition-colors duration-200 ${
                    location.pathname === dashboardNav.href
                      ? 'text-primary-600'
                      : 'text-gray-400 group-hover:text-gray-500'
                  }`}
                />
                {dashboardNav.name}
              </NavLink>
            </div>

            {/* Main menu title */}
            <div className="mt-6 px-3 text-xs font-bold text-gray-400 uppercase tracking-wider">
              Main Menu
            </div>

            {/* Explore / Practice / Reflect groups (main flow) */}
            <div className="mt-2 space-y-4">
              {groupedNav.map((group) => {
                const groupActive = group.routes.some(
                  (r) => location.pathname === r.href
                );

                return (
                  <div key={group.key} className="px-3">
                    <div className="relative pl-4">
                      {/* 세로 라인 */}
                      <div className="absolute left-1.5 top-0 bottom-0 border-l border-gray-200" />
                      <div className="flex items-center gap-2">
                        <div
                          className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold border ${
                            group.done
                              ? 'bg-primary-600 text-white border-primary-600'
                              : groupActive
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-600 border-gray-300'
                          }`}
                        >
                          {group.done ? (
                            <CheckCircle2 size={16} className="text-white" />
                          ) : (
                            group.step
                          )}
                        </div>
                        <span
                          className={`text-sm font-extrabold ${
                            groupActive
                              ? 'text-primary-700'
                              : 'text-gray-800'
                          }`}
                        >
                          {group.label}
                        </span>
                      </div>

                      {/* 하위 메뉴 */}
                      <div className="mt-2 ml-7 space-y-1.5">
                        {group.routes.map((item) => {
                          const isActive = location.pathname === item.href;
                          return (
                            <NavLink
                              key={item.name}
                              to={item.href}
                              onClick={closeMobile}
                              className={`group flex items-center gap-2 py-1.5 pr-2 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                  ? 'text-primary-700'
                                  : 'text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full border ${
                                  isActive
                                    ? 'bg-primary-600 border-primary-600'
                                    : 'border-gray-300 bg-gray-100 group-hover:bg-gray-200'
                                }`}
                              />
                              <span>{item.name}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>


        </div>
      </aside>
    </>
  );
};

export default Sidebar;
