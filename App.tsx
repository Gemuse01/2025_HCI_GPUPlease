import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './contexts/AppContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import VirtualTrading from './pages/VirtualTrading';
import AiAgent from './pages/AiAgent';
import Diary from './pages/Diary';
import News from './pages/News';
import Learning from './pages/Learning';
import Onboarding from './pages/Onboarding';
import FloatingChat from './components/FloatingChat';

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user } = useApp();
  const location = useLocation();

  if (!user.is_onboarded) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }

  return children;
};

const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMenuTour, setShowMenuTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem('finguide_menu_tour_v1');
      if (!stored) {
        setShowMenuTour(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const tourSteps = [
    {
      key: 'dashboard',
      title: 'Dashboard',
      description:
        'See your virtual net worth, P&L, cash balances, and scenario label in one place. This is also where you get one clear “next best action” for today.',
      path: '/',
    },
    {
      key: 'trading',
      title: 'Virtual Trading',
      description:
        'Practice buying and selling NASDAQ and Korean stocks with a risk‑free virtual account. All trades here are simulated and will later connect to your diary.',
      path: '/trading',
    },
    {
      key: 'diary',
      title: 'Trading Diary',
      description:
        'Right after each trade, record what you felt and why you acted. Over time, the diary helps you spot emotional patterns and see how they affect your results.',
      path: '/diary',
    },
    {
      key: 'learning',
      title: 'Learning',
      description:
        'Short 5‑minute cards and quizzes that build your investing basics step by step. Completing a set also counts toward your learning stamps on the dashboard.',
      path: '/learning',
    },
    {
      key: 'news',
      title: 'Market News',
      description:
        'A focused news feed for the market and your watchlist, with a quick sense of positive/negative tone to support your own judgment — not replace it.',
      path: '/news',
    },
    {
      key: 'agent',
      title: 'AI Mentor',
      description:
        'An AI mentor that knows your persona and practice portfolio, and helps you think through strategy, psychology, and risk. Ask questions in natural language.',
      path: '/agent',
    },
  ];

  const currentStep = tourSteps[tourStep] ?? tourSteps[0];

  const closeTour = () => {
    setShowMenuTour(false);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('finguide_menu_tour_v1', 'seen');
      } catch {
        // ignore
      }
    }
  };

  const goNext = () => {
    if (tourStep >= tourSteps.length - 1) {
      closeTour();
      return;
    }

    const targetIndex = Math.min(tourSteps.length - 1, tourStep + 1);
    const targetStep = tourSteps[targetIndex];
    setTourStep(targetIndex);
    if (targetStep?.path) {
      navigate(targetStep.path);
    }
  };

  const goPrev = () => {
    if (tourStep <= 0) return;
    const targetIndex = Math.max(0, tourStep - 1);
    const prevStep = tourSteps[targetIndex];
    setTourStep(targetIndex);
    if (prevStep?.path) {
      navigate(prevStep.path);
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-100 relative">
      <Sidebar isOpen={sidebarOpen} closeMobile={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Navbar toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        {showMenuTour && currentStep && (
          <div className="fixed inset-0 z-40 flex items-center justify-center px-4 sm:px-0">
            <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={closeTour} />
            <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 sm:p-7 z-50">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-xs font-bold text-primary-600 uppercase tracking-wider mb-1">Quick tour</div>
                  <h2 className="text-xl font-extrabold text-gray-900">
                    {currentStep.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeTour}
                  className="ml-2 text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-100"
                >
                  <span className="sr-only">Close</span>
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed mb-4">
                {currentStep.description}
              </p>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                <span>
                  Step {tourStep + 1} of {tourSteps.length}
                </span>
                <button
                  type="button"
                  onClick={closeTour}
                  className="underline hover:text-gray-700"
                >
                  Skip tour for now
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={tourStep === 0}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                    tourStep === 0
                      ? 'text-gray-300 border-gray-100 cursor-default'
                      : 'text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Previous
                </button>
                <div className="flex-1 flex justify-end">
                  <button
                    type="button"
                    onClick={goNext}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-primary-600 text-white hover:bg-primary-700 shadow-sm"
                  >
                    {tourStep === tourSteps.length - 1 ? 'Got it' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto focus:outline-none">
          <Routes>
             <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
             <Route path="/trading" element={<ProtectedRoute><VirtualTrading /></ProtectedRoute>} />
             <Route path="/learning" element={<ProtectedRoute><Learning /></ProtectedRoute>} />
             <Route path="/news" element={<ProtectedRoute><News /></ProtectedRoute>} />
             <Route path="/agent" element={<ProtectedRoute><AiAgent /></ProtectedRoute>} />
             <Route path="/diary" element={<ProtectedRoute><Diary /></ProtectedRoute>} />
          </Routes>
        </main>
        <FloatingChat />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <Router>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </Router>
    </AppProvider>
  );
};

export default App;
