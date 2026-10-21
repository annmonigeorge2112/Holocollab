import { useEffect, useRef, useState, useCallback } from 'react';
import { socketManager } from '../services/SocketManager';
import { ServerMediaStatePayload } from '../types/events';

export interface RemoteParticipantMedia {
  stream: MediaStream;
  name: string;
  micOn: boolean;
  camOn: boolean;
  audioOnly?: boolean;
}

export type MediaSessionStatus = 'idle' | 'initializing' | 'connected' | 'error';

export interface UseMediaSessionReturn {
  localStream: MediaStream | null;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteStreams: Map<string, RemoteParticipantMedia>;
  micOn: boolean;
  camOn: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  screenStream: MediaStream | null;
  isScreenSharing: boolean;
  startScreenShare: () => Promise<MediaStream | null>;
  stopScreenShare: () => void;
  restartCamera: () => Promise<void>;
  releaseAllMedia: () => void;
  error: string | null;
  status: MediaSessionStatus;
}

// Global serialisation promise to prevent concurrent getUserMedia calls
export let globalGUMQueue: Promise<any> = Promise.resolve();
export let lastMediaReleaseTime = 0;

const getIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUser = import.meta.env.VITE_TURN_USER || import.meta.env.VITE_TURN_USERNAME;
  const turnPass = import.meta.env.VITE_TURN_PASS || import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl) {
    const turnConfig: RTCIceServer = { urls: turnUrl };
    if (turnUser) turnConfig.username = turnUser;
    if (turnPass) turnConfig.credential = turnPass;
    servers.push(turnConfig);
  }
  return servers;
};

const VIDEO_CAP = 6;

export const useMediaSession = (sessionId: string, userId?: string): UseMediaSessionReturn => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteParticipantMedia>>(new Map());
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MediaSessionStatus>('idle');

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenSendersRef = useRef<Map<string, RTCRtpSender[]>>(new Map());

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceCandidatesQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const participantNamesRef = useRef<Map<string, string>>(new Map());
  const mediaStatesRef = useRef<Map<string, { micOn: boolean; camOn: boolean }>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const knownParticipantsRef = useRef<Set<string>>(new Set());

  // Attach local stream to ref video when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  // Broadcast local media state changes
  const broadcastMediaState = useCallback(
    (newMic: boolean, newCam: boolean) => {
      if (!sessionId || !userId) return;
      socketManager.emit('media_state', {
        sessionId,
        userId,
        micOn: newMic,
        camOn: newCam,
      });
    },
    [sessionId, userId]
  );

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;
    const nextMic = !micOn;
    audioTracks.forEach((t) => {
      t.enabled = nextMic;
    });
    setMicOn(nextMic);
    broadcastMediaState(nextMic, camOn);
  }, [micOn, camOn, broadcastMediaState]);

  const toggleCam = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;
    const nextCam = !camOn;
    videoTracks.forEach((t) => {
      t.enabled = nextCam;
    });
    setCamOn(nextCam);
    broadcastMediaState(micOn, nextCam);
  }, [micOn, camOn, broadcastMediaState]);

  // Stop Screen Share
  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    setIsScreenSharing(false);

    // Remove screen senders from all peer connections and renegotiate
    peersRef.current.forEach((pc, targetId) => {
      const senders = screenSendersRef.current.get(targetId) || [];
      senders.forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch {}
      });
      screenSendersRef.current.delete(targetId);

      // Renegotiate offer
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (pc.localDescription) {
            socketManager.emit('rtc_offer', {
              to: targetId,
              payload: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
            });
          }
        })
        .catch(() => {});
    });
  }, []);

  // Start Screen Share with getDisplayMedia
  const startScreenShare = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not supported on this device/browser.');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsScreenSharing(true);

      // Listen for browser native "Stop sharing" bar/button
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          stopScreenShare();
        };
      });

      // Add tracks to all peer connections and renegotiate
      peersRef.current.forEach(async (pc, targetId) => {
        const addedSenders: RTCRtpSender[] = [];
        stream.getTracks().forEach((track) => {
          try {
            const sender = pc.addTrack(track, stream);
            addedSenders.push(sender);
          } catch {}
        });
        screenSendersRef.current.set(targetId, addedSenders);

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketManager.emit('rtc_offer', {
            to: targetId,
            payload: { type: offer.type, sdp: offer.sdp },
          });
        } catch (err) {
          console.warn('Renegotiation failed for screen share:', targetId, err);
        }
      });

      return stream;
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setError(`Screen share failed: ${err.message || 'unknown error'}`);
      }
      return null;
    }
  }, [stopScreenShare]);

  // Create a peer connection with peerId (target user ID)
  const createPeerConnection = useCallback(
    (targetUserId: string): RTCPeerConnection => {
      const existing = peersRef.current.get(targetUserId);
      if (existing) {
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
      peersRef.current.set(targetUserId, pc);

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // If screen share is active, also add screen tracks
      if (screenStreamRef.current) {
        const addedSenders: RTCRtpSender[] = [];
        screenStreamRef.current.getTracks().forEach((track) => {
          try {
            const sender = pc.addTrack(track, screenStreamRef.current!);
            addedSenders.push(sender);
          } catch {}
        });
        screenSendersRef.current.set(targetUserId, addedSenders);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketManager.emit('rtc_ice', {
            to: targetUserId,
            payload: event.candidate.toJSON() as unknown as Record<string, unknown>,
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          const name = participantNamesRef.current.get(targetUserId) || 'Participant';
          const mState = mediaStatesRef.current.get(targetUserId) || { micOn: true, camOn: true };

          const count = next.size;
          const isAudioOnly = count >= VIDEO_CAP;

          next.set(targetUserId, {
            stream,
            name,
            micOn: mState.micOn,
            camOn: isAudioOnly ? false : mState.camOn,
            audioOnly: isAudioOnly,
          });
          return next;
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          pc.close();
          peersRef.current.delete(targetUserId);
        }
      };

      return pc;
    },
    []
  );

  // Comprehensive media release function
  const releaseAllMedia = useCallback(() => {
    // 1. Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // 2. Pause and clear local video preview element
    if (localVideoRef.current) {
      try {
        localVideoRef.current.pause();
        localVideoRef.current.srcObject = null;
      } catch {}
    }

    // 3. Stop screen share
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    setIsScreenSharing(false);

    // 4. Close all peer connections and clear maps
    peersRef.current.forEach((pc) => {
      try {
        pc.getSenders().forEach((s) => {
          try {
            pc.removeTrack(s);
          } catch {}
        });
        pc.close();
      } catch {}
    });
    peersRef.current.clear();
    screenSendersRef.current.clear();
    iceCandidatesQueueRef.current.clear();
    setRemoteStreams(new Map());

    lastMediaReleaseTime = Date.now();
    setStatus('idle');
  }, []);

  // Acquire media with serialisation, delay after previous release, and NotReadable/Abort retry
  const acquireMedia = useCallback(async (isCancelledFn: () => boolean): Promise<MediaStream | null> => {
    // Serialise via global queue
    const runAcquire = async (): Promise<MediaStream | null> => {
      // If previous release happened recently (< 300ms), wait until camera hardware unlocks
      const elapsedSinceRelease = Date.now() - lastMediaReleaseTime;
      if (elapsedSinceRelease < 300) {
        await new Promise((r) => setTimeout(r, 300 - elapsedSinceRelease));
      }

      if (isCancelledFn()) return null;

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 24, max: 24 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      let stream: MediaStream | null = null;
      let lastErr: any = null;

      // Retry up to 3 times on NotReadableError / AbortError (camera busy)
      for (let attempt = 0; attempt < 3; attempt++) {
        if (isCancelledFn()) return null;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err: any) {
          lastErr = err;
          const isBusy = err.name === 'NotReadableError' || err.name === 'AbortError';
          if (isBusy && attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
          } else {
            break;
          }
        }
      }

      if (isCancelledFn()) {
        stream?.getTracks().forEach((t) => t.stop());
        return null;
      }

      if (!stream) {
        // Fallback to audio-only
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          setCamOn(false);
          const busyMsg = lastErr?.name === 'NotReadableError' || lastErr?.name === 'AbortError'
            ? 'Camera is busy. Close other tabs or apps using the camera.'
            : 'Camera unavailable. Joined with audio only.';
          setError(busyMsg);
        } catch {
          setError('Microphone & camera unavailable. Joined in listen-only mode.');
          setMicOn(false);
          setCamOn(false);
          return null;
        }
      }

      if (isCancelledFn()) {
        stream?.getTracks().forEach((t) => t.stop());
        return null;
      }

      // Detect unexpected video track ended event (e.g. camera unplugged or claimed by another app)
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          setError('Camera stream ended unexpectedly. Click "Restart camera" to reconnect.');
          setCamOn(false);
        });
      });

      return stream;
    };

    // Chain to global serialisation queue
    const promise = globalGUMQueue.then(runAcquire, runAcquire);
    globalGUMQueue = promise;
    return promise;
  }, []);

  // Initialize Local Media Stream
  useEffect(() => {
    if (!sessionId) return;
    let isCancelled = false;
    setStatus('initializing');
    setError(null);

    acquireMedia(() => isCancelled).then((stream) => {
      if (isCancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (stream) {
        localStreamRef.current = stream;
        setLocalStream(stream);
        setStatus('connected');
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        if (userId) {
          broadcastMediaState(micOn, camOn);
        }
      }
    });

    return () => {
      isCancelled = true;
      releaseAllMedia();
    };
  }, [sessionId, userId, acquireMedia, releaseAllMedia]);

  // Restart camera action
  const restartCamera = useCallback(async () => {
    setStatus('initializing');
    setError(null);

    // Release current local stream first
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    lastMediaReleaseTime = Date.now();

    let isCancelled = false;
    const stream = await acquireMedia(() => isCancelled);
    if (stream) {
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOn(true);
      setStatus('connected');
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      // Replace video tracks in existing peer connections
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        peersRef.current.forEach((pc) => {
          pc.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'video') {
              sender.replaceTrack(videoTrack).catch(() => {});
            }
          });
        });
      }

      if (userId) {
        broadcastMediaState(micOn, true);
      }
    }
  }, [acquireMedia, userId, micOn, broadcastMediaState]);

  // Mesh WebRTC Handlers & Signaling
  useEffect(() => {
    if (!sessionId) return;

    // Handle participants update
    const handleParticipantsUpdate = async (data: {
      participants: Array<{ id: string; name: string; role: string; joinedAt: string }>;
    }) => {
      const activeIds = new Set(data.participants.map((p) => p.id));

      data.participants.forEach((p) => {
        participantNamesRef.current.set(p.id, p.name);
      });

      // Remove peers who left
      peersRef.current.forEach((pc, pId) => {
        if (!activeIds.has(pId)) {
          pc.close();
          peersRef.current.delete(pId);
          iceCandidatesQueueRef.current.delete(pId);
        }
      });

      setRemoteStreams((prev) => {
        const next = new Map(prev);
        let changed = false;
        prev.forEach((_, pId) => {
          if (!activeIds.has(pId)) {
            next.delete(pId);
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      // Mesh rule: Existing participants initiate offer to newly joined participant
      if (userId) {
        for (const p of data.participants) {
          if (p.id === userId) continue;

          // If this participant is brand new to us and we were already present, we send an offer
          if (!knownParticipantsRef.current.has(p.id)) {
            knownParticipantsRef.current.add(p.id);

            // Existing participant creates offer to newcomer
            const pc = createPeerConnection(p.id);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socketManager.emit('rtc_offer', {
                to: p.id,
                payload: { type: offer.type, sdp: offer.sdp },
              });
            } catch (err) {
              console.warn('Failed creating offer to', p.id, err);
            }
          }
        }
      }
    };

    // Receive RTC Offer
    const handleOffer = async (data: { to: string; from: string; payload: Record<string, unknown> }) => {
      const fromId = data.from;
      if (!fromId || (userId && fromId === userId)) return;

      const pc = createPeerConnection(fromId);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.payload as unknown as RTCSessionDescriptionInit));

        // Flush queued ICE candidates
        const queued = iceCandidatesQueueRef.current.get(fromId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        iceCandidatesQueueRef.current.delete(fromId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketManager.emit('rtc_answer', {
          to: fromId,
          payload: { type: answer.type, sdp: answer.sdp },
        });
      } catch (err) {
        console.warn('Failed handling offer from', fromId, err);
      }
    };

    // Receive RTC Answer
    const handleAnswer = async (data: { to: string; from: string; payload: Record<string, unknown> }) => {
      const fromId = data.from;
      const pc = peersRef.current.get(fromId);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.payload as unknown as RTCSessionDescriptionInit));

        // Flush queued ICE candidates
        const queued = iceCandidatesQueueRef.current.get(fromId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        iceCandidatesQueueRef.current.delete(fromId);
      } catch (err) {
        console.warn('Failed setting remote description for answer from', fromId, err);
      }
    };

    // Receive RTC ICE candidate
    const handleIce = async (data: { to: string; from: string; payload: Record<string, unknown> }) => {
      const fromId = data.from;
      const candidateInit = data.payload as unknown as RTCIceCandidateInit;
      if (!fromId || !candidateInit) return;

      const pc = peersRef.current.get(fromId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          console.warn('Failed adding ICE candidate from', fromId, err);
        }
      } else {
        const queue = iceCandidatesQueueRef.current.get(fromId) || [];
        queue.push(candidateInit);
        iceCandidatesQueueRef.current.set(fromId, queue);
      }
    };

    // Receive media_state
    const handleMediaState = (data: ServerMediaStatePayload) => {
      mediaStatesRef.current.set(data.userId, { micOn: data.micOn, camOn: data.camOn });
      setRemoteStreams((prev) => {
        const existing = prev.get(data.userId);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(data.userId, {
          ...existing,
          micOn: data.micOn,
          camOn: existing.audioOnly ? false : data.camOn,
        });
        return next;
      });
    };

    socketManager.on('participants_update', handleParticipantsUpdate);
    socketManager.on('rtc_offer', handleOffer);
    socketManager.on('rtc_answer', handleAnswer);
    socketManager.on('rtc_ice', handleIce);
    socketManager.on('media_state', handleMediaState);

    return () => {
      socketManager.off('participants_update', handleParticipantsUpdate);
      socketManager.off('rtc_offer', handleOffer);
      socketManager.off('rtc_answer', handleAnswer);
      socketManager.off('rtc_ice', handleIce);
      socketManager.off('media_state', handleMediaState);

      // Clean up all peer connections
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      iceCandidatesQueueRef.current.clear();
    };
  }, [sessionId, userId, createPeerConnection]);

  return {
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
    error,
    status,
  };
};
