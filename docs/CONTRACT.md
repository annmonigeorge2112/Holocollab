# HoloCollab EduMeet: Contract Specification

## REST API Specification
All requests/responses are JSON unless multipart upload. Bearer JWT required in `Authorization: Bearer <token>` for all endpoints except `/auth/*`.

### Auth Endpoints
- `POST /auth/register`
  - Body: `{ "name": string, "email": string, "password": string, "role": "student" | "educator" }`
  - Response: `{ "token": string, "user": { "id": string, "name": string, "email": string, "role": "student" | "educator" } }`
- `POST /auth/login`
  - Body: `{ "email": string, "password": string }`
  - Response: `{ "token": string, "user": { "id": string, "name": string, "email": string, "role": "student" | "educator" } }`
- `POST /auth/guest`
  - Body: `{ "name": string }`
  - Response: `{ "token": string, "user": { "id": string, "name": string, "role": "guest" } }`
- `GET /me`
  - Response: `{ "id": string, "name": string, "email"?: string, "role": "student" | "educator" | "guest" }`

### Sessions
- `POST /sessions` (Educator)
  - Body: `{ "name": string, "topic": string, "externalLink"?: string }`
  - Response: `{ "id": string, "name": string, "topic": string, "roomCode": string, "externalLink"?: string, "createdAt": string, "endedAt"?: string }`
  - Note: `roomCode` is a 6-character uppercase alphanumeric string.
- `GET /sessions`
  - Response: `Array<{ "id": string, "name": string, "topic": string, "roomCode": string, "createdAt": string, "endedAt"?: string }>`
- `GET /sessions/by-code/{code}`
  - Response: `{ "id": string, "name": string, "topic": string, "roomCode": string, "hostId": string, "endedAt"?: string }`
- `POST /sessions/{id}/end`
  - Response: `{ "id": string, "status": "ended", "endedAt": string }`
- `GET /sessions/{id}/report` (Host educator only)
  - Response: `{ "sessionId": string, "durationSeconds": number, "totalParticipants": number, "engagementAverage": number, "rating": "Excellent" | "Good" | "Fair", "aiInsight": string, "summary": string, "quizzes": Array<{ "question": string, "score": number }>, "attendance": Array<{ "userId": string, "name": string, "joinedAt": string, "leftAt": string | null, "durationSeconds": number, "engagementPct": number, "chatCount": number, "gestureCount": number, "strokeCount": number }>, "engagementSeries": Array<{ "timeLabel": string, "activePercentages": Record<string, number> }> }`

### 3D Assets
- `POST /assets`
  - Multipart Form Data: file `.glb`, max 25MB, optional name.
  - Response: `{ "id": string, "url": string, "name": string }`
- `GET /assets`
  - Response: `Array<{ "id": string, "url": string, "name": string }>`

### AI (Gemini)
- `POST /ai/chat`
  - Body: `{ "sessionId": string, "message": string }`
  - Response: `{ "reply": string }`
- `POST /ai/summary`
  - Body: `{ "sessionId": string }`
  - Response: `{ "summary": string }`
- `POST /ai/quiz`
  - Body: `{ "sessionId": string, "topic": string, "count": number }`
  - Response: `{ "quiz": Array<{ "question": string, "options": string[], "answer": string }> }`

---

## Socket.IO Events

Mount path: `/socket.io`

### Client -> Server
- `join_session`: `{ "sessionId": string, "token": string }`
- `leave_session`: `{ "sessionId": string }`
- `model_load`: `{ "sessionId": string, "assetUrl": string }`
- `model_transform`: `{ "sessionId": string, "position": [number, number, number], "rotation": [number, number, number], "scale": number, "by": string }`
- `gesture_event`: `{ "sessionId": string, "type": "fist" | "point" | "open" | "pinch", "data": Record<string, unknown> }`
- `annotation_add`: `{ "sessionId": string, "point": [number, number, number], "text": string }`
- `annotation_clear`: `{ "sessionId": string }`
- `whiteboard_stroke`: `{ "sessionId": string, "points": [number, number][], "color": string, "size": number, "tool": "pen" | "eraser" }`
- `whiteboard_clear`: `{ "sessionId": string }`
- `chat_message`: `{ "sessionId": string, "message": string }`
- `rtc_offer`: `{ "sessionId": string, "to": string, "from": string, "payload": Record<string, unknown> }`
- `rtc_answer`: `{ "sessionId": string, "to": string, "from": string, "payload": Record<string, unknown> }`
- `rtc_ice`: `{ "sessionId": string, "to": string, "from": string, "payload": Record<string, unknown> }`
- `engagement_ping`: `{ "sessionId": string, "active": boolean }`
- `highlight_object`: `{ "sessionId": string, "name": string }`
- `part_select`: `{ "sessionId": string, "path": string | null, "by": string }`
- `model_filter`: `{ "sessionId": string, "filter": "realistic" | "blue" | "red", "by": string }`
- `media_state`: `{ "sessionId": string, "userId": string, "micOn": boolean, "camOn": boolean }`

### Server -> Client (Broadcast / Targeted)
- `participants_update`: `{ "participants": Array<{ "id": string, "name": string, "role": string, "joinedAt": string }> }`
- `media_state`: `{ "userId": string, "micOn": boolean, "camOn": boolean }`
- `model_load`: `{ "assetUrl": string, "by": string }`
- `model_transform`: `{ "position": [number, number, number], "rotation": [number, number, number], "scale": number, "by": string }`
- `part_select`: `{ "path": string | null, "by": string }`
- `model_filter`: `{ "filter": "realistic" | "blue" | "red", "by": string }`
- `gesture_event`: `{ "type": "fist" | "point" | "open" | "pinch", "data": Record<string, unknown>, "from": string }`
- `annotation_add`: `{ "point": [number, number, number], "text": string, "by": string }`
- `annotation_clear`: `{ "by": string }`
- `whiteboard_stroke`: `{ "points": [number, number][], "color": string, "size": number, "tool": "pen" | "eraser", "by": string }`
- `whiteboard_clear`: `{ "by": string }`
- `chat_message`: `{ "id": string, "from": string, "name": string, "message": string, "timestamp": string }`
- `rtc_offer`: `{ "to": string, "from": string, "payload": Record<string, unknown> }`
- `rtc_answer`: `{ "to": string, "from": string, "payload": Record<string, unknown> }`
- `rtc_ice`: `{ "to": string, "from": string, "payload": Record<string, unknown> }`
- `engagement_ping`: `{ "sessionId": string, "active": boolean }`
- `error`: `{ "message": string }`

### Room State (Sent to Late Joiners on join_session)
On `join_session`, late joiners receive the current room state:
1. `participants_update`: current participant list.
2. `media_state`: latest media state for each active participant.
3. `model_load`: `{ "assetUrl": currentModelUrl, "by": "system" }` (if a model has been loaded).
4. `model_transform`: `{ "position": [x, y, z], "rotation": [rx, ry, rz], "scale": s, "by": lastBy }` (if transformed).
5. `part_select`: `{ "path": selectedPartPath, "by": "system" }` (if a part is isolated).
6. `model_filter`: `{ "filter": currentFilter, "by": "system" }` (if set).
7. Prior `whiteboard_stroke` and `annotation_add` history.

---

## Data Model (Entities)

- **users**: `id`, `name`, `email` (nullable for guests), `password_hash` (nullable for guests), `role` (`student` | `educator` | `guest`), `created_at`
- **sessions**: `id`, `name`, `topic`, `room_code` (unique 6-char alphanumeric), `external_link`, `host_id`, `created_at`, `ended_at`
- **participants**: `id`, `session_id`, `user_id`, `joined_at`, `left_at`
- **assets**: `id`, `name`, `url`, `uploader_id`, `size_bytes`, `created_at`
- **messages**: `id`, `session_id`, `user_id`, `content`, `created_at`
- **engagement_samples**: `id`, `session_id`, `user_id`, `is_active`, `timestamp`
- **quizzes**: `id`, `session_id`, `topic`, `data_json`, `created_at`
