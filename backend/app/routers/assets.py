from typing import List, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.engine import get_db
from app.db.schema import Asset, User
from app.routers.auth import get_current_user
from app.schemas.assets import AssetOut
from app.services.storage import upload_asset_file

router = APIRouter(prefix="/assets", tags=["assets"])

@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    asset_name = name or file.filename or "Unnamed Asset"
    public_url = await upload_asset_file(
        filename=file.filename or "model.glb",
        content=content,
        content_type=file.content_type or "model/gltf-binary"
    )

    asset = Asset(
        name=asset_name,
        url=public_url,
        uploader_id=current_user.id,
        size_bytes=len(content),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset

@router.get("", response_model=List[AssetOut])
async def list_assets(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Asset).order_by(Asset.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()
