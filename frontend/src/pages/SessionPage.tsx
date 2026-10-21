import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';
import { socketManager } from '../services/SocketManager';
import { ARSceneComponent, ARSceneHandle } from '../components/ARScene';
import { Whiteboard } from '../components/Whiteboard';
import { GeminiAssistant } from '../components/GeminiAssistant';
import { useRealtime } from '../hooks/useRealtime';
import { SAMPLE_MODELS } from '../constants/models';
import {
  ServerChatMessagePayload,
  StrokeData,
  ParticipantsUpdatePayload,
  ServerMediaStatePayload,
  ServerGestureEventPayload,
  ServerScreenSharePayload,
} from '../types/events';
import { useMediaSession } from '../hooks/useMediaSession';
import { VideoGrid } from '../components/VideoGrid';
import { useGestureSession } from '../hooks/useGestureSession';
import { HandOverlay } from '../components/HandOverlay';
import {
  Users,
  Box,
  MessageSquare,
  Bot,
  PenLine,
  Upload,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Video as VideoIcon,
  VideoOff,
  Mic,
  MicOff,
  Sparkles,
  Share2,
  Check,
  RotateCcw,
  AlertCircle,
  Monitor,
  MonitorOff,
  RefreshCw,
} from 'lucide-react';

interface SessionMeta {
  id: string;
  name: string;
  topic: string;
  roomCode: string;
  hostId: string;
  endedAt?: string;
}

interface AssetItem {
  id: string;
  url: string;
  name: string;
}

type SidePanel = 'participants' | 'chat' | 'gemini' | 'models' | 'video' | null;

export const SessionPage: React.FC = () => {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const arRef = useRef<ARSceneHandle | null>(null);

  // Session metadata & states
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Connection status chip state
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');

  // Asset Models & host slides
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [currentModelUrl, setCurrentModelUrl] = useState<string>('');
  const [currentSlideIdx, setCurrentSlideIdx] = useState(-1);

  // Whiteboard
  const [whiteboardActive, setWhiteboardActive] = useState(false);
  const [strokes, setStrokes] = useState<StrokeData[]>([]);

  // Chat
  const [chatMessages, setChatMessages] = useState<ServerChatMessagePayload[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Gemini Assistant
  const [geminiResponses, setGeminiResponses] = useState<{ answer: string; timestamp: string }[]>([]);
  const [geminiLoading, setGeminiLoading] = useState(false);

  // UI Drawers & Controls
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Screen Share Presenter State
  const [activePresenter, setActivePresenter] = useState<{ userId: string; name: string } | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  // Participant Media States & Gesture Badges
  const [peerMediaStates, setPeerMediaStates] = useState<Map<string, { micOn: boolean; camOn: boolean }>>(new Map());
  const [peerGestures, setPeerGestures] = useState<Map<string, string>>(new Map());

  const isHost = user?.role === 'educator' || (session && session.hostId === user?.id);

  // 1. Single getUserMedia & screen share session in the whole page
  const {
    localStream,
    localVideoRef,
    remoteStreams,
    micOn,
    camOn,
    toggleMic,
    toggleCam,
    screenStream,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    restartCamera,
    releaseAllMedia,
    error: mediaError,
    status: mediaStatus,
  } = useMediaSession(sessionId ?? '', user?.id);

  // 2. Gesture Session using the same video element and reactive stream
  const {
    currentGesture,
    allHands,
    fps: gestureFps,
    latencyMs: gestureLatencyMs,
    isEnabled: gesturesEnabled,
    setIsEnabled: setGesturesEnabled,
    status: handTrackingStatus,
    error: gestureError,
  } = useGestureSession({
    sessionId,
    videoRef: localVideoRef,
    stream: localStream,
    arSceneRef: arRef,
    isApproved: true,
    enabled: true,
  });

  // Camera chip state: "on" | "off" | "denied" | "in use"
  const cameraChipStatus: 'on' | 'off' | 'denied' | 'in use' = mediaStatus === 'initializing'
    ? 'in use'
    : !camOn
    ? 'off'
    : mediaError?.toLowerCase().includes('denied') || mediaError?.toLowerCase().includes('unavailable')
    ? 'denied'
    : localStream && localStream.getVideoTracks().some((t) => t.enabled)
    ? 'on'
    : 'off';

  // Fetch session details
  const fetchSessionData = useCallback(() => {
    if (!sessionId) return;
    setLoadingSession(true);
    setSessionError(null);

    apiFetch<SessionMeta>(`/sessions/${sessionId}`)
      .then((data) => {
        if (data.endedAt) {
          setSessionError('This session has already ended.');
        } else {
          setSession(data);
        }
      })
      .catch(() => {
        // Fallback check by room code
        apiFetch<SessionMeta>(`/sessions/by-code/${sessionId}`)
          .then((data) => {
            if (data.endedAt) {
              setSessionError('This session has already ended.');
            } else {
              setSession(data);
            }
          })
          .catch(() => {
            setSessionError('Invalid session or room code.');
          });
      })
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  useEffect(() => {
    apiFetch<AssetItem[]>('/assets').then(setAssets).catch(() => {});
  }, []);

  // 3. Realtime AR Scene Sync
  const {
    isConnected,
    connectionError,
    retryCount,
    controlledBy,
    participants,
    broadcastModelLoad,
    onLocalTransformChange,
    onLocalPartSelect,
    onLocalFilterChange,
    onLocalInteractionEnd,
  } = useRealtime({
    sessionId: sessionId ?? '',
    token,
    userName: user?.name ?? 'User',
    arSceneRef: arRef,
    onModelLoaded: (url) => setCurrentModelUrl(url),
  });

  // Current room layout mode
  // 1. Share Mode: someone is presenting screen
  // 2. AR Mode: host loaded a 3D model
  // 3. Meet Mode (default): responsive Google Meet video grid
  const currentMode: 'meet' | 'ar' | 'share' = activePresenter
    ? 'share'
    : currentModelUrl
    ? 'ar'
    : 'meet';

  // Update connection status chip
  useEffect(() => {
    if (isConnected) {
      setConnStatus('connected');
    } else if (loadingSession) {
      setConnStatus('connecting');
    } else {
      setConnStatus('reconnecting');
    }
  }, [isConnected, loadingSession]);

  // 4. Socket Listeners for chat, whiteboard strokes, peer media states, screen share, and gesture badges
  useEffect(() => {
    if (!sessionId || !token) return;

    const handleChat = (data: ServerChatMessagePayload) => {
      setChatMessages((prev) => [...prev, data]);
    };

    const handleStroke = (data: {
      points: [number, number][];
      color: string;
      size: number;
      tool: 'pen' | 'eraser';
      by: string;
    }) => {
      setStrokes((prev) => [
        ...prev,
        { points: data.points, color: data.color, width: data.size, tool: data.tool },
      ]);
    };

    const handleClear = () => setStrokes([]);

    const handleMediaState = (data: ServerMediaStatePayload) => {
      setPeerMediaStates((prev) => {
        const next = new Map(prev);
        next.set(data.userId, { micOn: data.micOn, camOn: data.camOn });
        return next;
      });
    };

    const handleGestureEvent = (data: ServerGestureEventPayload) => {
      if (data.from) {
        setPeerGestures((prev) => {
          const next = new Map(prev);
          next.set(data.from, data.type);
          return next;
        });
      }
    };

    const handleScreenShare = (data: ServerScreenSharePayload) => {
      if (data.on) {
        setActivePresenter({ userId: data.userId, name: data.name });
      } else {
        setActivePresenter((curr) => (curr?.userId === data.userId ? null : curr));
      }
    };

    socketManager.on('chat_message', handleChat);
    socketManager.on('whiteboard_stroke', handleStroke);
    socketManager.on('whiteboard_clear', handleClear);
    socketManager.on('media_state', handleMediaState);
    socketManager.on('gesture_event', handleGestureEvent);
    socketManager.on('screen_share', handleScreenShare);

    return () => {
      socketManager.off('chat_message', handleChat);
      socketManager.off('whiteboard_stroke', handleStroke);
      socketManager.off('whiteboard_clear', handleClear);
      socketManager.off('media_state', handleMediaState);
      socketManager.off('gesture_event', handleGestureEvent);
      socketManager.off('screen_share', handleScreenShare);
    };
  }, [sessionId, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Full media cleanup on beforeunload / pagehide
  useEffect(() => {
    const handleUnload = () => {
      releaseAllMedia();
      if (sessionId) {
        socketManager.emit('leave_session', { sessionId });
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [releaseAllMedia, sessionId]);

  // 5. Engagement Ping Sender: every 15s sends engagement_ping { sessionId, active }
  // Active is true if tab is visible AND there was recent activity within last 30s
  useEffect(() => {
    if (!sessionId) return;

    let lastActivityTime = Date.now();

    const recordActivity = () => {
      lastActivityTime = Date.now();
    };

    window.addEventListener('mousemove', recordActivity);
    window.addEventListener('mousedown', recordActivity);
    window.addEventListener('keydown', recordActivity);
    window.addEventListener('touchstart', recordActivity);
    window.addEventListener('pointerdown', recordActivity);

    const pingInterval = window.setInterval(() => {
      const isVisible = !document.hidden;
      const isRecentlyActive = Date.now() - lastActivityTime <= 30000;
      const active = isVisible && isRecentlyActive;

      socketManager.emit('engagement_ping', {
        sessionId,
        active,
      });
    }, 15000);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('mousedown', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
      window.removeEventListener('pointerdown', recordActivity);
    };
  }, [sessionId]);

  const loadModel = useCallback(
    async (url: string) => {
      setCurrentModelUrl(url);
      await arRef.current?.loadModel(url);
      broadcastModelLoad(url);
    },
    [broadcastModelLoad]
  );

  const allModels = [
    ...SAMPLE_MODELS,
    ...assets.map((a) => ({ id: a.id, name: a.name, url: a.url, description: '' })),
  ];

  const goToSlide = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, allModels.length - 1));
      setCurrentSlideIdx(clamped);
      loadModel(allModels[clamped].url);
    },
    [allModels, loadModel]
  );

  useEffect(() => {
    if (!currentModelUrl) {
      setCurrentSlideIdx(-1);
      return;
    }
    const idx = allModels.findIndex((m) => m.url === currentModelUrl);
    if (idx >= 0) setCurrentSlideIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelUrl]);

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !sessionId) return;
    socketManager.emit('chat_message', { sessionId, message: chatInput.trim() });
    setChatInput('');
  };

  const handleStrokeAdd = (stroke: StrokeData) => {
    if (!sessionId) return;
    setStrokes((prev) => [...prev, stroke]);
    socketManager.emit('whiteboard_stroke', {
      sessionId,
      points: stroke.points,
      color: stroke.color,
      size: stroke.width,
      tool: stroke.tool === 'eraser' ? 'eraser' : 'pen',
    });
  };

  const clearWhiteboard = () => {
    setStrokes([]);
    if (sessionId) socketManager.emit('whiteboard_clear', { sessionId });
  };

  const handleAsk = async (prompt: string) => {
    if (!sessionId) return;
    setGeminiLoading(true);
    try {
      const res = await apiFetch<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ sessionId, message: prompt }),
      });
      setGeminiResponses((prev) => [
        ...prev,
        { answer: res.reply, timestamp: new Date().toISOString() },
      ]);
    } catch (err: any) {
      let msg = 'Gemini is unavailable right now.';
      if (err?.data?.detail) {
        msg = typeof err.data.detail === 'string' ? err.data.detail : (err.data.detail.detail || msg);
      } else if (err?.message) {
        msg = err.message;
      }
      setGeminiResponses((prev) => [
        ...prev,
        { answer: `⚠️ ${msg}`, timestamp: new Date().toISOString() },
      ]);
    } finally {
      setGeminiLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch<AssetItem>('/assets', { method: 'POST', body: form });
      setAssets((prev) => [...prev, res]);
      loadModel(res.url);
    } catch {
      // ignore upload error
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleToggleScreenShare = async () => {
    if (!sessionId) return;
    if (isScreenSharing) {
      stopScreenShare();
      socketManager.emit('screen_share', {
        sessionId,
        userId: user?.id ?? '',
        name: user?.name ?? 'User',
        on: false,
      });
      setActivePresenter(null);
    } else {
      if (activePresenter && activePresenter.userId !== user?.id && !isHost) {
        setShareNotice(`${activePresenter.name} is currently presenting.`);
        setTimeout(() => setShareNotice(null), 3000);
        return;
      }
      const stream = await startScreenShare();
      if (stream) {
        socketManager.emit('screen_share', {
          sessionId,
          userId: user?.id ?? '',
          name: user?.name ?? 'User',
          on: true,
        });
        setActivePresenter({ userId: user?.id ?? '', name: user?.name ?? 'You' });
      }
    }
  };

  const endSession = async () => {
    if (!sessionId || !isHost) return;
    if (isScreenSharing) {
      stopScreenShare();
      socketManager.emit('screen_share', {
        sessionId,
        userId: user?.id ?? '',
        name: user?.name ?? 'User',
        on: false,
      });
    }
    releaseAllMedia();
    await apiFetch(`/sessions/${sessionId}/end`, { method: 'POST' }).catch(() => {});
    navigate(`/session/${sessionId}/report`);
  };

  const leaveSession = () => {
    if (isScreenSharing && sessionId) {
      stopScreenShare();
      socketManager.emit('screen_share', {
        sessionId,
        userId: user?.id ?? '',
        name: user?.name ?? 'User',
        on: false,
      });
    }
    releaseAllMedia();
    navigate('/dashboard');
  };

  const copyRoomCode = () => {
    if (!session?.roomCode) return;
    navigator.clipboard.writeText(session.roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (loadingSession) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-purple-300 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-500" />
        <span className="text-xs font-medium tracking-wide">Connecting to HoloCollab Session…</span>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-purple-200 p-6">
        <div className="max-w-md w-full p-6 bg-slate-900/90 border border-purple-500/30 rounded-3xl shadow-2xl text-center flex flex-col items-center gap-4">
          <AlertCircle className="w-12 h-12 text-rose-400" />
          <h2 className="text-lg font-bold text-white">Session Unavailable</h2>
          <p className="text-xs text-purple-300/70">{sessionError}</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={fetchSessionData}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry</span>
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const panelOpen = sidePanel !== null && sidePanel !== 'gemini';

  // Presenter stream resolution for Share mode
  const presenterStream = activePresenter?.userId === user?.id
    ? screenStream
    : activePresenter?.userId
    ? remoteStreams.get(activePresenter.userId)?.stream
    : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none flex flex-col md:flex-row">
      {/* Share / Conflict Notice Toast */}
      {shareNotice && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-amber-500/90 text-slate-950 text-xs font-semibold rounded-xl shadow-2xl pointer-events-none animate-fade-in">
          {shareNotice}
        </div>
      )}

      {/* Main Viewport */}
      <div className="relative flex-1 h-full overflow-hidden flex flex-col">
        {/* ================= MODE 1: MEET MODE (Full Screen Video Grid) ================= */}
        {currentMode === 'meet' && (
          <div className="absolute inset-0 z-10 flex flex-col justify-center items-center p-3 md:p-6 bg-slate-950">
            <VideoGrid
              localStream={localStream}
              localVideoRef={localVideoRef}
              userName={user?.name ?? 'You'}
              micOn={micOn}
              camOn={camOn}
              remoteStreams={remoteStreams}
              layout="grid"
              className="w-full h-full"
            />
          </div>
        )}

        {/* ================= MODE 2: AR MODE (Transparent 3D Scene over User Camera) ================= */}
        {currentMode === 'ar' && (
          <>
            {/* Z-0: User's Own Camera Background */}
            {camOn && localStream ? (
              <video
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover z-0 -scale-x-100 pointer-events-none"
                ref={(el) => {
                  (localVideoRef as any).current = el;
                  if (el && el.srcObject !== localStream) {
                    el.srcObject = localStream;
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900 via-purple-950 to-slate-950 flex items-center justify-center pointer-events-none">
                <div className="text-center text-purple-300/50 text-sm">
                  Camera off — displaying virtual background
                </div>
              </div>
            )}

            {/* Z-10: Transparent AR Scene */}
            <div className="absolute inset-0 z-10">
              <ARSceneComponent
                ref={arRef}
                modelUrl={currentModelUrl || undefined}
                enableCamera={false}
                onTransformChange={onLocalTransformChange}
                onInteractionEnd={onLocalInteractionEnd}
                onPartSelect={(name) => onLocalPartSelect(name)}
                onFilterChange={onLocalFilterChange}
                className="w-full h-full bg-transparent"
              />
            </div>

            {/* Z-15: Other Participants Strip (right side overlay) */}
            {remoteStreams.size > 0 && (
              <div className="absolute top-20 right-4 z-15 w-40 max-h-[60vh] pointer-events-auto">
                <VideoGrid
                  localStream={null}
                  localVideoRef={localVideoRef}
                  userName={user?.name ?? 'You'}
                  micOn={micOn}
                  camOn={camOn}
                  remoteStreams={remoteStreams}
                  layout="strip"
                />
              </div>
            )}
          </>
        )}

        {/* ================= MODE 3: SHARE MODE (Active Screen Presenter) ================= */}
        {currentMode === 'share' && (
          <div className="absolute inset-0 z-10 flex flex-col md:flex-row bg-slate-950">
            {/* Main Presenter Display */}
            <div className="relative flex-1 h-full flex flex-col justify-center items-center p-3">
              <div className="relative w-full h-full max-h-[82vh] bg-black rounded-2xl overflow-hidden border border-purple-500/30 flex items-center justify-center shadow-2xl">
                {presenterStream ? (
                  <video
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                    ref={(el) => {
                      if (el && el.srcObject !== presenterStream) {
                        el.srcObject = presenterStream;
                      }
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-purple-300/70 text-sm gap-2">
                    <Monitor className="w-10 h-10 text-purple-400 animate-pulse" />
                    <span>Connecting to screen stream…</span>
                  </div>
                )}

                {/* Presenting Badge & Stop Button */}
                <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-purple-500/30 text-xs shadow-lg">
                  <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-purple-100 font-medium">
                    {activePresenter?.userId === user?.id ? 'You are presenting' : `${activePresenter?.name || 'Someone'} is presenting`}
                  </span>
                  {(activePresenter?.userId === user?.id || isHost) && (
                    <button
                      onClick={handleToggleScreenShare}
                      className="ml-2 px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-semibold transition"
                    >
                      Stop sharing
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Participants Strip on Right */}
            <div className="w-full md:w-48 max-h-36 md:max-h-full p-2 overflow-y-auto flex-shrink-0 z-15">
              <VideoGrid
                localStream={localStream}
                localVideoRef={localVideoRef}
                userName={user?.name ?? 'You'}
                micOn={micOn}
                camOn={camOn}
                remoteStreams={remoteStreams}
                layout="strip"
              />
            </div>
          </div>
        )}

        {/* Z-ORDER LAYER 20: Whiteboard Canvas Overlay */}
        <div className={`absolute inset-0 z-20 ${whiteboardActive ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <Whiteboard
            onStrokeAdd={handleStrokeAdd}
            onClear={clearWhiteboard}
            externalStrokes={strokes}
            isActive={whiteboardActive}
            onToggleActive={setWhiteboardActive}
            arSceneRef={arRef}
          />
        </div>

        {/* Z-ORDER LAYER 25: Hand Overlay (Gestures) */}
        {gesturesEnabled && (
          <div className="absolute inset-0 z-25 pointer-events-none">
            <HandOverlay
              videoRef={localVideoRef}
              allHands={allHands}
              gesture={currentGesture}
              fps={gestureFps}
              latencyMs={gestureLatencyMs}
              isEnabled={gesturesEnabled}
              className="w-full h-full"
            />
          </div>
        )}

        {/* Z-ORDER LAYER 30: Top Info & Status Bar */}
        <header className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
          {/* Left: Room Code & Connection Chip with Error Tooltip */}
          <div
            className="flex items-center gap-2 pointer-events-auto bg-slate-900/85 backdrop-blur-md border border-purple-500/30 px-3 py-1.5 rounded-2xl shadow-lg relative group"
            title={connectionError ? `Connection Error: ${connectionError} (retry ${retryCount})` : `Socket: ${connStatus}`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  connStatus === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : connStatus === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-[10px] text-purple-300 font-mono capitalize">{connStatus}</span>
            </div>

            <div className="w-[1px] h-3 bg-purple-500/30" />

            <span className="text-xs font-mono font-bold text-purple-100">{session?.roomCode ?? '------'}</span>

            <button
              onClick={copyRoomCode}
              className="p-1 hover:bg-white/10 rounded text-purple-300 hover:text-white transition"
              title="Copy Room Code"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            </button>

            {/* Error tooltip if disconnected */}
            {connectionError && (
              <div className="absolute top-full mt-2 left-0 hidden group-hover:block z-50 px-3 py-1.5 bg-rose-950/90 border border-rose-500/50 rounded-xl text-[10px] text-rose-200 shadow-xl whitespace-nowrap">
                {connectionError}
              </div>
            )}
          </div>

          {/* Status Chips: Camera & Hand Tracking */}
          <div className="flex items-center gap-2 pointer-events-auto bg-slate-900/85 backdrop-blur-md border border-purple-500/30 px-3 py-1.5 rounded-2xl shadow-lg text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  cameraChipStatus === 'on'
                    ? 'bg-emerald-400'
                    : cameraChipStatus === 'in use'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-purple-200">Camera: <strong className="capitalize">{cameraChipStatus}</strong></span>
            </div>

            <div className="w-[1px] h-3 bg-purple-500/30" />

            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  handTrackingStatus === 'ready'
                    ? 'bg-emerald-400'
                    : handTrackingStatus === 'loading'
                    ? 'bg-amber-400 animate-pulse'
                    : handTrackingStatus === 'failed'
                    ? 'bg-rose-500 animate-pulse'
                    : 'bg-slate-400'
                }`}
              />
              <span className="text-purple-200">Hand tracking: <strong className="capitalize">{handTrackingStatus}</strong></span>
            </div>
          </div>

          {/* Center: Slide Switcher for Educator */}
          {isHost && allModels.length > 0 && currentMode === 'ar' && (
            <div className="hidden sm:flex items-center gap-1 pointer-events-auto bg-slate-900/85 backdrop-blur-md border border-purple-500/30 p-1 rounded-2xl shadow-lg">
              <button
                onClick={() => goToSlide(currentSlideIdx - 1)}
                disabled={currentSlideIdx === 0}
                className="p-1 text-purple-300 hover:text-white rounded hover:bg-white/10 transition disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                value={currentSlideIdx}
                onChange={(e) => goToSlide(Number(e.target.value))}
                className="bg-transparent text-purple-100 text-xs px-2 py-0.5 focus:outline-none cursor-pointer max-w-[150px]"
              >
                {allModels.map((m, idx) => (
                  <option key={m.id} value={idx} className="bg-slate-900 text-white">
                    {idx + 1}. {m.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => goToSlide(currentSlideIdx + 1)}
                disabled={currentSlideIdx >= allModels.length - 1}
                className="p-1 text-purple-300 hover:text-white rounded hover:bg-white/10 transition disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Right: Remote Control Indicator */}
          {controlledBy && (
            <div className="pointer-events-auto flex items-center gap-2 px-3 py-1 bg-amber-500/20 backdrop-blur-md border border-amber-500/40 rounded-xl text-xs text-amber-200 shadow-xl">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Controlled by <strong>{controlledBy}</strong></span>
            </div>
          )}
        </header>

        {/* Gemini Floating Assistant */}
        {sidePanel === 'gemini' && (
          <div className="absolute top-16 right-4 z-40 pointer-events-auto">
            <GeminiAssistant
              onAsk={handleAsk}
              responses={geminiResponses}
              isOpen
              onClose={() => setSidePanel(null)}
            />
            {geminiLoading && (
              <div className="mt-2 text-center text-[11px] text-cyan-400 animate-pulse">
                Gemini is thinking…
              </div>
            )}
          </div>
        )}

        {/* Media & Hand Tracking Error Notices */}
        {(mediaError || gestureError) && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-amber-950/90 border border-amber-500/50 rounded-2xl text-[11px] text-amber-200 shadow-2xl pointer-events-auto flex items-center gap-3">
            <div className="flex flex-col">
              {mediaError && <span>{mediaError}</span>}
              {gestureError && <span className="text-rose-300">{gestureError}</span>}
            </div>
            <button
              onClick={restartCamera}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1 flex-shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Restart camera</span>
            </button>
          </div>
        )}

        {/* Z-ORDER LAYER 30: Bottom Responsive Control Bar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-2xl border border-purple-500/30 shadow-2xl max-w-[95vw] overflow-x-auto">
          {/* Media Controls: Mic & Cam */}
          <button
            onClick={toggleMic}
            className={`p-2 rounded-xl transition ${
              micOn ? 'bg-purple-600/70 hover:bg-purple-500 text-white' : 'bg-rose-600/80 hover:bg-rose-500 text-white'
            }`}
            title={micOn ? 'Mute Microphone' : 'Unmute Microphone'}
          >
            {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleCam}
            className={`p-2 rounded-xl transition ${
              camOn ? 'bg-purple-600/70 hover:bg-purple-500 text-white' : 'bg-rose-600/80 hover:bg-rose-500 text-white'
            }`}
            title={camOn ? 'Turn Off Camera' : 'Turn On Camera'}
          >
            {camOn ? <VideoIcon className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>

          {/* Restart Camera Button */}
          <button
            onClick={restartCamera}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-white transition border border-purple-500/20"
            title="Restart Camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Share Screen Button (hidden if getDisplayMedia unavailable) */}
          {Boolean(navigator.mediaDevices?.getDisplayMedia) && (
            <button
              onClick={handleToggleScreenShare}
              className={`p-2 rounded-xl border transition ${
                isScreenSharing
                  ? 'bg-emerald-600 border-emerald-400 text-white'
                  : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
              }`}
              title={isScreenSharing ? 'Stop Sharing Screen' : 'Share Screen'}
            >
              {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>
          )}

          <div className="w-[1px] h-5 bg-purple-500/30" />

          {/* Gestures Toggle */}
          <button
            onClick={() => setGesturesEnabled(!gesturesEnabled)}
            className={`p-2 rounded-xl border transition ${
              gesturesEnabled
                ? 'bg-emerald-600/80 border-emerald-400 text-white'
                : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title={gesturesEnabled ? 'Hand Gestures Active' : 'Enable Hand Gestures'}
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {/* Whiteboard Toggle */}
          <button
            onClick={() => setWhiteboardActive(!whiteboardActive)}
            className={`p-2 rounded-xl border transition ${
              whiteboardActive
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title={whiteboardActive ? 'Hide Whiteboard' : 'Open Whiteboard'}
          >
            <PenLine className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-5 bg-purple-500/30" />

          {/* Chat Drawer */}
          <button
            onClick={() => setSidePanel((p) => (p === 'chat' ? null : 'chat'))}
            className={`p-2 rounded-xl border transition ${
              sidePanel === 'chat'
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title="Chat Messages"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Participants Drawer */}
          <button
            onClick={() => setSidePanel((p) => (p === 'participants' ? null : 'participants'))}
            className={`p-2 rounded-xl border transition ${
              sidePanel === 'participants'
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title="Participants List"
          >
            <Users className="w-4 h-4" />
          </button>

          {/* AI Assistant */}
          <button
            onClick={() => setSidePanel((p) => (p === 'gemini' ? null : 'gemini'))}
            className={`p-2 rounded-xl border transition ${
              sidePanel === 'gemini'
                ? 'bg-cyan-600 border-cyan-400 text-white'
                : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title="Gemini AI Assistant"
          >
            <Bot className="w-4 h-4" />
          </button>

          {/* Models Panel (Host Only) */}
          {isHost && (
            <>
              <button
                onClick={() => setSidePanel((p) => (p === 'models' ? null : 'models'))}
                className={`p-2 rounded-xl border transition ${
                  sidePanel === 'models' || Boolean(currentModelUrl)
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-slate-800 border-purple-500/20 text-purple-300 hover:text-white'
                }`}
                title="3D Models & AR Mode"
              >
                <Box className="w-4 h-4" />
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".glb"
                onChange={handleUpload}
                className="hidden"
              />
            </>
          )}

          <div className="w-[1px] h-5 bg-purple-500/30" />

          {/* Share Room Code */}
          <button
            onClick={copyRoomCode}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-white transition border border-purple-500/20"
            title="Copy Room Code"
          >
            {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
          </button>

          {/* Leave / End */}
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="p-2 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white transition border border-rose-500/30"
            title={isHost ? 'End Session for Everyone' : 'Leave Session'}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Leave Confirmation Dialog */}
        {showLeaveConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto p-4">
            <div className="max-w-sm w-full bg-slate-900 border border-purple-500/40 p-5 rounded-2xl shadow-2xl flex flex-col gap-3">
              <h3 className="text-sm font-bold text-white">
                {isHost ? 'End Session for Everyone?' : 'Leave Session?'}
              </h3>
              <p className="text-xs text-purple-300/70">
                {isHost
                  ? 'Ending the session will conclude collaboration for everyone and open the post-session report.'
                  : 'Are you sure you want to return to your dashboard?'}
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowLeaveConfirm(false);
                    if (isHost) endSession();
                    else leaveSession();
                  }}
                  className="px-3 py-1.5 text-xs text-white bg-rose-600 hover:bg-rose-500 rounded-xl font-medium"
                >
                  {isHost ? 'End Session' : 'Leave'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Side Panels (Desktop Drawer / Mobile Bottom Sheet) */}
      <aside
        className={`flex-shrink-0 transition-all duration-300 ${
          panelOpen ? 'w-full md:w-80 h-72 md:h-full' : 'w-0 h-0'
        } bg-slate-900/95 backdrop-blur-md border-t md:border-t-0 md:border-l border-purple-500/20 flex flex-col overflow-hidden z-40`}
      >
        {sidePanel === 'models' && isHost && (
          <div className="flex flex-col h-full w-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-purple-100">3D Models (AR Mode)</span>
              </div>
              <button onClick={() => setSidePanel(null)} className="text-slate-400 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Option to clear model and return to Meet Mode */}
              <button
                onClick={() => {
                  loadModel('');
                  setSidePanel(null);
                }}
                className={`w-full text-left p-3 rounded-2xl border transition ${
                  !currentModelUrl
                    ? 'bg-purple-950/50 border-purple-400 shadow-md'
                    : 'bg-slate-800/80 border-slate-700 hover:border-purple-500/40'
                }`}
              >
                <div className="text-xs font-bold text-white mb-0.5">No model (Meet Mode)</div>
                <div className="text-[10px] text-purple-300/70">
                  Switch the entire room back to full-screen video grid.
                </div>
              </button>

              <div className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider pt-2">
                Sample Models
              </div>
              {SAMPLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    loadModel(m.url);
                    setSidePanel(null);
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border transition ${
                    currentModelUrl === m.url
                      ? 'bg-purple-950/60 border-purple-400 shadow-lg'
                      : 'bg-slate-800/60 border-purple-500/15 hover:border-purple-500/40'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{m.name}</div>
                  <div className="text-[10px] text-purple-300/60 line-clamp-1">{m.description}</div>
                </button>
              ))}

              {assets.length > 0 && (
                <>
                  <div className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider pt-2">
                    Uploaded Models
                  </div>
                  {assets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        loadModel(a.url);
                        setSidePanel(null);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition ${
                        currentModelUrl === a.url
                          ? 'bg-purple-950/60 border-purple-400 shadow-lg'
                          : 'bg-slate-800/60 border-purple-500/15 hover:border-purple-500/40'
                      }`}
                    >
                      <div className="text-xs font-semibold text-white">{a.name}</div>
                    </button>
                  ))}
                </>
              )}

              <div className="pt-2">
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs shadow-md transition disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>{uploading ? 'Uploading .glb…' : 'Upload custom .glb'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {sidePanel === 'participants' && (
          <ParticipantsPanel
            participants={participants}
            peerMediaStates={peerMediaStates}
            peerGestures={peerGestures}
            hostId={session?.hostId}
            onClose={() => setSidePanel(null)}
          />
        )}

        {sidePanel === 'chat' && (
          <ChatPanel
            messages={chatMessages}
            chatInput={chatInput}
            onInputChange={setChatInput}
            onSend={sendChat}
            chatEndRef={chatEndRef}
            userName={user?.name ?? ''}
            onClose={() => setSidePanel(null)}
          />
        )}
      </aside>
    </div>
  );
};

const ParticipantsPanel: React.FC<{
  participants: ParticipantsUpdatePayload['participants'];
  peerMediaStates: Map<string, { micOn: boolean; camOn: boolean }>;
  peerGestures: Map<string, string>;
  hostId?: string;
  onClose: () => void;
}> = ({ participants, peerMediaStates, peerGestures, hostId, onClose }) => (
  <div className="flex flex-col h-full w-full">
    <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-purple-100">Participants</span>
        <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">
          {participants.length}
        </span>
      </div>
      <button onClick={onClose} className="text-slate-400 hover:text-white transition">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {participants.length === 0 ? (
        <p className="text-center text-xs text-purple-300/50 italic mt-8">No participants yet</p>
      ) : (
        participants.map((p) => {
          const media = peerMediaStates.get(p.id) || { micOn: true, camOn: true };
          const gesture = peerGestures.get(p.id);
          const isUserHost = p.id === hostId || p.role === 'educator';

          return (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-2 bg-purple-950/30 border border-purple-500/15 rounded-xl"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-purple-100 truncate">{p.name}</span>
                  {isUserHost && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-semibold">
                      Host
                    </span>
                  )}
                  {gesture && gesture !== 'none' && (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded uppercase font-bold">
                      {gesture}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-purple-300/60 capitalize">{p.role}</div>
              </div>

              {/* Mic & Cam icons */}
              <div className="flex items-center gap-1.5 text-slate-400">
                {media.micOn ? (
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-rose-400" />
                )}
                {media.camOn ? (
                  <VideoIcon className="w-3.5 h-3.5 text-purple-300" />
                ) : (
                  <VideoOff className="w-3.5 h-3.5 text-rose-400" />
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
);

const ChatPanel: React.FC<{
  messages: ServerChatMessagePayload[];
  chatInput: string;
  onInputChange: (v: string) => void;
  onSend: (e: React.FormEvent) => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  userName: string;
  onClose: () => void;
}> = ({ messages, chatInput, onInputChange, onSend, chatEndRef, userName, onClose }) => (
  <div className="flex flex-col h-full w-full">
    <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-purple-100">Session Chat</span>
      </div>
      <button onClick={onClose} className="text-slate-400 hover:text-white transition">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {messages.length === 0 ? (
        <p className="text-center text-xs text-purple-300/50 italic mt-8">No messages yet. Say hi!</p>
      ) : (
        messages.map((msg) => {
          const isMine = msg.name === userName;
          return (
            <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  isMine
                    ? 'bg-purple-600 text-white rounded-br-sm'
                    : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm'
                }`}
              >
                {!isMine && (
                  <span className="block text-[10px] font-semibold text-purple-400 mb-0.5">
                    {msg.name}
                  </span>
                )}
                {msg.message}
              </div>
              <span className="text-[9px] text-slate-500 mt-0.5 px-1">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })
      )}
      <div ref={chatEndRef} />
    </div>
    <form onSubmit={onSend} className="p-3 border-t border-purple-500/20 flex gap-2">
      <input
        type="text"
        value={chatInput}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Type a message…"
        className="flex-1 bg-slate-800/80 border border-purple-500/30 rounded-xl px-3 py-2 text-xs text-purple-100 placeholder-purple-300/40 focus:outline-none focus:border-purple-500"
      />
      <button
        type="submit"
        disabled={!chatInput.trim()}
        className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition"
      >
        Send
      </button>
    </form>
  </div>
);

export default SessionPage;
