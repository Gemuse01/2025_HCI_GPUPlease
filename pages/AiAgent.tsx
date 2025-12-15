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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

const AiAgent: React.FC = () => {
  const { user, portfolio, marketCondition, updateUser } = useApp();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      text: `Hello ${user.name}! I'm your personalized FinGuide mentor. 

I know you're here for **${user.goal}** and prefer a **${user.risk_tolerance}** risk approach. The market is currently simulated as **${marketCondition}**. 

How can I support your journey today?`,
      timestamp: new Date(),
    },
  ]);
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

  // Extract 3 survey questions from numbered or bullet list
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
      .map(l => l.trim())
      .filter(l => /^([•\-*–])\s+/.test(l))
      .map(l => l.replace(/^([•\-*–])\s+/, '').trim());

    if (bulletLines.length >= 3) {
      return bulletLines.slice(0, 3);
    }

    return null;
  }

  const handleSend = async (textInput: string) => {
    if (!textInput.trim() || isLoading) return;

    // 설문 대기 중일 때: 설문 답변 입력 처리
    if (surveyPending && surveyQuestions) {
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
    <div className="h-[calc(100vh-4rem-3rem)] md:h-[calc(100vh-4rem)] max-w-5xl mx-auto p-4 md:p-6 flex flex-col">
      {/* Header + Security Mode Toggle */}
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
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
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
  );
};

export default AiAgent;
