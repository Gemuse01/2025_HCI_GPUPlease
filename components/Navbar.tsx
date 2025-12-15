import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, Search, User as UserIcon, ChevronDown, LogOut, UserCog } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import { UserPersona } from '../types';

interface NavbarProps {
  toggleSidebar: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ toggleSidebar }) => {
  const { user, resetApp, updateUser } = useApp();
  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out? All data (portfolio, transaction history, diary entries, etc.) will be reset.')) {
      resetApp();
      navigate('/onboarding');
      setIsDropdownOpen(false);
    }
  };

  const handleResetPersona = () => {
    if (
      window.confirm(
        'Would you like to reset your persona? Your portfolio and transaction history will be kept, and only your user information will be reset.'
      )
    ) {
      // 사용자 정보만 초기화하고 포트폴리오, 거래 내역, 일기는 유지
      updateUser({
        name: '',
        persona: UserPersona.UNDECIDED,
        risk_tolerance: 'medium',
        goal: 'learning',
      });
      try {
        // 새로 온보딩하는 사용자에게 메뉴 투어를 다시 보여주기 위해 초기화
        window.localStorage.removeItem('finguide_menu_tour_v1');
      } catch {
        // ignore
      }
      navigate('/onboarding');
      setIsDropdownOpen(false);
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0 z-30 relative">
      <div className="flex items-center">
        <button
          onClick={toggleSidebar}
          className="p-2 -ml-2 mr-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 md:hidden"
        >
          <span className="sr-only">Open sidebar</span>
          <Menu size={24} />
        </button>
        {/* Mobile Logo shows when sidebar is closed on mobile */}
         <div className="md:hidden font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-indigo-600">
            FinGuide
          </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">


        {/* User Profile Summary */}
        <div className="flex items-center gap-3 pl-2 sm:pl-4 sm:border-l border-gray-200 sm:ml-2 relative" ref={dropdownRef}>
           <div className="hidden md:block text-right">
              <div className="text-sm font-bold text-gray-900 leading-tight">{user.name || 'Guest'}</div>
              <div className="text-xs font-medium text-gray-500 capitalize truncate max-w-[100px]">
                {user.persona !== 'UNDECIDED' ? user.persona.toLowerCase().replace('_', ' ') : 'New User'}
              </div>
           </div>
           <button 
             onClick={() => setIsDropdownOpen(!isDropdownOpen)}
             className="flex items-center gap-2 p-1 rounded-full hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200"
           >
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary-100 to-indigo-100 flex items-center justify-center text-primary-700 font-bold border border-primary-200 shadow-sm">
                {user.name ? user.name.charAt(0).toUpperCase() : <UserIcon size={18} />}
              </div>
              <ChevronDown size={16} className={`text-gray-400 hidden sm:block transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
           </button>

           {/* Dropdown Menu */}
           {isDropdownOpen && (
             <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
               <button
                 onClick={handleResetPersona}
                 className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
               >
                 <UserCog size={18} className="text-gray-400" />
                 <span>Reset Persona</span>
               </button>
               <div className="border-t border-gray-100 my-1"></div>
               <button
                 onClick={handleLogout}
                 className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
               >
                 <LogOut size={18} className="text-red-400" />
                 <span>Log Out</span>
               </button>
             </div>
           )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;