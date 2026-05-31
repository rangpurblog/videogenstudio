import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Trash2, Link, FileText, Sparkles, CheckCircle, AlertCircle,
  Loader2, ChevronDown, GitMerge, Copy, ExternalLink, Download,
  ImageIcon, Video, RefreshCw, Package, Music, Clock, Film, Layers as LayersIcon,
  Sliders, Wand2, ChevronLeft, ChevronRight, FolderOpen,
} from 'lucide-react';
import { parseScript, type ProductMapping } from '../lib/scriptParser';
import {
  saveVideoProject, updateProjectStatus, saveProductAsset,
  fetchLatestTimeline, fetchAudioTracks,
  saveRenderJob, updateRenderJob, fetchLatestTimelineEdit,
  type TimelineSegment, type TrackOverride, type AudioTrackRecord,
} from '../lib/supabase';
import type { FetchProductResult, FetchProgressEvent, VideoProgressEvent, RenderPlan } from '../electron.d';
import TimelineEditor from '../components/TimelineEditor';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductLink {
  id: string;
  url: string;
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

interface ProductFetchState {
  status: FetchStatus;
  progress: string;
  result: FetchProductResult | null;
}

// Which media index is selected per product (for the footage panel)
type FootageSelection = Record<number, { imageIndex: number; videoIndex: number; preferVideo: boolean }>;

type VideoStyle = 'cinematic' | 'product' | 'social' | 'documentary';

// ── Constants ─────────────────────────────────────────────────────────────────

const videoStyles: { value: VideoStyle; label: string; desc: string }[] = [
  { value: 'cinematic',   label: 'Cinematic',        desc: 'High-production, dramatic feel' },
  { value: 'product',     label: 'Product Showcase', desc: 'Clean, professional product demo' },
  { value: 'social',      label: 'Social Media',     desc: 'Fast-paced, engaging content' },
  { value: 'documentary', label: 'Documentary',      desc: 'Informative, narrative style' },
];

const SCRIPT_PLACEHOLDER = `Product 1:
Introduce the wireless earbuds — highlight noise cancellation, 30-hour battery life, and premium sound quality.

Product 2:
Showcase the charging case — mention the compact design and fast-charge feature.

Product 3:
Close with the companion app — personalised EQ settings and intuitive controls.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockResult(index: number): FetchProductResult {
  return {
    success: true, jobId: String(index), productIndex: index,
    title: `Product ${index} — Demo Mode`, images: [], videos: [], source: 'paapi',
  };
}

function fmtDur(seconds: number) {
  if (!seconds || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreateVideo() {
  const [script, setScript] = useState('');
  const [productLinks, setProductLinks] = useState<ProductLink[]>([
    { id: '1', url: '' }, { id: '2', url: '' }, { id: '3', url: '' },
  ]);
  const [fetchStates, setFetchStates] = useState<Record<string, ProductFetchState>>({});
  const [videoStyle, setVideoStyle] = useState<VideoStyle>('product');
  const [genStatus, setGenStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [genMessage, setGenMessage] = useState('');
  const [genProgress, setGenProgress] = useState('');
  const [copiedJson, setCopiedJson] = useState(false);
  const [activeTab, setActiveTab] = useState<'script' | 'preview' | 'footage'>('script');
  const [savedTimeline, setSavedTimeline] = useState<TimelineSegment[] | null>(null);
  const [audioMode, setAudioMode] = useState<'single' | 'multi'>('single');
  const [renderPlan, setRenderPlan] = useState<RenderPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [editMode, setEditMode] = useState<'auto' | 'manual'>('auto');
  const [manualOverrides, setManualOverrides] = useState<TrackOverride[]>([]);
  const [savedAudioTimelineId, setSavedAudioTimelineId] = useState<string | null>(null);
  const [footageSelection, setFootageSelection] = useState<FootageSelection>({});

  // Audio selection
  const [savedAudioTracks, setSavedAudioTracks] = useState<AudioTrackRecord[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);
  const unsubVideoRef = useRef<(() => void) | null>(null);

  const filledLinks = useMemo(() => productLinks.map((l) => l.url), [productLinks]);
  const parseResult = useMemo(() => parseScript(script, filledLinks), [script, filledLinks]);

  // Subscribe to Electron progress events
  useEffect(() => {
    if (!window.electronAPI) return;
    unsubRef.current = window.electronAPI.onFetchProgress((event: FetchProgressEvent) => {
      setFetchStates((prev) => ({
        ...prev,
        [event.jobId]: { ...prev[event.jobId], status: 'loading', progress: event.message },
      }));
    });
    unsubVideoRef.current = window.electronAPI.onVideoProgress((event: VideoProgressEvent) => {
      setGenProgress(event.message);
    });
    return () => { unsubRef.current?.(); unsubVideoRef.current?.(); };
  }, []);

  // Load latest audio timeline + saved audio tracks on mount
  useEffect(() => {
    fetchLatestTimeline().then((rec) => {
      if (rec) {
        setSavedTimeline(rec.timeline);
        setAudioMode(rec.mode);
        setSavedAudioTimelineId(rec.id ?? null);
        if (rec.audio_track_id) setSelectedAudioId(rec.audio_track_id);
      }
    });
    fetchAudioTracks().then((tracks) => {
      setSavedAudioTracks(tracks);
    });
  }, []);

  // Recompute distribution preview when timeline or style changes
  useEffect(() => {
    if (!savedTimeline || savedTimeline.length === 0 || !window.electronAPI?.previewDistribution) {
      setRenderPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    window.electronAPI.previewDistribution({ timelineSegments: savedTimeline, style: videoStyle, quality: '1080p' })
      .then((res) => {
        if (!cancelled) {
          setRenderPlan(res.success ? (res.plan ?? null) : null);
          setPlanLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [savedTimeline, videoStyle]);

  // ── Product link mutations ─────────────────────────────────────────────────

  const addLink = useCallback(() => {
    setProductLinks((prev) => [...prev, { id: Date.now().toString(), url: '' }]);
  }, []);

  const removeLink = useCallback((id: string) => {
    if (productLinks.length <= 1) return;
    setProductLinks((prev) => prev.filter((l) => l.id !== id));
    setFetchStates((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, [productLinks.length]);

  const updateLink = useCallback((id: string, url: string) => {
    setProductLinks((prev) => prev.map((l) => (l.id === id ? { ...l, url } : l)));
    setFetchStates((prev) => prev[id] ? { ...prev, [id]: { status: 'idle', progress: '', result: null } } : prev);
  }, []);

  // ── Fetch single product ──────────────────────────────────────────────────

  const fetchOne = useCallback(async (link: ProductLink, index: number) => {
    if (!link.url.trim()) return;
    const jobId = link.id;
    setFetchStates((prev) => ({ ...prev, [jobId]: { status: 'loading', progress: 'Starting…', result: null } }));

    let result: FetchProductResult;
    if (window.electronAPI) {
      result = await window.electronAPI.fetchProduct({ jobId, productUrl: link.url, productIndex: index + 1 });
    } else {
      await new Promise((r) => setTimeout(r, 1500));
      result = makeMockResult(index + 1);
    }

    setFetchStates((prev) => ({
      ...prev,
      [jobId]: { status: result.success ? 'success' : 'error', progress: '', result },
    }));

    if (result.success) {
      await saveProductAsset({ productIndex: index + 1, sourceUrl: link.url, result });
    }
  }, []);

  // ── Fetch all ─────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const toFetch = productLinks
      .map((l, i) => ({ link: l, index: i }))
      .filter(({ link }) => {
        if (!link.url.trim()) return false;
        const s = fetchStates[link.id];
        return !s || s.status === 'idle' || s.status === 'error';
      });

    if (window.electronAPI) {
      const products = toFetch.map(({ link, index }) => ({
        jobId: link.id, productUrl: link.url, productIndex: index + 1,
      }));
      for (const item of toFetch) {
        setFetchStates((prev) => ({
          ...prev,
          [item.link.id]: { status: 'loading', progress: 'Queued…', result: null },
        }));
      }
      const results = await window.electronAPI.fetchAllProducts({ products });
      for (const r of results) {
        setFetchStates((prev) => ({
          ...prev,
          [r.jobId]: { status: r.success ? 'success' : 'error', progress: '', result: r },
        }));
        if (r.success) {
          const link = productLinks.find((l) => l.id === r.jobId);
          if (link) await saveProductAsset({ productIndex: r.productIndex, sourceUrl: link.url, result: r });
        }
      }
    } else {
      for (const { link, index } of toFetch) await fetchOne(link, index);
    }
  }, [productLinks, fetchStates, fetchOne]);

  // ── Copy JSON ─────────────────────────────────────────────────────────────

  const handleCopyJson = () => {
    const enriched = parseResult.mappings.map((m) => {
      const link = productLinks[m.productIndex - 1];
      const fetchState = link ? fetchStates[link.id] : undefined;
      return {
        productIndex: m.productIndex,
        script: m.script,
        link: m.link,
        title: fetchState?.result?.title ?? null,
        images: fetchState?.result?.images?.map((img) => img.localPath || img.url) ?? [],
        videos: fetchState?.result?.videos?.map((v) => v.localPath || v.url) ?? [],
      };
    });
    navigator.clipboard.writeText(JSON.stringify(enriched, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // ── Generate video ─────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!script.trim() || parseResult.mappings.length === 0) return;
    setGenStatus('loading');
    setGenMessage('');
    setGenProgress('Preparing…');

    try {
      const saved = await saveVideoProject({ script, videoStyle, mappings: parseResult.mappings });

      const settings = await window.electronAPI?.loadSettings?.();
      const quality = settings?.quality ?? '1080p';

      let result: { success: boolean; message: string; outputPath?: string | null; planOnly?: boolean };

      if (window.electronAPI) {
        if (!savedTimeline || savedTimeline.length === 0) {
          setGenStatus('error');
          setGenMessage('No audio timeline. Go to Audio Upload, add audio and save the sync timeline first.');
          setGenProgress('');
          return;
        }

        // Apply selected audio path override if user picked a different track
        let segments = savedTimeline;
        if (selectedAudioId && audioMode === 'single') {
          const chosenTrack = savedAudioTracks.find((t) => t.id === selectedAudioId);
          if (chosenTrack?.local_path) {
            segments = savedTimeline.map((seg) => ({ ...seg, audioPath: chosenTrack.local_path }));
          }
        }

        result = await window.electronAPI.generateVideo({
          timelineSegments: segments,
          audioMode,
          style: videoStyle,
          quality,
          projectId: saved?.id,
          manualOverrides: editMode === 'manual' ? manualOverrides : [],
        });
      } else {
        await new Promise<void>((r) => setTimeout(r, 1500));
        result = { success: true, message: 'Video generation queued (demo mode).', planOnly: true };
      }

      if (saved?.id) await updateProjectStatus(saved.id, result.success ? 'completed' : 'error');

      const totalDuration = savedTimeline?.reduce((n, s) => n + s.duration, 0) ?? 0;
      await saveRenderJob({
        project_id: saved?.id ?? null,
        style: videoStyle,
        quality,
        audio_mode: audioMode,
        total_duration: totalDuration,
        product_count: savedTimeline?.length ?? 0,
        output_path: (result as { outputPath?: string | null }).outputPath ?? '',
        plan_path: (result as { planPath?: string }).planPath ?? '',
        plan_only: result.planOnly ?? false,
        status: result.success ? 'completed' : 'error',
        error_message: result.success ? '' : result.message,
      });

      setGenStatus(result.success ? 'success' : 'error');
      if (result.success && result.planOnly) {
        setGenMessage('Render plan saved. Install FFmpeg to enable video export.');
      } else if (result.success && result.outputPath) {
        setGenMessage(`Video saved: ${result.outputPath}`);
      } else if (!result.success) {
        setGenMessage(result.message || 'Generation failed.');
      }
      setGenProgress('');
    } catch {
      setGenStatus('error');
      setGenMessage('An unexpected error occurred.');
      setGenProgress('');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const anyFetching = Object.values(fetchStates).some((s) => s.status === 'loading');
  const fetchedCount = Object.values(fetchStates).filter((s) => s.status === 'success').length;
  const filledLinkCount = productLinks.filter((l) => l.url.trim()).length;
  const canGenerate = script.trim().length > 0 && parseResult.mappings.length > 0 && genStatus !== 'loading';

  // Footage tab: only show when at least one product has been fetched
  const hasAnyFootage = fetchedCount > 0;

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Create Video</h1>
          <p className="text-sm text-white/40 mt-1">
            Write a script with{' '}
            <code className="text-cyan-400/80 font-mono text-xs bg-cyan-500/10 px-1 py-0.5 rounded">Product N:</code>{' '}
            sections, add links, select footage and audio, then generate.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_380px] gap-5 items-start">
          {/* ── Left column ───────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Script / Preview / Footage tabs */}
            <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
              <div className="flex items-center border-b border-white/5">
                {[
                  { id: 'script'  as const, label: 'Script',          icon: FileText },
                  { id: 'preview' as const, label: 'Mapping Preview', icon: GitMerge },
                  { id: 'footage' as const, label: 'Footage',         icon: Film     },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all ${
                      activeTab === id
                        ? 'border-cyan-400 text-white'
                        : 'border-transparent text-white/35 hover:text-white/60'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                    {id === 'preview' && parseResult.mappings.length > 0 && (
                      <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/20">
                        {parseResult.mappings.length}
                      </span>
                    )}
                    {id === 'footage' && fetchedCount > 0 && (
                      <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/20">
                        {fetchedCount}
                      </span>
                    )}
                  </button>
                ))}
                {activeTab === 'script' && (
                  <span className="ml-auto px-4 text-[11px] text-white/25">{script.length} chars</span>
                )}
              </div>

              {activeTab === 'script' && (
                <div className="p-4">
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder={SCRIPT_PLACEHOLDER}
                    rows={16}
                    className="w-full bg-transparent text-sm text-white/80 placeholder-white/15 resize-none focus:outline-none leading-relaxed font-mono"
                  />
                </div>
              )}

              {activeTab === 'preview' && (
                <MappingPreview
                  mappings={parseResult.mappings}
                  productLinks={productLinks}
                  fetchStates={fetchStates}
                  unmappedLinks={parseResult.unmappedLinks}
                  missingSections={parseResult.missingSections}
                  onCopyJson={handleCopyJson}
                  copiedJson={copiedJson}
                />
              )}

              {activeTab === 'footage' && (
                <FootagePanel
                  productLinks={productLinks}
                  fetchStates={fetchStates}
                  parseResult={parseResult}
                  footageSelection={footageSelection}
                  setFootageSelection={setFootageSelection}
                />
              )}
            </div>

            {/* Video Style */}
            <div className="rounded-xl border border-white/8 bg-white/3 p-4">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Video Style</p>
              <div className="grid grid-cols-2 gap-2">
                {videoStyles.map(({ value, label, desc }) => (
                  <label
                    key={value}
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      videoStyle === value
                        ? 'bg-cyan-500/10 border border-cyan-500/20'
                        : 'hover:bg-white/4 border border-white/5'
                    }`}
                  >
                    <input
                      type="radio" name="style" value={value} checked={videoStyle === value}
                      onChange={() => setVideoStyle(value)} className="sr-only"
                    />
                    <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex-shrink-0 flex items-center justify-center ${videoStyle === value ? 'border-cyan-400' : 'border-white/20'}`}>
                      {videoStyle === value && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white/80">{label}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right column ──────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Product Links */}
            <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <Link size={13} className="text-white/40" />
                <span className="text-sm font-semibold text-white">Product Links</span>
                <span className="ml-auto text-[11px] text-white/25">
                  {productLinks.filter((l) => l.url).length}/{productLinks.length}
                </span>
              </div>
              <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                {productLinks.map((link, index) => {
                  const isMapped = parseResult.mappings.some((m) => m.productIndex === index + 1);
                  const fs = fetchStates[link.id];
                  return (
                    <div key={link.id} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <div className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold font-mono transition-all ${
                          isMapped ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-white/25 border border-white/5'
                        }`}>
                          {index + 1}
                        </div>
                        <input
                          type="url" value={link.url}
                          onChange={(e) => updateLink(link.id, e.target.value)}
                          placeholder="https://amazon.com/dp/..."
                          className={`flex-1 min-w-0 bg-white/5 border rounded-lg px-2.5 py-1.5 text-xs text-white/70 placeholder-white/15 focus:outline-none transition-all ${
                            isMapped ? 'border-cyan-500/30 focus:border-cyan-500/60' : 'border-white/8 focus:border-white/25'
                          }`}
                        />
                        <button
                          onClick={() => fetchOne(link, index)}
                          disabled={!link.url.trim() || fs?.status === 'loading'}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-all flex-shrink-0 ${
                            fs?.status === 'loading' ? 'text-cyan-400' :
                            fs?.status === 'success' ? 'text-emerald-400 hover:text-emerald-300' :
                            'text-white/20 hover:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30 disabled:cursor-not-allowed'
                          }`}
                        >
                          {fs?.status === 'loading' ? <Loader2 size={11} className="animate-spin" /> :
                           fs?.status === 'success' ? <CheckCircle size={11} /> :
                           fs?.status === 'error'   ? <RefreshCw size={11} className="text-red-400" /> :
                           <Download size={11} />}
                        </button>
                        <button
                          onClick={() => removeLink(link.id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      {fs?.status === 'loading' && fs.progress && (
                        <p className="text-[10px] text-cyan-400/60 pl-7 truncate">{fs.progress}</p>
                      )}
                      {fs?.status === 'success' && fs.result && (
                        <ProductResultRow result={fs.result} />
                      )}
                      {fs?.status === 'error' && (
                        <p className="text-[10px] text-red-400/60 pl-7 truncate">{fs.result?.error || 'Fetch failed'}</p>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={addLink}
                  className="flex items-center gap-1.5 text-[11px] text-cyan-400/50 hover:text-cyan-400 transition-colors mt-1 px-1"
                >
                  <Plus size={10} /> Add link
                </button>
              </div>
              {filledLinkCount > 0 && (
                <div className="px-3 pb-3">
                  <button
                    onClick={fetchAll}
                    disabled={anyFetching}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-white/8 text-xs font-semibold text-white/50 hover:text-white hover:border-cyan-500/30 hover:bg-cyan-500/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {anyFetching
                      ? <><Loader2 size={11} className="animate-spin" /> Fetching…</>
                      : <><Package size={11} /> Fetch All Products ({filledLinkCount})</>
                    }
                  </button>
                </div>
              )}
            </div>

            {/* ── Audio Selection ── */}
            <AudioSelector
              tracks={savedAudioTracks}
              selectedId={selectedAudioId}
              onSelect={setSelectedAudioId}
              savedTimeline={savedTimeline}
              audioMode={audioMode}
            />

            {/* Script Coverage */}
            <ParseSummary
              total={productLinks.length}
              mapped={parseResult.mappings.length}
              missingSections={parseResult.missingSections}
            />

            {/* Gen status */}
            {genStatus === 'success' && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-400 leading-relaxed">{genMessage}</p>
              </div>
            )}
            {genStatus === 'error' && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 leading-relaxed">{genMessage}</p>
              </div>
            )}

            {/* Audio timeline status */}
            <AudioTimelineStatus timeline={savedTimeline} audioMode={audioMode} />

            {/* Auto / Manual distribution toggle */}
            {(renderPlan || planLoading) && (
              <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
                <div className="flex items-center gap-1 p-1.5 border-b border-white/5">
                  <button
                    onClick={() => setEditMode('auto')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 justify-center transition-all ${
                      editMode === 'auto'
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/15 text-white border border-cyan-500/25 shadow-sm'
                        : 'text-white/35 hover:text-white/60'
                    }`}
                  >
                    <Wand2 size={11} /> Auto
                  </button>
                  <button
                    onClick={() => setEditMode('manual')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 justify-center transition-all ${
                      editMode === 'manual'
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/15 text-white border border-cyan-500/25 shadow-sm'
                        : 'text-white/35 hover:text-white/60'
                    }`}
                  >
                    <Sliders size={11} /> Manual
                  </button>
                </div>
                <div className="p-3">
                  {editMode === 'auto' ? (
                    <VisualDistributionPreview plan={renderPlan} loading={planLoading} />
                  ) : renderPlan ? (
                    <TimelineEditor
                      plan={renderPlan}
                      audioTimelineId={savedAudioTimelineId}
                      onOverridesChange={setManualOverrides}
                    />
                  ) : (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 size={11} className="text-white/30 animate-spin" />
                      <p className="text-[11px] text-white/30">Computing plan…</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Live progress */}
            {genStatus === 'loading' && genProgress && (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5">
                <Loader2 size={11} className="text-cyan-400 animate-spin flex-shrink-0" />
                <p className="text-xs text-cyan-400/80 truncate">{genProgress}</p>
              </div>
            )}

            {/* Generate */}
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 ${
                canGenerate
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-400 hover:to-blue-400 active:scale-[0.99]'
                  : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
              }`}
            >
              {genStatus === 'loading'
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : <><Sparkles size={14} /> Generate Video</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FootagePanel ──────────────────────────────────────────────────────────────

interface FootagePanelProps {
  productLinks: ProductLink[];
  fetchStates: Record<string, ProductFetchState>;
  parseResult: { mappings: ProductMapping[] };
  footageSelection: FootageSelection;
  setFootageSelection: React.Dispatch<React.SetStateAction<FootageSelection>>;
}

function FootagePanel({ productLinks, fetchStates, parseResult, footageSelection, setFootageSelection }: FootagePanelProps) {
  const products = productLinks
    .map((link, i) => {
      const fs = fetchStates[link.id];
      const mapping = parseResult.mappings.find((m) => m.productIndex === i + 1);
      return { index: i + 1, link, fs, mapping };
    })
    .filter(({ fs }) => fs?.status === 'success' && fs.result);

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <Film size={28} className="text-white/10 mb-3" />
        <p className="text-sm text-white/30">No footage yet</p>
        <p className="text-xs text-white/20 mt-1">
          Add product links and click the download button to fetch images &amp; videos.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/5">
      {products.map(({ index, fs, mapping }) => {
        const result = fs!.result!;
        const images = result.images ?? [];
        const videos = result.videos ?? [];
        const sel = footageSelection[index] ?? { imageIndex: 0, videoIndex: 0, preferVideo: videos.length > 0 };

        const setForProduct = (patch: Partial<typeof sel>) => {
          setFootageSelection((prev) => ({ ...prev, [index]: { ...sel, ...patch } }));
        };

        const currentImage = images[sel.imageIndex];
        const currentVideo = videos[sel.videoIndex];
        const activeIsVideo = sel.preferVideo && videos.length > 0;

        const colors = ['#06b6d4','#3b82f6','#0ea5e9','#14b8a6','#10b981','#f59e0b','#f97316'];
        const color = colors[(index - 1) % colors.length];

        return (
          <div key={index} className="p-4">
            {/* Product header */}
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}
              >
                {index}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white/80 truncate">
                  {result.title || `Product ${index}`}
                </p>
                {mapping?.script && (
                  <p className="text-[10px] text-white/30 truncate mt-0.5">{mapping.script.slice(0, 80)}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-white/30 flex-shrink-0">
                <ImageIcon size={9} /> {images.length}
                <Video size={9} className="ml-1" /> {videos.length}
              </div>
            </div>

            {/* Image / Video type switcher */}
            {videos.length > 0 && (
              <div className="flex gap-1 mb-3">
                <button
                  onClick={() => setForProduct({ preferVideo: false })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                    !activeIsVideo
                      ? 'bg-white/10 text-white border border-white/15'
                      : 'text-white/30 hover:text-white/60'
                  }`}
                >
                  <ImageIcon size={9} /> Images ({images.length})
                </button>
                <button
                  onClick={() => setForProduct({ preferVideo: true })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                    activeIsVideo
                      ? 'bg-white/10 text-white border border-white/15'
                      : 'text-white/30 hover:text-white/60'
                  }`}
                >
                  <Video size={9} /> Videos ({videos.length})
                </button>
              </div>
            )}

            {/* Media carousel */}
            {!activeIsVideo && images.length > 0 && (
              <MediaCarousel
                items={images.map((img) => ({
                  src: img.localPath ? `file://${img.localPath}` : img.url,
                  label: img.localPath ? 'local' : 'remote',
                  type: 'image',
                }))}
                currentIndex={sel.imageIndex}
                onPrev={() => setForProduct({ imageIndex: Math.max(0, sel.imageIndex - 1) })}
                onNext={() => setForProduct({ imageIndex: Math.min(images.length - 1, sel.imageIndex + 1) })}
                onSelect={(i) => setForProduct({ imageIndex: i })}
                color={color}
              />
            )}

            {activeIsVideo && videos.length > 0 && (
              <MediaCarousel
                items={videos.map((vid) => ({
                  src: vid.localPath ? `file://${vid.localPath}` : vid.url,
                  label: vid.localPath ? 'local' : 'remote',
                  type: 'video',
                }))}
                currentIndex={sel.videoIndex}
                onPrev={() => setForProduct({ videoIndex: Math.max(0, sel.videoIndex - 1) })}
                onNext={() => setForProduct({ videoIndex: Math.min(videos.length - 1, sel.videoIndex + 1) })}
                onSelect={(i) => setForProduct({ videoIndex: i })}
                color={color}
              />
            )}

            {images.length === 0 && videos.length === 0 && (
              <p className="text-[10px] text-white/25 text-center py-4">No media downloaded for this product.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── MediaCarousel ─────────────────────────────────────────────────────────────

interface MediaItem { src: string; label: string; type: 'image' | 'video'; }

function MediaCarousel({ items, currentIndex, onPrev, onNext, onSelect, color }: {
  items: MediaItem[];
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (i: number) => void;
  color: string;
}) {
  const current = items[currentIndex];
  if (!current) return null;

  return (
    <div>
      {/* Main preview */}
      <div className="relative rounded-xl overflow-hidden bg-black/30 border border-white/8 mb-2" style={{ aspectRatio: '16/9' }}>
        {current.type === 'image' ? (
          <img
            src={current.src}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }}
          />
        ) : (
          <video
            src={current.src}
            className="w-full h-full object-contain"
            controls
            muted
            preload="metadata"
          />
        )}
        {/* Nav arrows */}
        {items.length > 1 && (
          <>
            <button
              onClick={onPrev}
              disabled={currentIndex === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 border border-white/15 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 disabled:opacity-0 transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={onNext}
              disabled={currentIndex === items.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 border border-white/15 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 disabled:opacity-0 transition-all"
            >
              <ChevronRight size={14} />
            </button>
            {/* Counter */}
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/60 border border-white/10 text-[9px] text-white/60 font-mono">
              {currentIndex + 1} / {items.length}
            </div>
          </>
        )}
        {/* Local badge */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[8px] font-semibold"
          style={{ background: `${color}30`, color, border: `1px solid ${color}40` }}>
          {current.label}
        </div>
      </div>

      {/* Thumbnail strip */}
      {items.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                i === currentIndex ? 'opacity-100' : 'opacity-40 hover:opacity-70'
              }`}
              style={{ borderColor: i === currentIndex ? color : 'transparent' }}
            >
              {item.type === 'image' ? (
                <img src={item.src} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/5 flex items-center justify-center">
                  <Video size={14} className="text-white/40" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AudioSelector ─────────────────────────────────────────────────────────────

function AudioSelector({
  tracks, selectedId, onSelect, savedTimeline, audioMode,
}: {
  tracks: AudioTrackRecord[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  savedTimeline: TimelineSegment[] | null;
  audioMode: string;
}) {
  const hasTimeline = !!savedTimeline && savedTimeline.length > 0;
  const timelineDur = savedTimeline?.reduce((n, s) => n + s.duration, 0) ?? 0;

  // Only show single-mode tracks for the "full narration" selection
  const singleTracks = tracks.filter((t) => t.mode === 'single');
  const multiTracks = tracks.filter((t) => t.mode === 'multi');
  const displayTracks = audioMode === 'single' ? singleTracks : multiTracks;

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <Music size={13} className="text-white/40" />
        <span className="text-sm font-semibold text-white">Audio</span>
        {hasTimeline && (
          <span className="ml-auto text-[10px] text-white/30 flex items-center gap-1">
            <Clock size={9} /> {fmtDur(timelineDur)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        {!hasTimeline && (
          <p className="text-[11px] text-amber-400/70 leading-relaxed">
            No audio timeline synced. Go to <strong>Audio Upload</strong> to add audio and save a timeline.
          </p>
        )}

        {hasTimeline && displayTracks.length === 0 && (
          <p className="text-[11px] text-white/25">
            No saved audio tracks. Go to <strong>Audio Upload</strong> to add audio files.
          </p>
        )}

        {hasTimeline && displayTracks.length > 0 && (
          <>
            <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
              {audioMode === 'single' ? 'Select narration audio' : 'Per-product audio tracks'}
            </p>
            {displayTracks.map((track) => {
              const isSelected = track.id === selectedId;
              return (
                <button
                  key={track.id}
                  onClick={() => onSelect(isSelected ? null : (track.id ?? null))}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-cyan-500/30 bg-cyan-500/8'
                      : 'border-white/6 bg-white/2 hover:border-white/15 hover:bg-white/4'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'bg-cyan-500/20' : 'bg-white/5'
                  }`}>
                    <Music size={12} className={isSelected ? 'text-cyan-400' : 'text-white/30'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isSelected ? 'text-cyan-300' : 'text-white/65'}`}>
                      {track.file_name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {track.duration_seconds > 0 && (
                        <span className="text-[9px] text-white/25 flex items-center gap-0.5">
                          <Clock size={7} /> {fmtDur(track.duration_seconds)}
                        </span>
                      )}
                      {track.product_index !== null && (
                        <span className="text-[9px] text-white/25">
                          Product {track.product_index}
                        </span>
                      )}
                    </div>
                  </div>
                  {isSelected && <CheckCircle size={12} className="text-cyan-400 flex-shrink-0" />}
                </button>
              );
            })}
          </>
        )}

        <a
          href="#audio-upload"
          onClick={(e) => { e.preventDefault(); document.querySelector('[data-page="audio"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }}
          className="flex items-center gap-1.5 text-[10px] text-white/25 hover:text-cyan-400 transition-colors mt-1 px-1"
        >
          <FolderOpen size={9} /> Manage audio in Audio Upload
        </a>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProductResultRow({ result }: { result: FetchProductResult }) {
  const firstImage = result.images.find((img) => img.localPath || img.url);
  return (
    <div className="flex items-center gap-2 pl-7">
      {firstImage && (
        <div className="w-8 h-8 rounded bg-white/5 border border-white/8 overflow-hidden flex-shrink-0">
          <img
            src={firstImage.localPath ? `file://${firstImage.localPath}` : firstImage.url}
            alt="" className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-white/60 font-medium truncate">{result.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="flex items-center gap-0.5 text-[9px] text-white/25"><ImageIcon size={8} /> {result.images.length}</span>
          <span className="flex items-center gap-0.5 text-[9px] text-white/25"><Video size={8} /> {result.videos.length}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
            result.source === 'paapi' ? 'text-cyan-400/60 bg-cyan-500/8' : 'text-amber-400/60 bg-amber-500/8'
          }`}>
            {result.source}
          </span>
        </div>
      </div>
    </div>
  );
}

interface MappingPreviewProps {
  mappings: ProductMapping[];
  productLinks: Array<{ id: string; url: string }>;
  fetchStates: Record<string, ProductFetchState>;
  unmappedLinks: string[];
  missingSections: number[];
  onCopyJson: () => void;
  copiedJson: boolean;
}

function MappingPreview({
  mappings, productLinks, fetchStates, unmappedLinks, missingSections, onCopyJson, copiedJson,
}: MappingPreviewProps) {
  if (mappings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <GitMerge size={28} className="text-white/10 mb-3" />
        <p className="text-sm text-white/30">No mappings yet</p>
        <p className="text-xs text-white/20 mt-1 leading-relaxed">
          Add <code className="text-cyan-400/60 font-mono">Product 1:</code>,{' '}
          <code className="text-cyan-400/60 font-mono">Product 2:</code> sections to your script
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-white/30">{mappings.length} section{mappings.length !== 1 ? 's' : ''} mapped</p>
        <button onClick={onCopyJson} className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-cyan-400 transition-colors">
          {copiedJson ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
          {copiedJson ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>
      {mappings.map((m) => {
        const link = productLinks[m.productIndex - 1];
        const fs = link ? fetchStates[link.id] : undefined;
        return <MappingCard key={m.productIndex} mapping={m} fetchState={fs} />;
      })}
      {unmappedLinks.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/8 border border-amber-500/15">
          <p className="text-[11px] text-amber-400/80 font-semibold mb-1">
            {unmappedLinks.length} link{unmappedLinks.length !== 1 ? 's' : ''} not in script
          </p>
          {unmappedLinks.map((l, i) => <p key={i} className="text-[10px] text-white/25 truncate">{l || '(empty)'}</p>)}
        </div>
      )}
      {missingSections.length > 0 && (
        <div className="p-3 rounded-lg bg-red-500/8 border border-red-500/15">
          <p className="text-[11px] text-red-400/80">
            Script references Product {missingSections.join(', ')} — no link provided
          </p>
        </div>
      )}
    </div>
  );
}

interface FetchStateLocal { status: FetchStatus; progress: string; result: FetchProductResult | null; }

function MappingCard({ mapping, fetchState }: { mapping: ProductMapping; fetchState?: FetchStateLocal }) {
  const hasLink = !!mapping.link;
  const r = fetchState?.result;
  const firstImg = r?.images.find((i) => i.localPath || i.url);

  return (
    <div className={`rounded-lg border p-3 transition-all ${hasLink ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-white/8 bg-white/2'}`}>
      <div className="flex items-start gap-2.5 mb-2">
        {firstImg ? (
          <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 border border-white/8">
            <img src={firstImg.localPath ? `file://${firstImg.localPath}` : firstImg.url} alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-md bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0">
            <ImageIcon size={12} className="text-white/15" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              hasLink ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' : 'bg-white/5 text-white/30 border-white/8'
            }`}>
              Product {mapping.productIndex}
            </span>
            {fetchState?.status === 'loading' && <Loader2 size={10} className="animate-spin text-cyan-400" />}
            {r && (
              <div className="flex items-center gap-1.5 text-[9px] text-white/30">
                <span className="flex items-center gap-0.5"><ImageIcon size={8} /> {r.images.length}</span>
                <span className="flex items-center gap-0.5"><Video size={8} /> {r.videos.length}</span>
              </div>
            )}
          </div>
          {r?.title && <p className="text-[11px] text-white/70 font-medium truncate mt-0.5">{r.title}</p>}
          {hasLink && (
            <a href={mapping.link} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-cyan-400/50 hover:text-cyan-400 transition-colors truncate mt-0.5">
              <ExternalLink size={8} />
              {mapping.link.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed line-clamp-2 mt-1">
        {mapping.script || <em className="text-white/20">Empty section</em>}
      </p>
    </div>
  );
}

function ParseSummary({ total, mapped, missingSections }: {
  total: number; mapped: number; missingSections: number[];
}) {
  const pct = total === 0 ? 0 : Math.round((mapped / total) * 100);
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-white/40 font-medium">Script Coverage</p>
        <p className="text-[11px] text-white/50 font-mono">{mapped}/{total}</p>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-cyan-400' : 'bg-white/10'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-white/25">
        {mapped === 0 ? 'Add Product N: sections to your script' : pct === 100 ? 'All links matched' : `${total - mapped} unmatched`}
      </p>
      {missingSections.length > 0 && (
        <p className="text-[10px] text-amber-400/70 mt-1">Missing links: Product {missingSections.join(', ')}</p>
      )}
    </div>
  );
}

function AudioTimelineStatus({ timeline, audioMode }: { timeline: TimelineSegment[] | null; audioMode: string }) {
  if (!timeline || timeline.length === 0) return null;

  const totalDuration = timeline.reduce((n, s) => n + s.duration, 0);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle size={11} className="text-emerald-400" />
        <p className="text-[11px] font-semibold text-emerald-400">Audio timeline ready</p>
        <span className="ml-auto text-[10px] text-white/30 flex items-center gap-1">
          <Clock size={9} /> {fmtDur(totalDuration)}
        </span>
      </div>
      <div className="flex gap-1 h-4 rounded overflow-hidden">
        {timeline.map((seg, i) => {
          const colors = ['#06b6d4','#3b82f6','#0ea5e9','#14b8a6','#10b981','#f59e0b','#f97316'];
          const color = colors[(seg.productIndex - 1) % colors.length];
          const pct = totalDuration > 0 ? (seg.duration / totalDuration) * 100 : 0;
          return (
            <div key={i} className="flex items-center justify-center text-[8px] font-bold rounded-sm"
              style={{ width: `${pct}%`, background: `${color}30`, color }}>
              {pct > 8 ? `P${seg.productIndex}` : ''}
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-white/25 mt-1.5">
        {timeline.length} product{timeline.length !== 1 ? 's' : ''} · {audioMode} mode · audio is the timing master
      </p>
    </div>
  );
}

// ── VisualDistributionPreview ─────────────────────────────────────────────────

const MOTION_LABELS: Record<string, string> = {
  'kenburns-tl': 'Ken Burns ↗', 'kenburns-br': 'Ken Burns ↙',
  'kenburns-tr': 'Ken Burns ↖', 'kenburns-bl': 'Ken Burns ↘',
  'zoom-in': 'Zoom In', 'zoom-out': 'Zoom Out',
  'punch-in': 'Punch In', 'punch-out': 'Punch Out',
  'pan-lr': 'Pan →', 'pan-rl': 'Pan ←',
};

const SEG_COLORS = ['#06b6d4','#3b82f6','#0ea5e9','#14b8a6','#10b981','#f59e0b','#f97316'];
function segColor(idx: number) { return SEG_COLORS[(idx - 1) % SEG_COLORS.length]; }
function fmtSec(s: number) { return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`; }

function VisualDistributionPreview({ plan, loading }: { plan: RenderPlan | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader2 size={11} className="text-white/30 animate-spin" />
        <p className="text-[11px] text-white/30">Computing distribution…</p>
      </div>
    );
  }
  if (!plan) return null;

  const totalClips = plan.tracks.reduce((n, t) => n + t.clips.length, 0);
  const loopedClips = plan.tracks.reduce((n, t) => n + t.clips.filter((c) => c.looped).length, 0);
  const mediaUsed = plan.tracks.reduce((n, t) => n + t.mediaCount, 0);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <Film size={11} className="text-white/30 flex-shrink-0" />
        <span className="text-[11px] font-semibold text-white/50">Visual Distribution</span>
        <span className="text-[10px] text-white/25 ml-1">
          {totalClips} clips · {fmtSec(plan.totalDuration)}
        </span>
        <ChevronDown size={10} className={`ml-auto text-white/25 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {plan.tracks.map((track) => {
          const pct = plan.totalDuration > 0 ? (track.duration / plan.totalDuration) * 100 : 0;
          return <div key={track.productIndex} style={{ width: `${pct}%`, background: segColor(track.productIndex) }} />;
        })}
      </div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {plan.tracks.map((track) => {
            const color = segColor(track.productIndex);
            const imageClips = track.clips.filter((c) => c.type === 'image');
            const videoClips = track.clips.filter((c) => c.type === 'video');
            return (
              <div key={track.productIndex} className="p-2.5 rounded-xl border border-white/6 bg-white/2">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold"
                    style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}>
                    {track.productIndex}
                  </div>
                  <span className="text-[10px] text-white/50">Product {track.productIndex}</span>
                  <span className="text-[9px] text-white/25 ml-auto">{fmtSec(track.duration)}</span>
                </div>
                <div className="flex h-4 rounded overflow-hidden gap-px mb-1.5">
                  {track.clips.map((clip, ci) => {
                    const pct = track.duration > 0 ? (clip.duration / track.duration) * 100 : 0;
                    const isVid = clip.type === 'video';
                    return (
                      <div key={ci} className="flex items-center justify-center text-[7px]"
                        style={{ width: `${pct}%`, minWidth: 2, background: isVid ? `${color}50` : `${color}25` }}
                        title={`${clip.type} · ${fmtSec(clip.duration)}`}>
                        {pct > 6 && <span style={{ color }}>{isVid ? '▶' : '◼'}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  {videoClips.length > 0 && <span className="flex items-center gap-0.5 text-[9px]" style={{ color }}><Video size={7} /> {videoClips.length}</span>}
                  {imageClips.length > 0 && <span className="flex items-center gap-0.5 text-[9px]" style={{ color }}><ImageIcon size={7} /> {imageClips.length}</span>}
                  <div className="flex flex-wrap gap-1 ml-auto">
                    {[...new Set(track.clips.map((c) => c.motion).filter(Boolean))].map((m) => (
                      <span key={m!} className="text-[7px] px-1 py-0.5 rounded border"
                        style={{ color: `${color}cc`, borderColor: `${color}30`, background: `${color}10` }}>
                        {MOTION_LABELS[m!] ?? m}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-[9px] text-white/20">
            {mediaUsed} media → {totalClips} clips{loopedClips > 0 ? ` · ${loopedClips} looped` : ''} · {plan.style}
          </p>
        </div>
      )}
    </div>
  );
}
