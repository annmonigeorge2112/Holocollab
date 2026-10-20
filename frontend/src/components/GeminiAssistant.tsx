import React, { useState } from 'react';
import { Bot, Send, X } from 'lucide-react';

interface GeminiAssistantProps {
  onAsk: (prompt: string) => void;
  responses: Array<{ answer: string; timestamp: string }>;
  isOpen: boolean;
  onClose: () => void;
}

export const GeminiAssistant: React.FC<GeminiAssistantProps> = ({
  onAsk,
  responses,
  isOpen,
  onClose,
}) => {
  const [input, setInput] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onAsk(input.trim());
    setInput('');
  };

  return (
    <div className="absolute top-16 right-4 w-80 h-96 bg-slate-900/90 backdrop-blur-md border border-cyan-500/30 rounded-xl shadow-2xl flex flex-col z-40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20 bg-slate-800/50">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-cyan-400" />
          <span className="font-semibold text-sm text-cyan-200">Gemini Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
        {responses.length === 0 ? (
          <p className="text-slate-400 text-center italic mt-8">
            Ask Gemini questions about the 3D model, anatomy, or lesson context.
          </p>
        ) : (
          responses.map((res, idx) => (
            <div
              key={idx}
              className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700 text-slate-200 whitespace-pre-wrap leading-relaxed"
            >
              {res.answer}
              <div className="text-[10px] text-slate-400 mt-1 text-right">
                {new Date(res.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-cyan-500/20 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AI..."
          className="flex-1 bg-slate-800/80 text-xs px-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-cyan-400 text-white"
        />
        <button
          type="submit"
          className="p-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
