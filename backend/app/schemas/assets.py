from pydantic import BaseModel, ConfigDict

class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    url: str
    name: str
