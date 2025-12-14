# test_yf_raw.py
import json
from datetime import datetime, timezone

import yfinance as yf


def fmt_ts(epoch):
  """epoch → 읽기 편한 ISO 문자열로 변환 (없으면 'N/A')"""
  try:
    if isinstance(epoch, (int, float)):
      return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
  except Exception:
    pass
  return "N/A"


def debug_one(symbol: str):
  print("\n" + "=" * 80)
  print(f"### RAW NEWS for: {symbol}")
  print("=" * 80)

  ticker = yf.Ticker(symbol)
  news = getattr(ticker, "news", None)

  print("[INFO] type(ticker.news):", type(news))
  print("[INFO] ticker.news value:", news)

  if not news:
    print("[INFO] ticker.news 가 비어 있거나 None 입니다.")
    return

  print(f"[INFO] length = {len(news)}")

  # 첫 3개 정도만 구조 확인
  for i, item in enumerate(news[:3], start=1):
    print(f"\n[{i}] ----")
    print("  keys:", sorted(item.keys()))
    print("  title:", item.get("title"))
    print("  publisher:", item.get("publisher"))
    print("  link:", item.get("link"))
    print("  providerPublishTime:", fmt_ts(item.get("providerPublishTime")))
    print("  relatedTickers:", item.get("relatedTickers"))
    print("  ticker:", item.get("ticker"))

    print("\n  ▶ full JSON:")
    print(json.dumps(item, indent=2, ensure_ascii=False))


if __name__ == "__main__":
  # 🔹 여기 한 줄만 바꿔가면서 테스트 하면 됨
  #   예: "TSLA", "MSFT", "AAPL", "META", "005930.KS", "000660.KS" 등
  debug_one("TSLA")
