from flask import Flask, request, jsonify
from flask_cors import CORS
import yfinance as yf
import time
import os

from qwen_client import call_qwen_finsec_model, build_security_prompt

app = Flask(__name__)
CORS(app)  # allow all origins for /api/*

@app.route("/")
def index():
    return jsonify({
        "message": "yfinance API server is running",
        "endpoints": [
            "/api/quote?symbol=SYMBOL",
            "/api/search?query=QUERY",
            "/api/news?symbol=SYMBOL (optional)"
        ]
    })

@app.route("/api/quote")
def get_quote():
    symbol = request.args.get('symbol')
    if not symbol:
        return jsonify({'error': "no symbol"}), 400
    try:
        ticker = yf.Ticker(symbol)
        data = ticker.history(period="2d")
        if data.empty:
            return jsonify({"error": "No price data"}), 404
        last_row = data.iloc[-1]
        price = float(last_row["Close"])
        prev_row = data.iloc[-2] if len(data) > 1 else last_row
        prev_close = float(prev_row["Close"])
        change_pct = (price - prev_close) / prev_close * 100 if prev_close > 0 else 0
        return jsonify({"symbol": symbol, "price": price, "change_pct": change_pct})
    except Exception as e:
        print("quote error", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/search")
def search_stocks():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({"results": []})
    
    results = []
    query_upper = query.upper()
    
    # 1. 나스닥 심볼 직접 시도 (대문자로)
    nasdaq_symbols = [query_upper]
    
    # 2. 한국 주식 / 나스닥 심볼 후보 생성
    korean_symbols = []
    # 이미 .KS, .KQ가 붙어있으면 그대로 사용하고 나스닥은 제외
    if query_upper.endswith('.KS') or query_upper.endswith('.KQ'):
        korean_symbols = [query_upper]
        nasdaq_symbols = []
    elif query.isdigit() and len(query) == 6:
        # 6자리 숫자면 .KS와 .KQ 둘 다 시도
        korean_symbols = [f"{query}.KS", f"{query}.KQ"]
    elif query.isdigit() and len(query) < 6:
        # 6자리 미만 숫자면 앞에 0을 붙여서 6자리로 만들고 시도
        padded_query = query.zfill(6)
        korean_symbols = [f"{padded_query}.KS", f"{padded_query}.KQ"]
    else:
        # 그 외는 나스닥 심볼로 가정 (예: AAPL, TSLA)
        nasdaq_symbols = [query_upper]
    
    # 모든 후보 심볼 검증
    all_symbols = nasdaq_symbols + korean_symbols
    valid_korean_results = {'KS': None, 'KQ': None}
    
    for symbol in all_symbols:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            # 유효한 종목인지 확인
            if not info or 'symbol' not in info:
                continue
            
            # 이름 가져오기
            name = info.get('longName') or info.get('shortName') or ''
            
            # 이름이 이상한 경우 필터링
            if not name or len(name) < 2:
                continue
            
            # 이름에 이상한 패턴이 있으면 제외
            if ',' in name or name.startswith('0P') or len(name.split(',')) > 1:
                continue
            
            # 실제 주가 데이터가 있어야 함 (가장 중요!)
            try:
                data = ticker.history(period="2d")
                if data.empty:
                    continue  # 주가 데이터가 없으면 유효하지 않음
                price = float(data.iloc[-1]["Close"])
            except:
                # history 실패 시 info에서 가격 가져오기 시도
                price = info.get('currentPrice', 0) or info.get('regularMarketPrice', 0) or 0
                if price <= 0:
                    continue  # 가격이 없으면 유효하지 않음
            
            # 가격이 0 이하면 제외
            if price <= 0:
                continue
            
            sector = info.get('sector', 'N/A')
            
            result = {
                "symbol": symbol,
                "name": name,
                "price": price,
                "change_pct": 0,
                "sector": sector,
                "volatility": "medium"
            }
            
            # 나스닥 종목이면 바로 추가
            if symbol not in korean_symbols:
                results.append(result)
            else:
                # 한국 주식인 경우, .KS와 .KQ를 구분해서 저장
                if symbol.endswith('.KS'):
                    if valid_korean_results['KS'] is None:
                        valid_korean_results['KS'] = result
                elif symbol.endswith('.KQ'):
                    if valid_korean_results['KQ'] is None:
                        valid_korean_results['KQ'] = result
                
        except Exception as e:
            # 이 심볼은 유효하지 않음, 다음으로
            continue
    
    # 한국 주식 결과 추가 (각각 최대 1개씩만)
    if valid_korean_results['KS']:
        results.append(valid_korean_results['KS'])
    if valid_korean_results['KQ']:
        results.append(valid_korean_results['KQ'])
    
    return jsonify({"results": results[:20]})  # 최대 20개 반환

@app.route("/api/news")
def get_news():
    symbol = request.args.get('symbol', '').strip()
    
    try:
        news_items = []
        
        if symbol:
            # 특정 종목의 뉴스
            try:
                ticker = yf.Ticker(symbol)
                # news 속성 직접 접근
                news = []
                try:
                    # 방법 1: news 속성 직접 접근
                    news = ticker.news
                    if not news or not isinstance(news, list):
                        # 방법 2: _get_news 메서드 시도
                        try:
                            news = ticker._get_news()
                        except:
                            pass
                except Exception as e:
                    print(f"Error getting news for {symbol}: {e}")
                    news = []
                
                if news and isinstance(news, list) and len(news) > 0:
                    for idx, item in enumerate(news[:20]):  # 최대 20개
                        if not isinstance(item, dict):
                            continue
                        
                        try:
                            # content 객체 추출 (yfinance의 새로운 구조)
                            content = item.get('content', {})
                            if not isinstance(content, dict):
                                content = item
                            
                            # title 필드 찾기 (content 안에 있음)
                            title_val = content.get('title') or item.get('title') or content.get('headline') or ''
                            title = str(title_val).strip() if title_val and not isinstance(title_val, dict) else ''
                            if not title:
                                continue
                            
                            # publisher 필드 찾기
                            pub_val = (content.get('publisher') or content.get('publisherName') or 
                                      content.get('provider') or item.get('publisher') or 
                                      item.get('publisherName') or 'Market News')
                            publisher = str(pub_val).strip() if pub_val and not isinstance(pub_val, dict) else 'Market News'
                            if not publisher or publisher.lower() in ['unknown', '']:
                                publisher = 'Market News'
                            
                            # 날짜 처리
                            pub_time = (content.get('providerPublishTime') or content.get('pubDate') or 
                                       content.get('publishedAt') or content.get('pubDateUTC') or
                                       item.get('providerPublishTime') or item.get('pubDate') or 
                                       item.get('publishedAt') or 0)
                            if isinstance(pub_time, str):
                                try:
                                    from datetime import datetime
                                    pub_time = int(datetime.fromisoformat(pub_time.replace('Z', '+00:00')).timestamp())
                                except:
                                    pub_time = 0
                            elif pub_time and isinstance(pub_time, (int, float)):
                                pub_time = int(pub_time)
                            else:
                                pub_time = 0
                            
                            # summary 필드 찾기
                            summary_val = (content.get('summary') or content.get('description') or 
                                          content.get('text') or item.get('summary') or 
                                          item.get('description') or title)
                            summary = str(summary_val).strip() if summary_val and not isinstance(summary_val, dict) else title
                            if not summary:
                                summary = title
                            
                            # uuid 찾기
                            id_val = content.get('id') or item.get('uuid') or item.get('id') or item.get('link')
                            news_id = str(id_val) if id_val and not isinstance(id_val, dict) else f"{symbol}_{len(news_items)}_{hash(title)}"
                            
                            # 링크 찾기 (다양한 필드 시도)
                            link_val = (content.get('link') or content.get('url') or content.get('canonicalUrl') or
                                       content.get('clickThroughUrl') or content.get('clickThroughURL') or
                                       item.get('link') or item.get('url') or item.get('canonicalUrl') or
                                       item.get('clickThroughUrl') or item.get('clickThroughURL') or '')
                            link = str(link_val) if link_val and not isinstance(link_val, dict) else ''
                            
                            # 링크가 없거나 유효하지 않으면 검색 링크로 대체 (제목으로 구글 검색)
                            if not link or not link.startswith('http'):
                                try:
                                    from urllib.parse import quote_plus
                                    query_str = quote_plus(title)
                                    link = f"https://www.google.com/search?q={query_str}"
                                except Exception:
                                    link = ''
                            
                            news_items.append({
                                "id": str(news_id),
                                "title": title,
                                "source": publisher,
                                "date": pub_time,
                                "summary": summary,
                                "impact": "neutral",
                                "related_symbols": [symbol],
                                "link": link
                            })
                        except Exception as e:
                            print(f"Error processing news item {idx} for {symbol}: {e}")
                            continue
            except Exception as e:
                print(f"Error fetching news for {symbol}:", e)
                import traceback
                traceback.print_exc()
        else:
            # 주요 종목들의 뉴스 (AAPL, GOOGL, TSLA, MSFT, NVDA)
            # 한국 주식은 뉴스가 제한적이므로 제외
            major_symbols = ['AAPL', 'GOOGL', 'TSLA', 'MSFT', 'NVDA']
            all_news = []
            
            for sym in major_symbols:
                try:
                    ticker = yf.Ticker(sym)
                    # news 속성 직접 접근
                    news = []
                    try:
                        # 방법 1: news 속성 직접 접근
                        news = ticker.news
                        if not news or not isinstance(news, list) or len(news) == 0:
                            # 방법 2: _get_news 메서드 시도
                            try:
                                news = ticker._get_news()
                            except:
                                pass
                    except Exception as e:
                        print(f"Error getting news for {sym}: {e}")
                        news = []
                    
                    # 요청 간 딜레이 (Yahoo Finance 제한 방지)
                    time.sleep(0.5)
                    
                    if news and isinstance(news, list) and len(news) > 0:
                        for idx, item in enumerate(news[:8]):  # 각 종목당 최대 8개
                            if not isinstance(item, dict):
                                continue
                            
                            try:
                                # content 객체 추출 (yfinance의 새로운 구조)
                                content = item.get('content', {})
                                if not isinstance(content, dict):
                                    content = item
                                
                                # title 필드 찾기 (content 안에 있음)
                                title_val = content.get('title') or item.get('title') or content.get('headline') or ''
                                title = str(title_val).strip() if title_val and not isinstance(title_val, dict) else ''
                                if not title:
                                    continue
                                
                                # publisher 필드 찾기
                                pub_val = (content.get('publisher') or content.get('publisherName') or 
                                          content.get('provider') or item.get('publisher') or 
                                          item.get('publisherName') or 'Market News')
                                publisher = str(pub_val).strip() if pub_val and not isinstance(pub_val, dict) else 'Market News'
                                if not publisher or publisher.lower() in ['unknown', '']:
                                    publisher = 'Market News'
                                
                                # 날짜 처리
                                pub_time = (content.get('providerPublishTime') or content.get('pubDate') or 
                                           content.get('publishedAt') or content.get('pubDateUTC') or
                                           item.get('providerPublishTime') or item.get('pubDate') or 
                                           item.get('publishedAt') or 0)
                                if isinstance(pub_time, str):
                                    try:
                                        from datetime import datetime
                                        pub_time = int(datetime.fromisoformat(pub_time.replace('Z', '+00:00')).timestamp())
                                    except:
                                        pub_time = 0
                                elif pub_time and isinstance(pub_time, (int, float)):
                                    pub_time = int(pub_time)
                                else:
                                    pub_time = 0
                                
                                # summary 필드 찾기
                                summary_val = (content.get('summary') or content.get('description') or 
                                              content.get('text') or item.get('summary') or 
                                              item.get('description') or title)
                                summary = str(summary_val).strip() if summary_val and not isinstance(summary_val, dict) else title
                                if not summary:
                                    summary = title
                                
                                # uuid 찾기
                                id_val = content.get('id') or item.get('uuid') or item.get('id') or item.get('link')
                                news_id = str(id_val) if id_val and not isinstance(id_val, dict) else f"{sym}_{len(all_news)}_{hash(title)}"
                                
                                # 링크 찾기 (다양한 필드 시도)
                                link_val = (content.get('link') or content.get('url') or content.get('canonicalUrl') or
                                           content.get('clickThroughUrl') or content.get('clickThroughURL') or
                                           item.get('link') or item.get('url') or item.get('canonicalUrl') or
                                           item.get('clickThroughUrl') or item.get('clickThroughURL') or '')
                                link = str(link_val) if link_val and not isinstance(link_val, dict) else ''
                                
                                # 링크가 없거나 유효하지 않으면 검색 링크로 대체 (제목으로 구글 검색)
                                if not link or not link.startswith('http'):
                                    try:
                                        from urllib.parse import quote_plus
                                        query_str = quote_plus(title)
                                        link = f"https://www.google.com/search?q={query_str}"
                                    except Exception:
                                        link = ''
                                
                                all_news.append({
                                    "id": str(news_id),
                                    "title": title,
                                    "source": publisher,
                                    "date": pub_time,
                                    "summary": summary,
                                    "impact": "neutral",
                                    "related_symbols": [sym],
                                    "link": link
                                })
                            except Exception as e:
                                print(f"Error processing news item {idx} for {sym}: {e}")
                                continue
                except Exception as e:
                    print(f"Error fetching news for {sym}:", e)
                    continue
            
            # 날짜순으로 정렬 (최신순)
            all_news.sort(key=lambda x: x['date'], reverse=True)
            news_items = all_news[:30]  # 전체 최대 30개
        
        # 뉴스가 없으면 에러 메시지와 함께 빈 배열 반환
        # (mock 데이터는 사용하지 않음 - 실제 데이터만 사용)
        if len(news_items) == 0:
            print("Warning: No news items found from yfinance")
        
        return jsonify({"news": news_items})
    except Exception as e:
        print("news error", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "news": []}), 500


# -----------------------------
# Qwen Finsec proxy endpoint
# -----------------------------

# 엘리스에서 받은 URL / API KEY (원래는 환경변수로 빼는 것이 안전함)
MY_API_URL = os.getenv("QWEN_FINSEC_URL", "https://mlapi.run/0cd91e2f-6603-4699-b9d8-57c93f05b37e")
MY_API_KEY = os.getenv(
    "QWEN_FINSEC_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjUzMjc0NDQsIm5iZiI6MTc2NTMyNzQ0NCwiZXhwIjoxNzY1Mzc4Nzk5LCJrZXlfaWQiOiI5MWQ1N2UwMi03ODYxLTQ4YzQtODU1Ni1hMGVkYmIyNWQxNjIifQ.D-ybt57LKXBcckn2LgHXx6YI2g49UYI4f1vPAxZgpgk",
)


@app.route("/api/security-chat", methods=["POST", "OPTIONS"])
def security_chat():
    """
    보안모드용 Qwen-Finsec 프록시 엔드포인트
    프론트에서 body:
      { "history": [ { "role": "user"|"model", "content": "..." }, ... ] }
    """
    print(">>> /api/security-chat hit, method =", request.method)

    # 브라우저 Preflight(OPTIONS) 대응
    if request.method == "OPTIONS":
        # Flask-CORS가 헤더는 달아주기 때문에 200만 돌려주면 됨
        return "", 200

    data = request.get_json(force=True) or {}
    history = data.get("history", [])

    if not history:
        return jsonify({"error": "history is empty"}), 400

    latest = history[-1]
    user_message = latest.get("content", "")
    prev_history = history[:-1]

    prompt = build_security_prompt(prev_history, user_message)
    print("[DEBUG] prompt head:", prompt[:200], "...")

    answer = call_qwen_finsec_model(MY_API_URL, MY_API_KEY, prompt)
    return jsonify({"answer": answer})

if __name__ == "__main__":
    # 기존 yfinance + Qwen 프록시 엔드포인트들을 모두 포함한 서버
    app.run(host="0.0.0.0", port=5002, debug=True)
