import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';
import {
  Sparkles,
  Users,
  Video,
  PlusCircle,
  FileText,
  LogOut,
  BookOpen,
} from 'lucide-react';

interface SessionItem {
  id: string;
  name: string;
  topic: string;
  roomCode: string;
  externalLink?: string;
  createdAt: string;
  endedAt?: string;
}

export const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Host session form state
  const [showHostModal, setShowHostModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [sessionTopic, setSessionTopic] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Past sessions
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    const fetchSessions = async () => {
      setLoadingSessions(true);
      try {
        const res = await apiFetch<SessionItem[]>('/sessions');
        setSessions(res);
      } catch {
        // user might be student or guest without host permissions
      } finally {
        setLoadingSessions(false);
      }
    };
    fetchSessions();
  }, []);

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('Room code must be exactly 6 characters.');
      return;
    }
    try {
      await apiFetch<SessionItem>(`/sessions/by-code/${code}`);
      navigate(`/lobby/${code}`);
    } catch (err: any) {
      setJoinError(err.message || 'Session not found');
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiFetch<SessionItem>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: sessionName.trim(),
          topic: sessionTopic.trim(),
          externalLink: externalLink.trim() || undefined,
        }),
      });
      setShowHostModal(false);
      setSessions((prev) => [res, ...prev]);
      navigate(`/lobby/${res.roomCode}`);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-950 text-purple-100 p-6 md:p-10 overflow-y-auto">
      {/* Background Ambience */}
      <div className="absolute w-[600px] h-[600px] bg-purple-700/15 rounded-full blur-[140px] pointer-events-none -top-40 left-1/4" />
      <div className="absolute w-[500px] h-[500px] bg-indigo-700/15 rounded-full blur-[140px] pointer-events-none -bottom-40 right-10" />

      {/* Top Navbar */}
      <header className="relative max-w-6xl mx-auto flex items-center justify-between pb-8 border-b border-purple-500/15 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/15 border border-purple-500/30 rounded-2xl shadow-inner">
            <Sparkles className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-purple-200 to-indigo-200 bg-clip-text text-transparent">
              HoloCollab Dashboard
            </h1>
            <p className="text-xs text-purple-300/60">
              Welcome back, <span className="text-purple-200 font-medium">{user?.name}</span> ({user?.role})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/profile')}
            className="px-4 py-2 bg-purple-900/20 hover:bg-purple-900/30 border border-purple-500/20 rounded-xl text-xs font-medium text-purple-200 transition"
          >
            Profile
          </button>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="p-2 bg-purple-900/20 hover:bg-rose-950/40 border border-purple-500/20 hover:border-rose-500/40 text-purple-300 hover:text-rose-300 rounded-xl transition"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="relative max-w-6xl mx-auto space-y-8">
        {/* Two Main Cards: Join Session & Host Session */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Join Session Card */}
          <div className="bg-purple-950/25 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="p-3 w-fit bg-purple-500/10 border border-purple-500/20 rounded-2xl mb-4 text-purple-300">
                <Users className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-semibold text-purple-100">Join a Session</h2>
              <p className="text-xs text-purple-300/60 mt-1">
                Enter a 6-character room code given by your educator or peer.
              </p>
            </div>

            <form onSubmit={handleJoinByCode} className="mt-6 space-y-3">
              {joinError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                  {joinError}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 7K2M9X"
                  className="flex-1 bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5 text-center text-sm font-mono tracking-widest text-purple-100 uppercase focus:outline-none focus:border-purple-400"
                />
                <button
                  type="submit"
                  disabled={joinCode.length !== 6}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-purple-900/30 transition disabled:opacity-40"
                >
                  Join
                </button>
              </div>
            </form>
          </div>

          {/* Host Session Card */}
          <div className="bg-purple-950/25 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="p-3 w-fit bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4 text-indigo-300">
                <Video className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-semibold text-purple-100">Host a Session</h2>
              <p className="text-xs text-purple-300/60 mt-1">
                Start a collaborative 3D learning room with webcam gestures and Gemini assistant.
              </p>
            </div>

            <div className="mt-6">
              {user?.role === 'educator' ? (
                <button
                  onClick={() => setShowHostModal(true)}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2 transition"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Create New Session</span>
                </button>
              ) : (
                <div className="p-3 bg-purple-900/15 border border-purple-500/20 rounded-xl text-center text-xs text-purple-300/70">
                  Educator account required to host sessions.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* My Past Sessions */}
        <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-400" />
              <h3 className="text-sm font-semibold text-purple-100">My Sessions</h3>
            </div>
            <span className="text-xs text-purple-300/50">{sessions.length} total</span>
          </div>

          {loadingSessions ? (
            <div className="text-center py-8 text-xs text-purple-300/50">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-purple-300/40">
              No sessions hosted yet. Click "Host a Session" to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-purple-200">
                <thead className="border-b border-purple-500/15 text-purple-300/60 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Room Code</th>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Topic</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-purple-900/10 transition">
                      <td className="py-3.5 px-4 font-mono font-medium text-purple-300 tracking-wider">
                        {s.roomCode}
                      </td>
                      <td className="py-3.5 px-4 font-medium">{s.name}</td>
                      <td className="py-3.5 px-4 text-purple-300/70">{s.topic}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            s.endedAt
                              ? 'bg-slate-800 text-slate-400 border-slate-700'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          {s.endedAt ? 'Ended' : 'Active'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        {!s.endedAt && (
                          <button
                            onClick={() => navigate(`/lobby/${s.roomCode}`)}
                            className="px-3 py-1 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 rounded-lg text-purple-200 text-[11px] font-medium transition"
                          >
                            Enter
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/session/${s.id}/report`)}
                          className="px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-indigo-300 text-[11px] font-medium transition inline-flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          <span>Report</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Host Session Modal */}
      {showHostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-purple-500/30 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-purple-100">Create New Session</h3>
            {createError && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateSession} className="space-y-3">
              <div>
                <label className="text-xs text-purple-200/70 block mb-1">Session Name</label>
                <input
                  type="text"
                  required
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Molecular Biology 101"
                  className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="text-xs text-purple-200/70 block mb-1">Topic</label>
                <input
                  type="text"
                  required
                  value={sessionTopic}
                  onChange={(e) => setSessionTopic(e.target.value)}
                  placeholder="e.g. DNA Replication & Polymerase"
                  className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="text-xs text-purple-200/70 block mb-1">External Link (optional)</label>
                <input
                  type="url"
                  value={externalLink}
                  onChange={(e) => setExternalLink(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHostModal(false)}
                  className="flex-1 py-2.5 bg-purple-900/20 hover:bg-purple-900/30 text-purple-300 rounded-xl text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition disabled:opacity-50"
                >
                  {creating ? 'Starting...' : 'Create & Enter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
