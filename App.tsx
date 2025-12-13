import React, { useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-100 relative">
      <Sidebar isOpen={sidebarOpen} closeMobile={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Navbar toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
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
