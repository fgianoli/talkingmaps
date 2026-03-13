"""
TalkingMaps – AI Assistant Router
Supports OpenAI, Anthropic (Claude), Google (Gemini) for text generation.
Supports DALL-E for image generation.
API keys are stored encrypted per-user.
"""
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_system_db
from core.security import get_current_user
from core.encryption import encrypt_api_key, decrypt_api_key

router = APIRouter()

SUPPORTED_PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
        "image_models": ["dall-e-3", "dall-e-2"],
    },
    "anthropic": {
        "name": "Anthropic (Claude)",
        "models": ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
        "image_models": [],
    },
    "google": {
        "name": "Google (Gemini)",
        "models": ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro"],
        "image_models": ["imagen-3.0-generate-002"],
    },
}


class AISettingsUpdate(BaseModel):
    openai_key: str = ""
    anthropic_key: str = ""
    google_key: str = ""
    preferred_provider: str = "openai"
    preferred_model: str = "gpt-4o"


class GenerateRequest(BaseModel):
    prompt: str
    context: str = ""  # Additional context (slide content, story description, etc.)
    task: str = "narrative"  # narrative, title, description, translate, summarize, chart
    target_language: str = ""  # For translation
    provider: str = ""  # Override preferred provider
    model: str = ""  # Override preferred model


class ImageRequest(BaseModel):
    prompt: str
    size: str = "1024x1024"  # 1024x1024, 1792x1024, 1024x1792
    style: str = "natural"  # natural, vivid
    provider: str = ""  # openai (DALL-E) or google (Imagen/Gemini)


# ── AI Settings (per-user encrypted keys) ──────

@router.get("/settings")
async def get_ai_settings(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Get user's AI settings (keys are masked)."""
    result = await db.execute(
        text("SELECT ai_settings FROM users WHERE id = :id"), {"id": user["id"]}
    )
    row = result.fetchone()
    settings_data = (row[0] if row and row[0] else {}) if row else {}

    # Mask keys for frontend display (show only last 4 chars)
    masked = {}
    for key in ["openai_key", "anthropic_key", "google_key"]:
        encrypted = settings_data.get(key, "")
        if encrypted:
            decrypted = decrypt_api_key(encrypted)
            masked[key] = "••••" + decrypted[-4:] if len(decrypted) > 4 else "••••"
            masked[key + "_set"] = True
        else:
            masked[key] = ""
            masked[key + "_set"] = False

    masked["preferred_provider"] = settings_data.get("preferred_provider", "openai")
    masked["preferred_model"] = settings_data.get("preferred_model", "gpt-4o")
    return masked


@router.put("/settings")
async def update_ai_settings(
    body: AISettingsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Update user's AI settings. API keys are encrypted before storage."""
    # Get current settings to preserve keys that aren't being updated
    result = await db.execute(
        text("SELECT ai_settings FROM users WHERE id = :id"), {"id": user["id"]}
    )
    row = result.fetchone()
    current = (row[0] if row and row[0] else {}) if row else {}

    new_settings = {
        "preferred_provider": body.preferred_provider,
        "preferred_model": body.preferred_model,
    }

    # Only update keys that are non-empty (allow clearing with special value)
    for key_name, value in [
        ("openai_key", body.openai_key),
        ("anthropic_key", body.anthropic_key),
        ("google_key", body.google_key),
    ]:
        if value == "__CLEAR__":
            new_settings[key_name] = ""
        elif value and not value.startswith("••••"):
            # New key provided, encrypt it
            new_settings[key_name] = encrypt_api_key(value)
        else:
            # Keep existing encrypted key
            new_settings[key_name] = current.get(key_name, "")

    await db.execute(
        text("UPDATE users SET ai_settings = CAST(:settings AS jsonb), updated_at = NOW() WHERE id = :id"),
        {"id": user["id"], "settings": json.dumps(new_settings)},
    )
    await db.commit()
    return {"detail": "Impostazioni AI aggiornate"}


@router.get("/providers")
async def list_providers():
    """List available AI providers and models."""
    return SUPPORTED_PROVIDERS


# ── Text Generation ──────

@router.post("/generate")
async def generate_text(
    body: GenerateRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Generate text using the user's configured AI provider."""
    result = await db.execute(
        text("SELECT ai_settings FROM users WHERE id = :id"), {"id": user["id"]}
    )
    row = result.fetchone()
    ai_settings = (row[0] if row and row[0] else {}) if row else {}

    provider = body.provider or ai_settings.get("preferred_provider", "openai")
    model = body.model or ai_settings.get("preferred_model", "gpt-4o")

    # Get the decrypted API key
    key_map = {"openai": "openai_key", "anthropic": "anthropic_key", "google": "google_key"}
    encrypted_key = ai_settings.get(key_map.get(provider, ""), "")
    if not encrypted_key:
        raise HTTPException(400, f"Nessuna chiave API configurata per {provider}. Vai nelle impostazioni AI del tuo profilo.")

    api_key = decrypt_api_key(encrypted_key)
    if not api_key:
        raise HTTPException(400, "Chiave API non valida o corrotta. Reinseriscila nelle impostazioni.")

    # Build system prompt based on task
    system_prompts = {
        "narrative": "Sei un assistente per la creazione di storymaps. Genera testo narrativo coinvolgente per una slide di storymap. Il testo deve essere adatto a un contesto cartografico e geospaziale. Rispondi nella stessa lingua del contesto fornito.",
        "title": "Genera un titolo breve e accattivante (max 10 parole) per una slide di storymap. Rispondi solo con il titolo, senza virgolette.",
        "description": "Genera una breve descrizione (1-2 frasi) per un elemento sulla mappa (marker, area, linea). Rispondi nella stessa lingua del contesto.",
        "translate": f"Traduci il seguente testo in {body.target_language or 'inglese'}. Mantieni la formattazione HTML se presente. Rispondi solo con la traduzione.",
        "summarize": "Riassumi il seguente testo in 2-3 frasi concise. Rispondi nella stessa lingua del testo.",
        "chart": "Genera una configurazione JSON per un grafico Chart.js basata sulla descrizione fornita. Rispondi SOLO con il JSON valido, senza markdown o spiegazioni. Formato: {\"type\":\"bar\",\"labels\":[...],\"data\":[...],\"options\":{}}",
        "improve": "Migliora il seguente testo rendendolo più coinvolgente e professionale, mantenendo lo stesso significato. Rispondi nella stessa lingua del testo.",
    }

    system_prompt = system_prompts.get(body.task, system_prompts["narrative"])
    user_prompt = body.prompt
    if body.context:
        user_prompt = f"Contesto: {body.context}\n\n{body.prompt}"

    try:
        if provider == "openai":
            text_result = await _call_openai(api_key, model, system_prompt, user_prompt)
        elif provider == "anthropic":
            text_result = await _call_anthropic(api_key, model, system_prompt, user_prompt)
        elif provider == "google":
            text_result = await _call_google(api_key, model, system_prompt, user_prompt)
        else:
            raise HTTPException(400, f"Provider non supportato: {provider}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[AI] Text generation error: {e}")
        raise HTTPException(500, "Errore nella generazione del testo. Riprova.")

    return {"text": text_result, "provider": provider, "model": model}


# ── Image Generation ──────

@router.post("/generate-image")
async def generate_image(
    body: ImageRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_system_db),
):
    """Generate an image using DALL-E (OpenAI) or Imagen/Gemini (Google)."""
    result = await db.execute(
        text("SELECT ai_settings FROM users WHERE id = :id"), {"id": user["id"]}
    )
    row = result.fetchone()
    ai_settings = (row[0] if row and row[0] else {}) if row else {}

    # Determine provider: explicit choice, or fallback to whoever has a key
    provider = body.provider
    if not provider:
        if ai_settings.get("openai_key"):
            provider = "openai"
        elif ai_settings.get("google_key"):
            provider = "google"
        else:
            raise HTTPException(400, "Per generare immagini serve una chiave OpenAI (DALL-E) o Google (Imagen). Configurala nelle impostazioni AI.")

    if provider == "google":
        encrypted_key = ai_settings.get("google_key", "")
        if not encrypted_key:
            raise HTTPException(400, "Nessuna chiave Google configurata. Vai nelle impostazioni AI.")
        api_key = decrypt_api_key(encrypted_key)
        if not api_key:
            raise HTTPException(400, "Chiave API Google non valida.")
        try:
            img_result = await _call_google_image(api_key, body.prompt, body.size)
            return img_result
        except HTTPException:
            raise
        except Exception as e:
            print(f"[AI] Google image error: {e}")
            raise HTTPException(500, "Errore nella generazione dell'immagine. Riprova.")
    else:
        # OpenAI DALL-E
        encrypted_key = ai_settings.get("openai_key", "")
        if not encrypted_key:
            raise HTTPException(400, "Nessuna chiave OpenAI configurata. Vai nelle impostazioni AI.")
        api_key = decrypt_api_key(encrypted_key)
        if not api_key:
            raise HTTPException(400, "Chiave API OpenAI non valida.")
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/images/generations",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": "dall-e-3",
                        "prompt": body.prompt,
                        "n": 1,
                        "size": body.size,
                        "style": body.style,
                        "response_format": "url",
                    },
                )
                if resp.status_code != 200:
                    error = resp.json().get("error", {}).get("message", resp.text[:200])
                    raise HTTPException(resp.status_code, f"DALL-E error: {error}")
                data = resp.json()
                return {"url": data["data"][0]["url"], "revised_prompt": data["data"][0].get("revised_prompt", ""), "provider": "openai"}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[AI] OpenAI image error: {e}")
            raise HTTPException(500, "Errore nella generazione dell'immagine. Riprova.")


# ── Provider API calls ──────

async def _call_openai(api_key: str, model: str, system_prompt: str, user_prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": 1000,
                "temperature": 0.7,
            },
        )
        if resp.status_code != 200:
            error = resp.json().get("error", {}).get("message", resp.text[:200])
            raise HTTPException(resp.status_code, f"OpenAI: {error}")
        return resp.json()["choices"][0]["message"]["content"]


async def _call_anthropic(api_key: str, model: str, system_prompt: str, user_prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": model,
                "max_tokens": 1000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )
        if resp.status_code != 200:
            error = resp.json().get("error", {}).get("message", resp.text[:200])
            raise HTTPException(resp.status_code, f"Anthropic: {error}")
        return resp.json()["content"][0]["text"]


async def _call_google(api_key: str, model: str, system_prompt: str, user_prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": user_prompt}]}],
                "generationConfig": {"maxOutputTokens": 1000, "temperature": 0.7},
            },
        )
        if resp.status_code != 200:
            error = resp.json().get("error", {}).get("message", resp.text[:200])
            raise HTTPException(resp.status_code, f"Google AI: {error}")
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


async def _call_google_image(api_key: str, prompt: str, size: str) -> dict:
    """Generate image using Gemini 2.0 Flash native image generation."""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": f"Generate an image: {prompt}"}]}],
                "generationConfig": {
                    "responseModalities": ["IMAGE", "TEXT"],
                },
            },
        )
        if resp.status_code != 200:
            error = resp.json().get("error", {}).get("message", resp.text[:200])
            raise HTTPException(resp.status_code, f"Google Imagen: {error}")

        data = resp.json()
        # Look for image data in response parts
        for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
            if "inlineData" in part:
                mime = part["inlineData"].get("mimeType", "image/png")
                b64 = part["inlineData"]["data"]
                return {
                    "base64": f"data:{mime};base64,{b64}",
                    "provider": "google",
                    "revised_prompt": "",
                }
        raise HTTPException(500, "Google non ha generato un'immagine. Prova con un prompt diverso.")
