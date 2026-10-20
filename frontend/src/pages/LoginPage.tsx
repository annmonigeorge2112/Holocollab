import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Sparkles, ArrowRight, User as UserIcon } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [guestName, setGuestName] = useState('');
  const [showGuestInput, setShowGuestInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { login, guest } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await guest(guestName.trim());
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Guest entry failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none -top-20 -left-20" />
      <div className="absolute w-[400px] h-[400px] bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none -bottom-20 -right-20" />

      {/* Card container */}
      <div className="relative w-full max-w-md bg-purple-950/30 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-8 shadow-2xl shadow-purple-950/50">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl mb-3 shadow-inner">
            <Sparkles className="w-8 h-8 text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-200 via-purple-300 to-indigo-200 bg-clip-text text-transparent">
            Welcome to HoloCollab
          </h1>
          <p className="text-xs text-purple-300/60 mt-1">AI + AR Collaborative Learning</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 text-center">
            {error}
          </div>
        )}

        {!showGuestInput ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-purple-200/70 block mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5 text-sm text-purple-100 placeholder-purple-400/40 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-purple-200/70 block mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5 text-sm text-purple-100 placeholder-purple-400/40 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-purple-900/40 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleGuestSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-purple-200/70 block mb-1.5">Display Name</label>
              <input
                type="text"
                required
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Alex"
                className="w-full bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5 text-sm text-purple-100 placeholder-purple-400/40 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !guestName.trim()}
              className="w-full mt-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-purple-900/40 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <span>{submitting ? 'Entering...' : 'Enter as Guest'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        <div className="relative my-6 flex items-center justify-center">
          <div className="border-t border-purple-500/20 w-full" />
          <span className="bg-transparent px-3 text-[11px] uppercase tracking-wider text-purple-400/50 absolute backdrop-blur">or</span>
        </div>

        <button
          type="button"
          onClick={() => setShowGuestInput(!showGuestInput)}
          className="w-full py-2.5 bg-purple-900/20 hover:bg-purple-900/30 border border-purple-500/20 text-purple-200 text-xs font-medium rounded-xl transition flex items-center justify-center gap-2"
        >
          <UserIcon className="w-3.5 h-3.5 text-purple-400" />
          <span>{showGuestInput ? 'Back to Email Sign In' : 'Continue as Guest'}</span>
        </button>

        <p className="text-center text-xs text-purple-300/50 mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-purple-300 font-medium hover:underline">
            Register now
          </Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
