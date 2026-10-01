import os
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from google import genai

load_dotenv()

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
SYSTEM_PROMPT = os.getenv(
    "GEMINI_SYSTEM_PROMPT",
    "You are a helpful, natural conversational voice assistant. Answer the user's request directly, clearly, and conversationally. Keep responses reasonably concise unless the user asks for detail."
)


def get_client():
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing. Add it to your .env file.")
    return genai.Client(api_key=api_key)


def normalize_messages(messages):
    """Convert browser chat history into Gemini contents."""
    contents = []
    if not isinstance(messages, list):
        return contents

    # Keep the request reasonably small while preserving recent context.
    for message in messages[-30:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        text = message.get("content")
        if role not in {"user", "model"} or not isinstance(text, str):
            continue
        text = text.strip()
        if not text:
            continue
        contents.append({"role": role, "parts": [{"text": text}]})
    return contents


@app.get("/")
def index():
    return render_template("index.html", model=MODEL)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "model": MODEL})


@app.post("/api/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    user_message = str(payload.get("message", "")).strip()
    history = payload.get("history", [])

    if not user_message:
        return jsonify({"ok": False, "error": "Message is empty."}), 400

    try:
        client = get_client()
        contents = normalize_messages(history)
        contents.append({"role": "user", "parts": [{"text": user_message}]})

        response = client.models.generate_content(
            model=MODEL,
            contents=contents,
            config={"system_instruction": SYSTEM_PROMPT},
        )

        answer = (getattr(response, "text", "") or "").strip()
        if not answer:
            return jsonify({"ok": False, "error": "Gemini returned an empty response."}), 502

        return jsonify({
            "ok": True,
            "reply": answer,
            "model": MODEL,
        })
    except Exception as exc:
        # Do not expose secrets or a raw traceback to the browser.
        print(f"Gemini error: {exc}")
        return jsonify({
            "ok": False,
            "error": "Gemini could not answer right now. Check your API key, model name, and terminal logs."
        }), 500


if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)
