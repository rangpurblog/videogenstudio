import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, RefreshCw, ImageIcon, Video, HardDrive,
  Package, ChevronRight, ArrowLeft, Download, Loader2,
  CheckCircle, AlertCircle, Copy, ExternalLink,
} from 'lucide-react';
import type { ProductManifest, ProductImage, ProductVideo } from '../electron.d';
import { saveMediaFiles } from '../lib/supabase';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function imgSrc(img: ProductImage): string {
  return img.localPath ? `file://${img.localPath}` : img.url;
}

// ── Mock data for browser (non-Electron) preview ─────────────────────────────

const DEMO_MANIFESTS: ProductManifest[] = [
  {
    productIndex: 1, folderName: 'product_1', productDir: '/media/product_1',
    title: 'Wireless Earbuds Pro', images: [], videos: [],
    hashes: [], imageCount: 8, videoCount: 1, totalSizeBytes: 4_200_000,
    updatedAt: new Date().toISOString(),
  },
  {
    productIndex: 2, folderName: 'product_2', productDir: '/media/product_2',
    title: 'Charging Case', images: [], videos: [],
    hashes: [], imageCount: 5, videoCount: 0, totalSizeBytes: 2_100_000,
    updatedAt: new Date().toISOString(),
  },
];

// ── Download progress tracking ────────────────────────────────────────────────

interface DownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error';
  progress: string;
  error?: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MediaLibrary() {
  const [manifests, setManifests] = useState<ProductManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [mediaDir, setMediaDir] = useState('');
  const [selected, setSelected] = useState<ProductManifest | null>(null);
  const [activeImageTab, setActiveImageTab] = useState<'images' | 'videos'>('images');
  const [downloadStates, setDownloadStates] = useState<Record<number, DownloadState>>({});

  // Load manifest index
  const loadIndex = useCallback(async () => {
    setLoading(true);
    if (window.electronAPI) {
      const [index, dir] = await Promise.all([
        window.electronAPI.getMediaIndex(),
        window.electronAPI.getMediaDir(),
      ]);
      setManifests(index);
      setMediaDir(dir);
    } else {
      setManifests(DEMO_MANIFESTS);
      setMediaDir('~/VideoGen/media');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadIndex();

    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onDownloadProgress((evt) => {
      setDownloadStates((prev) => ({
        ...prev,
        [evt.productIndex]: { status: 'downloading', progress: evt.message },
      }));
    });
    return unsub;
  }, [loadIndex]);

  // Refresh selected manifest after download
  const refreshSelected = useCallback(async () => {
    if (!selected || !window.electronAPI) return;
    const index = await window.electronAPI.getMediaIndex();
    setManifests(index);
    const fresh = index.find((m) => m.productIndex === selected.productIndex);
    if (fresh) setSelected(fresh);
  }, [selected]);

  const handleOpenFolder = async (folderPath: string) => {
    if (window.electronAPI) await window.electronAPI.openFolder(folderPath);
  };

  const handleOpenMediaDir = async () => {
    if (window.electronAPI) await window.electronAPI.openFolder(mediaDir);
  };

  // Re-download a product's media (uses URLs already in manifest)
  const handleRedownload = async (manifest: ProductManifest) => {
    const idx = manifest.productIndex;
    setDownloadStates((prev) => ({ ...prev, [idx]: { status: 'downloading', progress: 'Starting…' } }));

    if (!window.electronAPI) {
      setTimeout(() => {
        setDownloadStates((prev) => ({ ...prev, [idx]: { status: 'done', progress: '' } }));
      }, 1500);
      return;
    }

    const imageUrls = manifest.images.map((i) => ({ url: i.url, width: i.width, height: i.height }));
    const videoUrls = manifest.videos.map((v) => ({ url: v.url }));

    const result = await window.electronAPI.downloadProductMedia({
      jobId: String(idx),
      productIndex: idx,
      title: manifest.title,
      imageUrls,
      videoUrls,
    });

    if (result.success) {
      // Persist new files to Supabase
      const records = [
        ...(result.images || []).filter((i) => i.localPath && i.hash).map((i) => ({
          product_index: idx,
          file_type: 'image' as const,
          source_url: i.url,
          local_path: i.localPath!,
          file_hash: i.hash!,
          file_size_bytes: i.fileSizeBytes || 0,
          original_size_bytes: i.originalSizeBytes || 0,
          width: i.width,
          height: i.height,
          optimized: i.optimized || false,
        })),
        ...(result.videos || []).filter((v) => v.localPath && v.hash).map((v) => ({
          product_index: idx,
          file_type: 'video' as const,
          source_url: v.url,
          local_path: v.localPath!,
          file_hash: v.hash!,
          file_size_bytes: v.fileSizeBytes || 0,
          original_size_bytes: v.originalSizeBytes || 0,
          width: 0,
          height: 0,
          optimized: false,
        })),
      ];
      await saveMediaFiles(records);
      setDownloadStates((prev) => ({ ...prev, [idx]: { status: 'done', progress: '' } }));
      await loadIndex();
    } else {
      setDownloadStates((prev) => ({ ...prev, [idx]: { status: 'error', progress: '', error: result.error } }));
    }
  };

  const totalImages = manifests.reduce((n, m) => n + m.imageCount, 0);
  const totalVideos = manifests.reduce((n, m) => n + m.videoCount, 0);
  const totalSize = manifests.reduce((n, m) => n + m.totalSizeBytes, 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-cyan-500/40 border-t-cyan-500 rounded-full animate-spin" />
          <p className="text-sm text-white/30">Scanning media library…</p>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <ProductDetail
        manifest={selected}
        onBack={() => setSelected(null)}
        onOpenFolder={handleOpenFolder}
        onRedownload={() => handleRedownload(selected)}
        downloadState={downloadStates[selected.productIndex]}
        activeTab={activeImageTab}
        onTabChange={setActiveImageTab}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Media Library</h1>
            <p className="text-sm text-white/40 mt-1">
              Downloaded product assets organized by product slot.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenMediaDir}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/5 border border-white/8 transition-all"
            >
              <FolderOpen size={13} /> Open Folder
            </button>
            <button
              onClick={loadIndex}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/5 border border-white/8 transition-all"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Products', value: manifests.length, icon: Package, color: 'text-cyan-400' },
            { label: 'Images', value: totalImages, icon: ImageIcon, color: 'text-blue-400' },
            { label: 'Videos', value: totalVideos, icon: Video, color: 'text-emerald-400' },
            { label: 'Disk Usage', value: formatBytes(totalSize), icon: HardDrive, color: 'text-amber-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-white/8 bg-white/3 p-4 flex items-center gap-3">
              <Icon size={16} className={`${color} flex-shrink-0`} />
              <div>
                <p className="text-lg font-bold text-white leading-none">{value}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Media dir path */}
        <div className="flex items-center gap-2 mb-5 px-1">
          <FolderOpen size={11} className="text-white/20 flex-shrink-0" />
          <code className="text-[10px] text-white/25 font-mono truncate">{mediaDir}</code>
        </div>

        {manifests.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {manifests.map((m) => (
              <ProductCard
                key={m.productIndex}
                manifest={m}
                downloadState={downloadStates[m.productIndex]}
                onClick={() => { setSelected(m); setActiveImageTab('images'); }}
                onRedownload={() => handleRedownload(m)}
                onOpenFolder={() => handleOpenFolder(m.productDir)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({
  manifest, downloadState, onClick, onRedownload, onOpenFolder,
}: {
  manifest: ProductManifest;
  downloadState?: DownloadState;
  onClick: () => void;
  onRedownload: () => void;
  onOpenFolder: () => void;
}) {
  const firstImage = manifest.images.find((i) => i.localPath || i.url);
  const isDownloading = downloadState?.status === 'downloading';

  return (
    <div className="group rounded-xl border border-white/8 bg-white/3 overflow-hidden hover:border-white/15 transition-all">
      {/* Thumbnail */}
      <div
        className="relative h-40 bg-white/3 cursor-pointer overflow-hidden"
        onClick={onClick}
      >
        {firstImage ? (
          <img
            src={imgSrc(firstImage)}
            alt={manifest.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={32} className="text-white/10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/30 text-cyan-300 border border-cyan-500/20 backdrop-blur-sm">
            Product {manifest.productIndex}
          </span>
        </div>
        <ChevronRight size={14} className="absolute right-2 bottom-2 text-white/40 group-hover:text-white transition-colors" />
      </div>

      {/* Info */}
      <div className="p-3.5">
        <p className="text-sm font-medium text-white/80 truncate leading-snug mb-2">
          {manifest.title || `Product ${manifest.productIndex}`}
        </p>

        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center gap-1 text-[11px] text-white/35">
            <ImageIcon size={11} /> {manifest.imageCount}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-white/35">
            <Video size={11} /> {manifest.videoCount}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-white/25 ml-auto">
            <HardDrive size={10} /> {formatBytes(manifest.totalSizeBytes)}
          </span>
        </div>

        {/* Progress bar for active download */}
        {isDownloading && (
          <div className="mb-2">
            <p className="text-[10px] text-cyan-400/70 truncate mb-1">{downloadState?.progress}</p>
            <div className="h-0.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse" />
            </div>
          </div>
        )}
        {downloadState?.status === 'done' && (
          <p className="text-[10px] text-emerald-400 mb-2 flex items-center gap-1">
            <CheckCircle size={10} /> Download complete
          </p>
        )}
        {downloadState?.status === 'error' && (
          <p className="text-[10px] text-red-400 mb-2 truncate flex items-center gap-1">
            <AlertCircle size={10} /> {downloadState.error}
          </p>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onRedownload(); }}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/40 hover:text-white hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isDownloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            {isDownloading ? 'Downloading…' : 'Re-download'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenFolder(); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/40 hover:text-white hover:bg-white/8 transition-all"
          >
            <FolderOpen size={10} /> Open
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ProductDetail ─────────────────────────────────────────────────────────────

function ProductDetail({
  manifest, onBack, onOpenFolder, onRedownload, downloadState, activeTab, onTabChange,
}: {
  manifest: ProductManifest;
  onBack: () => void;
  onOpenFolder: (p: string) => void;
  onRedownload: () => void;
  downloadState?: DownloadState;
  activeTab: 'images' | 'videos';
  onTabChange: (t: 'images' | 'videos') => void;
}) {
  const [lightbox, setLightbox] = useState<ProductImage | null>(null);
  const isDownloading = downloadState?.status === 'downloading';

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl">
        {/* Back header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            Media Library
          </button>
          <span className="text-white/15">/</span>
          <span className="text-sm text-white font-medium">{manifest.title || `Product ${manifest.productIndex}`}</span>
        </div>

        {/* Product header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                Product {manifest.productIndex}
              </span>
              <span className="text-[10px] text-white/25">
                {manifest.folderName}
              </span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              {manifest.title || `Product ${manifest.productIndex}`}
            </h1>
            {manifest.updatedAt && (
              <p className="text-xs text-white/25 mt-0.5">
                Last updated {new Date(manifest.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenFolder(manifest.productDir)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:text-white border border-white/8 hover:bg-white/5 transition-all"
            >
              <FolderOpen size={12} /> Open Folder
            </button>
            <button
              onClick={onRedownload}
              disabled={isDownloading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {isDownloading ? 'Downloading…' : 'Re-download'}
            </button>
          </div>
        </div>

        {/* Progress */}
        {isDownloading && (
          <div className="mb-5 p-3 rounded-xl bg-cyan-500/8 border border-cyan-500/15">
            <div className="flex items-center gap-2 mb-1.5">
              <Loader2 size={12} className="animate-spin text-cyan-400" />
              <p className="text-xs text-cyan-400 font-medium">{downloadState?.progress}</p>
            </div>
            <div className="h-1 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse" />
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Images', value: manifest.imageCount, color: 'text-cyan-400' },
            { label: 'Videos', value: manifest.videoCount, color: 'text-blue-400' },
            { label: 'Total Size', value: formatBytes(manifest.totalSizeBytes), color: 'text-white' },
            { label: 'Dedup Hashes', value: manifest.hashes.length, color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-white/8 bg-white/3 p-3 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-white/30 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/8 mb-5">
          {(['images', 'videos'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium capitalize border-b-2 transition-all ${
                activeTab === tab ? 'border-cyan-400 text-white' : 'border-transparent text-white/35 hover:text-white/60'
              }`}
            >
              {tab === 'images' ? <ImageIcon size={13} /> : <Video size={13} />}
              {tab}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-white/40">
                {tab === 'images' ? manifest.imageCount : manifest.videoCount}
              </span>
            </button>
          ))}
        </div>

        {/* Image grid */}
        {activeTab === 'images' && (
          manifest.images.length === 0 ? (
            <NoAssets type="images" />
          ) : (
            <div className="grid grid-cols-3 gap-3 lg:grid-cols-4">
              {manifest.images.map((img, i) => (
                <ImageTile key={i} image={img} index={i} onClick={() => setLightbox(img)} />
              ))}
            </div>
          )
        )}

        {/* Video list */}
        {activeTab === 'videos' && (
          manifest.videos.length === 0 ? (
            <NoAssets type="videos" />
          ) : (
            <div className="space-y-2">
              {manifest.videos.map((vid, i) => (
                <VideoRow key={i} video={vid} index={i} onOpenFolder={() => onOpenFolder(manifest.productDir)} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ── Image tile ────────────────────────────────────────────────────────────────

function ImageTile({ image, index, onClick }: { image: ProductImage; index: number; onClick: () => void }) {
  const [err, setErr] = useState(false);
  return (
    <div
      className="group relative aspect-square rounded-lg overflow-hidden border border-white/8 bg-white/3 cursor-pointer hover:border-cyan-500/30 transition-all"
      onClick={onClick}
    >
      {!err && (image.localPath || image.url) ? (
        <img
          src={imgSrc(image)}
          alt={`Image ${index + 1}`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon size={20} className="text-white/15" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-white/60 font-mono">#{index + 1}</span>
          {image.fileSizeBytes && (
            <span className="text-[9px] text-white/40">{formatBytes(image.fileSizeBytes)}</span>
          )}
        </div>
        {image.optimized && (
          <span className="text-[8px] text-emerald-400/70">optimized</span>
        )}
      </div>
    </div>
  );
}

// ── Video row ─────────────────────────────────────────────────────────────────

function VideoRow({ video, index, onOpenFolder }: { video: ProductVideo; index: number; onOpenFolder: () => void }) {
  return (
    <div className="flex items-center gap-4 p-3.5 rounded-xl border border-white/8 bg-white/3 hover:border-white/15 transition-all">
      <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
        <Video size={16} className="text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/70 truncate">
          {video.localPath ? `video_${index + 1}.mp4` : `Video ${index + 1}`}
        </p>
        <p className="text-[10px] text-white/25 truncate mt-0.5">
          {video.localPath || video.url}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {video.fileSizeBytes ? (
          <span className="text-[11px] text-white/30">{formatBytes(video.fileSizeBytes)}</span>
        ) : null}
        {video.hash && (
          <span className="text-[9px] text-white/20 font-mono" title={`SHA-256: ${video.hash}`}>
            {video.hash.slice(0, 8)}…
          </span>
        )}
        <button
          onClick={onOpenFolder}
          className="w-7 h-7 flex items-center justify-center rounded text-white/25 hover:text-white hover:bg-white/8 transition-all"
          title="Open containing folder"
        >
          <FolderOpen size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ image, onClose }: { image: ProductImage; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyPath = () => {
    navigator.clipboard.writeText(image.localPath || image.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imgSrc(image)}
          alt=""
          className="block max-h-[75vh] max-w-full object-contain bg-black"
        />
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 p-3 bg-black/60 backdrop-blur-sm">
          {image.width > 0 && (
            <span className="text-[10px] text-white/40">{image.width}×{image.height}</span>
          )}
          {image.fileSizeBytes && (
            <span className="text-[10px] text-white/40">{formatBytes(image.fileSizeBytes)}</span>
          )}
          {image.optimized && (
            <span className="text-[10px] text-emerald-400/70 flex items-center gap-1">
              <CheckCircle size={9} /> optimized
            </span>
          )}
          <button onClick={copyPath} className="ml-auto flex items-center gap-1.5 text-[10px] text-white/40 hover:text-white transition-colors">
            {copied ? <CheckCircle size={10} className="text-emerald-400" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy path'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/4 border border-white/8 flex items-center justify-center mb-4">
        <Package size={28} className="text-white/20" />
      </div>
      <p className="text-base font-semibold text-white/40 mb-1">No media downloaded yet</p>
      <p className="text-sm text-white/20 max-w-xs leading-relaxed">
        Fetch product data in the Create Video page to automatically download and organize media here.
      </p>
    </div>
  );
}

function NoAssets({ type }: { type: 'images' | 'videos' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {type === 'images' ? <ImageIcon size={28} className="text-white/10 mb-3" /> : <Video size={28} className="text-white/10 mb-3" />}
      <p className="text-sm text-white/30">No {type} downloaded for this product</p>
    </div>
  );
}
