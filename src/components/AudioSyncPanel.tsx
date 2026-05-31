import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  Play, Pause, Scissors, Sliders, CheckCircle, Copy,
  ChevronRight, Download, Loader2, Plus, Minus, Music,
  AlignLeft, Flag,
} from 'lucide-react';
import {
  saveTimeline, updateTimeline, fetchLatestTimeline,
  type TimelineSegment, type AudioTimelineRecord,
} from '../lib/supabase';
import type { AudioMode } from '../pages/AudioUpload';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AudioTrackLike {
  uid: string;
  dbId: string | null;
  productIndex: number | null;
  fileName: string;
  localPath: string | null;
  objectUrl: string | null;
  duration: number;
}

export interface AudioSyncPanelProps {
  mode: AudioMode;
  singleTrack: AudioTrackLike | null;
  multiTracks: AudioTrackLike[];
  productCount: number;
}

type SyncType = 'auto' | 'manual';

// ── Colors ────────────────────────────────────────────────────────────────────

const SEG_COLORS = [
  '#06b6d4', // cyan-500
  '#3b82f6', // blue-500
  '#0ea5e9', // sky-500
  '#14b8a6', // teal-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#f97316', // orange-500
];

function segColor(idx: number) {
  return SEG_COLORS[(idx - 1) % SEG_COLORS.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${Number(sec) < 10 ? '0' + sec : sec}`;
}

function fmtTimeShort(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function parseTimeInput(s: string): number | null {
  const trimmed = s.trim();
  // Accept "M:SS", "M:SS.s", or just seconds "12.5"
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  const match = trimmed.match(/^(\d+):(\d+(\.\d+)?)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

function fmtTimeInput(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${Number(sec) < 10 ? '0' + sec : sec}`;
}

function evenSplit(duration: number, count: number): number[] {
  const step = duration / count;
  return Array.from({ length: count - 1 }, (_, i) =>
    parseFloat(((i + 1) * step).toFixed(2))
  );
}

// ── Timeline drag component ───────────────────────────────────────────────────

interface TimelineProps {
  duration: number;
  markers: number[];
  currentTime: number;
  onMarkersChange: (m: number[]) => void;
  onSeek: (t: number) => void;
  readonly?: boolean;
}

const MIN_SEG = 0.5;

function Timeline({ duration, markers, currentTime, onMarkersChange, onSeek, readonly }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const boundaries = [0, ...markers, duration];
  const segments = boundaries.slice(0, -1).map((start, i) => ({
    start,
    end: boundaries[i + 1],
    pctLeft: (start / duration) * 100,
    pctWidth: ((boundaries[i + 1] - start) / duration) * 100,
    productIndex: i + 1,
  }));

  const cursorPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Global drag tracking
  useEffect(() => {
    if (draggingIdx === null) return;
    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const rawTime = pct * duration;
      const prevBound = draggingIdx > 0 ? markers[draggingIdx - 1] : -Infinity;
      const nextBound = draggingIdx < markers.length - 1 ? markers[draggingIdx + 1] : Infinity;
      const clamped = Math.max(prevBound + MIN_SEG, Math.min(nextBound - MIN_SEG, rawTime));
      onMarkersChange(markers.map((m, i) => (i === draggingIdx ? parseFloat(clamped.toFixed(2)) : m)));
    };
    const onUp = () => setDraggingIdx(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingIdx, markers, duration, onMarkersChange]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingIdx !== null || readonly) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };

  return (
    <div className="select-none">
      {/* Timeline track */}
      <div
        ref={containerRef}
        className="relative h-10 rounded-xl overflow-hidden cursor-pointer"
        onClick={handleTrackClick}
      >
        {/* Segments */}
        {segments.map((seg) => (
          <div
            key={seg.productIndex}
            className="absolute top-0 h-full flex items-center justify-center transition-all"
            style={{
              left: `${seg.pctLeft}%`,
              width: `${seg.pctWidth}%`,
              background: `${segColor(seg.productIndex)}22`,
              borderRight: seg.productIndex < segments.length ? `1px solid rgba(255,255,255,0.1)` : 'none',
            }}
          >
            {seg.pctWidth > 8 && (
              <span
                className="text-[10px] font-bold pointer-events-none"
                style={{ color: segColor(seg.productIndex) }}
              >
                P{seg.productIndex}
              </span>
            )}
          </div>
        ))}

        {/* Segment color fills (brighter top strip) */}
        {segments.map((seg) => (
          <div
            key={`fill-${seg.productIndex}`}
            className="absolute top-0 h-1.5"
            style={{
              left: `${seg.pctLeft}%`,
              width: `${seg.pctWidth}%`,
              background: segColor(seg.productIndex),
            }}
          />
        ))}

        {/* Playback cursor */}
        {duration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-md z-20 pointer-events-none"
            style={{ left: `${cursorPct}%` }}
          >
            <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white" />
          </div>
        )}

        {/* Marker handles */}
        {!readonly && markers.map((time, i) => (
          <div
            key={`handle-${i}`}
            className="absolute top-0 bottom-0 w-4 flex items-center justify-center z-30 cursor-ew-resize group"
            style={{ left: `calc(${(time / duration) * 100}% - 8px)` }}
            onMouseDown={(e) => { e.stopPropagation(); setDraggingIdx(i); }}
          >
            <div className="w-1 h-full bg-white/60 group-hover:bg-white group-hover:w-1.5 transition-all rounded-full" />
          </div>
        ))}

        {/* Border */}
        <div className="absolute inset-0 rounded-xl border border-white/10 pointer-events-none" />
      </div>

      {/* Time ruler */}
      <div className="relative h-5 mt-1">
        <span className="absolute left-0 text-[9px] text-white/25 font-mono">0:00</span>
        {markers.map((time, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 text-[9px] font-mono"
            style={{ left: `${(time / duration) * 100}%`, color: segColor(i + 1) }}
          >
            {fmtTimeShort(time)}
          </span>
        ))}
        <span className="absolute right-0 text-[9px] text-white/25 font-mono">{fmtTimeShort(duration)}</span>
        {duration > 0 && (
          <span
            className="absolute -translate-x-1/2 text-[9px] text-white/60 font-mono"
            style={{ left: `${cursorPct}%` }}
          >
            {fmtTimeShort(currentTime)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Time input ─────────────────────────────────────────────────────────────────

function TimeInput({
  value, onChange, min, max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const [raw, setRaw] = useState(fmtTimeInput(value));
  const [error, setError] = useState(false);

  useEffect(() => { setRaw(fmtTimeInput(value)); setError(false); }, [value]);

  const commit = () => {
    const parsed = parseTimeInput(raw);
    if (
      parsed === null ||
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max)
    ) {
      setError(true);
      setRaw(fmtTimeInput(value));
      return;
    }
    setError(false);
    onChange(parseFloat(parsed.toFixed(2)));
  };

  return (
    <input
      value={raw}
      onChange={(e) => { setRaw(e.target.value); setError(false); }}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={`w-20 text-center font-mono text-xs px-2 py-1.5 rounded-lg border bg-white/5 focus:outline-none transition-colors ${
        error
          ? 'border-red-400/60 text-red-400'
          : 'border-white/12 text-white/70 focus:border-cyan-500/50 hover:border-white/20'
      }`}
    />
  );
}

// ── Mini player for the sync panel ────────────────────────────────────────────

interface MiniPlayerProps {
  src: string;
  duration: number;
  onTimeChange: (t: number) => void;
  seekTo?: number;
}

function MiniPlayer({ src, duration, onTimeChange, seekTo }: MiniPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (seekTo !== undefined && audioRef.current) {
      audioRef.current.currentTime = seekTo;
      setCurrent(seekTo);
    }
  }, [seekTo]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  return (
    <div className="flex items-center gap-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          const t = audioRef.current?.currentTime ?? 0;
          setCurrent(t);
          onTimeChange(t);
        }}
        onEnded={() => { setPlaying(false); setCurrent(0); onTimeChange(0); }}
        preload="metadata"
      />
      <button
        onClick={toggle}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/30 transition-all"
      >
        {playing
          ? <Pause size={11} className="text-cyan-400" />
          : <Play size={11} className="text-cyan-400 ml-px" />}
      </button>
      <span className="text-[11px] font-mono text-white/35">
        {fmtTimeShort(current)} / {fmtTimeShort(duration)}
      </span>
      <span className="text-[10px] text-white/20 ml-auto">Click timeline to seek</span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AudioSyncPanel({ mode, singleTrack, multiTracks, productCount }: AudioSyncPanelProps) {
  const [syncType, setSyncType] = useState<SyncType>('manual');
  const [autoCount, setAutoCount] = useState(productCount || 3);
  const [markers, setMarkers] = useState<number[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTo, setSeekTo] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const totalDuration = singleTrack?.duration ?? 0;
  const audioSrc = singleTrack?.localPath
    ? `file://${singleTrack.localPath}`
    : (singleTrack?.objectUrl ?? '');

  // Initialise markers from even split
  useEffect(() => {
    if (mode !== 'single' || !singleTrack) return;
    setMarkers(evenSplit(singleTrack.duration, autoCount));
  }, [singleTrack, autoCount, mode]);

  // Load any previously saved timeline
  useEffect(() => {
    if (!singleTrack?.dbId) return;
    fetchLatestTimeline(singleTrack.dbId).then((rec) => {
      if (!rec) return;
      setSavedId(rec.id ?? null);
      setSyncType(rec.sync_mode as SyncType);
      const boundaries = rec.timeline.map((s) => s.endTime).slice(0, -1);
      setMarkers(boundaries);
      setAutoCount(rec.product_count);
    });
  }, [singleTrack?.dbId]);

  // ── Derived segments ────────────────────────────────────────────────────────

  const singleSegments: TimelineSegment[] = useMemo(() => {
    if (!singleTrack) return [];
    const bounds = [0, ...markers, singleTrack.duration];
    return bounds.slice(0, -1).map((start, i) => ({
      productIndex: i + 1,
      startTime: start,
      endTime: bounds[i + 1],
      duration: parseFloat((bounds[i + 1] - start).toFixed(3)),
      audioPath: singleTrack.localPath ?? singleTrack.fileName ?? '',
    }));
  }, [singleTrack, markers]);

  const multiSegments: TimelineSegment[] = useMemo(() => {
    return multiTracks
      .filter((t) => t.productIndex !== null && t.productIndex <= productCount)
      .sort((a, b) => (a.productIndex ?? 0) - (b.productIndex ?? 0))
      .map((t) => ({
        productIndex: t.productIndex!,
        startTime: 0,
        endTime: t.duration,
        duration: t.duration,
        audioPath: t.localPath ?? t.fileName ?? '',
      }));
  }, [multiTracks, productCount]);

  const activeSegments = mode === 'single' ? singleSegments : multiSegments;

  // ── Marker manipulation ────────────────────────────────────────────────────

  const addProduct = () => {
    if (!totalDuration) return;
    const newCount = markers.length + 2;
    setAutoCount(newCount);
    setMarkers(evenSplit(totalDuration, newCount));
  };

  const removeProduct = () => {
    if (markers.length === 0) return;
    const newCount = markers.length + 1;
    setAutoCount(newCount - 1);
    setMarkers(evenSplit(totalDuration, newCount - 1));
  };

  const setMarkerHere = (markerIdx: number) => {
    const time = currentTime;
    const prev = markerIdx > 0 ? markers[markerIdx - 1] : -Infinity;
    const next = markerIdx < markers.length - 1 ? markers[markerIdx + 1] : Infinity;
    if (time <= prev + MIN_SEG || time >= next - MIN_SEG) return;
    setMarkers((prev) => prev.map((m, i) => (i === markerIdx ? parseFloat(time.toFixed(2)) : m)));
  };

  const updateMarker = (markerIdx: number, value: number) => {
    setMarkers((prev) => prev.map((m, i) => (i === markerIdx ? value : m)));
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    const record: AudioTimelineRecord = {
      audio_track_id: singleTrack?.dbId ?? null,
      mode,
      sync_mode: syncType,
      product_count: activeSegments.length,
      timeline: activeSegments,
    };

    if (savedId) {
      await updateTimeline(savedId, record);
      setSaving(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } else {
      const saved = await saveTimeline(record);
      setSavedId(saved?.id ?? null);
      setSaving(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    }
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(activeSegments, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // ── Empty state ──────────────────────────────────────────────────────────

  const hasContent = mode === 'single' ? !!singleTrack : multiTracks.length > 0;
  if (!hasContent) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/3 p-6 flex flex-col items-center gap-2 text-center">
        <Music size={20} className="text-white/15" />
        <p className="text-sm text-white/30">Upload audio above to configure synchronization</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/5">
        <Scissors size={14} className="text-white/40" />
        <span className="text-sm font-semibold text-white">Audio Synchronization</span>
        <span className="ml-auto text-[11px] text-white/25">
          {activeSegments.length} product{activeSegments.length !== 1 ? 's' : ''}
          {' · '}
          {fmtTimeShort(activeSegments.reduce((n, s) => n + s.duration, 0))} total
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* ── Multi mode: direct mapping ──────────────────────────────────── */}
        {mode === 'multi' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <AlignLeft size={12} className="text-cyan-400/60" />
              <p className="text-xs text-white/50">
                Multi-audio mode — each file maps directly to its product.
              </p>
            </div>

            {/* Multi timeline bar */}
            {multiSegments.length > 0 && (
              <div className="space-y-2">
                <div className="flex h-8 rounded-xl overflow-hidden border border-white/8">
                  {multiSegments.map((seg) => {
                    const totalMs = multiSegments.reduce((n, s) => n + s.duration, 0) || 1;
                    return (
                      <div
                        key={seg.productIndex}
                        className="flex items-center justify-center text-[10px] font-bold transition-all"
                        style={{
                          width: `${(seg.duration / totalMs) * 100}%`,
                          background: `${segColor(seg.productIndex)}30`,
                          borderRight: '1px solid rgba(255,255,255,0.06)',
                          color: segColor(seg.productIndex),
                        }}
                      >
                        P{seg.productIndex}
                      </div>
                    );
                  })}
                </div>
                {/* top color strip */}
                <div className="flex h-1 rounded-full overflow-hidden">
                  {multiSegments.map((seg) => {
                    const totalMs = multiSegments.reduce((n, s) => n + s.duration, 0) || 1;
                    return (
                      <div
                        key={seg.productIndex}
                        style={{ width: `${(seg.duration / totalMs) * 100}%`, background: segColor(seg.productIndex) }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mapping table */}
            <div className="space-y-2">
              {multiSegments.map((seg) => {
                const track = multiTracks.find((t) => t.productIndex === seg.productIndex);
                return (
                  <div
                    key={seg.productIndex}
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/6 bg-white/2"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                      style={{ background: `${segColor(seg.productIndex)}20`, color: segColor(seg.productIndex), border: `1px solid ${segColor(seg.productIndex)}40` }}
                    >
                      {seg.productIndex}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/70 truncate">{track?.fileName ?? `product_${seg.productIndex}`}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[10px] font-mono text-white/35">0:00</span>
                      <span className="text-[10px] text-white/15">→</span>
                      <span className="text-[10px] font-mono text-white/35">{fmtTimeShort(seg.duration)}</span>
                      <span className="text-[10px] text-white/25 ml-2">{fmtTimeShort(seg.duration)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Single mode ────────────────────────────────────────────────────── */}
        {mode === 'single' && singleTrack && (
          <div className="space-y-5">
            {/* Sync type switcher */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/4 border border-white/8 w-fit">
              {([
                { id: 'auto' as SyncType, label: 'Auto Split', icon: Scissors },
                { id: 'manual' as SyncType, label: 'Manual Markers', icon: Sliders },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSyncType(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                    syncType === id
                      ? 'bg-white/10 text-white border border-white/12'
                      : 'text-white/35 hover:text-white/60'
                  }`}
                >
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>

            {/* Auto split controls */}
            {syncType === 'auto' && (
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/3 border border-white/6">
                <p className="text-xs text-white/50">Split into</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAutoCount((n) => Math.max(1, n - 1))}
                    className="w-6 h-6 flex items-center justify-center rounded-md border border-white/12 text-white/40 hover:text-white hover:bg-white/8 transition-all"
                  >
                    <Minus size={10} />
                  </button>
                  <span className="text-sm font-bold text-white w-6 text-center">{autoCount}</span>
                  <button
                    onClick={() => setAutoCount((n) => Math.min(12, n + 1))}
                    className="w-6 h-6 flex items-center justify-center rounded-md border border-white/12 text-white/40 hover:text-white hover:bg-white/8 transition-all"
                  >
                    <Plus size={10} />
                  </button>
                </div>
                <p className="text-xs text-white/50">equal segments</p>
                <button
                  onClick={() => setMarkers(evenSplit(totalDuration, autoCount))}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/25 hover:bg-cyan-500/25 transition-all"
                >
                  <Scissors size={11} /> Apply Split
                </button>
              </div>
            )}

            {/* Mini player */}
            {audioSrc && (
              <div className="p-3 rounded-xl border border-white/8 bg-white/2">
                <MiniPlayer
                  src={audioSrc}
                  duration={totalDuration}
                  onTimeChange={setCurrentTime}
                  seekTo={seekTo}
                />
              </div>
            )}

            {/* Timeline */}
            <Timeline
              duration={totalDuration}
              markers={markers}
              currentTime={currentTime}
              onMarkersChange={setMarkers}
              onSeek={(t) => { setSeekTo(t); setCurrentTime(t); }}
              readonly={syncType === 'auto'}
            />

            {/* Manual marker table */}
            {syncType === 'manual' && (
              <div className="space-y-3">
                <p className="text-[11px] text-white/35 font-medium uppercase tracking-wider">Time Markers</p>
                <div className="space-y-2">
                  {singleSegments.map((seg, i) => {
                    const isLast = i === singleSegments.length - 1;
                    return (
                      <div
                        key={seg.productIndex}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/6 bg-white/2 group"
                      >
                        {/* Product badge */}
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                          style={{
                            background: `${segColor(seg.productIndex)}18`,
                            color: segColor(seg.productIndex),
                            border: `1px solid ${segColor(seg.productIndex)}35`,
                          }}
                        >
                          {seg.productIndex}
                        </div>

                        <span className="text-[10px] text-white/25 flex-shrink-0">Product {seg.productIndex}</span>

                        <div className="flex items-center gap-1.5 ml-auto">
                          {/* Start time (read-only for first, editable otherwise) */}
                          {i === 0 ? (
                            <span className="w-20 text-center font-mono text-xs text-white/30">0:00.0</span>
                          ) : (
                            <TimeInput
                              value={markers[i - 1]}
                              onChange={(v) => updateMarker(i - 1, v)}
                              min={i >= 2 ? markers[i - 2] + MIN_SEG : MIN_SEG}
                              max={i < markers.length ? markers[i] - MIN_SEG : totalDuration - MIN_SEG}
                            />
                          )}

                          <span className="text-white/20 text-xs">→</span>

                          {/* End time (read-only for last, editable otherwise) */}
                          {isLast ? (
                            <span className="w-20 text-center font-mono text-xs text-white/30">{fmtTimeInput(totalDuration)}</span>
                          ) : (
                            <TimeInput
                              value={markers[i]}
                              onChange={(v) => updateMarker(i, v)}
                              min={i > 0 ? markers[i - 1] + MIN_SEG : MIN_SEG}
                              max={i < markers.length - 1 ? markers[i + 1] - MIN_SEG : totalDuration - MIN_SEG}
                            />
                          )}

                          {/* Duration */}
                          <span className="text-[10px] font-mono text-white/25 w-12 text-right">
                            {fmtTimeShort(seg.duration)}
                          </span>

                          {/* Set here button */}
                          {!isLast && (
                            <button
                              onClick={() => setMarkerHere(i)}
                              title="Set this marker to current playback position"
                              className="w-6 h-6 flex items-center justify-center rounded border border-white/8 text-white/20 hover:text-cyan-400 hover:border-cyan-500/30 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Flag size={9} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add / remove product */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={addProduct}
                    className="flex items-center gap-1.5 text-xs text-cyan-400/50 hover:text-cyan-400 transition-colors"
                  >
                    <Plus size={11} /> Add product
                  </button>
                  {markers.length > 1 && (
                    <button
                      onClick={removeProduct}
                      className="flex items-center gap-1.5 text-xs text-white/20 hover:text-red-400 transition-colors ml-auto"
                    >
                      <Minus size={11} /> Remove last
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Auto split preview (read-only rows) */}
            {syncType === 'auto' && singleSegments.length > 0 && (
              <div className="space-y-2">
                {singleSegments.map((seg) => (
                  <div
                    key={seg.productIndex}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/6 bg-white/2"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                      style={{
                        background: `${segColor(seg.productIndex)}18`,
                        color: segColor(seg.productIndex),
                        border: `1px solid ${segColor(seg.productIndex)}35`,
                      }}
                    >
                      {seg.productIndex}
                    </div>
                    <span className="text-xs text-white/50 flex-1">Product {seg.productIndex}</span>
                    <span className="font-mono text-xs text-white/35">{fmtTimeInput(seg.startTime)}</span>
                    <span className="text-white/20 text-xs">→</span>
                    <span className="font-mono text-xs text-white/35">{fmtTimeInput(seg.endTime)}</span>
                    <span className="text-[10px] text-white/25 w-12 text-right font-mono">{fmtTimeShort(seg.duration)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
          <button
            onClick={handleSave}
            disabled={saving || activeSegments.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              savedOk
                ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
                : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {saving
              ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
              : savedOk
              ? <><CheckCircle size={13} /> Saved</>
              : <><Download size={13} /> Save Timeline</>}
          </button>

          <button
            onClick={() => setShowJson((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
              showJson
                ? 'bg-white/6 border-white/15 text-white/70'
                : 'border-white/8 text-white/35 hover:text-white hover:border-white/20'
            }`}
          >
            <ChevronRight size={13} className={`transition-transform ${showJson ? 'rotate-90' : ''}`} />
            JSON
          </button>

          {showJson && (
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-white/8 text-white/35 hover:text-white hover:border-white/20 transition-all ml-auto"
            >
              {copiedJson ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
              {copiedJson ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* JSON output */}
        {showJson && activeSegments.length > 0 && (
          <div className="rounded-xl border border-white/8 overflow-hidden">
            <pre className="px-4 py-3 text-[11px] text-cyan-300/80 font-mono leading-relaxed overflow-x-auto bg-black/20">
              {JSON.stringify(activeSegments, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
