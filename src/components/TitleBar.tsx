import { Minus, Square, X } from 'lucide-react';

export default function TitleBar() {
  const isElectron = !!window.electronAPI;

  const handleMinimize = () => window.electronAPI?.minimizeWindow();
  const handleMaximize = () => window.electronAPI?.maximizeWindow();
  const handleClose = () => window.electronAPI?.closeWindow();

  return (
    <div
      className="h-10 flex items-center justify-between px-4 select-none bg-[#0a0c12] border-b border-white/5"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
          <div className="w-2.5 h-2.5 border-2 border-white rounded-sm" />
        </div>
        <span className="text-xs font-semibold text-white/60 tracking-widest uppercase">
          VideoGen Studio
        </span>
      </div>

      {isElectron && (
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="w-7 h-7 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={handleMaximize}
            className="w-7 h-7 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            <Square size={10} />
          </button>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
