import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Newspaper, Bot, BookHeart, GraduationCap, X, LogOut } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

interface SidebarProps {
  isOpen: boolean;
  closeMobile: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, closeMobile }) => {
  const { resetApp } = useApp();
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Virtual Trading', href: '/trading', icon: TrendingUp },
    { name: 'Learning', href: '/learning', icon: GraduationCap },
    { name: 'Market News', href: '/news', icon: Newspaper },
    { name: 'AI Mentor', href: '/agent', icon: Bot },
    { name: 'Trading Diary', href: '/diary', icon: BookHeart },
  ];

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
            <div className="flex items-center gap-2">
               <div className="bg-primary-600 rounded-lg p-1.5">
                 <TrendingUp size={20} className="text-white" />
               </div>
               <span className="text-xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-primary-700 to-indigo-700">
                FinGuide
              </span>
            </div>
            
            <button
              onClick={closeMobile}
              className="md:hidden p-2 -mr-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 rounded-full focus:outline-none active:bg-gray-200 transition-colors"
            >
              <span className="sr-only">Close sidebar</span>
              <X size={20} />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
            <div className="mb-6 px-3 text-xs font-bold text-gray-400 uppercase tracking-wider">
              Main Menu
            </div>
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={closeMobile}
                  className={`group flex items-center px-3.5 py-3 text-sm font-bold rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon
                    size={20}
                    className={`mr-3 flex-shrink-0 transition-colors duration-200 ${
                      isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                  />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>


        </div>
      </aside>
    </>
  );
};

export default Sidebar;
