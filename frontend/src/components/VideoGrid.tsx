import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, VolumeX } from 'lucide-react';
import { RemoteParticipantMedia } from '../hooks/useMediaSession';

interface VideoTileProps {
  stream: MediaStream | null;
  videoRefProp?: React.RefObject<HTMLVideoElement>;
  name: string;
  isLocal?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  audioOnly?: boolean;
  overlay?: React.ReactNode;
}

const VideoTile: React.FC<VideoTileProps> = ({
  stream,
  videoRefProp,
  name,
  isLocal = false,
  micOn = true,
  camOn = true,
  audioOnly = false,
  overlay,
}) => {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = videoRefProp || internalVideoRef;
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Speaking indicator with Web Audio Analyser
  useEffect(() => {
    if (!stream || !micOn) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let animId: number;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioContextClass();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        setIsSpeaking(avg > 18);
        animId = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch {
      // AudioContext may fail if not interacted or denied
    }

    return () => {
      cancelAnimationFrame(animId);
      source?.disconnect();
      audioCtx?.close().catch(() => {});
    };
  }, [stream, micOn]);

  const showVideo = camOn && !audioOnly && stream && stream.getVideoTracks().length > 0;

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-slate-900/90 border transition-all duration-200 aspect-video flex items-center justify-center ${
        isSpeaking ? 'border-emerald-400 ring-2 ring-emerald-400/40 shadow-emerald-500/20' : 'border-purple-500/20'
      }`}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-2 text-center text-purple-300">
          <div className="w-9 h-9 rounded-full bg-purple-900/60 border border-purple-500/40 flex items-center justify-center mb-1 text-sm font-bold text-white shadow-inner">
            {name.charAt(0).toUpperCase()}
          </div>
          {audioOnly && <span className="text-[9px] text-amber-400 font-medium">Audio only</span>}
        </div>
      )}

      {/* Optional Overlay (e.g. HandOverlay) */}
      {overlay && <div className="absolute inset-0 pointer-events-none">{overlay}</div>}

      {/* Name and mic/cam icons badge */}
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1.5 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-[10px] text-white z-10">
        <span className="truncate max-w-[80px] font-medium">
          {name} {isLocal && '(You)'}
        </span>
        <div className="flex items-center gap-1">
          {micOn ? (
            <Mic className="w-2.5 h-2.5 text-emerald-400" />
          ) : (
            <MicOff className="w-2.5 h-2.5 text-rose-400" />
          )}
          {camOn && !audioOnly ? (
            <Video className="w-2.5 h-2.5 text-purple-300" />
          ) : (
            <VideoOff className="w-2.5 h-2.5 text-rose-400" />
          )}
        </div>
      </div>
    </div>
  );
};

interface VideoGridProps {
  localStream: MediaStream | null;
  localVideoRef?: React.RefObject<HTMLVideoElement>;
  userName: string;
  micOn: boolean;
  camOn: boolean;
  remoteStreams: Map<string, RemoteParticipantMedia>;
  localOverlay?: React.ReactNode;
  className?: string;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  localStream,
  localVideoRef,
  userName,
  micOn,
  camOn,
  remoteStreams,
  localOverlay,
  className = '',
}) => {
  const remoteEntries = Array.from(remoteStreams.entries());
  const hasAudioOnlyNotice = remoteEntries.some(([, p]) => p.audioOnly);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Grid container: compact strip or responsive layout */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2 gap-2 max-h-64 lg:max-h-none overflow-y-auto p-1">
        {/* Local Participant */}
        <VideoTile
          stream={localStream}
          videoRefProp={localVideoRef}
          name={userName}
          isLocal
          micOn={micOn}
          camOn={camOn}
          overlay={localOverlay}
        />

        {/* Remote Participants */}
        {remoteEntries.map(([userId, p]) => (
          <VideoTile
            key={userId}
            stream={p.stream}
            name={p.name}
            micOn={p.micOn}
            camOn={p.camOn}
            audioOnly={p.audioOnly}
          />
        ))}
      </div>

      {hasAudioOnlyNotice && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/60 border border-amber-500/30 text-amber-300 text-[11px]">
          <VolumeX className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Participant cap reached (max 6 video). Extra users connected via audio only.</span>
        </div>
      )}
    </div>
  );
};
