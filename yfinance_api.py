from flask import Flask, request, jsonify
from flask_cors import CORS
import yfinance as yf
import time
import os
import json
import re

from qwen_client import call_qwen_finsec_model, build_security_prompt
from openai import OpenAI

app = Flask(__name__)
CORS(app)  # allow all origins for /api/*


def yahoo_search_symbols(query: str):
    """
    Yahoo Finance 검색 API를 사용해 회사명/티커로 심볼 후보를 가져온다.
    - 예: "samsung" -> ["005930.KS", "005935.KS", ...]
    - 예: "realty income" -> ["O"]
    """
    query = (query or "").strip()
    if not query:
        return []

    try:
        import urllib.request
        from urllib.parse import urlencode

        base_url = "https://query1.finance.yahoo.com/v1/finance/search"
        params = {"q": query, "quotesCount": 8, "newsCount": 0, "listsCount": 0}
        url = f"{base_url}?{urlencode(params)}"

        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read()
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception:
                data = {}

        quotes = data.get("quotes", []) or []
        symbols = []
        for q in quotes:
            sym = q.get("symbol")
            if not sym:
                continue
            s = str(sym).strip()
            if not s:
                continue
            if s not in symbols:
                symbols.append(s)

        print(f"[yahoo_search_symbols] query='{query}' -> {symbols}")
        return symbols
    except Exception as e:
        print("[yahoo_search_symbols] error:", e)
        return []

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
    
    # 1. 심볼 기반 후보 생성
    nasdaq_symbols = [query_upper]
    korean_symbols = []

    # (1) 이미 .KS, .KQ가 붙어있으면 그대로 사용하고 나스닥은 제외
    if query_upper.endswith('.KS') or query_upper.endswith('.KQ'):
        korean_symbols = [query_upper]
        nasdaq_symbols = []
    # (2) 공백/텍스트에 섞여 있는 6자리 숫자 추출 (예: "삼성전자 005930")
    else:
        m = re.search(r"\d{6}", query)
        code = m.group(0) if m else None
        if code:
            korean_symbols = [f"{code}.KS", f"{code}.KQ"]
        elif query.isdigit() and len(query) < 6:
            # 6자리 미만 숫자면 앞에 0을 붙여서 6자리로 만들고 시도
            padded_query = query.zfill(6)
            korean_symbols = [f"{padded_query}.KS", f"{padded_query}.KQ"]
        else:
            # 그 외는 나스닥 심볼로 가정 (예: AAPL, TSLA, TSLA.US)
            nasdaq_symbols = [query_upper]
    
    all_symbols = nasdaq_symbols + korean_symbols

    # 2. 회사명/티커 검색을 위해 Yahoo Finance search API 결과를 추가 후보로 사용
    try:
        yahoo_syms = yahoo_search_symbols(query)
        for s in yahoo_syms:
            su = s.upper()
            if su not in all_symbols:
                all_symbols.append(su)
    except Exception as e:
        print("[/api/search] yahoo_search_symbols error:", e)
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
                
        except Exception:
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
                            raw_link_val = (
                                content.get('link') or content.get('url') or content.get('canonicalUrl') or
                                content.get('clickThroughUrl') or content.get('clickThroughURL') or
                                item.get('link') or item.get('url') or item.get('canonicalUrl') or
                                item.get('clickThroughUrl') or item.get('clickThroughURL') or ''
                            )
                            link = _normalize_link_value(raw_link_val)
                            if not isinstance(link, str):
                                link = ''
                            # http/https 로 시작하지 않으면 버튼을 아예 숨기기 위해 빈 문자열로 처리
                            if not link.startswith('http'):
                                link = ''
                            
                            # 관련 심볼 처리:
                            # 1) 기본은 요청 symbol
                            # 2) Yahoo가 내려주는 relatedTickers
                            related_set = set()
                            if symbol:
                                related_set.add(symbol)

                            try:
                                raw_related = content.get("relatedTickers") or item.get("relatedTickers") or []
                                if isinstance(raw_related, list):
                                    for r in raw_related:
                                        if not r:
                                            continue
                                        rsym = str(r).strip()
                                        if not rsym:
                                            continue
                                        related_set.add(rsym)
                            except Exception:
                                pass

                            related = sorted(related_set)
                            
                            news_items.append({
                                "id": str(news_id),
                                "title": title,
                                "source": publisher,
                                "date": pub_time,
                                "summary": summary,
                                "impact": "neutral",
                                "related_symbols": related,
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
            # Market News 모드: 여러 종목의 뉴스를 모아서
            # 같은 기사(제목+출처 기준)는 한 번만 보여주고,
            # 관련 심볼은 실제로 그 기사가 속해 있던 심볼 + Yahoo relatedTickers 로 구성
            major_symbols = ['AAPL', 'GOOGL', 'TSLA', 'MSFT', 'NVDA']
            article_map = {}  # key -> article dict (related_symbols 는 set 으로 유지)
            
            for sym in major_symbols:
                try:
                    ticker = yf.Ticker(sym)
                    news = []
                    try:
                        news = ticker.news
                        if not news or not isinstance(news, list) or len(news) == 0:
                            try:
                                news = ticker._get_news()
                            except:
                                pass
                    except Exception as e:
                        print(f"Error getting news for {sym}: {e}")
                        news = []
                    
                    time.sleep(0.5)  # Yahoo rate limit 보호
                    
                    if news and isinstance(news, list) and len(news) > 0:
                        for idx, item in enumerate(news[:8]):  # 각 종목당 최대 8개
                            if not isinstance(item, dict):
                                continue
                            
                            try:
                                content = item.get('content', {})
                                if not isinstance(content, dict):
                                    content = item
                                
                                title_val = content.get('title') or item.get('title') or content.get('headline') or ''
                                title = str(title_val).strip() if title_val and not isinstance(title_val, dict) else ''
                                if not title:
                                    continue
                                
                                pub_val = (content.get('publisher') or content.get('publisherName') or 
                                          content.get('provider') or item.get('publisher') or 
                                          item.get('publisherName') or 'Market News')
                                publisher = str(pub_val).strip() if pub_val and not isinstance(pub_val, dict) else 'Market News'
                                if not publisher or publisher.lower() in ['unknown', '']:
                                    publisher = 'Market News'
                                
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
                                
                                summary_val = (content.get('summary') or content.get('description') or 
                                              content.get('text') or item.get('summary') or 
                                              item.get('description') or title)
                                summary = str(summary_val).strip() if summary_val and not isinstance(summary_val, dict) else title
                                if not summary:
                                    summary = title
                                
                                id_val = content.get('id') or item.get('uuid') or item.get('id') or item.get('link')
                                base_id = str(id_val) if id_val and not isinstance(id_val, dict) else title
                                
                                # 기사 중복을 줄이기 위한 키 (제목 + 출처 기준)
                                key = f"{title.strip().lower()}|{publisher.strip().lower()}"

                                if key not in article_map:
                                    # 링크 찾기
                                    raw_link_val = (
                                        content.get('link')
                                        or content.get('url')
                                        or content.get('canonicalUrl')
                                        or content.get('clickThroughUrl')
                                        or content.get('clickThroughURL')
                                        or item.get('link')
                                        or item.get('url')
                                        or item.get('canonicalUrl')
                                        or item.get('clickThroughUrl')
                                        or item.get('clickThroughURL')
                                        or ''
                                    )
                                    link = _normalize_link_value(raw_link_val)
                                    if not isinstance(link, str):
                                        link = ''
                                    # http/https 로 시작하지 않으면 버튼을 숨기기 위해 빈 문자열 처리
                                    if not link.startswith('http'):
                                        link = ''

                                    article_map[key] = {
                                        "id": f"{base_id}_{hash(key)}",
                                        "title": title,
                                        "source": publisher,
                                        "date": pub_time,
                                        "summary": summary,
                                        "impact": "neutral",
                                        "related_symbols": set(),
                                        "link": link,
                                    }
                                
                                # 이 기사는 최소한 sym 과 연관
                                article_map[key]["related_symbols"].add(sym)
                                
                                # Yahoo relatedTickers 도 추가
                                try:
                                    raw_related = content.get("relatedTickers") or item.get("relatedTickers") or []
                                    if isinstance(raw_related, list):
                                        for r in raw_related:
                                            if not r:
                                                continue
                                            rsym = str(r).strip()
                                            if not rsym:
                                                continue
                                            article_map[key]["related_symbols"].add(rsym)
                                except Exception:
                                    pass
                            except Exception as e:
                                print(f"Error processing news item {idx} for {sym}: {e}")
                                continue
                except Exception as e:
                    print(f"Error fetching news for {sym}:", e)
                    continue
            
            # map → 리스트로 변환 + 심볼 set 을 정렬된 리스트로 변경
            all_news = []
            for art in article_map.values():
                syms = sorted(art["related_symbols"])
                art["related_symbols"] = syms
                all_news.append(art)
            
            all_news.sort(key=lambda x: x['date'], reverse=True)
            news_items = all_news[:30]
        
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
# GPT-5 nano sentiment proxy  (/api/news-sentiment)
# -----------------------------

# 환경변수로 덮어쓸 수 있게 기본값만 설정
SENTIMENT_API_URL = os.getenv(
    "SENTIMENT_API_URL",
    "https://mlapi.run/daef5150-72ef-48ff-8861-df80052ea7ac/v1",
)
SENTIMENT_API_KEY = os.getenv("SENTIMENT_API_KEY", "")

openai_client = (
    OpenAI(base_url=SENTIMENT_API_URL, api_key=SENTIMENT_API_KEY)
    if SENTIMENT_API_KEY
    else None
)


openai_client = (
    OpenAI(base_url=SENTIMENT_API_URL, api_key=SENTIMENT_API_KEY)
    if SENTIMENT_API_KEY
    else None
)


def _normalize_link_value(raw):
    """
    Yahoo Finance 뉴스 객체 안의 링크 필드는 문자열이거나 dict일 수 있으므로,
    여기서 최대한 실제 http(s) URL 을 뽑아낸다.
    """
    if not raw:
        return ""
    # 이미 문자열인 경우
    if isinstance(raw, str):
        return raw
    # dict 인 경우 여러 키 후보에서 URL 시도
    if isinstance(raw, dict):
        for key in (
            "url",
            "webUrl",
            "canonicalUrl",
            "clickThroughUrl",
            "clickThroughURL",
            "href",
        ):
            val = raw.get(key)
            if isinstance(val, str):
                return val
    return ""

def call_openai_json(prompt: str, max_tokens: int = 800):
    """
    Helper to call the GPT-5 nano (mlapi) chat completion endpoint and parse JSON from content.
    Assumes openai_client is configured as an OpenAI(base_url=..., api_key=...).
    """
    if openai_client is None:
        raise RuntimeError("SENTIMENT_API_KEY not configured")

    # NOTE:
    # - 예전에 max_completion_tokens 를 강제로 넣었을 때, mlapi 가 content 를 빈 문자열로
    #   돌려주는 문제가 있어서 여기서는 토큰 제한을 명시적으로 주지 않는다.
    # - 모델 기본값에 맡기고, 너무 길게 나오면 프롬프트 쪽에서 길이를 제한하는 방식으로 제어한다.
    resp = openai_client.chat.completions.create(
        model="openai/gpt-5-nano",
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
    )

    content = (resp.choices[0].message.content or "").strip()
    if not content:
        raise RuntimeError("Empty GPT response content.")

    import json as _json

    try:
        data = _json.loads(content)
    except Exception as e:
        raise RuntimeError(f"Failed to parse JSON from GPT content: {e}")

    return data


@app.route("/api/news-sentiment", methods=["POST"])
def news_sentiment():
    """
    프론트에서 뉴스 제목/요약을 보내면 GPT-5 nano로 감성분석 수행.
    body: { "title": str, "summary": str, "symbols": [str] }
    응답: { "sentiment": "positive"|"negative"|"neutral" }
    """
    if openai_client is None:
        return jsonify({"error": "SENTIMENT_API_KEY not configured", "sentiment": "neutral"}), 500

    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    summary = (data.get("summary") or "").strip()
    symbols = data.get("symbols") or []

    if not title and not summary:
        return jsonify({"error": "empty_text", "sentiment": "neutral"}), 400

    try:
        user_text = f"Headline: {title[:200]}\n\nSummary: {summary[:600]}\nSymbols: {', '.join(symbols) if isinstance(symbols, list) else symbols}"

        resp = openai_client.chat.completions.create(
            model="openai/gpt-5-nano",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Korean/English financial news sentiment classifier.\n"
                        "Read the following news headline and summary and reply with EXACTLY ONE WORD in English:\n"
                        "POSITIVE, NEGATIVE, or NEUTRAL.\n"
                        "No explanation. No extra text."
                    ),
                },
                {"role": "user", "content": user_text},
            ],
            temperature=1,
        )

        raw = (resp.choices[0].message.content or "").strip().upper()
        if raw not in {"POSITIVE", "NEGATIVE", "NEUTRAL"}:
            raw = "NEUTRAL"

        return jsonify({"sentiment": raw.lower()})
    except Exception as e:
        print("[/api/news-sentiment] error:", e)
        return jsonify({"error": str(e), "sentiment": "neutral"}), 500


@app.route("/api/dashboard-learning", methods=["GET"])
def dashboard_learning():
    """
    Generate 5-minute learning cards for the dashboard using GPT-5 nano.
    Response: { "cards": [ { "title", "duration", "category", "content" }, ... ] }
    """
    if openai_client is None:
        return jsonify({"error": "SENTIMENT_API_KEY not configured", "cards": []}), 500

    # Optional: allow client to request count and seed (기본 3개)
    try:
        count = int(request.args.get("count", "3"))
    except ValueError:
        count = 3
    count = max(1, min(12, count))

    try:
        seed = int(request.args.get("seed", "0"))
    except ValueError:
        seed = 0

    prompt = f"""
You are a financial educator for beginner retail investors.
Create {count} short "5-minute learning" cards about basic investing concepts.

Requirements:
- Mix global topics and market context (for example: US tech, index ETFs, diversification, risk management).
- Use clear, simple English. Do not include any Korean language.
- Use the numeric session seed {seed} to make results vary between calls.
- Return ONLY valid JSON that can be parsed by JSON.parse, with this exact shape:
[
  {{"title":"string","duration":"string like '3 min'","category":"string tag like 'Basic Term' | 'Strategy' | 'Market Concepts'","content":"markdown string, 3-5 short paragraphs, under 220 words total"}},
  ...
]
- Do not wrap the JSON in backticks.
- Do not add any text before or after the JSON.
""".strip()

    try:
        raw = call_openai_json(prompt, max_tokens=900)
        if not isinstance(raw, list) or not raw:
            raise RuntimeError("Model returned non-list or empty result.")

        cards = []
        for idx, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            content = str(item.get("content", "")).strip()
            duration = str(item.get("duration", "5 min")).strip()
            category = str(item.get("category", "Learning")).strip()
            if not title or not content:
                continue
            cards.append(
                {
                    "id": idx + 1,
                    "title": title,
                    "duration": duration,
                    "category": category,
                    "content": content,
                }
            )

        if not cards:
            raise RuntimeError("No valid learning cards extracted from GPT output.")

        return jsonify({"cards": cards})
    except Exception as e:
        print("[/api/dashboard-learning] error:", e)
        return jsonify({"error": str(e), "cards": []}), 500


@app.route("/api/dashboard-quizzes", methods=["GET"])
def dashboard_quizzes():
    """
    Generate multiple-choice quiz questions for the dashboard using GPT-5 nano.
    Response: { "quizzes": [ { "question", "options", "correctIndex", "explanation" }, ... ] }
    """
    if openai_client is None:
        return jsonify({"error": "SENTIMENT_API_KEY not configured", "quizzes": []}), 500

    try:
        count = int(request.args.get("count", "3"))
    except ValueError:
        count = 3
    count = max(1, min(20, count))

    try:
        seed = int(request.args.get("seed", "0"))
    except ValueError:
        seed = 0

    prompt = f"""
You are creating multiple-choice quizzes for beginner retail investors.
Generate {count} short questions about personal investing, risk management, stock markets (including Korean stocks like KOSPI/KOSDAQ) and basic products (ETFs, bonds, etc.).

Return ONLY valid JSON that can be parsed by JSON.parse, with this exact structure:
[
  {{"question":"string","options":["option A","option B","option C","option D"],"correctIndex":0,"explanation":"short explanation (2-3 sentences, under 80 words)"}},
  ...
]

Rules:
- Exactly 4 options per question.
- correctIndex is 0-based (0, 1, 2 or 3).
- Do NOT include the correct answer text anywhere except via correctIndex and explanation.
- No extra keys, no comments, no trailing commas, and nothing outside the JSON.
- Use the numeric session seed {seed} to make question sets differ between calls.
""".strip()

    try:
        raw = call_openai_json(prompt, max_tokens=900)
        if not isinstance(raw, list) or not raw:
            raise RuntimeError("Model returned non-list or empty result.")

        quizzes = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            question = str(item.get("question", "")).strip()
            options = item.get("options") or []
            if not question or not isinstance(options, list) or len(options) != 4:
                continue
            options_clean = [str(o or "").strip() for o in options]
            if any(not o for o in options_clean):
                continue
            correct_index = item.get("correctIndex")
            if not isinstance(correct_index, int) or not (0 <= correct_index < 4):
                continue
            explanation = str(item.get("explanation", "")).strip()
            if not explanation:
                continue
            quizzes.append(
                {
                    "question": question,
                    "options": options_clean,
                    "correctIndex": correct_index,
                    "explanation": explanation,
                }
            )

        if not quizzes:
            raise RuntimeError("No valid quizzes extracted from GPT output.")

        return jsonify({"quizzes": quizzes})
    except Exception as e:
        print("[/api/dashboard-quizzes] error:", e)
        return jsonify({"error": str(e), "quizzes": []}), 500

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
