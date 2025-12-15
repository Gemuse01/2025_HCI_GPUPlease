import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { generateFinancialAdvice, generateSecurityAdvice } from '../services/mentorService';
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Shield,
  ShieldAlert,
  MessageSquare,
  Trash2,
  Menu,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from 'react-router-dom';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiAgent: React.FC = () => {
  const { user, portfolio, marketCondition, updateUser } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const userKey = React.useMemo(
    () => ((user as any)?.id || user?.persona || "default"),
    [user?.persona, (user as any)?.id]
  );

  const sessionsStorageKey = React.useMemo(
    () => `finguide_ai_chat_sessions_${userKey}`,
    [userKey]
  );

  const getSessionStorageKey = React.useCallback(
    (sessionId: string) => `finguide_ai_chat_${userKey}_${sessionId}`,
    [userKey]
  );

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const [input, setInput] = useState('');
  
  // 세션 목록 로드
  const loadSessions = React.useCallback(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(sessionsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<any>;
        return parsed.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
        })).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
    } catch {
      // ignore
    }
    return [];
  }, [sessionsStorageKey]);

  // 세션 목록 저장
  const saveSessions = React.useCallback((sessionsList: ChatSession[]) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        sessionsStorageKey,
        JSON.stringify(sessionsList)
      );
    } catch {
      // ignore
    }
  }, [sessionsStorageKey]);

  // 초기 메시지 생성
  const createInitialMessage = React.useCallback((): Message => ({
    id: '1',
    role: 'model',
    text: `Hello ${user.name}! I'm your personalized FinGuide mentor. 

I know you're here for **${user.goal}** and prefer a **${user.risk_tolerance}** risk approach. The market is currently simulated as **${marketCondition}**. 

How can I support your journey today?`,
    timestamp: new Date(),
  }), [user.name, user.goal, user.risk_tolerance, marketCondition]);

  const [messages, setMessages] = useState<Message[]>([createInitialMessage()]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSecurityMode, setIsSecurityMode] = useState(false);
  const [surveyQuestions, setSurveyQuestions] = useState<string[] | null>(null);
  const [surveyAnswers, setSurveyAnswers] = useState<string[]>(["", "", ""]);
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false);
  const [surveyPending, setSurveyPending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 메시지 로드 함수
  const loadMessages = React.useCallback((sessionId: string | null) => {
    if (typeof window === 'undefined') return;
    
    const initialMsg = createInitialMessage();
    
    if (!sessionId) {
      setMessages([initialMsg]);
      return;
    }
    
    try {
      const raw = window.localStorage.getItem(getSessionStorageKey(sessionId));
      if (raw) {
        const parsed = JSON.parse(raw) as Array<any>;
        const loadedMessages = parsed.map((m) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        }));
        setMessages(loadedMessages);
      } else {
        setMessages([initialMsg]);
      }
    } catch {
      setMessages([initialMsg]);
    }
  }, [getSessionStorageKey, createInitialMessage]);

  // 세션 선택
  const selectSession = React.useCallback((sessionId: string) => {
    // 응답 대기 중에는 세션 전환을 막아, 답변이 다른 세션에 들어가는 것을 방지
    if (isLoading) return;
    setCurrentSessionId(sessionId);
    // 메시지 직접 로드 (loadMessages 함수 의존성 제거)
    if (typeof window === 'undefined') return;
    
    const initialMsg = createInitialMessage();
    
    try {
      const raw = window.localStorage.getItem(getSessionStorageKey(sessionId));
      if (raw) {
        const parsed = JSON.parse(raw) as Array<any>;
        const loadedMessages = parsed.map((m) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        }));
        setMessages(loadedMessages);
      } else {
        setMessages([initialMsg]);
      }
    } catch {
      setMessages([initialMsg]);
    }
    setSidebarOpen(false);
  }, [getSessionStorageKey, createInitialMessage]);

  // 세션 삭제
  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading) return;
    if (typeof window === 'undefined') return;
    
    try {
      // 세션 메시지 삭제
      window.localStorage.removeItem(getSessionStorageKey(sessionId));
      
      // 세션 목록에서 제거
      const updatedSessions = sessions.filter(s => s.id !== sessionId);
      setSessions(updatedSessions);
      saveSessions(updatedSessions);
      
      // 현재 세션이 삭제된 세션이면 새 채팅 시작
      if (currentSessionId === sessionId) {
        const newSessionId = `session_${Date.now()}`;
        const newSession: ChatSession = {
          id: newSessionId,
          title: 'New Chat',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const initial = [createInitialMessage()];
        
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              getSessionStorageKey(newSessionId),
              JSON.stringify(initial)
            );
          } catch {
            // ignore
          }
        }
        
        const finalSessions = [newSession, ...updatedSessions];
        setSessions(finalSessions);
        saveSessions(finalSessions);
        setCurrentSessionId(newSessionId);
        setMessages(initial);
      }
    } catch {
      // ignore
    }
  };

  // 컴포넌트 마운트 시 세션 목록 로드 (한 번만 실행)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const raw = window.localStorage.getItem(sessionsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<any>;
        const loadedSessions = parsed.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
        })).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        
        setSessions(loadedSessions);
        
        // 가장 최근 세션이 있으면 자동 선택
        if (loadedSessions.length > 0) {
          setCurrentSessionId(loadedSessions[0].id);
          // 메시지 로드는 별도로 처리
          const sessionRaw = window.localStorage.getItem(getSessionStorageKey(loadedSessions[0].id));
          if (sessionRaw) {
            const parsed = JSON.parse(sessionRaw) as Array<any>;
            const loadedMessages = parsed.map((m) => ({
              ...m,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
            }));
            setMessages(loadedMessages);
          } else {
            setMessages([createInitialMessage()]);
          }
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 마운트 시에만 실행

  const handleNewChat = React.useCallback(() => {
    if (isLoading) return;
    // 새 세션 생성
    const newSessionId = `session_${Date.now()}`;
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New Chat',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // 초기 메시지
    const initial = [createInitialMessage()];
    
    // 세션 저장
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          getSessionStorageKey(newSessionId),
          JSON.stringify(initial)
        );
      } catch {
        // ignore
      }
    }
    
    // 세션 목록 업데이트
    setSessions(prev => {
      const updatedSessions = [newSession, ...prev];
      saveSessions(updatedSessions);
      return updatedSessions;
    });
    
    // 새 세션 선택
    setCurrentSessionId(newSessionId);
    setMessages(initial);
  }, [getSessionStorageKey, saveSessions, createInitialMessage]);

  // 확장 플래그 확인 및 처리 (URL 쿼리 파라미터)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const isExpanded = searchParams.get('expand') === 'true';
    
    // URL에 expand 파라미터가 있으면 새 세션 생성
    if (isExpanded) {
      handleNewChat();
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, handleNewChat]);

  // 커스텀 이벤트 감지 (FloatingChat에서 확장 버튼 클릭 시)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleChatExpanded = (e: CustomEvent) => {
      // FloatingChat 메시지를 새 세션으로 가져오기
      const aiAgentStorageKey = `finguide_ai_chat_v1_${userKey}`;
      if (e.detail?.storageKey === aiAgentStorageKey) {
        try {
          const raw = window.localStorage.getItem(aiAgentStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Array<any>;
            const loadedMessages = parsed.map((m) => ({
              ...m,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
            }));
            
            // 새 세션 생성
            const newSessionId = `session_${Date.now()}`;
            const firstUserMessage = loadedMessages.find(m => m.role === 'user');
            const sessionTitle = firstUserMessage 
              ? firstUserMessage.text.substring(0, 50) 
              : 'New Chat';
            
            const newSession: ChatSession = {
              id: newSessionId,
              title: sessionTitle,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            
            // 세션 저장
            window.localStorage.setItem(
              getSessionStorageKey(newSessionId),
              JSON.stringify(loadedMessages)
            );
            
            // 세션 목록 업데이트 (함수형 업데이트 사용)
            setSessions(prev => {
              const updatedSessions = [newSession, ...prev];
              saveSessions(updatedSessions);
              return updatedSessions;
            });
            
            // 세션 선택
            setCurrentSessionId(newSessionId);
            setMessages(loadedMessages);
            setSidebarOpen(false);
          }
        } catch {
          // ignore
        }
      }
    };
    
    window.addEventListener('chatExpanded', handleChatExpanded as EventListener);
    return () => {
      window.removeEventListener('chatExpanded', handleChatExpanded as EventListener);
    };
  }, [getSessionStorageKey, saveSessions, userKey]);

  // 채팅 히스토리를 로컬스토리지에 저장
  useEffect(() => {
    if (typeof window === 'undefined' || !currentSessionId) return;
    
    try {
      // 메시지 저장
      window.localStorage.setItem(
        getSessionStorageKey(currentSessionId),
        JSON.stringify(
          messages.map((m) => ({
            ...m,
            timestamp: m.timestamp,
          }))
        )
      );
      
      // 세션 제목 업데이트 (첫 번째 사용자 메시지 사용)
      const firstUserMessage = messages.find(m => m.role === 'user');
      if (firstUserMessage) {
        const sessionTitle = firstUserMessage.text.substring(0, 50);
        // 함수형 업데이트를 사용하여 sessions 의존성 제거
        setSessions(prev => {
          const updatedSessions = prev.map(s => 
            s.id === currentSessionId 
              ? { ...s, title: sessionTitle, updatedAt: new Date() }
              : s
          ).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          saveSessions(updatedSessions);
          return updatedSessions;
        });
      }
    } catch {
      // 저장 실패는 조용히 무시
    }
  }, [messages, currentSessionId, getSessionStorageKey, saveSessions]);

  // Extract 3 survey questions from numbered or bullet list (Security Mode micro-survey)
  function extractThreeSurveyQuestions(text: string): string[] | null {
    if (!text) return null;

    // 1) 숫자형 설문 (1. / 2. / 3.)
    const numberRe = /1\.?\s*(.+)\n\s*2\.?\s*(.+)\n\s*3\.?\s*(.+)/s;
    const nm = text.match(numberRe);
    if (nm) {
      return [nm[1].trim(), nm[2].trim(), nm[3].trim()];
    }

    // 2) 불릿형 설문 (•, -, *, –)
    const bulletLines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^([•\-*–])\s+/.test(l))
      .map((l) => l.replace(/^([•\-*–])\s+/, '').trim());

    if (bulletLines.length >= 3) {
      return bulletLines.slice(0, 3);
    }

    return null;
  }

  const handleSend = async (textInput: string) => {
    if (!textInput.trim() || isLoading) return;

    // 설문 대기 중일 때: 설문 답변 입력 처리
    if (surveyPending && surveyQuestions) {
      // 먼저 사용자 메시지를 채팅에 추가
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text: textInput,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      
      // Parse exactly 3 answers from last 3 sentences
      const sentences = textInput
        .split(/[\.?!…。]+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (sentences.length >= 3) {
        const parsed = sentences.slice(-3);
        // Compose qa_pairs: [{ question, answer }]
        const qa_pairs = surveyQuestions.slice(0, 3).map((q, idx) => ({
          question: q,
          answer: parsed[idx] || "",
        }));
        setIsSubmittingSurvey(true);
        try {
          const resp = await fetch('/api/persona/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              qa_pairs,
              current_persona: user.persona,
            }),
          });
          
          if (!resp.ok) {
            const errorData = await resp.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${resp.status}`);
          }
          
          const result = await resp.json();
          if (result && typeof result.changed === 'boolean') {
            // 🔑 페르소나가 변경되었거나 유지되었을 때 사용자 상태 업데이트
            if (result.persona) {
              updateUser({ persona: result.persona });
            }
            
            if (result.changed) {
              setMessages((prev) => [
                ...prev,
                {
                  id: (Date.now() + 2).toString(),
                  role: 'model',
                  text: `Your persona has been updated to **${result.label}** (${result.persona}).`,
                  timestamp: new Date(),
                },
              ]);
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: (Date.now() + 2).toString(),
                  role: 'model',
                  text: `Your persona remains **${result.label}** (${result.persona}). Thank you for your responses!`,
                  timestamp: new Date(),
                },
              ]);
            }
          } else if (result.error) {
            throw new Error(result.error);
          }
        } catch (err) {
          console.error('Persona classification error:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 2).toString(),
              role: 'model',
              text: `Sorry, there was a problem updating your persona: ${errorMessage}. Please try again later.`,
              timestamp: new Date(),
            },
          ]);
        } finally {
          setSurveyQuestions(null);
          setSurveyAnswers(["", "", ""]);
          setSurveyPending(false);
          setIsSubmittingSurvey(false);
        }
        return; // block normal chat flow
      }
    }

    // 세션이 아직 없다면, 첫 사용자 메시지를 보내는 순간 기본 세션을 자동 생성
    if (!currentSessionId) {
      const newSessionId = `session_${Date.now()}`;
      const initial = [createInitialMessage()];
      const now = new Date();
      const newSession: ChatSession = {
        id: newSessionId,
        title: 'New Chat',
        createdAt: now,
        updatedAt: now,
      };

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            getSessionStorageKey(newSessionId),
            JSON.stringify(initial)
          );
        } catch {
          // ignore storage errors
        }
      }

      setSessions((prev) => {
        const updated = [newSession, ...prev];
        saveSessions(updated);
        return updated;
      });
      setCurrentSessionId(newSessionId);
      setMessages(initial);
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: textInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      if (isSecurityMode) {
        // 🔐 Security Mode → Flask + Qwen-Finsec 호출
        const historyForSecurity = messages.concat(userMsg);
        console.log("[DEBUG] historyForSecurity:", historyForSecurity);
        const responseText = await generateSecurityAdvice(
          historyForSecurity.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        );

        // after receiving model response, detect a 3-item survey/checklist (numbered or bullet)
        const questions = extractThreeSurveyQuestions(responseText);
        if (questions) {
          setSurveyQuestions(questions);
          setSurveyPending(true); // ✅ 설문 대기 상태 ON
        } else {
          setSurveyQuestions(null);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText,
            timestamp: new Date(),
          },
        ]);
      } else {
        // 💬 일반 모드 → Gemini/GPT 기반 멘토 호출
        const historyForApi = messages.concat(userMsg).map((m) => ({
          role: m.role,
          parts: [{ text: m.text }],
        }));

        const responseText = await generateFinancialAdvice(
          historyForApi,
          user,
          portfolio,
        );

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText,
            timestamp: new Date(),
          },
        ]);

        // after receiving model response, detect a 3-item survey/checklist (numbered or bullet)
        const questions = extractThreeSurveyQuestions(responseText);
        if (questions) {
          setSurveyQuestions(questions);
          setSurveyPending(true); // ✅ 설문 대기 상태 ON
        } else {
          setSurveyQuestions(null);
        }

        // 만약 서버가 페르소나 변경을 알리면 사용자에게 보여주기 위해 /api/check-persona-change 호출
        try {
          const surveyTrigger = /\b(survey|checklist|self-check)\b/i;
          if (surveyTrigger.test(textInput)) {
            // no-op for now; actual survey flow will call /api/update-persona after answers
          }
        } catch (e) {
          console.warn('Persona check skipped', e);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text:
            "I'm having trouble connecting to my data sources right now. Please try again in a moment.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Removed: handleSubmitSurvey and applySurveyAnswers (survey submission is now handled inline in handleSend)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(input);
  };

  const SUGGESTED_PROMPTS = [
    { icon: <BookOpen size={16} />, text: "Explain 'Dollar-Cost Averaging' simply." },
    { icon: <TrendingUp size={16} />, text: 'How does this market condition affect tech stocks?' },
    { icon: <AlertTriangle size={16} />, text: 'Review my current portfolio risk.' },
    { icon: <Sparkles size={16} />, text: 'Give me a psychological tip for trading today.' },
  ];

  return (
    <div className="h-[calc(100vh-4rem-3rem)] md:h-[calc(100vh-4rem)] flex">
      {/* 사이드바 */}
      <div className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <div className="h-full flex flex-col">
          {/* 사이드바 헤더 */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Chat History</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden text-gray-500 hover:text-gray-700"
            >
              <X size={20} />
            </button>
          </div>
          
          {/* 새 채팅 버튼 */}
          <div className="p-4 border-b border-gray-200">
            <button
              onClick={handleNewChat}
              disabled={isLoading}
              className="w-full flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              <Sparkles size={18} />
              <span className="font-medium">New Chat</span>
            </button>
          </div>
          
          {/* 세션 목록 */}
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-8">
                <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                <p>No chat history</p>
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => selectSession(session.id)}
                    className={`group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-primary-50 text-primary-700'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <MessageSquare size={16} className="shrink-0" />
                    <span className="flex-1 text-sm truncate">{session.title}</span>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-red-600 transition-opacity"
                      title="Delete chat"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 오버레이 (모바일) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* 메인 콘텐츠 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="max-w-5xl mx-auto w-full p-4 md:p-6 flex flex-col h-full">
          {/* Header + Security Mode Toggle + New Chat */}
          <div className="flex-shrink-0 mb-6 flex items-start justify-between gap-3 flex-wrap">
        {/* 왼쪽: 제목 + 설명 */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="bg-primary-100 p-2 rounded-xl">
        {/* Suggested Prompts (only show if few messages) */}
            </div>
            AI Financial Mentor
          </h1>
          <p className="text-gray-600 mt-2 ml-1">
            Your personal guide tailored to your{' '}
            {user.persona.toLowerCase().replace('_', ' ')} style.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 사이드바 토글 버튼 (모바일) */}
          <button
            type="button"
            onClick={() => !isLoading && setSidebarOpen(true)}
            disabled={isLoading}
            className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs md:text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Menu size={16} className="text-gray-500" />
            <span>History</span>
          </button>
          
          {/* 새 채팅 버튼 */}
          <button
            type="button"
            onClick={handleNewChat}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs md:text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Sparkles size={16} className="text-gray-500" />
            <span>New chat</span>
          </button>

          {/* 🔐 Security Mode 버튼 */}
          <button
            type="button"
            onClick={() => setIsSecurityMode((prev) => !prev)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs md:text-sm font-semibold border transition
            ${
              isSecurityMode
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            {isSecurityMode ? (
              <ShieldAlert size={16} className="text-emerald-600" />
            ) : (
              <Shield size={16} className="text-gray-500" />
            )}
            <span>Security Mode</span>
            {isSecurityMode && (
              <span className="hidden md:inline text-[10px] font-medium uppercase tracking-wide">
                ON
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 보안 모드 안내 배너 */}
      {isSecurityMode && (
        <div className="mb-4 text-xs md:text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2 flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <p>
            Security Mode is active. Responses will focus more on regulation, compliance,
            and security-risk perspectives.
          </p>
        </div>
      )}

      {/* 메인 카드 영역 */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`flex gap-3 max-w-[85%] md:max-w-[75%] ${
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    msg.role === 'user' ? 'bg-gray-200' : 'bg-primary-100'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User size={18} className="text-gray-600" />
                  ) : (
                    <Bot size={18} className="text-primary-600" />
                  )}
                </div>
                <div>
                  <div
                    className={`p-4 rounded-2xl text-sm md:text-base prose prose-sm md:prose-base max-w-none ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white rounded-tr-none'
                        : 'bg-gray-50 text-gray-800 rounded-tl-none border border-gray-100'
                    }`}
                  >
                    <ReactMarkdown
                      components={{
                        p: ({ node, ...props }) => (
                          <p className="mb-2 last:mb-0" {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="list-disc list-outside ml-4 mb-2" {...props} />
                        ),
                        li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                  <span
                    className={`text-xs text-gray-400 mt-1 block ${
                      msg.role === 'user' ? 'text-right mr-1' : 'ml-1'
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex gap-3 max-w-[75%]">
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <Loader2 size={18} className="text-primary-600 animate-spin" />
                </div>
                <div className="bg-gray-50 text-gray-500 p-4 rounded-2xl rounded-tl-none border border-gray-100 flex items-center gap-2">
                  <span className="animate-pulse font-medium">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Prompts (only show if few messages) */}
        {messages.length < 4 && !isLoading && (
          <div className="px-4 md:px-6 py-3 flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
            {SUGGESTED_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt.text)}
                className="shrink-0 flex items-center gap-2 px-3 py-2 bg-primary-50 text-primary-700 rounded-xl text-sm font-bold hover:bg-primary-100 transition-colors border border-primary-100"
              >
                {prompt.icon}
                {prompt.text}
              </button>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-gray-50 border-t border-gray-100 shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-3 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask specific questions for better advice..."
              className="flex-1 border-gray-200 rounded-xl py-3.5 px-5 pr-14 focus:ring-2 focus:ring-primary-500 focus:border-transparent shadow-sm text-gray-900 bg-white font-medium"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:hover:bg-primary-600"
            >
              {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </form>
          <p className="text-xs text-center text-gray-400 mt-3">
            FinGuide AI can make mistakes. Consider checking important financial information.
          </p>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
};

export default AiAgent;
