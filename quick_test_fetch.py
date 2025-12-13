# quick_test_fetch.py
from backend.news_service import fetch_live_news


def main():
    symbol = "TSLA"
    items = fetch_live_news(symbol)

    print(f"{symbol} 변환된 뉴스 개수:", len(items))

    for i, item in enumerate(items[:5], start=1):
        print(f"\n--- 뉴스 {i} ---")
        print("id         :", item.get("id"))
        print("source     :", item.get("source"))
        print("date       :", item.get("date"))
        print("title      :", item.get("title"))
        print("summary    :", (item.get("summary") or "")[:120], "...")
        print("impact     :", item.get("impact"))
        print("symbols    :", item.get("related_symbols"))
        # url도 news_service에 넣어뒀다면:
        if "url" in item:
            print("url        :", item.get("url"))


if __name__ == "__main__":
    main()
