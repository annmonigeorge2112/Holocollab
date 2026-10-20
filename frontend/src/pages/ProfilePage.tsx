import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User as UserIcon, Mail, Shield, ArrowLeft, LogOut } from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-6 bg-slate-950 text-purple-100 overflow-hidden">
      <div className="absolute w-[500px] h-[500px] bg-purple-700/15 rounded-full blur-[140px] pointer-events-none -top-20 -left-20" />
      <div className="absolute w-[400px] h-[400px] bg-indigo-700/15 rounded-full blur-[120px] pointer-events-none -bottom-20 -right-20" />

      <div className="relative w-full max-w-md bg-purple-950/25 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-purple-500/15">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-xs text-purple-300/70 hover:text-purple-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Dashboard</span>
          </button>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="flex items-center gap-1.5 text-xs text-rose-300/80 hover:text-rose-200 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 p-0.5 shadow-xl shadow-purple-950/60">
            <div className="w-full h-full bg-slate-950 rounded-full flex items-center justify-center">
              <UserIcon className="w-8 h-8 text-purple-300" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-purple-100">{user?.name}</h2>
          <span className="px-3 py-0.5 bg-purple-500/15 border border-purple-500/30 rounded-full text-xs font-mono uppercase text-purple-300">
            {user?.role}
          </span>
        </div>

        <div className="space-y-3 pt-2">
          <div className="p-4 bg-purple-900/20 border border-purple-500/20 rounded-2xl flex items-center gap-3">
            <Mail className="w-4 h-4 text-purple-400" />
            <div className="overflow-hidden">
              <span className="text-[10px] uppercase text-purple-300/50 block">Email Address</span>
              <span className="text-xs text-purple-200 truncate block">
                {user?.email || 'None (Guest Account)'}
              </span>
            </div>
          </div>

          <div className="p-4 bg-purple-900/20 border border-purple-500/20 rounded-2xl flex items-center gap-3">
            <Shield className="w-4 h-4 text-purple-400" />
            <div>
              <span className="text-[10px] uppercase text-purple-300/50 block">User Identifier</span>
              <span className="text-xs font-mono text-purple-300/80">{user?.id}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate('/dashboard')}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition shadow-lg shadow-purple-900/30"
        >
          Back to Sessions
        </button>
      </div>
    </div>
  );
};

export default ProfilePage;
