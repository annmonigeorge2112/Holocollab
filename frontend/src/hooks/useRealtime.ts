import { useEffect, useRef, useState, useCallback } from 'react';
import { socketManager } from '../services/SocketManager';
import { ARSceneHandle } from '../components/ARScene';
import { TransformState, FilterMode } from '../services/ARScene';
import {
  ServerModelTransformPayload,
  ServerModelLoadPayload,
  ServerPartSelectPayload,
  ServerModelFilterPayload,
  ParticipantsUpdatePayload,
} from '../types/events';

export interface UseRealtimeOptions {
  sessionId: string;
  token?: string | null;
  userName?: string;
  arSceneRef: React.RefObject<ARSceneHandle | null>;
  onModelLoaded?: (assetUrl: string, by: string) => void;
  onRemotePartSelect?: (path: string | null) => void;
  onRemoteFilter?: (filter: FilterMode) => void;
}

export interface UseRealtimeReturn {
  isConnected: boolean;
  connectionError: string | null;
  retryCount: number;
  reconnect: () => void;
  controlledBy: string | null;
  participants: ParticipantsUpdatePayload['participants'];
  broadcastTransform: (transform: TransformState, isEnd?: boolean) => void;
  broadcastModelLoad: (assetUrl: string) => void;
  broadcastPartSelect: (path: string | null) => void;
  broadcastModelFilter: (filter: FilterMode) => void;
  broadcastHighlight: (name: string) => void;
  onLocalTransformChange: (transform: TransformState) => void;
  onLocalPartSelect: (path: string | null) => void;
  onLocalFilterChange: (filter: FilterMode) => void;
  onLocalInteractionEnd: () => void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVector(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function useRealtime({
  sessionId,
  token,
  userName = 'User',
  arSceneRef,
  onModelLoaded,
  onRemotePartSelect,
  onRemoteFilter,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [controlledBy, setControlledBy] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantsUpdatePayload['participants']>([]);

  const reconnect = useCallback(() => {
    if (!token) return;
    setConnectionError(null);
    const socket = socketManager.connect(token);
    if (!socket.connected) {
      socket.connect();
    }
  }, [token]);

  // Guard against echo loops: true when applying remote transforms or selections
  const isApplyingRemoteRef = useRef(false);

  // Throttling: max 20 emits per second (min interval 50ms)
  const lastEmitTimeRef = useRef(0);
  const pendingTransformRef = useRef<TransformState | null>(null);
  const throttleTimerRef = useRef<number | null>(null);

  // ControlledBy clear timer
  const controlTimeoutRef = useRef<number | null>(null);

  // Interpolation animation frame ID
  const lerpAnimationIdRef = useRef<number | null>(null);

  // Connect to Socket.IO and join room
  useEffect(() => {
    if (!sessionId || !token) return;

    const socket = socketManager.connect(token);

    const handleConnect = () => {
      setIsConnected(true);
      setConnectionError(null);
      setRetryCount(0);
      socketManager.emit('join_session', { sessionId, token });
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleConnectError = (err: Error) => {
      setIsConnected(false);
      setConnectionError(err.message || 'Connection failed');
      setRetryCount((prev) => prev + 1);
    };

    const handleReconnectAttempt = (attempt: number) => {
      setRetryCount(attempt);
    };

    const handleParticipantsUpdate = (data: ParticipantsUpdatePayload) => {
      setParticipants(data.participants || []);
    };

    const handleModelLoad = (data: ServerModelLoadPayload) => {
      if (data.assetUrl && arSceneRef.current) {
        arSceneRef.current.loadModel(data.assetUrl);
        // Reset part selection locally without re-emitting
        isApplyingRemoteRef.current = true;
        arSceneRef.current.selectPart(null);
        isApplyingRemoteRef.current = false;
        onModelLoaded?.(data.assetUrl, data.by);
      } else if (!data.assetUrl) {
        if (arSceneRef.current) {
          isApplyingRemoteRef.current = true;
          arSceneRef.current.selectPart(null);
          isApplyingRemoteRef.current = false;
        }
        onModelLoaded?.('', data.by);
      }
    };

    const handleModelTransform = (data: ServerModelTransformPayload) => {
      // Ignore transforms originated by self (last-writer-wins)
      if (data.by === userName) return;

      // Update "controlled by" indicator and reset auto-clear timer
      setControlledBy(data.by || 'Someone');
      if (controlTimeoutRef.current !== null) {
        window.clearTimeout(controlTimeoutRef.current);
      }
      controlTimeoutRef.current = window.setTimeout(() => {
        setControlledBy(null);
      }, 1500);

      // Smoothly interpolate incoming transform over ~100ms
      const targetTransform: TransformState = {
        position: data.position,
        rotation: data.rotation,
        scale: data.scale,
      };

      if (!arSceneRef.current) return;

      const startTransform = arSceneRef.current.getTransform();
      const startTime = performance.now();
      const duration = 100;

      if (lerpAnimationIdRef.current !== null) {
        cancelAnimationFrame(lerpAnimationIdRef.current);
      }

      const animateLerp = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        // Smooth ease-out quad
        const ease = 1 - (1 - progress) * (1 - progress);

        const currentPos = lerpVector(startTransform.position, targetTransform.position, ease);
        const currentRot = lerpVector(startTransform.rotation, targetTransform.rotation, ease);
        const currentScale = lerp(startTransform.scale, targetTransform.scale, ease);

        // Guard against echo loops
        isApplyingRemoteRef.current = true;
        arSceneRef.current?.setTransform({
          position: currentPos,
          rotation: currentRot,
          scale: currentScale,
        });
        isApplyingRemoteRef.current = false;

        if (progress < 1) {
          lerpAnimationIdRef.current = requestAnimationFrame(animateLerp);
        } else {
          lerpAnimationIdRef.current = null;
        }
      };

      lerpAnimationIdRef.current = requestAnimationFrame(animateLerp);
    };

    const handlePartSelect = (data: ServerPartSelectPayload) => {
      if (data.by === userName) return;
      if (arSceneRef.current) {
        isApplyingRemoteRef.current = true;
        arSceneRef.current.selectPart(data.path);
        isApplyingRemoteRef.current = false;
        onRemotePartSelect?.(data.path);
      }
    };

    const handleModelFilter = (data: ServerModelFilterPayload) => {
      if (data.by === userName) return;
      if (arSceneRef.current) {
        isApplyingRemoteRef.current = true;
        arSceneRef.current.setFilter(data.filter);
        isApplyingRemoteRef.current = false;
        onRemoteFilter?.(data.filter);
      }
    };

    const handleHighlightObject = (data: { name: string; by: string }) => {
      if (arSceneRef.current) {
        if (data.name) {
          arSceneRef.current.selectPart(data.name);
        } else {
          arSceneRef.current.selectPart(null);
        }
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError as any);
    socket.io?.on('reconnect_attempt', handleReconnectAttempt);
    socketManager.on('participants_update', handleParticipantsUpdate);
    socketManager.on('model_load', handleModelLoad);
    socketManager.on('model_transform', handleModelTransform);
    socketManager.on('part_select', handlePartSelect);
    socketManager.on('model_filter', handleModelFilter);
    socketManager.on('highlight_object', handleHighlightObject);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socketManager.emit('leave_session', { sessionId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError as any);
      socket.io?.off('reconnect_attempt', handleReconnectAttempt);
      socketManager.off('participants_update', handleParticipantsUpdate);
      socketManager.off('model_load', handleModelLoad);
      socketManager.off('model_transform', handleModelTransform);
      socketManager.off('part_select', handlePartSelect);
      socketManager.off('model_filter', handleModelFilter);
      socketManager.off('highlight_object', handleHighlightObject);

      if (controlTimeoutRef.current !== null) {
        window.clearTimeout(controlTimeoutRef.current);
      }
      if (lerpAnimationIdRef.current !== null) {
        cancelAnimationFrame(lerpAnimationIdRef.current);
      }
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, [sessionId, token, userName, arSceneRef, onModelLoaded, onRemotePartSelect, onRemoteFilter]);

  // Local interaction emit with <= 20/sec throttle and end flush
  const emitTransformNow = useCallback(
    (transform: TransformState) => {
      if (!sessionId) return;
      lastEmitTimeRef.current = performance.now();
      socketManager.emit('model_transform', {
        sessionId,
        position: transform.position,
        rotation: transform.rotation,
        scale: transform.scale,
        by: userName,
      });
      pendingTransformRef.current = null;
    },
    [sessionId, userName]
  );

  const broadcastTransform = useCallback(
    (transform: TransformState, isEnd: boolean = false) => {
      // Guard against echo loops
      if (isApplyingRemoteRef.current) return;

      // Local interaction immediately overrides remote controlledBy (last-writer-wins)
      setControlledBy(null);

      const now = performance.now();
      const timeSinceLast = now - lastEmitTimeRef.current;

      if (isEnd) {
        if (throttleTimerRef.current !== null) {
          window.clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        emitTransformNow(transform);
        return;
      }

      pendingTransformRef.current = transform;

      // Throttle to 20 times per second (50ms interval)
      if (timeSinceLast >= 50) {
        emitTransformNow(transform);
      } else if (throttleTimerRef.current === null) {
        const wait = 50 - timeSinceLast;
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingTransformRef.current) {
            emitTransformNow(pendingTransformRef.current);
          }
        }, wait);
      }
    },
    [emitTransformNow]
  );

  const onLocalTransformChange = useCallback(
    (transform: TransformState) => {
      broadcastTransform(transform, false);
    },
    [broadcastTransform]
  );

  const onLocalInteractionEnd = useCallback(() => {
    if (arSceneRef.current) {
      broadcastTransform(arSceneRef.current.getTransform(), true);
    }
  }, [arSceneRef, broadcastTransform]);

  const broadcastPartSelect = useCallback(
    (path: string | null) => {
      if (!sessionId || isApplyingRemoteRef.current) return;
      socketManager.emit('part_select', {
        sessionId,
        path,
        by: userName,
      });
    },
    [sessionId, userName]
  );

  const broadcastModelFilter = useCallback(
    (filter: FilterMode) => {
      if (!sessionId || isApplyingRemoteRef.current) return;
      socketManager.emit('model_filter', {
        sessionId,
        filter,
        by: userName,
      });
    },
    [sessionId, userName]
  );

  const onLocalPartSelect = useCallback(
    (path: string | null) => {
      broadcastPartSelect(path);
    },
    [broadcastPartSelect]
  );

  const onLocalFilterChange = useCallback(
    (filter: FilterMode) => {
      broadcastModelFilter(filter);
    },
    [broadcastModelFilter]
  );

  const broadcastModelLoad = useCallback(
    (assetUrl: string) => {
      if (!sessionId) return;
      socketManager.emit('model_load', { sessionId, assetUrl });
    },
    [sessionId]
  );

  const broadcastHighlight = useCallback(
    (name: string) => {
      if (!sessionId) return;
      socketManager.emit('highlight_object', { sessionId, name });
    },
    [sessionId]
  );

  return {
    isConnected,
    connectionError,
    retryCount,
    reconnect,
    controlledBy,
    participants,
    broadcastTransform,
    broadcastModelLoad,
    broadcastPartSelect,
    broadcastModelFilter,
    broadcastHighlight,
    onLocalTransformChange,
    onLocalPartSelect,
    onLocalFilterChange,
    onLocalInteractionEnd,
  };
}
