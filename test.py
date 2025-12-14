from openai import OpenAI

client = OpenAI(
    base_url="https://mlapi.run/daef5150-72ef-48ff-8861-df80052ea7ac/v1",
    api_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjU2MDQ2MzIsIm5iZiI6MTc2NTYwNDYzMiwia2V5X2lkIjoiZWNjODM5MzYtYzQ5Ni00MGYyLTk2YjktNzkzOTJkOTE0MjcwIn0._bisu91OPtmw36Og1tc21GoyQm0oJ1vqeTtDqPVJNHs"
)

res = client.chat.completions.create(
    model="openai/gpt-5-nano",
    messages=[
        {
            "role": "system",
            "content": (
                "You are a Korean sentiment classifier.\n"
                "Read the user's sentence and reply with EXACTLY ONE WORD in English:\n"
                "POSITIVE, NEGATIVE, or NEUTRAL.\n"
                "No explanation. No extra text."
            ),
        },
        {
            "role": "user",
            "content": "나 속상해."  # 여기에 문장 바꿔가며 테스트
        },
    ],
)
print(res.choices[0].message.content)