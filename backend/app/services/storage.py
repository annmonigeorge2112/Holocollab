import os
import uuid
import httpx
from fastapi import HTTPException, status
from app.config import settings

ALLOWED_EXTENSION = ".glb"
MAX_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB
GLTF_MAGIC_HEADER = b"glTF"

async def upload_asset_file(filename: str, content: bytes, content_type: str = "model/gltf-binary") -> str:
    # 1. Check file extension
    _, ext = os.path.splitext(filename)
    if ext.lower() != ALLOWED_EXTENSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file extension. Only '{ALLOWED_EXTENSION}' files are permitted."
        )

    # 2. Check maximum file size (25 MB)
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File exceeds maximum allowed size of 25MB."
        )

    # 3. Check magic bytes: valid binary glTF must start with 'glTF' (0x676C5446)
    if len(content) < 4 or content[:4] != GLTF_MAGIC_HEADER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. File does not contain valid binary glTF (glTF magic header missing)."
        )

    unique_filename = f"{uuid.uuid4()}{ext.lower()}"

    # 4. Storage backend switch (local for dev, supabase for production)
    is_supabase = (settings.STORAGE_BACKEND.lower() == "supabase") or (bool(settings.SUPABASE_URL and settings.SUPABASE_KEY))
    if is_supabase and settings.SUPABASE_URL and settings.SUPABASE_KEY:
        bucket = settings.SUPABASE_BUCKET
        base_supabase = settings.SUPABASE_URL.rstrip("/")
        upload_url = f"{base_supabase}/storage/v1/object/{bucket}/{unique_filename}"

        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
            "apikey": settings.SUPABASE_KEY,
            "Content-Type": content_type,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(upload_url, content=content, headers=headers)
            if resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to upload to Supabase Storage: {resp.text}"
                )

        # Return public URL in Supabase
        return f"{base_supabase}/storage/v1/object/public/{bucket}/{unique_filename}"

    # Fallback to local storage in backend/uploads
    uploads_dir = os.path.abspath(settings.UPLOADS_DIR)
    os.makedirs(uploads_dir, exist_ok=True)
    file_path = os.path.join(uploads_dir, unique_filename)

    with open(file_path, "wb") as f:
        f.write(content)

    return f"{settings.BASE_URL.rstrip('/')}/uploads/{unique_filename}"

