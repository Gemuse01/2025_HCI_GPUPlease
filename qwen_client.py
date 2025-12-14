# qwen_client.py
import requests

def call_qwen_finsec_model(api_url: str, api_key: str, prompt: str, max_tokens: int = 512):
    base_url = api_url.rstrip("/")
    endpoint = f"{base_url}/generate"
   
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}" 
    }
   
    payload = {
        "prompt": prompt,
        "max_tokens": max_tokens
    }
   
    try:
        print(f"📡 모델 호출 중... ({endpoint})")
        response = requests.post(endpoint, headers=headers, json=payload, timeout=120)
       
        if response.status_code == 200:
            result_text = response.text.strip().strip('"').replace(r'\n', '\n')
            return result_text
        else:
            return f"❌ 에러 발생 (Status {response.status_code}): {response.text}"
           
    except Exception as e:
        return f"❌ 연결 실패: {str(e)}"


def build_security_prompt(history, user_message: str) -> str:
    """
    history: [{ "role": "user" | "model", "content": "..." }, ...]
    """
    system_msg = (
        "당신은 금융 보안 전문가입니다. "
        "금융권 망분리, 규제 완화, 제로트러스트, 내부자 위협, 클라우드 보안 등의 관점에서 "
        "규제·리스크·보안 아키텍처를 중심으로 신중하게 답변하세요.\n\n"
        "항상 영어로 답변하세요."
    )

    conv = ""
    for turn in history:
        role = "사용자" if turn["role"] == "user" else "모델"
        conv += f"{role}: {turn['content']}\n"

    conv += f"사용자: {user_message}\n모델:"
    return system_msg + conv
