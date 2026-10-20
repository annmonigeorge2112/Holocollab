import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import { Camera, Mic, MicOff, VideoOff, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';

interface SessionDetails {
  id: string;
  name: string;
  topic: string;
  roomCode: string;
  hostId: string;
}

export const LobbyPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hardware state
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const data = await apiFetch<SessionDetails>(`/sessions/by-code/${code?.toUpperCase()}`);
        setSession(data);
      } catch (err: any) {
        setError(err.message || 'Unable to find session');
      } finally {
        setLoading(false);
      }
    };
    if (code) fetchSession();
  }, [code]);

  // Handle camera & mic testing
  useEffect(() => {
    let active = true;

    async function setupMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Setup audio analyzer for mic level bar
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 64;
        source.connect(analyzer);

        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        const updateLevel = () => {
          if (!active) return;
          analyzer.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch (err) {
        console.warn('Media devices could not be loaded in lobby preview', err);
      }
    }

    setupMedia();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleCamera = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOn;
      });
    }
    setCameraOn(!cameraOn);
  };

  const toggleMic = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !micOn;
      });
    }
    setMicOn(!micOn);
  };

  const handleJoin = () => {
    if (session) {
      navigate(`/session/${session.id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-purple-300">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-purple-200 p-4">
        <div className="max-w-md w-full bg-purple-950/30 border border-purple-500/20 rounded-3xl p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-rose-300">Session Error</h2>
          <p className="text-xs text-purple-300/70">{error || 'Session is unavailable.'}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-6 bg-slate-950 text-purple-100 overflow-hidden">
      <div className="absolute w-[600px] h-[600px] bg-purple-700/15 rounded-full blur-[140px] pointer-events-none -top-40 -left-40" />
      <div className="absolute w-[500px] h-[500px] bg-indigo-700/15 rounded-full blur-[140px] pointer-events-none -bottom-40 -right-40" />

      <div className="relative w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 bg-purple-950/25 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-8 shadow-2xl">
        {/* Left column: Camera Preview & Mic Bar */}
        <div className="flex flex-col space-y-4">
          <div className="relative w-full aspect-video bg-black/60 rounded-2xl overflow-hidden border border-purple-500/20 shadow-inner flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`w-full h-full object-cover transform scale-x-[-1] ${!cameraOn ? 'hidden' : ''}`}
            />
            {!cameraOn && (
              <div className="flex flex-col items-center gap-2 text-purple-400/50">
                <VideoOff className="w-10 h-10" />
                <span className="text-xs">Camera is turned off</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3 flex gap-2">
              <button
                type="button"
                onClick={toggleCamera}
                className={`p-2.5 rounded-xl text-xs font-medium transition backdrop-blur-md border ${
                  cameraOn
                    ? 'bg-purple-900/60 border-purple-500/30 text-white hover:bg-purple-800/60'
                    : 'bg-rose-900/60 border-rose-500/30 text-rose-200 hover:bg-rose-800/60'
                }`}
              >
                {cameraOn ? <Camera className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={toggleMic}
                className={`p-2.5 rounded-xl text-xs font-medium transition backdrop-blur-md border ${
                  micOn
                    ? 'bg-purple-900/60 border-purple-500/30 text-white hover:bg-purple-800/60'
                    : 'bg-rose-900/60 border-rose-500/30 text-rose-200 hover:bg-rose-800/60'
                }`}
              >
                {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mic Level Indicator */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs text-purple-300/70">
              <span className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-purple-400" />
                Mic Input Level
              </span>
              <span className="font-mono text-[10px]">{micOn ? `${micLevel}%` : 'Muted'}</span>
            </div>
            <div className="w-full h-2 bg-purple-900/30 rounded-full overflow-hidden border border-purple-500/20">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all duration-75"
                style={{ width: `${micOn ? micLevel : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right column: Session Info & Join */}
        <div className="flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-xs uppercase font-mono tracking-widest text-purple-300/60">Ready to join</span>
            </div>

            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-100 to-indigo-100 bg-clip-text text-transparent">
                {session.name}
              </h2>
              <p className="text-sm text-purple-300/70 mt-1">{session.topic}</p>
            </div>

            <div className="p-4 bg-purple-900/20 border border-purple-500/20 rounded-2xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-purple-300/60">Room Code</span>
                <span className="font-mono font-bold text-purple-300 text-sm tracking-wider">{session.roomCode}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-purple-300/60">Environment</span>
                <span className="text-purple-200">Interactive 3D AR + Whiteboard</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-purple-300/60">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Camera feed is processed locally on device for hand gestures</span>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-purple-500/15">
            <button
              onClick={handleJoin}
              className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-purple-900/40 flex items-center justify-center gap-2 transition"
            >
              <span>Join Session Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full py-2.5 text-center text-xs text-purple-300/60 hover:text-purple-200 transition"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LobbyPage;
