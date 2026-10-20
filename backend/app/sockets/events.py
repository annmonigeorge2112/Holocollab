from datetime import datetime, timezone
import socketio
from app.auth import decode_token
from app.services.gemini import ask_gemini
from app.config import settings

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[settings.FRONTEND_ORIGIN, "*"],
)

# In-memory tracking of active sessions
# room_code -> dict of sid -> { "id": str, "name": str, "role": str }
room_sessions: dict[str, dict[str, dict]] = {}

@sio.event
async def connect(sid, environ, auth=None):
    pass

@sio.event
async def disconnect(sid):
    for room_code, members in list(room_sessions.items()):
        if sid in members:
            user_info = members.pop(sid)
            await sio.leave_room(sid, room_code)
            await sio.emit("participant_left", {"id": user_info["id"]}, room=room_code)
            if not members:
                del room_sessions[room_code]

@sio.event
async def join_room(sid, data):
    room_code = data.get("room_code", "").upper()
    token = data.get("token", "")
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        role = payload.get("role", "student")
        name = payload.get("name", "Anonymous")
    except Exception:
        await sio.emit("error", {"message": "Invalid or expired authentication token"}, to=sid)
        return

    await sio.enter_room(sid, room_code)
    if room_code not in room_sessions:
        room_sessions[room_code] = {}

    room_sessions[room_code][sid] = {"id": user_id, "name": name, "role": role}

    # Notify caller of existing members
    participants = list(room_sessions[room_code].values())
    await sio.emit(
        "room_joined",
        {"user_id": user_id, "role": role, "participants": participants},
        to=sid,
    )

    # Notify other members in the room
    await sio.emit(
        "participant_joined",
        {"id": user_id, "name": name, "role": role},
        room=room_code,
        skip_sid=sid,
    )

@sio.event
async def leave_room(sid, data):
    room_code = data.get("room_code", "").upper()
    if room_code in room_sessions and sid in room_sessions[room_code]:
        user_info = room_sessions[room_code].pop(sid)
        await sio.leave_room(sid, room_code)
        await sio.emit("participant_left", {"id": user_info["id"]}, room=room_code)

@sio.event
async def model_transform(sid, data):
    room_code = data.get("room_code", "").upper()
    user_info = room_sessions.get(room_code, {}).get(sid, {})
    user_id = user_info.get("id", "unknown")

    await sio.emit(
        "model_updated",
        {
            "user_id": user_id,
            "position": data.get("position", [0, 0, 0]),
            "rotation": data.get("rotation", [0, 0, 0]),
            "scale": data.get("scale", 1),
        },
        room=room_code,
        skip_sid=sid,
    )

@sio.event
async def whiteboard_draw(sid, data):
    room_code = data.get("room_code", "").upper()
    user_info = room_sessions.get(room_code, {}).get(sid, {})
    user_id = user_info.get("id", "unknown")

    await sio.emit(
        "whiteboard_drawn",
        {"user_id": user_id, "stroke": data.get("stroke", {})},
        room=room_code,
        skip_sid=sid,
    )

@sio.event
async def whiteboard_clear(sid, data):
    room_code = data.get("room_code", "").upper()
    user_info = room_sessions.get(room_code, {}).get(sid, {})
    user_id = user_info.get("id", "unknown")

    await sio.emit(
        "whiteboard_cleared",
        {"user_id": user_id},
        room=room_code,
        skip_sid=sid,
    )

@sio.event
async def gemini_query(sid, data):
    room_code = data.get("room_code", "").upper()
    prompt = data.get("prompt", "")
    answer = await ask_gemini(prompt)
    await sio.emit(
        "gemini_response",
        {"answer": answer, "timestamp": datetime.now(timezone.utc).isoformat()},
        room=room_code,
    )
