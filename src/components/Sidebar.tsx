import { LayoutDashboard, Video, Settings, KeyRound, Library, Mic2 } from 'lucide-react';

export type Page = 'dashboard' | 'create' | 'media' | 'audio' | 'settings' | 'license';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create', label: 'Create Video', icon: Video },
  { id: 'media', label: 'Media Library', icon: Library },
  { id: 'audio', label: 'Audio Upload', icon: Mic2 },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'license', label: 'License', icon: KeyRound },
];

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-56 flex-shrink-0 bg-[#0d0f18] border-r border-white/5 flex flex-col">
      <div className="px-4 py-5">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <div className="w-3.5 h-3.5 border-2 border-white rounded-sm" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">VideoGen</p>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">Studio</p>
          </div>
        </div>

        <nav className="space-y-0.5">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-3 px-2">
            Menu
          </p>
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activePage === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/15 to-blue-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon
                  size={16}
                  className={isActive ? 'text-cyan-400' : 'text-white/30 group-hover:text-white/60 transition-colors'}
                />
                {label}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto px-4 py-4 border-t border-white/5">
        <div className="flex items-center gap-3 px-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white">
            U
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white/80 truncate">User</p>
            <p className="text-[10px] text-white/30 truncate">Pro Plan</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
        </div>
      </div>
    </aside>
  );
}
