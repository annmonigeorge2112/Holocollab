import json
import time
import hashlib
import re
import asyncio
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ValidationError
from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

# Pydantic schema for quiz questions
class QuizQuestion(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=2, max_length=6)
    answer: str
    explanation: Optional[str] = ""

class QuizOutput(BaseModel):
    quiz: List[QuizQuestion]

class RateLimiter:
    """In-memory rate limiter: max 10 requests per minute per user."""
    def __init__(self, max_requests: int = 10, window_seconds: float = 60.0):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.user_timestamps: Dict[str, List[float]] = {}

    def check_and_record(self, user_id: str) -> bool:
        now = time.time()
        timestamps = self.user_timestamps.get(user_id, [])
        # Filter timestamps within window
        valid = [t for t in timestamps if now - t < self.window_seconds]
        if len(valid) >= self.max_requests:
            self.user_timestamps[user_id] = valid
            return False
        valid.append(now)
        self.user_timestamps[user_id] = valid
        return True

class ResponseCache:
    """In-memory cache with 10-minute TTL keyed by hash of (endpoint, normalized input)."""
    def __init__(self, ttl_seconds: float = 600.0):
        self.ttl_seconds = ttl_seconds
        self.cache: Dict[str, tuple[float, Any]] = {}

    def _hash_key(self, endpoint: str, payload_str: str) -> str:
        norm = re.sub(r"\s+", " ", payload_str.strip().lower())
        raw = f"{endpoint}:{norm}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, endpoint: str, payload_str: str) -> Optional[Any]:
        key = self._hash_key(endpoint, payload_str)
        now = time.time()
        if key in self.cache:
            ts, val = self.cache[key]
            if now - ts <= self.ttl_seconds:
                return val
            del self.cache[key]
        return None

    def set(self, endpoint: str, payload_str: str, value: Any) -> None:
        key = self._hash_key(endpoint, payload_str)
        self.cache[key] = (time.time(), value)

class AIService:
    def __init__(self):
        self.model = getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash")
        self.client: Optional[genai.Client] = None
        self.rate_limiter = RateLimiter(max_requests=10, window_seconds=60.0)
        self.cache = ResponseCache(ttl_seconds=600.0)
        self.max_prompt_length = 3000

    def get_client(self) -> genai.Client:
        api_key = (getattr(settings, "GEMINI_API_KEY", "") or "").strip()
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in your environment.")
        if not self.client or getattr(self, "_current_key", None) != api_key:
            self.client = genai.Client(api_key=api_key)
            self._current_key = api_key
        return self.client

    async def _call_gemini_with_retry(
        self,
        prompt: str,
        config: Optional[types.GenerateContentConfig] = None,
        max_retries: int = 1,
    ) -> str:
        """Call Gemini model with exponential backoff on 429/503 rate limits or service issues."""
        client = self.get_client()
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                # Wrap synchronous client call in asyncio.to_thread
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=self.model,
                    contents=prompt,
                    config=config,
                )
                return response.text or ""
            except Exception as e:
                err_str = str(e).lower()
                last_error = e
                is_transient = "429" in err_str or "503" in err_str or "quota" in err_str or "resource_exhausted" in err_str
                if attempt < max_retries and is_transient:
                    backoff = (2 ** attempt) * 1.0
                    logger.warning(f"Gemini API rate-limit/transient error ({e}). Retrying in {backoff}s...")
                    await asyncio.sleep(backoff)
                else:
                    break
        raise last_error

    async def generate_content(self, prompt: str, history: Optional[List[Dict[str, str]]] = None) -> str:
        capped_prompt = prompt[:self.max_prompt_length]
        if history:
            history_lines = [f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history]
            combined = "\n".join(history_lines) + f"\nUser: {capped_prompt}"
        else:
            combined = capped_prompt
        return await self._call_gemini_with_retry(combined)

    async def chat(self, session_context: str, message: str) -> str:
        capped_message = message[:self.max_prompt_length]
        system_instruction = (
            "You are HoloCollab EduMeet's educational AR assistant.\n"
            "Help students and educators understand the 3D model and concepts.\n"
            "If referring specifically to a 3D component that should be highlighted, you may include "
            "a tag in the format: [[HIGHLIGHT: part_name]]. You may use this tag ONLY with a name "
            "from the provided part list in the context. Do not invent part names."
        )
        full_prompt = (
            f"{system_instruction}\n\n"
            f"--- SESSION CONTEXT ---\n{session_context}\n\n"
            f"--- USER QUESTION ---\n{capped_message}"
        )
        return await self._call_gemini_with_retry(full_prompt)

    async def class_summary(self, transcript: str, topic: str) -> str:
        cached = self.cache.get("summary", f"{topic}:{transcript}")
        if cached:
            return cached

        prompt = (
            f"Generate a concise, insightful educational summary for a collaborative session on topic '{topic}'.\n"
            f"Transcript and session notes:\n{transcript[:self.max_prompt_length]}"
        )
        summary = await self._call_gemini_with_retry(prompt)
        self.cache.set("summary", f"{topic}:{transcript}", summary)
        return summary

    async def generate_quiz(self, topic: str, count: int = 3) -> List[Dict[str, Any]]:
        cache_key = f"{topic}:{count}"
        cached = self.cache.get("quiz", cache_key)
        if cached:
            return cached

        prompt = (
            f"Generate an educational quiz on the topic '{topic}' with exactly {count} multiple choice questions.\n"
            "Return valid JSON matching this schema:\n"
            "{\n"
            '  "quiz": [\n'
            "    {\n"
            '      "question": "string",\n'
            '      "options": ["string", "string", "string", "string"],\n'
            '      "answer": "string",\n'
            '      "explanation": "string"\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "The answer MUST match one of the items in options."
        )

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=QuizOutput,
        )

        # Retry once if JSON validation fails
        last_error = None
        for attempt in range(2):
            try:
                raw_text = await self._call_gemini_with_retry(prompt, config=config)
                clean_json = raw_text.strip()
                # Parse and validate with Pydantic
                data = json.loads(clean_json)
                parsed = QuizOutput.model_validate(data)
                result = [q.model_dump() for q in parsed.quiz]
                self.cache.set("quiz", cache_key, result)
                return result
            except (json.JSONDecodeError, ValidationError) as e:
                last_error = e
                logger.warning(f"Invalid quiz JSON received on attempt {attempt + 1}: {e}")
                prompt += "\nNote: Your previous response was not valid JSON. Ensure strict adherence to the schema."

        raise ValueError(f"Failed to generate valid quiz JSON after retry: {last_error}")

    async def key_concepts(self, transcript: str) -> List[str]:
        prompt = (
            "Extract 3 to 7 key educational concepts covered in the following class transcript:\n"
            f"{transcript[:self.max_prompt_length]}\n"
            "Return them as a bulleted list."
        )
        text = await self._call_gemini_with_retry(prompt)
        concepts = [line.strip("- *").strip() for line in text.splitlines() if line.strip("- *").strip()]
        return concepts

ai_service = AIService()
