# test_yf.py
"""
yfinance 뉴스 구조를 확인하기 위한 디버그 스크립트

실행 예:
    python test_yf.py
"""

from __future__ import annotations

from typing import Any, Dict, List, Union
from datetime import datetime, timezone

import yfinance as yf


def format_ts(ts: Union[int, float, str, None]) -> str:
    """providerPublishTime 등을 보기 좋게 문자열로 변환."""
    if ts is None:
        return "N/A"

    # epoch seconds (int/float) 인 경우
    if isinstance(ts, (int, float)):
        try:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.isoformat()
        except Exception:
            return f"(invalid-epoch: {ts})"

    # 문자열이면 그냥 그대로
    return str(ts)


def inspect_news(symbol: str, limit: int = 10) -> None:
    print("=" * 80)
    print(f"### Symbol: {symbol}")
    print("=" * 80)

    try:
        t = yf.Ticker(symbol)
        raw_list: List[Dict[str, Any]] = t.news or []
    except Exception as e:
        print(f"[ERROR] yfinance.ticker.news 호출 중 에러 ({symbol}): {e}")
        return

    print(f"[INFO] yfinance.ticker.news length = {len(raw_list)}")

    base_symbol = symbol.split(".")[0].upper()

    for idx, item in enumerate(raw_list[:limit], start=1):
        if not isinstance(item, dict):
            print(f"\n[{idx}] item is not dict: {repr(item)}")
            continue

        # raw 그대로 먼저 보여주기
        print(f"\n[{idx}] RAW item dict keys = {list(item.keys())}")
        # 필요하면 아래 주석 풀고 전체 dict 그대로 보고 싶을 때 사용
        # print(f"    RAW = {item!r}")

        title = (item.get("title") or "").strip()
        publisher = (item.get("publisher") or item.get("source") or "").strip()
        link = (item.get("link") or item.get("url") or "").strip()
        summary = (item.get("summary") or "").strip()
        related = item.get("relatedTickers") or item.get("ticker") or []

        # relatedTickers 가 문자열일 수도 있으니 통일해서 리스트화
        if isinstance(related, str):
            related_list = [related]
        elif isinstance(related, list):
            related_list = [str(r) for r in related]
        else:
            related_list = []

        ts_raw = item.get("providerPublishTime")
        ts_str = format_ts(ts_raw)

        # 심볼 매칭 여부 확인
        direct_match = symbol in related_list
        related_base = [r.split(".")[0].upper() for r in related_list]
        base_match = base_symbol in related_base

        # 우리가 서비스에서 포함할지에 대한 간단한 기준 예시
        # - title / link 둘 다 비어 있으면 무조건 제외
        # - relatedTickers 가 있으면, 그 안에 이 심볼(또는 .앞부분)이 포함된 경우에만 포함
        if not title and not link:
            would_include = False
        elif related_list:
            would_include = direct_match or base_match
        else:
            # related 가 전혀 없으면 일단 보류(원하면 True 로 바꿔도 됨)
            would_include = False

        print(f"  title            : {title or '(empty)'}")
        print(f"  publisher        : {publisher or '(empty)'}")
        print(f"  date (UTC)       : {ts_str}")
        print(f"  link             : {link or '(empty)'}")
        print(f"  summary          : {summary[:80]}{'...' if len(summary) > 80 else ''}")
        print(f"  relatedTickers   : {related_list}")
        print(f"  direct_match?    : {direct_match}")
        print(f"  base_match(.앞만): {base_match}")
        print(f"  would-include?   : {would_include}")


def main() -> None:
    # 여기서 보고 싶은 심볼들을 마음대로 넣어서 테스트하면 됨
    symbols = [
        "TSLA",
        "MSFT",
        "AAPL",
        "005930.KS",  # 삼성전자
        "000660.KS",  # 하이닉스
    ]

    for sym in symbols:
        inspect_news(sym, limit=10)


if __name__ == "__main__":
    main()
