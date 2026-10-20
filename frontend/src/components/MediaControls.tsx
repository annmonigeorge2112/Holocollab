import React from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';

interface MediaControlsProps {
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeaveCall?: () => void;
  className?: string;
}

export const MediaControls: React.FC<MediaControlsProps> = ({
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onLeaveCall,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-purple-500/30 shadow-lg ${className}`}
    >
      <button
        onClick={onToggleMic}
        className={`p-2 rounded-xl transition ${
          micOn
            ? 'bg-purple-600/70 hover:bg-purple-500 text-white'
            : 'bg-rose-600/80 hover:bg-rose-500 text-white'
        }`}
        title={micOn ? 'Mute Microphone' : 'Unmute Microphone'}
      >
        {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
      </button>

      <button
        onClick={onToggleCam}
        className={`p-2 rounded-xl transition ${
          camOn
            ? 'bg-purple-600/70 hover:bg-purple-500 text-white'
            : 'bg-rose-600/80 hover:bg-rose-500 text-white'
        }`}
        title={camOn ? 'Turn Off Camera' : 'Turn On Camera'}
      >
        {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
      </button>

      {onLeaveCall && (
        <button
          onClick={onLeaveCall}
          className="p-2 rounded-xl bg-slate-800 hover:bg-rose-700/80 text-rose-300 hover:text-white transition border border-rose-500/20"
          title="Disconnect Audio/Video"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
