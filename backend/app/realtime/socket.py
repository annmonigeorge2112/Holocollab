import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
import socketio
from sqlalchemy import select

from app.config import settings
from app.routers.auth import decode_token
import app.db.engine as db_engine
from app.db.schema import Session, Message, User, EngagementSample
from app.services.participants import record_participant_join, record_participant_leave

# Configure Socket.IO server:
# - Allowed origins loaded strictly from environment configuration
# - WebSocket with HTTP long-polling fallback for cloud reverse proxies
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.get_cors_origins(),
    transports=["websocket", "polling"],
)

# In-memory rooms data structure
room_state: Dict[str, Dict[str, Any]] = {}

# sid -> { "session_id": str, "user_id": str, "role": str, "name": str }
socket_users: Dict[str, Dict[str, Any]] = {}

# sid -> last_transform_timestamp (for throttling to max 30 updates/sec: min interval ~0.0333s)
last_transform_time: Dict[str, float] = {}
TRANSFORM_MIN_INTERVAL = 1.0 / 30.0

# user_id -> last_engagement_ping_timestamp (ignore pings faster than 1 per 10s)
last_ping_time: Dict[str, float] = {}
# session_id -> { user_id: { "chat": int, "gestures": int, "strokes": int, "air_ink": int } }
room_activity_counts: Dict[str, Dict[str, Dict[str, int]]] = {}
# user_id -> list of float timestamps within the last second for air_stroke_points
user_air_points_times: Dict[str, list[float]] = {}
AIR_POINTS_MAX_PER_SEC = 40
MAX_AIR_STROKES_PER_ROOM = 300
MAX_POINTS_PER_AIR_STROKE = 3000

@sio.event
async def connect(sid, environ, auth=None):
    token = None
    if isinstance(auth, dict):
        token = auth.get("token")
    if not token and "HTTP_AUTHORIZATION" in environ:
        auth_header = environ["HTTP_AUTHORIZATION"]
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        return False  # Reject connection

    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        role = payload.get("role", "student")
        if not user_id:
            return False

        async with db_engine.async_session_maker() as db:
            stmt = select(User).where(User.id == user_id)
            user = (await db.execute(stmt)).scalar_one_or_none()
            if not user:
                return False
            name = user.name
    except Exception:
        return False

    socket_users[sid] = {
        "user_id": user_id,
        "role": role,
        "name": name,
        "session_id": None,
    }
    return True

@sio.event
async def join_session(sid, data):
    session_id_or_code = data.get("sessionId") or data.get("roomCode")
    if not session_id_or_code:
        await sio.emit("error", {"message": "sessionId or roomCode required"}, to=sid)
        return

    user_info = socket_users.get(sid)
    if not user_info:
        await sio.emit("error", {"message": "Unauthorized socket"}, to=sid)
        return

    # Look up session in DB by id or by room_code
    session_id = session_id_or_code
    host_id = "system"
    room_code = session_id_or_code.upper()

    async with db_engine.async_session_maker() as db:
        stmt = select(Session).where(
            (Session.id == session_id_or_code) | (Session.room_code == session_id_or_code.upper())
        )
        session = (await db.execute(stmt)).scalar_one_or_none()
        if session and session.ended_at is not None:
            await sio.emit("error", {"message": "Session has already ended"}, to=sid)
            return

        if session:
            session_id = session.id
            host_id = session.host_id
            room_code = session.room_code
            await record_participant_join(session_id, user_info["user_id"], db)
        else:
            # Support ad-hoc / dev rooms without failing
            pass

    # Initialize room state if first user
    if session_id not in room_state:
        room_state[session_id] = {
            "room_code": room_code,
            "host_id": host_id,
            "participants": {},
            "media_state": {},
            "current_model_url": None,
            "last_model_transform": None,
            "selected_part_path": None,
            "model_filter": "realistic",
            "whiteboard_strokes": [],
            "annotations": [],
            "air_strokes": [],
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    room_state[session_id]["participants"][sid] = {
        "id": user_info["user_id"],
        "name": user_info["name"],
        "role": user_info["role"],
        "joinedAt": now_iso,
    }
    user_info["session_id"] = session_id
    await sio.enter_room(sid, session_id)

    # Emit current participants to the whole room
    participants_list = list(room_state[session_id]["participants"].values())
    await sio.emit("participants_update", {"participants": participants_list}, room=session_id)

    # Send current room state to newly joined user (late joiner sync)
    media_states = room_state[session_id].get("media_state", {})
    for u_id, m_state in media_states.items():
        await sio.emit("media_state", {"userId": u_id, "micOn": m_state.get("micOn", False), "camOn": m_state.get("camOn", False)}, to=sid)

    current_model = room_state[session_id].get("current_model_url")
    if current_model:
        await sio.emit("model_load", {"assetUrl": current_model, "by": "system"}, to=sid)
    last_transform = room_state[session_id].get("last_model_transform")
    if last_transform:
        await sio.emit("model_transform", last_transform, to=sid)
    selected_part = room_state[session_id].get("selected_part_path")
    if selected_part is not None:
        await sio.emit("part_select", {"path": selected_part, "by": "system"}, to=sid)
    current_filter = room_state[session_id].get("model_filter")
    if current_filter:
        await sio.emit("model_filter", {"filter": current_filter, "by": "system"}, to=sid)
    for stroke in room_state[session_id]["whiteboard_strokes"]:
        await sio.emit("whiteboard_stroke", stroke, to=sid)
    for annot in room_state[session_id]["annotations"]:
        await sio.emit("annotation_add", annot, to=sid)
    for air_stroke in room_state[session_id].get("air_strokes", []):
        await sio.emit("air_stroke_start", {
            "id": air_stroke["id"],
            "color": air_stroke["color"],
            "width": air_stroke["width"],
            "by": air_stroke["by"],
            "name": air_stroke["name"],
        }, to=sid)
        points = air_stroke.get("points", [])
        for i in range(0, len(points), 20):
            await sio.emit("air_stroke_points", {
                "id": air_stroke["id"],
                "points": points[i:i+20],
            }, to=sid)
        await sio.emit("air_stroke_end", {
            "id": air_stroke["id"],
        }, to=sid)

async def _handle_leave(sid):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    # Remove participant
    if sid in room_state[session_id]["participants"]:
        del room_state[session_id]["participants"][sid]
    if "media_state" in room_state[session_id] and user_info["user_id"] in room_state[session_id]["media_state"]:
        del room_state[session_id]["media_state"][user_info["user_id"]]

    # Record leave timestamp in DB
    try:
        async with db_engine.async_session_maker() as db:
            await record_participant_leave(session_id, user_info["user_id"], db)
    except Exception:
        pass

    # Leave room and broadcast participants_update
    await sio.leave_room(sid, session_id)
    participants_list = list(room_state[session_id]["participants"].values())
    await sio.emit("participants_update", {"participants": participants_list}, room=session_id)
    user_info["session_id"] = None

@sio.event
async def leave_session(sid, data=None):
    await _handle_leave(sid)

@sio.event
async def disconnect(sid):
    await _handle_leave(sid)
    if sid in socket_users:
        del socket_users[sid]
    if sid in last_transform_time:
        del last_transform_time[sid]

@sio.event
async def model_load(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    # Check permission: host, educator, or if demo session ("system" host) the session creator/first participant
    is_host = (user_info["user_id"] == room_state[session_id].get("host_id"))
    is_demo_room = room_state[session_id].get("host_id") in (None, "system", "")
    if not is_host and user_info["role"] not in ("educator", "host") and not is_demo_room:
        await sio.emit("error", {"message": "Permission denied: Only host or educator can load models"}, to=sid)
        return

    asset_url = data.get("assetUrl", "")
    room_state[session_id]["current_model_url"] = asset_url
    room_state[session_id]["selected_part_path"] = None
    await sio.emit("model_load", {"assetUrl": asset_url, "by": user_info["name"]}, room=session_id)

@sio.event
async def model_transform(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    # Throttle to max 30 updates/sec
    now = time.time()
    last_time = last_transform_time.get(sid, 0.0)
    if now - last_time < TRANSFORM_MIN_INTERVAL:
        return  # Drop excess update
    last_transform_time[sid] = now

    payload = {
        "position": data.get("position", [0, 0, 0]),
        "rotation": data.get("rotation", [0, 0, 0]),
        "scale": data.get("scale", 1),
        "by": data.get("by") or user_info["name"],
    }
    room_state[session_id]["last_model_transform"] = payload
    await sio.emit("model_transform", payload, room=session_id, skip_sid=sid)

@sio.event
async def part_select(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    path = data.get("path")
    payload = {
        "path": path,
        "by": data.get("by") or user_info["name"],
    }
    room_state[session_id]["selected_part_path"] = path
    await sio.emit("part_select", payload, room=session_id, skip_sid=sid)

@sio.event
async def model_filter(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    filter_mode = data.get("filter", "realistic")
    payload = {
        "filter": filter_mode,
        "by": data.get("by") or user_info["name"],
    }
    room_state[session_id]["model_filter"] = filter_mode
    await sio.emit("model_filter", payload, room=session_id, skip_sid=sid)

@sio.event
async def gesture_event(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id:
        return

    user_id = user_info["user_id"]
    if session_id not in room_activity_counts:
        room_activity_counts[session_id] = {}
    if user_id not in room_activity_counts[session_id]:
        room_activity_counts[session_id][user_id] = {"chat": 0, "gestures": 0, "strokes": 0, "air_ink": 0}
    room_activity_counts[session_id][user_id]["gestures"] += 1

    payload = {
        "type": data.get("type", "open"),
        "data": data.get("data", {}),
        "from": user_id,
    }
    await sio.emit("gesture_event", payload, room=session_id, skip_sid=sid)

@sio.event
async def annotation_add(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    payload = {
        "point": data.get("point", [0, 0, 0]),
        "text": data.get("text", ""),
        "by": user_info["name"],
    }
    room_state[session_id]["annotations"].append(payload)
    await sio.emit("annotation_add", payload, room=session_id, skip_sid=sid)

@sio.event
async def annotation_clear(sid, data=None):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    room_state[session_id]["annotations"] = []
    await sio.emit("annotation_clear", {"by": user_info["name"]}, room=session_id, skip_sid=sid)

@sio.event
async def whiteboard_stroke(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    user_id = user_info["user_id"]
    if session_id not in room_activity_counts:
        room_activity_counts[session_id] = {}
    if user_id not in room_activity_counts[session_id]:
        room_activity_counts[session_id][user_id] = {"chat": 0, "gestures": 0, "strokes": 0, "air_ink": 0}
    room_activity_counts[session_id][user_id]["strokes"] += 1

    payload = {
        "points": data.get("points", []),
        "color": data.get("color", "#ffffff"),
        "size": data.get("size", 2),
        "tool": data.get("tool", "pen"),
        "by": user_info["name"],
    }
    strokes = room_state[session_id]["whiteboard_strokes"]
    strokes.append(payload)
    # Cap whiteboard strokes list at 2000
    if len(strokes) > 2000:
        room_state[session_id]["whiteboard_strokes"] = strokes[-2000:]

    await sio.emit("whiteboard_stroke", payload, room=session_id, skip_sid=sid)

@sio.event
async def whiteboard_clear(sid, data=None):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    room_state[session_id]["whiteboard_strokes"] = []
    await sio.emit("whiteboard_clear", {"by": user_info["name"]}, room=session_id, skip_sid=sid)

@sio.event
async def air_stroke_start(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    stroke_id = str(data.get("id", ""))
    color = str(data.get("color", "#00ffff"))
    width = float(data.get("width", 2.0))
    by_user_id = str(data.get("by", user_info["user_id"]))
    by_name = str(data.get("name", user_info["name"]))

    stroke_obj = {
        "id": stroke_id,
        "color": color,
        "width": width,
        "by": by_user_id,
        "name": by_name,
        "points": [],
    }

    strokes = room_state[session_id].get("air_strokes", [])
    strokes.append(stroke_obj)
    # Cap strokes per room at 300 (drop oldest)
    if len(strokes) > MAX_AIR_STROKES_PER_ROOM:
        room_state[session_id]["air_strokes"] = strokes[-MAX_AIR_STROKES_PER_ROOM:]
    else:
        room_state[session_id]["air_strokes"] = strokes

    relay_payload = {
        "id": stroke_id,
        "color": color,
        "width": width,
        "by": by_user_id,
        "name": by_name,
    }
    await sio.emit("air_stroke_start", relay_payload, room=session_id, skip_sid=sid)

@sio.event
async def air_stroke_points(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    user_id = user_info["user_id"]
    now = time.time()
    # Rate limit: max 40 air_stroke_points events per second per user (drop extra)
    history = [t for t in user_air_points_times.get(user_id, []) if now - t < 1.0]
    if len(history) >= AIR_POINTS_MAX_PER_SEC:
        return
    history.append(now)
    user_air_points_times[user_id] = history

    stroke_id = str(data.get("id", ""))
    incoming_points = data.get("points", [])
    if not isinstance(incoming_points, list):
        return

    # Batches of up to 20
    trimmed_points = incoming_points[:20]

    # Find stroke in room state and append points up to MAX_POINTS_PER_AIR_STROKE
    for stroke in room_state[session_id].get("air_strokes", []):
        if stroke["id"] == stroke_id:
            curr_len = len(stroke["points"])
            remaining_cap = MAX_POINTS_PER_AIR_STROKE - curr_len
            if remaining_cap > 0:
                stroke["points"].extend(trimmed_points[:remaining_cap])
            break

    relay_payload = {
        "id": stroke_id,
        "points": trimmed_points,
    }
    await sio.emit("air_stroke_points", relay_payload, room=session_id, skip_sid=sid)

@sio.event
async def air_stroke_end(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    stroke_id = str(data.get("id", ""))
    relay_payload = {
        "id": stroke_id,
    }
    await sio.emit("air_stroke_end", relay_payload, room=session_id, skip_sid=sid)

@sio.event
async def air_undo(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    by_user = str(data.get("by", user_info["user_id"]))
    strokes = room_state[session_id].get("air_strokes", [])

    # Remove that user's most recent stroke
    for i in range(len(strokes) - 1, -1, -1):
        if strokes[i].get("by") == by_user:
            del strokes[i]
            break

    relay_payload = {
        "by": by_user,
    }
    await sio.emit("air_undo", relay_payload, room=session_id, skip_sid=sid)

@sio.event
async def air_clear(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    by_user = str(data.get("by", user_info["user_id"]))
    all_clear = bool(data.get("all", False))
    host_id = room_state[session_id].get("host_id")

    if all_clear:
        # all=true is host-only (others get an error event)
        is_host = (user_info.get("role") == "educator") or (user_info["user_id"] == host_id)
        if not is_host:
            await sio.emit("error", {"message": "Only host can clear all air strokes"}, to=sid)
            return
        room_state[session_id]["air_strokes"] = []
    else:
        # clear only that user's strokes
        strokes = room_state[session_id].get("air_strokes", [])
        room_state[session_id]["air_strokes"] = [s for s in strokes if s.get("by") != by_user]

    relay_payload = {
        "by": by_user,
        "all": all_clear,
    }
    await sio.emit("air_clear", relay_payload, room=session_id, skip_sid=sid)

@sio.event
async def chat_message(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id:
        return

    user_id = user_info["user_id"]
    if session_id not in room_activity_counts:
        room_activity_counts[session_id] = {}
    if user_id not in room_activity_counts[session_id]:
        room_activity_counts[session_id][user_id] = {"chat": 0, "gestures": 0, "strokes": 0, "air_ink": 0}
    room_activity_counts[session_id][user_id]["chat"] += 1

    content = data.get("message", "")
    msg_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    # Persist message to database
    try:
        async with db_engine.async_session_maker() as db:
            msg_record = Message(
                id=msg_id,
                session_id=session_id,
                user_id=user_id,
                content=content,
            )
            db.add(msg_record)
            await db.commit()
    except Exception:
        pass

    payload = {
        "id": msg_id,
        "from": user_id,
        "name": user_info["name"],
        "message": content,
        "timestamp": now_iso,
    }
    await sio.emit("chat_message", payload, room=session_id, skip_sid=sid)

@sio.event
async def engagement_ping(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    user_id = user_info.get("user_id")
    session_id = user_info.get("session_id")
    if not user_id or not session_id:
        return

    # Ignore pings if requested sessionId does not match user's active session or not in room
    ping_session_id = data.get("sessionId") if isinstance(data, dict) else None
    if ping_session_id and ping_session_id != session_id:
        return
    if session_id not in room_state or sid not in room_state[session_id]["participants"]:
        return

    # Rate limit: ignore pings faster than 1 per 10 seconds per user
    now = time.time()
    last_ping = last_ping_time.get(user_id, 0.0)
    if now - last_ping < 10.0:
        return
    last_ping_time[user_id] = now

    is_active = bool(data.get("active", True)) if isinstance(data, dict) else True
    sample = EngagementSample(
        id=str(uuid.uuid4()),
        session_id=session_id,
        user_id=user_id,
        is_active=is_active,
        timestamp=datetime.now(timezone.utc),
    )
    try:
        async with db_engine.async_session_maker() as db:
            db.add(sample)
            await db.commit()
    except Exception:
        pass

@sio.event
async def highlight_object(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = user_info.get("session_id")
    if not session_id:
        return

    payload = {
        "name": data.get("name", ""),
        "by": user_info["name"],
    }
    await sio.emit("highlight_object", payload, room=session_id, skip_sid=sid)

# WebRTC Signaling: relay rtc_offer, rtc_answer, rtc_ice to target socket/user only
def _find_target_sid(target: str, session_id: Optional[str]) -> Optional[str]:
    # target may already be a sid
    if target in socket_users:
        return target
    # or target may be a user_id
    if session_id and session_id in room_state:
        for p_sid, p_info in room_state[session_id].get("participants", {}).items():
            if p_info.get("id") == target:
                return p_sid
    for s_sid, s_info in socket_users.items():
        if s_info.get("user_id") == target:
            return s_sid
    return target

@sio.event
async def media_state(sid, data):
    user_info = socket_users.get(sid)
    if not user_info:
        return
    session_id = data.get("sessionId") or user_info.get("session_id")
    if not session_id or session_id not in room_state:
        return

    user_id = data.get("userId") or user_info["user_id"]
    mic_on = bool(data.get("micOn", False))
    cam_on = bool(data.get("camOn", False))

    if "media_state" not in room_state[session_id]:
        room_state[session_id]["media_state"] = {}
    room_state[session_id]["media_state"][user_id] = {
        "micOn": mic_on,
        "camOn": cam_on,
    }

    payload = {
        "userId": user_id,
        "micOn": mic_on,
        "camOn": cam_on,
    }
    await sio.emit("media_state", payload, room=session_id, skip_sid=sid)

@sio.event
async def rtc_offer(sid, data):
    user_info = socket_users.get(sid)
    target = data.get("to")
    if not target or not user_info:
        return
    session_id = user_info.get("session_id")
    target_sid = _find_target_sid(target, session_id)
    if not target_sid:
        return
    payload = {
        "to": target,
        "from": user_info["user_id"],
        "payload": data.get("payload", {}),
    }
    await sio.emit("rtc_offer", payload, to=target_sid)

@sio.event
async def rtc_answer(sid, data):
    user_info = socket_users.get(sid)
    target = data.get("to")
    if not target or not user_info:
        return
    session_id = user_info.get("session_id")
    target_sid = _find_target_sid(target, session_id)
    if not target_sid:
        return
    payload = {
        "to": target,
        "from": user_info["user_id"],
        "payload": data.get("payload", {}),
    }
    await sio.emit("rtc_answer", payload, to=target_sid)

@sio.event
async def rtc_ice(sid, data):
    user_info = socket_users.get(sid)
    target = data.get("to")
    if not target or not user_info:
        return
    session_id = user_info.get("session_id")
    target_sid = _find_target_sid(target, session_id)
    if not target_sid:
        return
    payload = {
        "to": target,
        "from": user_info["user_id"],
        "payload": data.get("payload", {}),
    }
    await sio.emit("rtc_ice", payload, to=target_sid)
