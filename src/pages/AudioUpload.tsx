import { useState, useEffect, useRef, useCallback, DragEvent, ChangeEvent } from 'react';
import {
  Music, Upload, X, Play, Pause, Clock, HardDrive,
  Plus, Mic2, CheckCircle, AlertCircle, Loader2,
  ChevronRight, List, Layers,
} from 'lucide-react';
import {
  saveAudioTrack, fetchAudioTracks, deleteAudioTrack,
  type AudioTrackRecord,
} from '../lib/supabase';
import AudioSyncPanel from '../components/AudioSyncPanel';

// ── Types ────────────────────────────────────────────────────────────────────

export type AudioMode = 'single' | 'multi';

interface AudioTrack {
  uid: string;              // local UI id
  dbId: string | null;      // Supabase row id after save
  productIndex: number | null;
  fileName: string;
  localPath: string | null;
  objectUrl: string | null; // temporary blob url for playback
  duration: number;
  fileSizeBytes: number;
  mimeType: string;
  saving: boolean;
  error: string | null;
}

// ── Constants / helpers ──────────────────────────────────────────────────────

const ACCEPTED_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac']);
const ACCEPTED_EXTS = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

const WAVEFORM = [38, 62, 80, 55, 72, 45, 88, 60, 74, 50, 90, 42, 68, 78, 52];

function formatDuration(s: number): string {
  if (!isFinite(s) || isNaN(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function isAudioFile(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type) || ACCEPTED_EXTS.test(file.name);
}

async function detectDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => { URL.revokeObjectURL(url); };
    audio.addEventListener('loadedmetadata', () => { cleanup(); resolve(audio.duration || 0); }, { once: true });
    audio.addEventListener('error', () => { cleanup(); resolve(0); }, { once: true });
    audio.src = url;
  });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Waveform decoration ───────────────────────────────────────────────────────

function Waveform({ playing, small }: { playing: boolean; small?: boolean }) {
  return (
    <div className={`flex items-center gap-px ${small ? 'h-4' : 'h-5'}`}>
      {WAVEFORM.map((pct, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${playing ? 'bg-cyan-400' : 'bg-white/25'}`}
          style={{
            width: small ? 2 : 2,
            height: `${pct}%`,
            animationName: playing ? 'wavePulse' : 'none',
            animationDuration: `${0.4 + (i % 5) * 0.1}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
          }}
        />
      ))}
    </div>
  );
}

// ── Mini audio player ─────────────────────────────────────────────────────────

function AudioPlayer({ track, onRemove, onTimeChange }: { track: AudioTrack; onRemove: () => void; onTimeChange?: (t: number) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  const src = track.localPath
    ? `file://${track.localPath}`
    : (track.objectUrl ?? '');

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrent(audioRef.current.currentTime);
      onTimeChange?.(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => { setPlaying(false); setCurrent(0); };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !track.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = ratio * track.duration;
    setCurrent(a.currentTime);
  };

  const progress = track.duration > 0 ? (current / track.duration) * 100 : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/4 overflow-hidden">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="metadata"
      />

      <div className="flex items-center gap-3 px-4 py-3">
        {/* Play / pause */}
        <button
          onClick={toggle}
          disabled={!src}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-md shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex-shrink-0"
        >
          {playing
            ? <Pause size={14} className="text-white" />
            : <Play size={14} className="text-white ml-0.5" />}
        </button>

        {/* Waveform + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-white/80 truncate max-w-[200px]">{track.fileName}</p>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <span className="text-[10px] text-white/35 flex items-center gap-1">
                <Clock size={9} />{formatDuration(track.duration)}
              </span>
              <span className="text-[10px] text-white/25">{formatBytes(track.fileSizeBytes)}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div
            className="relative h-1.5 bg-white/10 rounded-full cursor-pointer group"
            onClick={handleSeek}
          >
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 5px)` }}
            />
          </div>

          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-white/25 font-mono">{formatDuration(current)}</span>
            <Waveform playing={playing} small />
          </div>
        </div>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({
  label, sublabel, onFile, disabled, error,
}: {
  label: string;
  sublabel?: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    setLocalError('');
    if (!isAudioFile(file)) {
      setLocalError('Unsupported format. Use MP3 or WAV.');
      return;
    }
    onFile(file);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (!disabled) setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };
  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const displayError = localError || error;

  return (
    <div>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 px-6 cursor-pointer transition-all duration-200 ${
          disabled
            ? 'opacity-40 cursor-not-allowed border-white/8 bg-transparent'
            : dragOver
            ? 'border-cyan-400/70 bg-cyan-500/8 scale-[1.01]'
            : 'border-white/12 bg-white/2 hover:border-white/25 hover:bg-white/4'
        }`}
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${dragOver ? 'bg-cyan-500/20' : 'bg-white/6'}`}>
          {dragOver
            ? <Music size={22} className="text-cyan-400" />
            : <Upload size={22} className="text-white/30" />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-white/70">{label}</p>
          {sublabel && <p className="text-xs text-white/30 mt-0.5">{sublabel}</p>}
          <p className="text-[11px] text-white/20 mt-1">MP3 · WAV · M4A · FLAC</p>
        </div>
        {dragOver && (
          <div className="absolute inset-0 rounded-xl border-2 border-cyan-400/50 pointer-events-none" />
        )}
      </div>
      {displayError && (
        <p className="flex items-center gap-1.5 text-xs text-red-400 mt-1.5 px-1">
          <AlertCircle size={11} /> {displayError}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}

// ── Product slot (multi mode) ─────────────────────────────────────────────────

function ProductSlot({
  index, track, onFile, onRemove,
}: {
  index: number;
  track: AudioTrack | null;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 items-start">
      {/* Badge */}
      <div className="flex flex-col items-center gap-1.5 pt-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold border transition-all ${
          track
            ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25'
            : 'bg-white/5 text-white/25 border-white/8'
        }`}>
          {index}
        </div>
        {track && (
          <div className="flex items-center gap-1 text-[9px] text-emerald-400">
            <CheckCircle size={9} /> done
          </div>
        )}
      </div>

      {/* Content */}
      <div>
        {track ? (
          <div className="space-y-1">
            <p className="text-[10px] text-white/35 font-medium px-1">Product {index}</p>
            <AudioPlayer track={track} onRemove={onRemove} />
            {track.saving && (
              <p className="flex items-center gap-1.5 text-[10px] text-cyan-400/60 px-1">
                <Loader2 size={9} className="animate-spin" /> Saving…
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[10px] text-white/35 font-medium px-1">Product {index}</p>
            <DropZone
              label={`Drop audio for Product ${index}`}
              sublabel={`product_${index}.mp3`}
              onFile={onFile}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AudioUpload() {
  const [mode, setMode] = useState<AudioMode>('single');
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [productCount, setProductCount] = useState(3);
  const [loading, setLoading] = useState(true);

  // Load saved tracks from Supabase on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      const rows = await fetchAudioTracks();
      const loaded: AudioTrack[] = rows.map((r) => ({
        uid: uid(),
        dbId: r.id ?? null,
        productIndex: r.product_index,
        fileName: r.file_name,
        localPath: r.local_path,
        objectUrl: null,
        duration: r.duration_seconds,
        fileSizeBytes: r.file_size_bytes,
        mimeType: r.mime_type,
        saving: false,
        error: null,
      }));
      if (loaded.length) {
        // Infer mode from what was loaded
        const hasSingle = loaded.some((t) => t.productIndex === null);
        setMode(hasSingle ? 'single' : 'multi');
        const maxIdx = Math.max(0, ...loaded.map((t) => t.productIndex ?? 0));
        if (maxIdx > 0) setProductCount(Math.max(productCount, maxIdx));
        setTracks(loaded);
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      tracks.forEach((t) => { if (t.objectUrl) URL.revokeObjectURL(t.objectUrl); });
    };
  }, [tracks]);

  // ── Handle file drop/select ────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File, productIndex: number | null) => {
    const objectUrl = URL.createObjectURL(file);
    const duration = await detectDuration(file);

    const track: AudioTrack = {
      uid: uid(),
      dbId: null,
      productIndex,
      fileName: file.name,
      localPath: null,
      objectUrl,
      duration,
      fileSizeBytes: file.size,
      mimeType: file.type || 'audio/mpeg',
      saving: true,
      error: null,
    };

    // Add to state immediately so UI shows it
    setTracks((prev) => {
      // Remove existing track for same slot
      const filtered = prev.filter((t) =>
        productIndex !== null ? t.productIndex !== productIndex : t.productIndex === null ? false : true
      );
      // For single mode, remove all existing single tracks
      const cleaned = productIndex === null ? prev.filter((t) => t.productIndex !== null) : filtered;
      return [...cleaned, track];
    });

    // Copy file via Electron IPC
    let localPath: string | null = null;
    const sourcePath = (file as unknown as { path?: string }).path;

    if (window.electronAPI && sourcePath) {
      const result = await window.electronAPI.saveAudioFile({
        sourcePath,
        mode,
        productIndex,
        originalName: file.name,
      });
      if (result.success && result.localPath) {
        localPath = result.localPath;
      }
    }

    // Save to Supabase
    const saved = await saveAudioTrack({
      mode,
      product_index: productIndex,
      file_name: file.name,
      local_path: localPath ?? '',
      duration_seconds: duration,
      file_size_bytes: file.size,
      mime_type: file.type || 'audio/mpeg',
    });

    setTracks((prev) =>
      prev.map((t) =>
        t.uid === track.uid
          ? { ...t, dbId: saved?.id ?? null, localPath, saving: false }
          : t
      )
    );
  }, [mode]);

  // ── Remove a track ─────────────────────────────────────────────────────────

  const handleRemove = useCallback(async (trackUid: string) => {
    const t = tracks.find((x) => x.uid === trackUid);
    if (!t) return;
    if (t.objectUrl) URL.revokeObjectURL(t.objectUrl);
    setTracks((prev) => prev.filter((x) => x.uid !== trackUid));

    if (t.dbId) await deleteAudioTrack(t.dbId);
    if (t.localPath && window.electronAPI) await window.electronAPI.deleteAudioFile(t.localPath);
  }, [tracks]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const singleTrack = tracks.find((t) => t.productIndex === null) ?? null;
  const getProductTrack = (idx: number) => tracks.find((t) => t.productIndex === idx) ?? null;
  const filledSlots = tracks.filter((t) => t.productIndex !== null && t.productIndex <= productCount).length;
  const totalDuration = tracks.reduce((n, t) => n + t.duration, 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-cyan-500/40 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      {/* CSS for waveform animation */}
      <style>{`
        @keyframes wavePulse {
          from { transform: scaleY(0.5); }
          to   { transform: scaleY(1.2); }
        }
      `}</style>

      <div className="max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Audio Upload</h1>
          <p className="text-sm text-white/40 mt-1">
            Attach narration audio to your video — one full file or per-product clips.
          </p>
        </div>

        {/* Mode switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/4 border border-white/8 mb-8 w-fit">
          {([
            { id: 'single' as AudioMode, label: 'Single Audio', icon: Mic2 },
            { id: 'multi' as AudioMode, label: 'Multi Audio', icon: Layers },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === id
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/15 text-white border border-cyan-500/25 shadow-sm'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Single mode ────────────────────────────────────────────────────── */}
        {mode === 'single' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/5">
                <Mic2 size={14} className="text-white/40" />
                <span className="text-sm font-semibold text-white">Full Narration</span>
                <span className="ml-auto text-[11px] text-white/25">One audio file for the entire video</span>
              </div>
              <div className="p-5">
                {singleTrack ? (
                  <div className="space-y-3">
                    <AudioPlayer
                      track={singleTrack}
                      onRemove={() => handleRemove(singleTrack.uid)}
                    />
                    {singleTrack.saving && (
                      <p className="flex items-center gap-1.5 text-xs text-cyan-400/60">
                        <Loader2 size={11} className="animate-spin" /> Saving…
                      </p>
                    )}
                    <TrackMeta track={singleTrack} />
                  </div>
                ) : (
                  <DropZone
                    label="Drop your narration audio here"
                    sublabel="Or click to browse files"
                    onFile={(f) => handleFile(f, null)}
                  />
                )}
              </div>
            </div>

            {singleTrack && <DurationInfo tracks={[singleTrack]} mode="single" />}
          </div>
        )}

        {/* ── Multi mode ─────────────────────────────────────────────────────── */}
        {mode === 'multi' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/5">
                <Layers size={14} className="text-white/40" />
                <span className="text-sm font-semibold text-white">Per-Product Audio</span>
                <span className="ml-auto text-[11px] text-white/25">
                  {filledSlots}/{productCount} uploaded
                </span>
              </div>

              <div className="p-5 space-y-5 divide-y divide-white/5">
                {Array.from({ length: productCount }, (_, i) => i + 1).map((idx) => (
                  <div key={idx} className={idx > 1 ? 'pt-5' : ''}>
                    <ProductSlot
                      index={idx}
                      track={getProductTrack(idx)}
                      onFile={(f) => handleFile(f, idx)}
                      onRemove={() => {
                        const t = getProductTrack(idx);
                        if (t) handleRemove(t.uid);
                      }}
                    />
                    {getProductTrack(idx) && (
                      <div className="pl-[92px] mt-2">
                        <TrackMeta track={getProductTrack(idx)!} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add / remove slot */}
              <div className="px-5 pb-5 flex items-center gap-2">
                <button
                  onClick={() => setProductCount((n) => n + 1)}
                  className="flex items-center gap-2 text-xs font-medium text-cyan-400/60 hover:text-cyan-400 transition-colors"
                >
                  <Plus size={12} /> Add product slot
                </button>
                {productCount > 1 && (
                  <button
                    onClick={() => {
                      const t = getProductTrack(productCount);
                      if (t) handleRemove(t.uid);
                      setProductCount((n) => Math.max(1, n - 1));
                    }}
                    className="ml-auto text-[11px] text-white/20 hover:text-red-400 transition-colors"
                  >
                    Remove last
                  </button>
                )}
              </div>
            </div>

            {/* Summary */}
            {tracks.some((t) => t.productIndex !== null) && (
              <DurationInfo
                tracks={tracks.filter((t) => t.productIndex !== null && t.productIndex <= productCount)}
                mode="multi"
                productCount={productCount}
              />
            )}
          </div>
        )}

        {/* JSON preview */}
        {tracks.length > 0 && (
          <JsonPreview tracks={tracks} mode={mode} />
        )}

        {/* Audio sync panel */}
        {tracks.length > 0 && (
          <div className="mt-6">
            <AudioSyncPanel
              mode={mode}
              singleTrack={singleTrack}
              multiTracks={tracks.filter((t) => t.productIndex !== null)}
              productCount={productCount}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Supporting components ─────────────────────────────────────────────────────

function TrackMeta({ track }: { track: AudioTrack }) {
  return (
    <div className="flex items-center gap-3 px-1 flex-wrap">
      <span className="flex items-center gap-1 text-[10px] text-white/25">
        <Clock size={9} /> {formatDuration(track.duration)}
      </span>
      <span className="flex items-center gap-1 text-[10px] text-white/25">
        <HardDrive size={9} /> {formatBytes(track.fileSizeBytes)}
      </span>
      {track.localPath && (
        <span className="text-[9px] font-mono text-white/15 truncate max-w-xs">{track.localPath}</span>
      )}
      {track.dbId && (
        <span className="flex items-center gap-1 text-[9px] text-emerald-400/50 ml-auto">
          <CheckCircle size={8} /> Saved
        </span>
      )}
    </div>
  );
}

function DurationInfo({
  tracks, mode, productCount,
}: {
  tracks: AudioTrack[];
  mode: AudioMode;
  productCount?: number;
}) {
  const total = tracks.reduce((n, t) => n + t.duration, 0);
  const filled = tracks.length;
  const total_slots = productCount ?? 1;

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Clock size={14} className="text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {mode === 'single' ? formatDuration(total) : `${formatDuration(total)} total`}
            </p>
            <p className="text-[10px] text-white/30 mt-0.5">
              {mode === 'multi'
                ? `${filled} of ${total_slots} product${total_slots !== 1 ? 's' : ''} have audio`
                : 'Full narration duration'}
            </p>
          </div>
        </div>
        {mode === 'multi' && productCount && (
          <div className="flex-1 max-w-[120px] ml-4">
            <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  filled === productCount ? 'bg-emerald-400' : 'bg-cyan-400'
                }`}
                style={{ width: `${(filled / productCount) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JsonPreview({ tracks, mode }: { tracks: AudioTrack[]; mode: AudioMode }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const json = tracks
    .filter((t) => mode === 'single' ? t.productIndex === null : t.productIndex !== null)
    .map((t) => ({
      productIndex: t.productIndex,
      audioPath: t.localPath ?? t.fileName,
      duration: parseFloat(t.duration.toFixed(3)),
    }));

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden mt-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-5 py-3.5 text-left hover:bg-white/3 transition-colors"
      >
        <List size={13} className="text-white/30" />
        <span className="text-xs font-semibold text-white/60">Metadata JSON</span>
        <ChevronRight
          size={12}
          className={`ml-auto text-white/25 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-white/5">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[10px] text-white/25">{json.length} item{json.length !== 1 ? 's' : ''}</span>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-cyan-400 transition-colors"
            >
              {copied ? <CheckCircle size={10} className="text-emerald-400" /> : null}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="px-4 pb-4 text-[11px] text-cyan-300/80 font-mono leading-relaxed overflow-x-auto bg-black/20">
            {JSON.stringify(json, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
