export type UserRole = 'student' | 'educator' | 'guest';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface RoomParticipant {
  id: string;
  name: string;
  role: UserRole;
  joinedAt?: string;
}

export interface StrokeData {
  points: [number, number][];
  color: string;
  width: number;
  tool?: 'pen' | 'eraser' | 'text';
  text?: string;
}

// Client -> Server Payloads (CONTRACT.md)
export interface JoinSessionPayload {
  sessionId: string;
  token: string;
}

export interface LeaveSessionPayload {
  sessionId: string;
}

export interface ModelLoadPayload {
  sessionId: string;
  assetUrl: string;
}

export interface ModelTransformPayload {
  sessionId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  by?: string;
}

export interface HighlightObjectPayload {
  sessionId: string;
  name: string;
}

export type ModelFilterMode = 'realistic' | 'blue' | 'red';

export interface PartSelectPayload {
  sessionId: string;
  path: string | null;
  by: string;
}

export interface ModelFilterPayload {
  sessionId: string;
  filter: ModelFilterMode;
  by: string;
}

export interface GestureEventPayload {
  sessionId: string;
  type: 'fist' | 'point' | 'open' | 'pinch';
  data: Record<string, unknown>;
}

export interface WhiteboardStrokePayload {
  sessionId: string;
  points: [number, number][];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
}

export interface WhiteboardClearPayload {
  sessionId: string;
}

export interface ChatMessagePayload {
  sessionId: string;
  message: string;
}

// Legacy payload compatibility
export interface JoinRoomPayload {
  room_code: string;
  token: string;
}

export interface LeaveRoomPayload {
  room_code: string;
}

export interface WhiteboardDrawPayload {
  room_code: string;
  stroke: StrokeData;
}

export interface GeminiQueryPayload {
  room_code: string;
  prompt: string;
}

// Server -> Client Payloads (CONTRACT.md)
export interface ParticipantsUpdatePayload {
  participants: Array<{
    id: string;
    name: string;
    role: string;
    joinedAt: string;
  }>;
}

export interface ServerModelLoadPayload {
  assetUrl: string;
  by: string;
}

export interface ServerModelTransformPayload {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  by: string;
}

export interface ServerHighlightObjectPayload {
  name: string;
  by: string;
}

export interface ServerPartSelectPayload {
  path: string | null;
  by: string;
}

export interface ServerModelFilterPayload {
  filter: ModelFilterMode;
  by: string;
}

export interface ServerGestureEventPayload {
  type: 'fist' | 'point' | 'open' | 'pinch';
  data: Record<string, unknown>;
  from: string;
}

export interface ServerWhiteboardStrokePayload {
  points: [number, number][];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
  by: string;
}

export interface ServerChatMessagePayload {
  id: string;
  from: string;
  name: string;
  message: string;
  timestamp: string;
}

export interface ErrorPayload {
  message: string;
}

// Legacy Server Payload compatibility
export interface RoomJoinedPayload {
  user_id: string;
  role: UserRole;
  participants: RoomParticipant[];
}

export interface ParticipantJoinedPayload {
  id: string;
  name: string;
  role: UserRole;
}

export interface ParticipantLeftPayload {
  id: string;
}

export interface ModelUpdatedPayload {
  user_id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export interface WhiteboardDrawnPayload {
  user_id: string;
  stroke: StrokeData;
}

export interface WhiteboardClearedPayload {
  user_id: string;
}

export interface GeminiResponsePayload {
  answer: string;
  timestamp: string;
}

export interface MediaStatePayload {
  sessionId: string;
  userId: string;
  micOn: boolean;
  camOn: boolean;
}

export interface ServerMediaStatePayload {
  userId: string;
  micOn: boolean;
  camOn: boolean;
}

export interface RtcSignalPayload {
  sessionId?: string;
  to: string;
  from?: string;
  payload: Record<string, unknown>;
}

// Air Ink Payloads (CONTRACT.md)
export interface AirStrokeStartPayload {
  sessionId: string;
  id: string;
  color: string;
  width: number;
  by: string;
  name: string;
}

export interface AirStrokePointsPayload {
  sessionId: string;
  id: string;
  points: [number, number, number][];
}

export interface AirStrokeEndPayload {
  sessionId: string;
  id: string;
}

export interface AirUndoPayload {
  sessionId: string;
  by: string;
}

export interface AirClearPayload {
  sessionId: string;
  by: string;
  all: boolean;
}

export interface ServerAirStrokeStartPayload {
  id: string;
  color: string;
  width: number;
  by: string;
  name: string;
}

export interface ServerAirStrokePointsPayload {
  id: string;
  points: [number, number, number][];
}

export interface ServerAirStrokeEndPayload {
  id: string;
}

export interface ServerAirUndoPayload {
  by: string;
}

export interface ServerAirClearPayload {
  by: string;
  all: boolean;
}

export interface ScreenSharePayload {
  sessionId: string;
  userId: string;
  name: string;
  on: boolean;
}

export interface ServerScreenSharePayload {
  userId: string;
  name: string;
  on: boolean;
}

// Strictly Typed Socket Event Maps
export interface ClientToServerEvents {
  join_session: (data: JoinSessionPayload) => void;
  leave_session: (data: LeaveSessionPayload) => void;
  model_load: (data: ModelLoadPayload) => void;
  model_transform: (data: ModelTransformPayload) => void;
  part_select: (data: PartSelectPayload) => void;
  model_filter: (data: ModelFilterPayload) => void;
  highlight_object: (data: HighlightObjectPayload) => void;
  gesture_event: (data: GestureEventPayload) => void;
  whiteboard_stroke: (data: WhiteboardStrokePayload) => void;
  whiteboard_clear: (data: WhiteboardClearPayload) => void;
  chat_message: (data: ChatMessagePayload) => void;
  media_state: (data: MediaStatePayload) => void;
  screen_share: (data: ScreenSharePayload) => void;
  rtc_offer: (data: RtcSignalPayload) => void;
  rtc_answer: (data: RtcSignalPayload) => void;
  rtc_ice: (data: RtcSignalPayload) => void;
  air_stroke_start: (data: AirStrokeStartPayload) => void;
  air_stroke_points: (data: AirStrokePointsPayload) => void;
  air_stroke_end: (data: AirStrokeEndPayload) => void;
  air_undo: (data: AirUndoPayload) => void;
  air_clear: (data: AirClearPayload) => void;
}

export interface ServerToClientEvents {
  participants_update: (data: ParticipantsUpdatePayload) => void;
  media_state: (data: ServerMediaStatePayload) => void;
  screen_share: (data: ServerScreenSharePayload) => void;
  model_load: (data: ServerModelLoadPayload) => void;
  model_transform: (data: ServerModelTransformPayload) => void;
  part_select: (data: ServerPartSelectPayload) => void;
  model_filter: (data: ServerModelFilterPayload) => void;
  highlight_object: (data: ServerHighlightObjectPayload) => void;
  gesture_event: (data: ServerGestureEventPayload) => void;
  whiteboard_stroke: (data: ServerWhiteboardStrokePayload) => void;
  whiteboard_clear: (data: { by: string }) => void;
  chat_message: (data: ServerChatMessagePayload) => void;
  rtc_offer: (data: { to: string; from: string; payload: Record<string, unknown> }) => void;
  rtc_answer: (data: { to: string; from: string; payload: Record<string, unknown> }) => void;
  rtc_ice: (data: { to: string; from: string; payload: Record<string, unknown> }) => void;
  error: (data: ErrorPayload) => void;
  air_stroke_start: (data: ServerAirStrokeStartPayload) => void;
  air_stroke_points: (data: ServerAirStrokePointsPayload) => void;
  air_stroke_end: (data: ServerAirStrokeEndPayload) => void;
  air_undo: (data: ServerAirUndoPayload) => void;
  air_clear: (data: ServerAirClearPayload) => void;
}

