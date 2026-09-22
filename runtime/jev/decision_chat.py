"""Answer jev's question set with an ordinary chat model, instead of TypeSafe's own endpoint.

jev's decision model is a specialised service: it takes a page state and a set of
questions, and answers each one with a choice and a probability distribution
(`jev_ultrafast/model.py`). This module answers the *same* questions with a chat model on
an OpenAI-compatible endpoint, so the agent loop, the browser harness and the two gates
can be exercised without that service's key.

It changes the brain, not the agent. Every question, every operation, every target and
every step recorded is what the vendored code builds; what differs is who answers, and
how fast. A run driven this way is not comparable to a TypeSafe run on time, and is
comparable to another run driven this way — which is what it is for.

It is installed by `runner.py` when `JEV_DECISION` is `chat`, and never otherwise: with
the variable unset, the request goes where it always went.

    JEV_DECISION=chat
    JEV_DECISION_BASE_URL=https://opencode.ai/zen/go/v1
    JEV_DECISION_MODEL=deepseek-v4-flash
    JEV_DECISION_API_KEY=...
    JEV_DECISION_SESSION=decks-jev          # optional; some gateways want a session id
"""

import json
import os
import time
import uuid

import httpx

from jev_ultrafast.questions import NEXT_ACTION, TARGET

CLIENT = httpx.Client(timeout=180)

SYSTEM = """You drive a web browser one action at a time, toward a goal.

""" + NEXT_ACTION + """

""" + TARGET + """

You are asked a set of questions about the current page. Each question offers criteria by
id, and you answer each one with the id you choose - and nothing else.

Reply with one JSON object and no other text, where every question appears and every choice
is one of that question's own ids, copied exactly:

{"answers": {"<question>": {"choice": "<id>", "confidence": 0.0}}}

Confidence is how sure you are, from 0 to 1."""


def install():
    """
    Point the model calls the vendored code makes where this machine can reach them.

    Two things, and they are independent. The *decision* call goes to TypeSafe's own endpoint,
    and is answered by a chat model instead — but only when `JEV_DECISION=chat`, because
    otherwise it goes where it always went. The *text helper* call goes to whatever
    `TEXT_MODEL_BASE_URL` names, and needs the header the gateway routes on: without it the
    gateway answers 400 and a run dies on its first keystroke, whatever answers the decisions.
    """
    from jev_ultrafast import model

    chat = os.environ.get("JEV_DECISION") == "chat"
    gateway_urls = any("opencode.ai" in (os.environ.get(name) or "") for name in ("TEXT_MODEL_BASE_URL", "JEV_DECISION_BASE_URL"))
    if not chat and not gateway_urls:
        return

    if chat:
        # The vendored code reads the key before it calls, so a missing one raises there and
        # not in the call that would have ignored it. Nothing sends this value anywhere.
        os.environ.setdefault("TYPESAFE_API_KEY", "chat-decision")

    real = model.post_json

    def post_json(url, key, body):
        if chat and url.startswith("https://api.typesafe.ai/"):
            return answer_with_chat(body)
        if "opencode.ai" in url:
            return gateway(url, key, body)
        return real(url, key, body)

    model.post_json = post_json


# One id per process, because a run is one conversation.
SESSION = f"decks-jev-{uuid.uuid4().hex[:12]}"


def headers(key):
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # What the gateway routes on. Without it: HTTP 400, "Request is missing
        # x-opencode-session".
        "x-opencode-session": os.environ.get("JEV_DECISION_SESSION") or SESSION,
        "User-Agent": "decks-jev/1.0",
    }


def gateway(url, key, body, tries=3):
    """
    One call to the chat gateway, with the retries the vendored `post_json` has.

    The vendored text helper sets a DeepSeek-shaped `reasoning` field, and this gateway
    answers 400 for it: `invalid request body: json: unknown field "reasoning"`. It is a
    request to think less, not part of the question, so it is dropped rather than translated.
    """
    body = {name: value for name, value in body.items() if name not in {"reasoning", "thinking"}}
    for attempt in range(tries):
        response = CLIENT.post(url, json=body, headers=headers(key))
        if response.status_code in {429, 529, 503} and attempt < tries - 1:
            time.sleep(0.5 * 2**attempt)
            continue
        if response.is_error:
            raise RuntimeError(f"The decision model returned HTTP {response.status_code}: {response.text[:200]}")
        return response.json()
    raise RuntimeError("The decision model is unavailable")


def answer_with_chat(body):
    """The TypeSafe answer shape, filled in from one chat completion."""
    questions = body.get("questions", {})
    started = time.perf_counter()
    reply = ask(body)
    answers = shape(get_json(reply), questions)
    return {
        "answers": answers,
        "model": os.environ.get("JEV_DECISION_MODEL", "deepseek-v4-flash"),
        "usage": reply.get("usage", {}),
        "latency_ms": round((time.perf_counter() - started) * 1000),
    }


def ask(body):
    base = os.environ.get("JEV_DECISION_BASE_URL", "https://opencode.ai/zen/go/v1").rstrip("/")
    key = os.environ.get("JEV_DECISION_API_KEY", "")
    if not key:
        raise RuntimeError("JEV_DECISION=chat needs JEV_DECISION_API_KEY; no decision can be made without it.")
    payload = {
        "model": os.environ.get("JEV_DECISION_MODEL", "deepseek-v4-flash"),
        "max_tokens": int(os.environ.get("JEV_DECISION_MAX_TOKENS", "8192")),
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps({"state": body.get("state"), "questions": body.get("questions")})},
        ],
    }
    parsed = gateway(base + "/chat/completions", key, payload)
    text = (parsed.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return {**parsed, "content": text}


def get_json(reply):
    """The model's JSON object, from its content or from the first braces in it."""
    text = reply.get("content", "")
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except ValueError:
                pass
    raise ValueError(f"The decision model did not answer with JSON: {text[:200]!r}")


def shape(answered, questions):
    """
    The chat model's choices, as the probability distribution the vendored code validates.

    A chat model gives one answer, not a distribution, so the confidence it reports is put on
    the choice and what is left is spread evenly over the others. The choice has to stay the
    most probable one — `validate_choice` insists on it — so confidence is floored at a
    little above an even share.
    """
    replies = answered.get("answers") if isinstance(answered, dict) else None
    if not isinstance(replies, dict):
        raise ValueError(f"The decision model's answer had no answers object: {str(answered)[:200]}")
    out = {}
    for name, question in questions.items():
        ids = list(question.get("criteria") or {})
        if not ids:
            continue
        said = replies.get(name)
        said = said if isinstance(said, dict) else {}
        choice = str(said.get("choice", "")).strip()
        if choice not in ids:
            raise ValueError(f"The decision model chose {choice!r} for {name}, which is not one of {ids}")
        confidence = confidence_of(said.get("confidence"), len(ids))
        rest = (1 - confidence) / (len(ids) - 1) if len(ids) > 1 else 0
        probabilities = {one: rest for one in ids}
        probabilities[choice] = confidence
        out[name] = {"choice": choice, "probabilities": probabilities, "confidence": confidence}
    return out


def confidence_of(raw, choices):
    """A share that keeps the chosen id the most probable one, whatever the model claimed."""
    floor = 1 / choices + 0.001
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = 0.8
    if not (0 <= value <= 1):
        value = 0.8
    return min(1.0, max(floor, value))


if __name__ == "__main__":  # a synthetic question, answered by whatever the environment names
    sample = {
        "state": {"page": {"url": "https://example.com", "title": "Example", "text": "A page with a search box."}, "elements": [{"index": "1", "label": "Search", "role": "textbox", "operations": ["TYPE_TEXT"]}], "recent_actions": []},
        "questions": {
            "operation": {"type": "choice", "criteria": {"CLICK": "Click an element.", "TYPE_TEXT": "Enter text in a field.", "DONE": "The goal is satisfied.", "BLOCKED": "Nothing can progress."}, "instructions": {"goal": "Search for the word decks.", "rules": NEXT_ACTION}},
            "type_text_target": {"type": "choice", "criteria": {"1": {"element": "[1] Search"}}, "instructions": {"goal": "Search for the word decks.", "operation": "TYPE_TEXT", "rules": [NEXT_ACTION, TARGET]}},
        },
    }
    started = time.perf_counter()
    out = answer_with_chat(sample)
    print(json.dumps({**out, "wall_ms": round((time.perf_counter() - started) * 1000)}, indent=1)[:1200])
