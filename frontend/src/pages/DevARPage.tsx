import React, { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ARSceneComponent, ARSceneHandle } from '../components/ARScene';
import { SAMPLE_MODELS } from '../constants/models';
import { useRealtime } from '../hooks/useRealtime';
import { usePresentation } from '../hooks/usePresentation';
import { apiFetch } from '../services/api';
import { AuthResponse } from '../types/events';
import { Search, ChevronLeft, ChevronRight, Radio, User as UserIcon } from 'lucide-react';

export const DevARPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const arRef = useRef<ARSceneHandle | null>(null);

  // Read URL query params or provide defaults for easy 2-tab testing
  const initialRoom = searchParams.get('room') || 'TEST01';
  const initialHost = searchParams.get('host') === 'true' || searchParams.get('host') === '1';
  const initialName = searchParams.get('name') || (initialHost ? 'Host' : 'Student');

  const [roomId, setRoomId] = useState(initialRoom);
  const [isHost, setIsHost] = useState(initialHost);
  const [userName, setUserName] = useState(initialName);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [highlightTarget, setHighlightTarget] = useState('');

  // Auto-acquire guest token if none in localStorage
  useEffect(() => {
    async function ensureToken() {
      if (!token) {
        try {
          const res = await apiFetch<AuthResponse>('/auth/guest', {
            method: 'POST',
            body: JSON.stringify({ name: userName }),
          });
          setToken(res.token);
        } catch {
          // Dev fallback token for offline/standalone testing
          setToken('dev-token');
        }
      }
    }
    ensureToken();
  }, [token, userName]);

  // Hook 1: Real-time Multi-User AR Scene Sync
  const {
    isConnected,
    controlledBy,
    broadcastHighlight,
    onLocalTransformChange,
    onLocalPartSelect,
    onLocalFilterChange,
    onLocalInteractionEnd,
  } = useRealtime({
    sessionId: roomId,
    token,
    userName,
    arSceneRef: arRef,
  });

  // Hook 2: Host Presentation Mode
  const {
    currentSlideIndex,
    currentModel,
    models,
    goToSlide,
    nextSlide,
    prevSlide,
  } = usePresentation({
    sessionId: roomId,
    isHost,
    arSceneRef: arRef,
    models: SAMPLE_MODELS,
  });

  const handleHighlight = () => {
    if (highlightTarget.trim() && arRef.current) {
      const target = highlightTarget.trim();
      arRef.current.highlightObject(target);
      broadcastHighlight(target);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 right-4 z-30 flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/85 backdrop-blur-md border border-purple-500/30 rounded-2xl shadow-2xl">
        {/* Left Section: Session & Role */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-purple-300 px-2 py-1 bg-purple-950/60 rounded-lg border border-purple-500/30 flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            {isConnected ? 'LIVE' : 'CONNECTING'}
          </span>

          {/* Room Input */}
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="Room code"
            className="bg-purple-950/40 text-purple-100 text-xs px-2.5 py-1.5 rounded-xl border border-purple-500/30 focus:outline-none focus:border-purple-400 w-24 text-center font-mono font-bold"
            title="Room Code"
          />

          {/* User Name */}
          <div className="flex items-center gap-1 bg-purple-950/40 px-2.5 py-1 rounded-xl border border-purple-500/30 text-xs text-purple-200">
            <UserIcon className="w-3.5 h-3.5 text-purple-400" />
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="bg-transparent border-none focus:outline-none text-purple-100 w-20 text-xs"
              placeholder="Name"
            />
          </div>

          {/* Host Toggle */}
          <button
            onClick={() => setIsHost(!isHost)}
            className={`px-2.5 py-1 text-xs font-medium rounded-xl border transition flex items-center gap-1 ${
              isHost
                ? 'bg-amber-600/80 border-amber-400 text-white shadow-lg shadow-amber-950/40'
                : 'bg-purple-950/40 border-purple-500/30 text-purple-300 hover:text-white'
            }`}
            title="Toggle Host Presentation Mode"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isHost ? 'Host' : 'Student'}</span>
          </button>
        </div>

        {/* Center Section: Presentation Slides */}
        <div className="flex items-center gap-2">
          {isHost ? (
            <div className="flex items-center gap-1 bg-purple-950/40 p-1 rounded-xl border border-purple-500/30">
              <button
                onClick={prevSlide}
                className="p-1 text-purple-300 hover:text-white rounded hover:bg-white/10 transition"
                title="Previous Model"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                value={currentSlideIndex}
                onChange={(e) => goToSlide(Number(e.target.value))}
                className="bg-transparent text-purple-100 text-xs px-2 py-1 focus:outline-none cursor-pointer"
              >
                {models.map((m, idx) => (
                  <option key={m.id} value={idx} className="bg-slate-900 text-white">
                    {idx + 1}. {m.name}
                  </option>
                ))}
              </select>
              <button
                onClick={nextSlide}
                className="p-1 text-purple-300 hover:text-white rounded hover:bg-white/10 transition"
                title="Next Model"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 bg-purple-950/40 rounded-xl border border-purple-500/30 text-xs text-purple-200">
              <span className="text-purple-400 font-medium">Model:</span>
              <span>{currentModel.name}</span>
            </div>
          )}
        </div>

        {/* Right Section: Highlight & Isolation */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={highlightTarget}
            onChange={(e) => setHighlightTarget(e.target.value)}
            placeholder="Mesh or part name..."
            className="bg-purple-950/40 text-purple-100 text-xs px-3 py-1.5 rounded-xl border border-purple-500/30 focus:outline-none focus:border-purple-400 w-36"
            onKeyDown={(e) => e.key === 'Enter' && handleHighlight()}
          />
          <button
            onClick={handleHighlight}
            className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-xl transition flex items-center gap-1 shadow-lg shadow-rose-950/40"
            title="Highlight mesh for 4 seconds"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Highlight</span>
          </button>
          <button
            onClick={() => {
              if (highlightTarget.trim() && arRef.current) {
                arRef.current.selectPart(highlightTarget.trim());
                onLocalPartSelect(highlightTarget.trim());
              }
            }}
            className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl transition shadow-lg shadow-purple-950/40"
            title="Isolate part by name"
          >
            <span>Isolate</span>
          </button>
          <button
            onClick={() => {
              arRef.current?.selectPart(null);
              onLocalPartSelect(null);
            }}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition"
            title="Show all parts"
          >
            Show all
          </button>
        </div>
      </div>

      {/* Controlled by <name> Banner */}
      {controlledBy && (
        <div className="absolute top-20 right-4 z-20 flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 backdrop-blur-md border border-amber-500/40 rounded-xl text-xs text-amber-200 shadow-xl animate-fadeIn">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Controlled by <strong className="text-white">{controlledBy}</strong></span>
        </div>
      )}

      {/* Fullscreen Synchronized AR Scene */}
      <ARSceneComponent
        ref={arRef}
        modelUrl={currentModel.url}
        onTransformChange={onLocalTransformChange}
        onInteractionEnd={onLocalInteractionEnd}
        onPartSelect={(name) => {
          onLocalPartSelect(name);
        }}
        onFilterChange={onLocalFilterChange}
        className="w-full h-full"
      />
    </div>
  );
};

export default DevARPage;
