import { TrendingUp, Video, Clock, CheckCircle, ArrowUpRight, Zap } from 'lucide-react';

const stats = [
  { label: 'Videos Generated', value: '24', delta: '+3 this week', icon: Video, color: 'cyan' },
  { label: 'Hours Saved', value: '18h', delta: '+2.5h today', icon: Clock, color: 'blue' },
  { label: 'Success Rate', value: '98%', delta: 'All time', icon: CheckCircle, color: 'emerald' },
  { label: 'Credits Used', value: '1,240', delta: '760 remaining', icon: Zap, color: 'amber' },
];

const recentVideos = [
  { title: 'Product Launch — Wireless Earbuds', status: 'Completed', duration: '1:24', date: 'Today, 10:42 AM' },
  { title: 'Skincare Routine Walkthrough', status: 'Completed', duration: '2:05', date: 'Yesterday, 3:15 PM' },
  { title: 'Kitchen Gadget Review', status: 'Processing', duration: '—', date: 'Yesterday, 11:00 AM' },
  { title: 'Fitness Tracker Unboxing', status: 'Completed', duration: '1:50', date: 'May 28, 9:30 AM' },
];

const colorMap: Record<string, string> = {
  cyan: 'from-cyan-500/15 to-cyan-500/5 border-cyan-500/20 text-cyan-400',
  blue: 'from-blue-500/15 to-blue-500/5 border-blue-500/20 text-blue-400',
  emerald: 'from-emerald-500/15 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
  amber: 'from-amber-500/15 to-amber-500/5 border-amber-500/20 text-amber-400',
};

export default function Dashboard() {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-white/40 mt-1">Welcome back. Here's your activity overview.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
          {stats.map(({ label, value, delta, icon: Icon, color }) => (
            <div
              key={label}
              className={`rounded-xl border bg-gradient-to-br p-4 ${colorMap[color]}`}
            >
              <div className="flex items-start justify-between mb-3">
                <Icon size={16} className="mt-0.5 opacity-80" />
                <ArrowUpRight size={12} className="opacity-40" />
              </div>
              <p className="text-2xl font-bold text-white mt-1">{value}</p>
              <p className="text-[11px] text-white/50 mt-0.5">{label}</p>
              <p className="text-[10px] text-white/30 mt-1">{delta}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-white/40" />
              <h2 className="text-sm font-semibold text-white">Recent Videos</h2>
            </div>
            <span className="text-[11px] text-cyan-400 cursor-pointer hover:text-cyan-300 transition-colors">
              View all
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {recentVideos.map((video) => (
              <div key={video.title} className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/2 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Video size={14} className="text-white/30" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate">{video.title}</p>
                  <p className="text-[11px] text-white/30 mt-0.5">{video.date}</p>
                </div>
                <div className="text-[11px] text-white/30">{video.duration}</div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    video.status === 'Completed'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  }`}
                >
                  {video.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
