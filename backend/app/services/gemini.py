import logging
from google import genai
from app.config import settings

logger = logging.getLogger(__name__)

async def ask_gemini(prompt: str, context: str | None = None) -> str:
    if not settings.GEMINI_API_KEY:
        return "Gemini API key is not configured. Please set GEMINI_API_KEY in your environment."
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        full_prompt = (
            f"Context: {context}\n\nQuestion: {prompt}"
            if context
            else f"Educational AR assistant query: {prompt}"
        )
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt,
        )
        return response.text or "No response received from Gemini."
    except Exception as e:
        logger.error(f"Gemini generation error: {e}")
        return f"Error querying Gemini assistant: {str(e)}"
