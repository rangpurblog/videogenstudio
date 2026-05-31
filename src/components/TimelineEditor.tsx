import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  GripVertical, ImageIcon, Video, Trash2, Plus, CheckCircle,
  Loader2, RotateCcw, ChevronDown, ChevronUp, Sliders, Info,
} from 'lucide-react';
import {
  saveTimelineEdit, updateTimelineEdit, fetchLatestTimelineEdit,
  type TrackOverride, type ClipOverride, type TimelineEditRecord,
} from '../lib/supabase';
import type { RenderPlan, DistributionClip, DistributionTrack } from '../electron.d';

// ── Types ─────────────────────────────────────────────────────────────────────

// A local mutable copy of the render plan tracks used for editing
export interface EditableClip extends DistributionClip {
  uid: string; // stable local key for React list
}

export interface EditableTrack {
  productIndex: number;
  startTime: number;
  endTime: number;
  duration: number; // locked to audio duration — read-only
  clips: EditableClip[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MOTION_OPTIONS = [
  { value: 'zoom-in',      label: 'Zoom In' },
  { value: 'zoom-out',     label: 'Zoom Out' },
  { value: 'kenburns-tl',  label: 'Ken Burns ↗' },
  { value: 'kenburns-br',  label: 'Ken Burns ↙' },
  { value: 'kenburns-tr',  label: 'Ken Burns ↖' },
  { value: 'kenburns-bl',  label: 'Ken Burns ↘' },
  { value: 'punch-in',     label: 'Punch In' },
  { value: 'punch-out',    label: 'Punch Out' },
  { value: 'pan-lr',       label: 'Pan →' },
  { value: 'pan-rl',       label: 'Pan ←' },
];

const SEG_COLORS = ['#06b6d4','#3b82f6','#0ea5e9','#14b8a6','#10b981','#f59e0b','#f97316'];
function segColor(idx: number) { return SEG_COLORS[(idx - 1) % SEG_COLORS.length]; }

const MIN_CLIP_DUR = 0.5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function fmtSec(s: number) {
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

function basename(p: string | null) {
  if (!p) return 'blank';
  return p.split(/[\\/]/).pop() ?? p;
}

function planToEditable(plan: RenderPlan): EditableTrack[] {
  return plan.tracks.map((t) => ({
    productIndex: t.productIndex,
    startTime: t.startTime,
    endTime: t.endTime,
    duration: t.duration,
    clips: t.clips.map((c) => ({ ...c, uid: uid() })),
  }));
}

function applyOverrides(base: EditableTrack[], overrides: TrackOverride[]): EditableTrack[] {
  return base.map((track) => {
    const override = overrides.find((o) => o.productIndex === track.productIndex);
    if (!override) return track;
    const clips = track.clips.map((clip, ci) => {
      const co = override.clips.find((c) => c.clipIndex === ci);
      if (!co) return clip;
      return {
        ...clip,
        duration: co.duration ?? clip.duration,
        motion: co.motion ?? clip.motion,
        path: co.path ?? clip.path,
      };
    });
    return { ...track, clips };
  });
}

function tracksToOverrides(edited: EditableTrack[], original: EditableTrack[]): TrackOverride[] {
  const result: TrackOverride[] = [];
  for (const editedTrack of edited) {
    const origTrack = original.find((t) => t.productIndex === editedTrack.productIndex);
    const clipOverrides: ClipOverride[] = [];
    editedTrack.clips.forEach((clip, ci) => {
      const orig = origTrack?.clips[ci];
      const changed =
        !orig ||
        clip.duration !== orig.duration ||
        clip.motion !== orig.motion ||
        clip.path !== orig.path;
      if (changed) {
        clipOverrides.push({ productIndex: editedTrack.productIndex, clipIndex: ci,
          duration: clip.duration, motion: clip.motion ?? undefined, path: clip.path ?? undefined });
      }
    });
    if (clipOverrides.length > 0 || editedTrack.clips.length !== origTrack?.clips.length) {
      result.push({ productIndex: editedTrack.productIndex, clips: clipOverrides });
    }
  }
  return result;
}

// ── Drag-to-resize handle between clips ──────────────────────────────────────

interface DragHandleProps {
  leftClipDur: number;
  rightClipDur: number;
  totalTrackDur: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onCommit: (newLeft: number, newRight: number) => void;
}

function DragHandle({ leftClipDur, rightClipDur, totalTrackDur, containerRef, onCommit }: DragHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startLeft = useRef(leftClipDur);
  const startRight = useRef(rightClipDur);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startLeft.current = leftClipDur;
    startRight.current = rightClipDur;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const pxPerSec = container.getBoundingClientRect().width / totalTrackDur;
      const deltaSec = (e.clientX - startX.current) / pxPerSec;
      const newLeft  = Math.max(MIN_CLIP_DUR, startLeft.current + deltaSec);
      const newRight = Math.max(MIN_CLIP_DUR, startRight.current - deltaSec);
      onCommit(parseFloat(newLeft.toFixed(2)), parseFloat(newRight.toFixed(2)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, containerRef, totalTrackDur, onCommit]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute top-0 bottom-0 w-3 z-30 flex items-center justify-center cursor-ew-resize group -translate-x-1/2
        ${dragging ? 'opacity-100' : 'opacity-0 hover:opacity-100'}
        transition-opacity`}
      style={{ touchAction: 'none' }}
    >
      <div className={`w-0.5 h-full rounded-full transition-all ${dragging ? 'bg-white w-1' : 'bg-white/50 group-hover:bg-white group-hover:w-0.5'}`} />
    </div>
  );
}

// ── Clip row editor ───────────────────────────────────────────────────────────

interface ClipRowProps {
  clip: EditableClip;
  clipIndex: number;
  productIndex: number;
  trackDuration: number;
  totalClips: number;
  canDelete: boolean;
  onChangeDuration: (v: number) => void;
  onChangeMotion: (v: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  color: string;
}

function ClipRow({ clip, clipIndex, productIndex, trackDuration, totalClips, canDelete, onChangeDuration, onChangeMotion, onDelete, onMoveUp, onMoveDown, color }: ClipRowProps) {
  const pct = trackDuration > 0 ? Math.round((clip.duration / trackDuration) * 100) : 0;
  const [durInput, setDurInput] = useState(clip.duration.toFixed(1));
  const [durError, setDurError] = useState(false);

  useEffect(() => { setDurInput(clip.duration.toFixed(1)); setDurError(false); }, [clip.duration]);

  const commitDur = () => {
    const v = parseFloat(durInput);
    if (isNaN(v) || v < MIN_CLIP_DUR) { setDurError(true); setDurInput(clip.duration.toFixed(1)); return; }
    setDurError(false);
    onChangeDuration(parseFloat(v.toFixed(2)));
  };

  return (
    <div
      className="flex items-center gap-2 p-2.5 rounded-xl border border-white/6 bg-white/2 group"
      style={{ borderLeftColor: `${color}40`, borderLeftWidth: 2 }}
    >
      {/* Reorder arrows */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        <button onClick={onMoveUp} disabled={clipIndex === 0}
          className="text-white/15 hover:text-white/50 disabled:opacity-0 transition-all">
          <ChevronUp size={10} />
        </button>
        <button onClick={onMoveDown} disabled={clipIndex === totalClips - 1}
          className="text-white/15 hover:text-white/50 disabled:opacity-0 transition-all">
          <ChevronDown size={10} />
        </button>
      </div>

      {/* Clip index badge */}
      <div className="text-[9px] font-bold w-4 text-center flex-shrink-0" style={{ color: `${color}99` }}>
        {clipIndex + 1}
      </div>

      {/* Type icon */}
      <div className="flex-shrink-0">
        {clip.type === 'video'
          ? <Video size={11} style={{ color }} />
          : clip.type === 'image'
          ? <ImageIcon size={11} style={{ color }} />
          : <div className="w-3 h-3 rounded bg-white/10" />}
      </div>

      {/* File name */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-white/55 truncate font-mono">{basename(clip.path)}</p>
        {clip.looped && (
          <p className="text-[8px] text-amber-400/50">↺ looped</p>
        )}
      </div>

      {/* Duration input */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          value={durInput}
          onChange={(e) => { setDurInput(e.target.value); setDurError(false); }}
          onBlur={commitDur}
          onKeyDown={(e) => e.key === 'Enter' && commitDur()}
          className={`w-14 text-center font-mono text-xs px-1.5 py-1 rounded-lg border bg-white/5 focus:outline-none transition-colors ${
            durError ? 'border-red-400/60 text-red-400' : 'border-white/10 text-white/60 focus:border-cyan-500/40'
          }`}
        />
        <span className="text-[9px] text-white/25">s</span>
        <span className="text-[9px] text-white/20 w-8 text-right">{pct}%</span>
      </div>

      {/* Motion selector */}
      <div className="relative flex-shrink-0">
        <select
          value={clip.motion ?? ''}
          onChange={(e) => onChangeMotion(e.target.value)}
          className="appearance-none bg-white/5 border border-white/10 rounded-lg px-2 pr-5 py-1 text-[10px] text-white/55 focus:outline-none cursor-pointer hover:border-white/20 transition-colors w-28"
          style={{ backgroundImage: 'none' }}
        >
          {MOTION_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <ChevronDown size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={!canDelete}
        className="w-5 h-5 flex items-center justify-center rounded text-white/15 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-0 transition-all flex-shrink-0"
      >
        <Trash2 size={9} />
      </button>
    </div>
  );
}

// ── Track timeline bar (visual + drag handles) ────────────────────────────────

interface TrackBarProps {
  track: EditableTrack;
  color: string;
  onResizeClips: (left: number, right: number, handleIdx: number) => void;
}

function TrackBar({ track, color, onResizeClips }: TrackBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative h-8 rounded-xl overflow-visible flex mb-1 select-none">
      {track.clips.map((clip, ci) => {
        const pct = track.duration > 0 ? (clip.duration / track.duration) * 100 : 0;
        const isVid = clip.type === 'video';
        return (
          <div
            key={clip.uid}
            className="relative flex items-center justify-center text-[9px] font-bold overflow-hidden"
            style={{
              width: `${pct}%`,
              minWidth: 2,
              background: isVid ? `${color}50` : `${color}25`,
              borderRight: ci < track.clips.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none',
              borderRadius: ci === 0 ? '10px 0 0 10px' : ci === track.clips.length - 1 ? '0 10px 10px 0' : '0',
            }}
          >
            {/* top strip */}
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[10px]" style={{ background: color, opacity: isVid ? 0.8 : 0.5 }} />
            {pct > 6 && (
              <span style={{ color }} className="opacity-80">
                {isVid ? '▶' : '◼'}
              </span>
            )}
            {/* Drag handle between clips */}
            {ci < track.clips.length - 1 && (
              <DragHandle
                leftClipDur={clip.duration}
                rightClipDur={track.clips[ci + 1].duration}
                totalTrackDur={track.duration}
                containerRef={containerRef as React.RefObject<HTMLDivElement>}
                onCommit={(newL, newR) => onResizeClips(newL, newR, ci)}
              />
            )}
          </div>
        );
      })}
      {/* Outer border */}
      <div className="absolute inset-0 rounded-xl border border-white/10 pointer-events-none" />
    </div>
  );
}

// ── Main TimelineEditor ───────────────────────────────────────────────────────

export interface TimelineEditorProps {
  plan: RenderPlan;
  audioTimelineId?: string | null;
  onOverridesChange: (overrides: TrackOverride[]) => void;
}

export default function TimelineEditor({ plan, audioTimelineId, onOverridesChange }: TimelineEditorProps) {
  const baseTracks = useMemo(() => planToEditable(plan), [plan]);
  const [tracks, setTracks] = useState<EditableTrack[]>(() => planToEditable(plan));
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);

  // Load persisted edits on mount
  useEffect(() => {
    fetchLatestTimelineEdit(audioTimelineId ?? undefined).then((rec) => {
      if (!rec) return;
      setSavedId(rec.id ?? null);
      setTracks(applyOverrides(planToEditable(plan), rec.edits));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioTimelineId]);

  // Re-initialise when plan changes (e.g. style switch)
  useEffect(() => {
    setTracks(planToEditable(plan));
  }, [plan]);

  // Notify parent whenever tracks change
  const overrides = useMemo(() => tracksToOverrides(tracks, baseTracks), [tracks, baseTracks]);
  useEffect(() => { onOverridesChange(overrides); }, [overrides, onOverridesChange]);

  // ── Mutation helpers ────────────────────────────────────────────────────────

  const updateClip = useCallback((productIndex: number, clipUid: string, patch: Partial<EditableClip>) => {
    setTracks((prev) => prev.map((t) => {
      if (t.productIndex !== productIndex) return t;
      return { ...t, clips: t.clips.map((c) => c.uid === clipUid ? { ...c, ...patch } : c) };
    }));
  }, []);

  const deleteClip = useCallback((productIndex: number, clipUid: string) => {
    setTracks((prev) => prev.map((t) => {
      if (t.productIndex !== productIndex) return t;
      if (t.clips.length <= 1) return t; // keep at least 1
      const remaining = t.clips.filter((c) => c.uid !== clipUid);
      // Redistribute freed duration evenly
      const freed = t.clips.find((c) => c.uid === clipUid)?.duration ?? 0;
      const perClip = freed / remaining.length;
      return { ...t, clips: remaining.map((c) => ({ ...c, duration: parseFloat((c.duration + perClip).toFixed(3)) })) };
    }));
  }, []);

  const moveClip = useCallback((productIndex: number, clipUid: string, direction: 'up' | 'down') => {
    setTracks((prev) => prev.map((t) => {
      if (t.productIndex !== productIndex) return t;
      const idx = t.clips.findIndex((c) => c.uid === clipUid);
      if (idx < 0) return t;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= t.clips.length) return t;
      const clips = [...t.clips];
      [clips[idx], clips[newIdx]] = [clips[newIdx], clips[idx]];
      return { ...t, clips };
    }));
  }, []);

  const resizeClips = useCallback((productIndex: number, handleIdx: number, newLeft: number, newRight: number) => {
    setTracks((prev) => prev.map((t) => {
      if (t.productIndex !== productIndex) return t;
      const clips = t.clips.map((c, ci) => {
        if (ci === handleIdx)     return { ...c, duration: newLeft };
        if (ci === handleIdx + 1) return { ...c, duration: newRight };
        return c;
      });
      return { ...t, clips };
    }));
  }, []);

  const resetTrack = useCallback((productIndex: number) => {
    const orig = baseTracks.find((t) => t.productIndex === productIndex);
    if (!orig) return;
    setTracks((prev) => prev.map((t) => t.productIndex === productIndex ? { ...orig, clips: orig.clips.map((c) => ({ ...c, uid: uid() })) } : t));
  }, [baseTracks]);

  const resetAll = useCallback(() => {
    setTracks(baseTracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, uid: uid() })) })));
  }, [baseTracks]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    const record: TimelineEditRecord = {
      audio_timeline_id: audioTimelineId ?? null,
      style: plan.style,
      edits: overrides,
    };
    if (savedId) {
      await updateTimelineEdit(savedId, overrides);
    } else {
      const saved = await saveTimelineEdit(record);
      setSavedId(saved?.id ?? null);
    }
    setSaving(false);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2500);
  };

  const hasChanges = overrides.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Header actions */}
      <div className="flex items-center gap-2">
        <Sliders size={12} className="text-white/30" />
        <p className="text-[11px] text-white/40 font-medium">
          {hasChanges ? `${overrides.length} track${overrides.length !== 1 ? 's' : ''} modified` : 'No changes — same as auto'}
        </p>
        {hasChanges && (
          <button
            onClick={resetAll}
            className="ml-auto flex items-center gap-1 text-[10px] text-white/25 hover:text-white/60 transition-colors"
          >
            <RotateCcw size={9} /> Reset all
          </button>
        )}
      </div>

      {/* Per-track editors */}
      {tracks.map((track) => {
        const color = segColor(track.productIndex);
        const isExpanded = expandedTrack === track.productIndex;
        const trackHasChanges = overrides.some((o) => o.productIndex === track.productIndex);

        return (
          <div key={track.productIndex} className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
            {/* Track header */}
            <button
              onClick={() => setExpandedTrack(isExpanded ? null : track.productIndex)}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/3 transition-colors text-left"
            >
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}
              >
                {track.productIndex}
              </div>
              <span className="text-xs font-semibold text-white/70">Product {track.productIndex}</span>
              <span className="text-[10px] text-white/30">{fmtSec(track.duration)}</span>
              <span className="text-[10px] text-white/20">{track.clips.length} clip{track.clips.length !== 1 ? 's' : ''}</span>
              {trackHasChanges && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border ml-1" style={{ color: `${color}cc`, borderColor: `${color}40`, background: `${color}10` }}>
                  edited
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {trackHasChanges && (
                  <button
                    onClick={(e) => { e.stopPropagation(); resetTrack(track.productIndex); }}
                    className="text-[9px] text-white/20 hover:text-white/50 transition-colors"
                  >
                    <RotateCcw size={9} />
                  </button>
                )}
                <ChevronDown
                  size={12}
                  className={`text-white/25 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {/* Track timeline bar — always visible */}
            <div className="px-4 pb-2">
              <TrackBar
                track={track}
                color={color}
                onResizeClips={(l, r, hi) => resizeClips(track.productIndex, hi, l, r)}
              />
              {/* Time ruler */}
              <div className="flex justify-between mt-0.5">
                <span className="text-[8px] text-white/15 font-mono">0s</span>
                <span className="text-[8px] text-white/15 font-mono">{fmtSec(track.duration)}</span>
              </div>
            </div>

            {/* Expanded clip list */}
            {isExpanded && (
              <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-1.5">
                <p className="text-[9px] text-white/25 uppercase tracking-wider font-semibold mb-2">Clips — drag handles in timeline bar to resize</p>
                {track.clips.map((clip, ci) => (
                  <ClipRow
                    key={clip.uid}
                    clip={clip}
                    clipIndex={ci}
                    productIndex={track.productIndex}
                    trackDuration={track.duration}
                    totalClips={track.clips.length}
                    canDelete={track.clips.length > 1}
                    color={color}
                    onChangeDuration={(v) => updateClip(track.productIndex, clip.uid, { duration: v })}
                    onChangeMotion={(v) => updateClip(track.productIndex, clip.uid, { motion: v })}
                    onDelete={() => deleteClip(track.productIndex, clip.uid)}
                    onMoveUp={() => moveClip(track.productIndex, clip.uid, 'up')}
                    onMoveDown={() => moveClip(track.productIndex, clip.uid, 'down')}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Save row */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            savedOk
              ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          {saving
            ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
            : savedOk
            ? <><CheckCircle size={11} /> Saved</>
            : 'Save Edits'}
        </button>

        {!hasChanges && (
          <span className="flex items-center gap-1 text-[10px] text-white/20">
            <Info size={9} /> Make changes above to save
          </span>
        )}
      </div>
    </div>
  );
}
