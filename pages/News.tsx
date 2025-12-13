import React, { useState, useEffect } from 'react';
import { NewsItem } from '../types';
import { Newspaper, TrendingUp, TrendingDown, Minus, Clock, Tag, RefreshCw, ExternalLink, X } from 'lucide-react';
import { analyzeNewsSentiment } from '../services/geminiService';

const News: React.FC = () => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [analyzingSentiment, setAnalyzingSentiment] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');

  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Recently';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const fetchNews = async (symbol?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const trimmed = symbol?.trim();
      const url = trimmed
        ? `http://localhost:5002/api/news?symbol=${encodeURIComponent(trimmed)}`
        : 'http://localhost:5002/api/news';

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to fetch news');
      }
      const data = await res.json();
      if (data.news && Array.isArray(data.news)) {
        // 날짜 포맷팅 및 기본 impact 설정
        // 중복 ID / 중복 기사(제목+출처 기준) 제거
        const seenIds = new Set<string>();
        const seenTitleSource = new Set<string>();

        const formattedNews = data.news
          .map((item: any, index: number) => {
            // 고유한 ID 생성
            let newsId = item.id || `${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
            // 중복 ID가 있으면 새로 생성
            if (seenIds.has(newsId)) {
              newsId = `${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
            }
            seenIds.add(newsId);

            const rawSymbols = Array.isArray(item.related_symbols) ? item.related_symbols : [];
            const cleanedSymbols = Array.from(
              new Set(
                rawSymbols
                  .map((s: string) => (s || '').trim())
                  .filter(Boolean)
                  .map((s: string) =>
                    /^[a-zA-Z0-9.]+$/.test(s) ? s.toUpperCase() : s
                  )
              )
            );

            return {
              ...item,
              date: item.date ? formatDate(item.date) : 'Recently',
              id: newsId,
              impact: item.impact || 'neutral',
              related_symbols: cleanedSymbols,
            };
          })
          .filter((item: NewsItem) => {
            const titleKey = (item.title || '').trim().toLowerCase();
            const sourceKey = (item.source || '').trim().toLowerCase();
            if (!titleKey) return false;
            const composite = `${titleKey}|${sourceKey}`;
            if (seenTitleSource.has(composite)) {
              return false;
            }
            seenTitleSource.add(composite);
            return true;
          });
        setNews(formattedNews);
        
        // 각 뉴스에 대해 감성분석 수행 (비동기, rate limiting 적용)
        // 무료 티어는 분당 10개 요청 제한이 있으므로 최대 5개만 분석 (안전 마진)
        const maxAnalysisCount = 5;
        const newsToAnalyze = formattedNews.slice(0, maxAnalysisCount);
        
        newsToAnalyze.forEach((item: NewsItem, index: number) => {
          // 각 요청 사이에 13초 딜레이 (분당 10개 = 6초 간격, 여유를 두고 13초)
          // 첫 번째는 즉시, 두 번째는 13초 후, 세 번째는 26초 후...
          setTimeout(() => {
            analyzeNewsItem(item);
          }, index * 13000);
        });
        
        if (formattedNews.length > maxAnalysisCount) {
          console.log(`[Sentiment] Analyzing only first ${maxAnalysisCount} news items due to API rate limits (10 requests/minute).`);
        }
      } else {
        setNews([]);
      }
    } catch (err) {
      console.error('News fetch error:', err);
      setError('뉴스를 불러오는 중 오류가 발생했습니다.');
      setNews([]);
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeNewsItem = async (item: NewsItem) => {
    if (analyzingSentiment.has(item.id) || item.impact !== 'neutral') {
      return; // 이미 분석 중이거나 분석 완료
    }
    
    setAnalyzingSentiment(prev => new Set(prev).add(item.id));
    
    try {
      console.log(`Analyzing sentiment for: ${item.title.substring(0, 50)}...`);
      const sentiment = await analyzeNewsSentiment(
        item.title,
        item.summary,
        item.related_symbols || []
      );
      console.log(`Sentiment result: ${sentiment} for ${item.title.substring(0, 50)}...`);
      
      setNews(prev => prev.map(n => 
        n.id === item.id ? { ...n, impact: sentiment } : n
      ));
    } catch (err: any) {
      // 감성 분석 오류는 다른 기능에 영향을 주지 않도록 조용히 처리
      console.warn('Sentiment analysis error (non-blocking):', err?.message || err);
      // 오류가 발생해도 neutral로 유지 (사용자 경험 방해하지 않음)
    } finally {
      setAnalyzingSentiment(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleNewsClick = (item: NewsItem, e: React.MouseEvent) => {
    // 링크 클릭은 기본 동작 유지
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.closest('button')) {
      return;
    }
    
    // 카드 클릭 시 모달로 본문 표시
    setSelectedNews(item);
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleSearch = async () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      fetchNews();
      return;
    }

    // 1차: 백엔드 /api/search 를 통해 회사명/티커 검색 → 심볼 얻기
    try {
      const res = await fetch(
        `http://localhost:5002/api/search?query=${encodeURIComponent(trimmed)}`
      );
      if (res.ok) {
        const data = await res.json();
        const first = (data.results || [])[0];
        if (first && first.symbol) {
          fetchNews(first.symbol);
          return;
        }
      }
    } catch (e) {
      console.error('News symbol search error:', e);
    }

    // 2차: 검색어를 그대로 심볼로 간주 (티커 직접 입력용)
    fetchNews(trimmed.toUpperCase());
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'positive': return <TrendingUp className="text-green-500" size={20} />;
      case 'negative': return <TrendingDown className="text-red-500" size={20} />;
      default: return <Minus className="text-gray-400" size={20} />;
    }
  };

  const getImpactClass = (impact: string) => {
    switch (impact) {
      case 'positive': return 'bg-green-50 text-green-800 border-green-100';
      case 'negative': return 'bg-red-50 text-red-800 border-red-100';
      default: return 'bg-gray-50 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <Newspaper className="text-primary-600" size={28} />
            Market News &amp; Reports
          </h1>
          <p className="text-gray-600 mt-1">Stay updated with the latest market news affecting your virtual portfolio.</p>
        </div>
        <div className="w-full md:w-auto flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search news by ticker or company (e.g. AAPL, Tesla, 005930)"
              className="w-full px-3 py-2 pr-10 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            {searchTerm.trim() ? 'Search' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
          <RefreshCw size={32} className="mx-auto mb-2 opacity-50 animate-spin" />
          <p className="font-medium text-gray-500">Loading news...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="space-y-6">
            {news.length > 0 ? (
              news.map(item => (
                <div 
                  key={item.id} 
                  className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                  onClick={(e) => handleNewsClick(item, e)}
                >
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4 gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                          <span className="font-bold text-primary-700">{item.source}</span>
                          <span>•</span>
                          <span className="flex items-center"><Clock size={14} className="mr-1"/> {item.date}</span>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 leading-tight hover:text-primary-600 transition-colors">{item.title}</h3>
                      </div>
                      <div className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1 border ${getImpactClass(item.impact)}`}>
                        {analyzingSentiment.has(item.id) ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          getImpactIcon(item.impact)
                        )}
                        {item.impact}
                      </div>
                    </div>

                    <p className="text-gray-700 leading-relaxed mb-4">{item.summary}</p>

                    <div className="flex items-center justify-between">
                      {item.related_symbols && item.related_symbols.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Tag size={16} className="text-gray-400" />
                          <div className="flex flex-wrap gap-2">
                            {item.related_symbols.map(symbol => (
                              <span key={symbol} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-md border border-blue-100">
                                {symbol}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-primary-600 text-sm font-medium hover:text-primary-700"
                        >
                          <ExternalLink size={16} />
                          <span>Read more</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-gray-500">
                <Newspaper size={32} className="mx-auto mb-2 opacity-50" />
                <p className="font-medium">No news available at the moment.</p>
                <p className="text-sm">Check back later for more market updates.</p>
              </div>
            )}
          </div>

          {news.length > 0 && (
            <div className="text-center p-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-gray-500">
              <Newspaper size={32} className="mx-auto mb-2 opacity-50" />
              <p className="font-medium">That's all the news for now.</p>
              <p className="text-sm">Check back later for more market updates.</p>
            </div>
          )}
        </>
      )}

      {/* 뉴스 본문 모달 */}
      {selectedNews && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedNews(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                  <span className="font-bold text-primary-700">{selectedNews.source}</span>
                  <span>•</span>
                  <span className="flex items-center"><Clock size={14} className="mr-1"/> {selectedNews.date}</span>
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900 leading-tight">{selectedNews.title}</h2>
              </div>
              <button
                onClick={() => setSelectedNews(null)}
                className="ml-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={24} className="text-gray-500" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-4">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${getImpactClass(selectedNews.impact)}`}>
                  {getImpactIcon(selectedNews.impact)}
                  {selectedNews.impact}
                </div>
              </div>
              
              <div className="prose max-w-none mb-6">
                <p className="text-gray-700 leading-relaxed text-lg whitespace-pre-wrap">{selectedNews.summary}</p>
              </div>
              
              {selectedNews.related_symbols && selectedNews.related_symbols.length > 0 && (
                <div className="flex items-center gap-2 mb-6">
                  <Tag size={18} className="text-gray-400" />
                  <div className="flex flex-wrap gap-2">
                    {selectedNews.related_symbols.map(symbol => (
                      <span key={symbol} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-sm font-bold rounded-md border border-blue-100">
                        {symbol}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {selectedNews.link && (
                <a
                  href={selectedNews.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-colors"
                >
                  <ExternalLink size={18} />
                  <span>Read Full Article</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default News;
