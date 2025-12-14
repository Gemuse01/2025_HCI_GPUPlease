# test_yf_debug.py
import yfinance as yf

symbol = "TSLA"
ticker = yf.Ticker(symbol)
news = ticker.news or []

print(f"{symbol} 뉴스 개수:", len(news))

if news:
    first = news[0]
    print("=== 첫 번째 뉴스 raw ===")
    print(first)
    print("=== 키 목록 ===")
    print(first.keys())

    # 여러 개 간단히 확인해보기
    for i, n in enumerate(news[:5], start=1):
        print(f"\n---- 뉴스 {i} ----")
        print("dict:", n)
