

import os
from flask import Blueprint, request, jsonify, current_app

# --- Persona descriptions (single source of truth for backend) ---
PERSONA_DESCRIPTIONS = {
    "HELPER_SEEKER": {
        "label": "Help Seeker",
        "description": "Seeks reassurance and expert validation before acting."
    },
    "STRUGGLER": {
        "label": "Solo Struggler",
        "description": "Tries to handle everything alone and carries full responsibility."
    },
    "OPTIMIST": {
        "label": "Optimist",
        "description": "Acts quickly, focusing on opportunity rather than risk."
    },
    "APATHETIC": {
        "label": "Motivation Seeker",
        "description": "Low engagement and low follow-through."
    },
}

# Blueprint definition
persona_bp = Blueprint("persona_engine", __name__)


def _normalize_persona_code(raw):
    """
    Normalize GPT output to one of the persona codes.
    """
    if not raw:
        return None
    raw = str(raw).strip().upper()
    persona_keys = set(PERSONA_DESCRIPTIONS.keys())
    for k in persona_keys:
        if k in raw:
            return k
    # fallback: first word
    first_word = raw.split()[0]
    if first_word in persona_keys:
        return first_word
    return None

@persona_bp.route("/api/persona/classify", methods=["POST"])
def classify_persona():
    """
    POST endpoint to classify closest persona based on QA pairs.
    Expects JSON:
      {
        "qa_pairs": [ { "question": str, "answer": str }, ... ],  # exactly 3
        "current_persona": str
      }
    Responds: { "persona", "label", "changed" }
    """
    openai_client = current_app.config.get("OPENAI_CLIENT")
    if openai_client is None:
        print("[ERROR] /api/persona/classify: OpenAI client is None")
        print("[DEBUG] Check if SENTIMENT_API_KEY and SENTIMENT_API_URL are set in environment")
        return jsonify({
            "error": "OpenAI client not configured. Please set SENTIMENT_API_KEY and SENTIMENT_API_URL environment variables.",
            "details": "The server could not initialize the OpenAI client. Check server logs for more information."
        }), 500
    try:
        data = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400
    qa_pairs = data.get("qa_pairs")
    current_persona = data.get("current_persona")
    # Validate input
    if not isinstance(qa_pairs, list) or len(qa_pairs) != 3:
        return jsonify({"error": "qa_pairs must be a list of exactly 3 objects"}), 400
    for idx, qa in enumerate(qa_pairs):
        if not isinstance(qa, dict) or "question" not in qa or "answer" not in qa:
            return jsonify({"error": f"qa_pairs[{idx}] must have 'question' and 'answer'"}), 400
        if not isinstance(qa["question"], str) or not isinstance(qa["answer"], str):
            return jsonify({"error": f"qa_pairs[{idx}] values must be strings"}), 400
    if not isinstance(current_persona, str) or current_persona not in PERSONA_DESCRIPTIONS:
        return jsonify({"error": "current_persona must be one of: " + ", ".join(PERSONA_DESCRIPTIONS.keys())}), 400

    # Compose prompt
    persona_descs = []
    for k, v in PERSONA_DESCRIPTIONS.items():
        persona_descs.append(f"{k}: {v['label']} - {v['description']}")
    persona_block = "\n".join(persona_descs)
    answers_block = "\n".join(
        [f"{i+1}. Q: {qa['question']}\n   A: {qa['answer']}" for i, qa in enumerate(qa_pairs)]
    )
    prompt = (
        "Below are 3 question-answer pairs from a user about their recent crisis or financial situation.\n"
        "Read each answer and, based on the following 4 persona descriptions, select the single closest persona.\n\n"
        "[Persona Descriptions]\n"
        f"{persona_block}\n\n"
        "[User QA Pairs]\n"
        f"{answers_block}\n\n"
        "Reply with ONLY the English code name of the closest persona (one of: HELPER_SEEKER, STRUGGLER, OPTIMIST, APATHETIC). No explanation."
    )
    try:
        print(f"[DEBUG] /api/persona/classify: Calling OpenAI with {len(qa_pairs)} QA pairs")
        resp = openai_client.chat.completions.create(
            model="openai/gpt-5",
            messages=[
                {"role": "system", "content": "You are an expert persona classifier for financial users."},
                {"role": "user", "content": prompt},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip().upper()
        print(f"[DEBUG] /api/persona/classify: OpenAI raw response: {raw}")
        selected = _normalize_persona_code(raw)
        if not selected:
            print(f"[WARNING] /api/persona/classify: Could not normalize persona code from: {raw}")
            return jsonify({"error": "Could not classify persona", "raw": raw}), 200
        changed = (selected != current_persona)
        print(f"[INFO] /api/persona/classify: Selected persona: {selected}, changed: {changed}")
        return jsonify({
            "persona": selected,
            "label": PERSONA_DESCRIPTIONS[selected]["label"],
            "changed": changed
        })
    except Exception as e:
        print(f"[ERROR] /api/persona/classify: Exception occurred: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "type": type(e).__name__}), 500