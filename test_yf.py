# test_yf.py
import yfinance as yf
from datetime import datetime

symbol = "TSLA"

ticker = yf.Ticker(symbol)
news = ticker.news or []

print(f"{symbol} 뉴스 개수:", len(news))

for i, n in enumerate(news[:5], start=1):
    content = n.get("content", {})

    title = content.get("title")
    summary = content.get("summary") or content.get("description")
    pub_date = content.get("pubDate") or content.get("displayTime")
    provider = (content.get("provider") or {}).get("displayName")
    url = (content.get("canonicalUrl") or {}).get("url")

    # pubDate → 보기 좋게
    if pub_date:
        try:
            dt = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
            date_str = dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            date_str = pub_date
    else:
        date_str = "N/A"

    print(f"\n---- 뉴스 {i} ----")
    print("제목:", title)
    print("언론사:", provider)
    print("시간:", date_str)
    print("요약:", summary)
    print("URL:", url)
