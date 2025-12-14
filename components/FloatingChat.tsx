import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { generateFinancialAdvice } from '../services/mentorService';
import { Send, Bot, User, Loader2, MessageCircle, X, Maximize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

const FloatingChat: React.FC = () => {
  const { user, portfolio } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      text: `Hi ${user.name}! I'm here to help. Ask me anything about the current page or finance in general.`,
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const historyForApi = messages.concat(userMsg).map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));
      const responseText = await generateFinancialAdvice(historyForApi, user, portfolio);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: responseText, timestamp: new Date() }]);
    } catch (error) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: "Error connecting. Try again.", timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-primary-700 transition-all hover:scale-105 focus:outline-none focus:ring-4 focus:ring-primary-300"
        aria-label="Open AI Chat"
      >
        <MessageCircle size={28} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 h-[550px] max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in slide-in-from-bottom-10 fade-in duration-200">
      {/* Header */}
      <div className="bg-primary-600 p-4 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={20} />
          <h3 className="font-bold">FinGuide Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/agent" onClick={() => setIsOpen(false)} className="text-primary-200 hover:text-white p-1" title="Go to full page">
             <Maximize2 size={18}/>
          </Link>
          <button onClick={() => setIsOpen(false)} className="text-primary-200 hover:text-white p-1 rounded-full hover:bg-primary-700 transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl text-sm prose prose-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none border border-gray-200 shadow-sm'}`}>
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-500 p-3 rounded-2xl rounded-tl-none border border-gray-200 shadow-sm flex items-center text-sm">
              <Loader2 size={14} className="animate-spin mr-2" /> Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-gray-100 shrink-0">
        <form onSubmit={handleSend} className="flex gap-2 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a quick question..."
            className="flex-1 border border-gray-300 rounded-full py-2 px-4 pr-10 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-gray-900 bg-white"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-primary-600 text-white p-1.5 rounded-full hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default FloatingChat;
