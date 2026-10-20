import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';
import {
  Sparkles,
  Clock,
  Users,
  TrendingUp,
  BookOpen,
  CheckCircle,
  XCircle,
  ChevronRight,
  ArrowLeft,
  FileText,
  Brain,
  Download,
  Award,
  ArrowUpDown,
  AlertCircle,
  MessageSquare,
  Hand,
  PenTool,
} from 'lucide-react';

interface QuizItem {
  question: string;
  score: number;
}

interface AttendanceRecord {
  userId: string;
  name: string;
  joinedAt: string;
  leftAt: string | null;
  durationSeconds: number;
  engagementPct: number;
  chatCount: number;
  gestureCount: number;
  strokeCount: number;
}

interface EngagementBucket {
  timeLabel: string;
  activePercentages: Record<string, number>;
}

interface SessionReport {
  sessionId: string;
  durationSeconds: number;
  totalParticipants: number;
  engagementAverage: number;
  rating: 'Excellent' | 'Good' | 'Fair';
  aiInsight: string;
  summary: string;
  quizzes: QuizItem[];
  attendance: AttendanceRecord[];
  engagementSeries: EngagementBucket[];
}

interface GeneratedQuiz {
  question: string;
  options: string[];
  answer: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

type SortField = 'name' | 'joinedAt' | 'leftAt' | 'durationSeconds' | 'engagementPct' | 'chatCount' | 'gestureCount' | 'strokeCount';

export const SessionReportPage: React.FC = () => {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table sorting
  const [sortField, setSortField] = useState<SortField>('durationSeconds');
  const [sortAsc, setSortAsc] = useState(false);

  // Quiz state
  const [quiz, setQuiz] = useState<GeneratedQuiz[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [topic, setTopic] = useState('');

  const loadReport = () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    apiFetch<SessionReport>(`/sessions/${sessionId}/report`)
      .then(setReport)
      .catch((e) => setError(e.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
  }, [sessionId]);

  const sortedAttendance = useMemo(() => {
    if (!report?.attendance) return [];
    return [...report.attendance].sort((a, b) => {
      let valA: string | number = a[sortField] ?? 0;
      let valB: string | number = b[sortField] ?? 0;
      if (sortField === 'name') {
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
      } else if (sortField === 'joinedAt' || sortField === 'leftAt') {
        valA = a[sortField] ? new Date(a[sortField]!).getTime() : 0;
        valB = b[sortField] ? new Date(b[sortField]!).getTime() : 0;
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [report?.attendance, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const exportCSV = () => {
    if (!report?.attendance || report.attendance.length === 0) return;
    const headers = [
      'Name',
      'Joined',
      'Left',
      'Time Present (s)',
      'Time Present (formatted)',
      'Engagement (%)',
      'Chat Messages',
      'Gestures',
      'Strokes',
    ];

    const escapeCSV = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return '""';
      const str = String(value);
      // Double quotes to escape within CSV
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = sortedAttendance.map((row) => [
      escapeCSV(row.name),
      escapeCSV(formatTime(row.joinedAt)),
      escapeCSV(formatTime(row.leftAt)),
      escapeCSV(row.durationSeconds),
      escapeCSV(formatDuration(row.durationSeconds)),
      escapeCSV(Math.round(row.engagementPct * 100)),
      escapeCSV(row.chatCount),
      escapeCSV(row.gestureCount),
      escapeCSV(row.strokeCount),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `session_${report.sessionId}_attendance.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generateQuiz = async () => {
    if (!sessionId) return;
    setQuizLoading(true);
    setQuiz([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
    try {
      const res = await apiFetch<{ quiz: GeneratedQuiz[] }>('/ai/quiz', {
        method: 'POST',
        body: JSON.stringify({ sessionId, topic: topic.trim() || 'session topic', count: 5 }),
      });
      setQuiz(res.quiz);
    } catch {
      // swallow
    } finally {
      setQuizLoading(false);
    }
  };

  const handleAnswer = (qIdx: number, option: string) => {
    if (quizSubmitted) return;
    setQuizAnswers((prev) => ({ ...prev, [qIdx]: option }));
  };

  const correctCount = quiz.filter((q, i) => quizAnswers[i] === q.answer).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-purple-300 space-y-3">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-500" />
        <p className="text-xs text-purple-400/80">Loading session analytics and insights…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-4">
        <div className="max-w-md w-full bg-purple-950/30 border border-purple-500/20 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
          <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
          <h2 className="text-xl font-bold text-rose-200">Report Unavailable</h2>
          <p className="text-xs text-purple-300/70 leading-relaxed">
            {error ?? 'Session report could not be loaded or you are not authorized to view it.'}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={loadReport}
              className="px-5 py-2.5 bg-purple-900/50 hover:bg-purple-800 text-purple-200 rounded-xl text-xs font-medium transition border border-purple-500/30"
            >
              Retry
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const engagePct = Math.round(report.engagementAverage * 100);

  // Overall rating pill color
  const ratingBadge = {
    Excellent: {
      color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
      bar: 'bg-emerald-400',
    },
    Good: {
      color: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
      bar: 'bg-cyan-400',
    },
    Fair: {
      color: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
      bar: 'bg-amber-400',
    },
  }[report.rating || 'Good'] || {
    color: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
    bar: 'bg-purple-400',
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-950 text-purple-100 overflow-y-auto">
      {/* Background glows */}
      <div className="fixed w-[600px] h-[600px] bg-purple-700/10 rounded-full blur-[140px] pointer-events-none -top-40 left-1/4" />
      <div className="fixed w-[500px] h-[500px] bg-indigo-700/10 rounded-full blur-[140px] pointer-events-none -bottom-40 right-10" />

      <div className="relative max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-1.5 text-xs text-purple-400/70 hover:text-purple-200 transition mb-3"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Dashboard
            </button>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-500/15 border border-purple-500/30 rounded-2xl">
                <FileText className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-200 to-indigo-200 bg-clip-text text-transparent">
                  Session Analytics Report
                </h1>
                <p className="text-xs text-purple-300/60 font-mono mt-0.5">{report.sessionId}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Session Concluded</span>
            </div>
          </div>
        </div>

        {/* Stats Cards (Duration, Participants, Average Engagement, Rating) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Clock className="w-5 h-5 text-purple-400" />}
            label="Duration"
            value={formatDuration(report.durationSeconds)}
          />
          <StatCard
            icon={<Users className="w-5 h-5 text-indigo-400" />}
            label="Participants"
            value={String(report.totalParticipants)}
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-cyan-400" />}
            label="Avg Engagement"
            value={`${engagePct}%`}
            sub={
              <div className="mt-2 w-full h-1.5 bg-purple-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full"
                  style={{ width: `${engagePct}%` }}
                />
              </div>
            }
          />
          <StatCard
            icon={<Award className="w-5 h-5 text-amber-400" />}
            label="Overall Rating"
            value={report.rating || 'Good'}
            sub={
              <div className="mt-2">
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${ratingBadge.color}`}>
                  {report.rating === 'Excellent' ? '≥ 75% Active' : report.rating === 'Good' ? '50% - 74% Active' : '< 50% Active'}
                </span>
              </div>
            }
          />
        </div>

        {/* AI Insight Paragraph */}
        <section className="bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-purple-950/40 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-300" />
            <h2 className="text-sm font-semibold text-purple-100">AI Engagement Insight</h2>
          </div>
          <p className="text-sm text-purple-200/90 leading-relaxed font-normal">
            {report.aiInsight || report.summary || 'All attendees maintained healthy engagement throughout the collaborative lesson.'}
          </p>
        </section>

        {/* Engagement Line Chart per Participant (Plain SVG) */}
        <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h2 className="text-sm font-semibold text-purple-100">Engagement Over Time (1-Min Buckets)</h2>
            </div>
            <p className="text-xs text-purple-300/50">Active participation percentage per minute</p>
          </div>

          <EngagementSVGChart series={report.engagementSeries || []} />
        </section>

        {/* Attendance Table */}
        <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <h2 className="text-sm font-semibold text-purple-100">Attendance & Participation Breakdown</h2>
            </div>
            <button
              onClick={exportCSV}
              disabled={!report.attendance || report.attendance.length === 0}
              className="px-3.5 py-1.5 bg-purple-900/40 hover:bg-purple-800 disabled:opacity-40 text-purple-200 text-xs font-medium rounded-xl border border-purple-500/30 transition flex items-center gap-1.5 self-start sm:self-auto"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>

          {!report.attendance || report.attendance.length === 0 ? (
            <div className="text-center py-8 text-xs text-purple-300/50">
              No participant records recorded for this session.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-purple-500/15">
              <table className="w-full text-left text-xs text-purple-200">
                <thead className="bg-purple-950/50 text-[11px] uppercase tracking-wider text-purple-300/70 border-b border-purple-500/20">
                  <tr>
                    <th
                      onClick={() => handleSort('name')}
                      className="px-4 py-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Name</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('joinedAt')}
                      className="px-3 py-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Joined</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('leftAt')}
                      className="px-3 py-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Left</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('durationSeconds')}
                      className="px-3 py-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Time Present</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('engagementPct')}
                      className="px-3 py-3 cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        <span>Engagement</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('chatCount')}
                      className="px-3 py-3 text-center cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        <span>Chat</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('gestureCount')}
                      className="px-3 py-3 text-center cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <Hand className="w-3 h-3" />
                        <span>Gestures</span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('strokeCount')}
                      className="px-3 py-3 text-center cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <PenTool className="w-3 h-3" />
                        <span>Strokes</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10">
                  {sortedAttendance.map((row) => {
                    const rowPct = Math.round(row.engagementPct * 100);
                    const isLow = rowPct < 40;
                    return (
                      <tr key={row.userId} className="hover:bg-purple-900/15 transition">
                        <td className="px-4 py-3 font-medium text-white flex items-center gap-2">
                          <span>{row.name}</span>
                          {isLow && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-rose-500/20 text-rose-300 rounded border border-rose-500/30">
                              Low
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-purple-300/70">
                          {formatTime(row.joinedAt)}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-purple-300/70">
                          {formatTime(row.leftAt)}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px]">
                          {formatDuration(row.durationSeconds)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-purple-900/50 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  rowPct >= 75
                                    ? 'bg-emerald-400'
                                    : rowPct >= 50
                                    ? 'bg-cyan-400'
                                    : 'bg-rose-400'
                                }`}
                                style={{ width: `${rowPct}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-purple-200">{rowPct}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-purple-200">
                          {row.chatCount}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-purple-200">
                          {row.gestureCount}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-purple-200">
                          {row.strokeCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Session Summary Paragraph */}
        <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-400" />
            <h2 className="text-sm font-semibold text-purple-100">Session Overview</h2>
          </div>
          <p className="text-sm text-purple-200/80 leading-relaxed whitespace-pre-wrap">
            {report.summary || 'No overview generated for this session.'}
          </p>
        </section>

        {/* Quiz History */}
        {report.quizzes && report.quizzes.length > 0 && (
          <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-400" />
              <h2 className="text-sm font-semibold text-purple-100">Quiz History</h2>
            </div>
            <div className="space-y-3">
              {report.quizzes.map((q, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 bg-purple-900/15 border border-purple-500/15 rounded-xl"
                >
                  <span className="text-xs text-purple-200 flex-1 pr-4">{q.question}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="w-16 h-1.5 bg-purple-900/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                        style={{ width: `${Math.round(q.score * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-purple-300 font-mono w-8 text-right">
                      {Math.round(q.score * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Generate New Quiz */}
        <section className="bg-purple-950/20 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-purple-100">Generate Post-Session Quiz</h2>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic or concept to evaluate"
              className="flex-1 bg-purple-900/20 border border-purple-500/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
            />
            <button
              onClick={generateQuiz}
              disabled={quizLoading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-xl transition disabled:opacity-40 flex items-center gap-1.5"
            >
              {quizLoading ? (
                <span className="animate-pulse">Generating…</span>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate</span>
                </>
              )}
            </button>
          </div>

          {quiz.length > 0 && (
            <div className="space-y-4 pt-2">
              {quiz.map((q, qIdx) => (
                <div
                  key={qIdx}
                  className="space-y-2 p-4 bg-slate-900/50 border border-purple-500/15 rounded-2xl"
                >
                  <p className="text-xs font-medium text-purple-100">
                    {qIdx + 1}. {q.question}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {q.options.map((opt) => {
                      const selected = quizAnswers[qIdx] === opt;
                      const isCorrect = opt === q.answer;
                      let cls =
                        'px-3 py-2 rounded-xl text-xs border transition cursor-pointer text-left ';
                      if (!quizSubmitted) {
                        cls += selected
                          ? 'bg-purple-600 border-purple-400 text-white'
                          : 'bg-purple-950/30 border-purple-500/20 text-purple-200 hover:border-purple-400';
                      } else {
                        if (isCorrect) cls += 'bg-emerald-900/30 border-emerald-500/40 text-emerald-200';
                        else if (selected)
                          cls += 'bg-rose-900/30 border-rose-500/40 text-rose-200';
                        else cls += 'bg-purple-950/30 border-purple-500/15 text-purple-300/50';
                      }
                      return (
                        <button key={opt} onClick={() => handleAnswer(qIdx, opt)} className={cls}>
                          <span className="flex items-center gap-2">
                            {quizSubmitted && isCorrect && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                            {quizSubmitted && selected && !isCorrect && (
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            )}
                            {opt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {!quizSubmitted ? (
                <button
                  onClick={() => setQuizSubmitted(true)}
                  disabled={Object.keys(quizAnswers).length < quiz.length}
                  className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl transition disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  Submit Answers
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="text-center py-3">
                  <p className="text-sm font-semibold text-purple-100">
                    Score:{' '}
                    <span className="text-lg font-bold text-emerald-400">
                      {correctCount}/{quiz.length}
                    </span>
                  </p>
                  <p className="text-xs text-purple-300/60 mt-0.5">
                    {correctCount === quiz.length
                      ? 'Perfect score!'
                      : correctCount >= quiz.length / 2
                      ? 'Good work!'
                      : 'Keep studying!'}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
}> = ({ icon, label, value, sub }) => (
  <div className="bg-purple-950/25 backdrop-blur-xl border border-purple-500/20 rounded-2xl p-5 shadow-xl space-y-1">
    <div className="flex items-center gap-2 text-purple-300/70">
      {icon}
      <span className="text-xs uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-2xl font-bold text-purple-100 pt-1">{value}</div>
    {sub}
  </div>
);

// Plain SVG Engagement Line Chart Component (No external chart libraries)
const PALETTE = ['#38bdf8', '#a855f7', '#34d399', '#f43f5e', '#fbbf24', '#ec4899', '#6366f1'];

const EngagementSVGChart: React.FC<{ series: EngagementBucket[] }> = ({ series }) => {
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    timeLabel: string;
    participant: string;
    percentage: number;
  } | null>(null);

  // Extract all distinct participant names
  const participants = useMemo(() => {
    const set = new Set<string>();
    series.forEach((bucket) => {
      Object.keys(bucket.activePercentages || {}).forEach((p) => set.add(p));
    });
    return Array.from(set);
  }, [series]);

  // Color mapping
  const colors = useMemo(() => {
    const map: Record<string, string> = {};
    participants.forEach((name, i) => {
      map[name] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [participants]);

  if (!series || series.length === 0 || participants.length === 0) {
    return (
      <div className="h-44 w-full flex items-center justify-center text-xs text-purple-300/50 bg-slate-900/30 rounded-2xl border border-purple-500/10">
        No periodic engagement samples recorded for this session.
      </div>
    );
  }

  // Dimensions
  const width = 800;
  const height = 220;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 35;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const xStep = series.length > 1 ? chartW / (series.length - 1) : chartW / 2;

  // Build line paths for each participant
  const lines = participants.map((name) => {
    const points = series.map((bucket, idx) => {
      const pct = bucket.activePercentages[name] ?? 0;
      const x = series.length === 1 ? padLeft + chartW / 2 : padLeft + idx * xStep;
      const y = padTop + chartH - (pct / 100) * chartH;
      return { x, y, pct, timeLabel: bucket.timeLabel };
    });

    const d = points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');

    return { name, d, points, color: colors[name] };
  });

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {participants.map((name) => (
          <div key={name} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: colors[name] }}
            />
            <span className="text-purple-200">{name}</span>
          </div>
        ))}
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-h-60"
          style={{ minWidth: '500px' }}
        >
          {/* Y Axis Grid lines (0%, 25%, 50%, 75%, 100%) */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = padTop + chartH - (tick / 100) * chartH;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#6b21a8"
                  strokeOpacity="0.25"
                  strokeDasharray="4 4"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="#c084fc"
                  fillOpacity="0.6"
                  fontFamily="monospace"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* X Axis Time Labels */}
          {series.map((bucket, idx) => {
            const x = series.length === 1 ? padLeft + chartW / 2 : padLeft + idx * xStep;
            // Only label every few points if there are many
            const step = Math.max(1, Math.floor(series.length / 8));
            if (idx % step !== 0 && idx !== series.length - 1) return null;
            return (
              <text
                key={idx}
                x={x}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill="#c084fc"
                fillOpacity="0.6"
                fontFamily="monospace"
              >
                {bucket.timeLabel}
              </text>
            );
          })}

          {/* Participant Lines and Data Circles */}
          {lines.map((line) => (
            <g key={line.name}>
              <path
                d={line.d}
                fill="none"
                stroke={line.color}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {line.points.map((pt, pIdx) => (
                <circle
                  key={pIdx}
                  cx={pt.x}
                  cy={pt.y}
                  r="3.5"
                  fill={line.color}
                  className="cursor-pointer transition-transform hover:scale-150"
                  onMouseEnter={() =>
                    setHoveredPoint({
                      x: pt.x,
                      y: pt.y,
                      timeLabel: pt.timeLabel,
                      participant: line.name,
                      percentage: pt.pct,
                    })
                  }
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              ))}
            </g>
          ))}

          {/* Hover Tooltip inside SVG */}
          {hoveredPoint && (
            <g transform={`translate(${Math.min(hoveredPoint.x, width - 110)}, ${Math.max(hoveredPoint.y - 45, 10)})`}>
              <rect
                width="105"
                height="38"
                rx="8"
                fill="#0f172a"
                stroke="#a855f7"
                strokeWidth="1"
                filter="drop-shadow(0 4px 6px rgba(0,0,0,0.5))"
              />
              <text x="8" y="16" fontSize="10" fill="#e2e8f0" fontWeight="600">
                {hoveredPoint.participant}
              </text>
              <text x="8" y="30" fontSize="10" fill="#38bdf8" fontFamily="monospace">
                {hoveredPoint.timeLabel}: {hoveredPoint.percentage}%
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};

export default SessionReportPage;
