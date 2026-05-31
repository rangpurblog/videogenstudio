'use strict';

/**
 * Audio-driven video composition engine.
 *
 * Core principle: audio duration is the timing master.
 * For each product segment the visual track must be exactly
 * `segment.duration` seconds long — achieved by distributeMedia().
 *
 * distributeMedia() algorithm
 * ────────────────────────────
 * Given `audioDuration` and `mediaItems` (images + videos):
 *
 * 1. Assign a "natural weight" to each item:
 *      video  → min(naturalDuration, MAX_VIDEO_CLIP) seconds
 *      image  → styleParams.holdSec seconds
 *
 * 2. Scale all weights so they sum to `audioDuration`:
 *      scaleFactor = audioDuration / sum(weights)
 *      clipDuration[i] = weight[i] * scaleFactor
 *
 * 3. If mediaItems is empty, return a single blank clip of audioDuration.
 *
 * 4. If mediaItems are fewer than MIN_CLIPS_THRESHOLD, loop them until
 *    we reach enough clips for smooth coverage, then redistribute.
 *
 * 5. Each clip gets a motion effect from the style palette:
 *      cinematic    → Ken Burns (slow zoom 1.00→1.08, diagonal pan)
 *      product      → Zoom-in (1.00→1.05, centre)
 *      social       → Punch-in (fast zoom 1.00→1.12, centre)
 *      documentary  → Slow pan left→right or right→left alternating
 *
 * Example  (10 sec audio, 3 images, style=product):
 *   weights = [4, 4, 4]  (holdSec=4 each)
 *   scaleFactor = 10/12 = 0.833
 *   durations = [3.33, 3.33, 3.33]  ✓ sums to 10s
 */

const fs   = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// ── FFmpeg binary resolution ───────────────────────────────────────────────────
//
// Priority:
//   1. FFMPEG_PATH env var (developer override)
//   2. Bundled ffmpeg-static binary extracted by electron-builder into extraResources
//   3. ffmpeg-static npm package (dev / non-packaged)
//   4. System PATH fallback

function ffmpegBin() {
  // 1. Explicit env override
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // 2. Packaged app: electron-builder copies the binary to resources/ffmpeg[.exe]
  if (app) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const resourcesPath = path.join(path.dirname(process.execPath), 'resources', `ffmpeg${ext}`);
    if (fs.existsSync(resourcesPath)) return resourcesPath;

    // Also check process.resourcesPath (set by Electron when packaged)
    const altPath = path.join(process.resourcesPath || '', `ffmpeg${ext}`);
    if (process.resourcesPath && fs.existsSync(altPath)) return altPath;
  }

  // 3. ffmpeg-static npm package (development)
  try {
    const staticBin = require('ffmpeg-static');
    if (staticBin && fs.existsSync(staticBin)) return staticBin;
  } catch { /* not installed */ }

  // 4. System PATH
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

// Lazy-load Electron app (not available in all contexts)
let app;
try { app = require('electron').app; } catch { /* renderer or test */ }

// ── Style parameters ───────────────────────────────────────────────────────────

const STYLE_PARAMS = {
  cinematic:   { holdSec: 6, maxImgSec: 9,  motionSet: ['kenburns-tl', 'kenburns-br', 'kenburns-tr', 'kenburns-bl'] },
  product:     { holdSec: 4, maxImgSec: 7,  motionSet: ['zoom-in',    'zoom-in',    'zoom-out',   'zoom-in']        },
  social:      { holdSec: 2, maxImgSec: 3,  motionSet: ['punch-in',   'punch-in',   'punch-out',  'punch-in']       },
  documentary: { holdSec: 5, maxImgSec: 8,  motionSet: ['pan-lr',     'pan-rl',     'pan-lr',     'pan-rl']         },
};

// Motion effect → FFmpeg zoompan expression params
const MOTION_EFFECTS = {
  'kenburns-tl': { zoomFrom: 1.00, zoomTo: 1.08, xBias: 0.0, yBias: 0.0 },  // top-left anchor
  'kenburns-br': { zoomFrom: 1.00, zoomTo: 1.08, xBias: 1.0, yBias: 1.0 },  // bottom-right anchor
  'kenburns-tr': { zoomFrom: 1.00, zoomTo: 1.08, xBias: 1.0, yBias: 0.0 },
  'kenburns-bl': { zoomFrom: 1.00, zoomTo: 1.08, xBias: 0.0, yBias: 1.0 },
  'zoom-in':     { zoomFrom: 1.00, zoomTo: 1.06, xBias: 0.5, yBias: 0.5 },  // centre zoom
  'zoom-out':    { zoomFrom: 1.06, zoomTo: 1.00, xBias: 0.5, yBias: 0.5 },  // centre pull back
  'punch-in':    { zoomFrom: 1.00, zoomTo: 1.12, xBias: 0.5, yBias: 0.5 },  // fast punch
  'punch-out':   { zoomFrom: 1.12, zoomTo: 1.00, xBias: 0.5, yBias: 0.5 },
  'pan-lr':      { zoomFrom: 1.04, zoomTo: 1.04, xBias: 0.0, yBias: 0.5 },  // pan left→right
  'pan-rl':      { zoomFrom: 1.04, zoomTo: 1.04, xBias: 1.0, yBias: 0.5 },  // pan right→left
};

const DEFAULT_STYLE    = 'product';
const MAX_VIDEO_CLIP   = 30;       // cap a single video clip at 30s
const MIN_CLIP_DUR     = 0.5;      // minimum clip duration in seconds
const MIN_CLIPS_TARGET = 3;        // loop media until at least this many clips exist
const QUALITY_MAP      = { '720p': '1280x720', '1080p': '1920x1080', '4k': '3840x2160' };
const DEFAULT_RES      = '1920x1080';
const VIDEO_FPS        = 30;

// ── Core distributor ───────────────────────────────────────────────────────────

/**
 * Proportionally distribute `audioDuration` across available media items.
 *
 * @param {number} audioDuration  - total seconds this product segment must fill
 * @param {Array}  mediaItems     - [{type:'image'|'video', path, naturalDuration?}]
 * @param {string} style          - cinematic | product | social | documentary
 * @returns {Array} clips         - [{type, path, duration, motion, zoomFrom, zoomTo, xBias, yBias, looped}]
 */
function distributeMedia(audioDuration, mediaItems, style) {
  const params = STYLE_PARAMS[style] || STYLE_PARAMS[DEFAULT_STYLE];

  // ── Empty media guard ───────────────────────────────────────────────────────
  if (!mediaItems || mediaItems.length === 0) {
    return [{
      type: 'blank',
      path: null,
      duration: parseFloat(audioDuration.toFixed(3)),
      motion: null,
    }];
  }

  // ── Build initial pool, looping if too few items ────────────────────────────
  let pool = [...mediaItems.map((m, i) => ({ ...m, originalIndex: i, looped: false }))];

  // Loop until we have at least MIN_CLIPS_TARGET clips (avoids jarring 1-image videos)
  if (pool.length < MIN_CLIPS_TARGET) {
    let loopSrc = [...mediaItems];
    while (pool.length < MIN_CLIPS_TARGET) {
      for (const item of loopSrc) {
        pool.push({ ...item, originalIndex: pool.length, looped: true });
        if (pool.length >= MIN_CLIPS_TARGET) break;
      }
    }
  }

  // ── Assign natural weights ──────────────────────────────────────────────────
  const weights = pool.map((item) => {
    if (item.type === 'video') {
      return Math.min(item.naturalDuration || params.holdSec, MAX_VIDEO_CLIP);
    }
    return params.holdSec;
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const scaleFactor = totalWeight > 0 ? audioDuration / totalWeight : 1;

  // ── Scale durations and enforce MIN_CLIP_DUR ────────────────────────────────
  let durations = weights.map((w) => Math.max(w * scaleFactor, MIN_CLIP_DUR));

  // After clamping, re-normalise so they still sum to audioDuration exactly
  const clampedTotal = durations.reduce((s, d) => s + d, 0);
  if (Math.abs(clampedTotal - audioDuration) > 0.001) {
    const norm = audioDuration / clampedTotal;
    durations = durations.map((d) => d * norm);
  }

  // ── Assign motion effects ───────────────────────────────────────────────────
  const clips = pool.map((item, i) => {
    const dur = parseFloat(durations[i].toFixed(3));
    const motionName = params.motionSet[i % params.motionSet.length];
    const motion = MOTION_EFFECTS[motionName] || MOTION_EFFECTS['zoom-in'];

    return {
      type: item.type,
      path: item.path,
      duration: dur,
      motion: motionName,
      zoomFrom: motion.zoomFrom,
      zoomTo: motion.zoomTo,
      xBias: motion.xBias,
      yBias: motion.yBias,
      looped: item.looped,
      productIndex: item.productIndex,
    };
  });

  return clips;
}

// ── Media scanner ──────────────────────────────────────────────────────────────

function readManifest(productDir) {
  const p = path.join(productDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function scanProductMedia(productIndex, mediaDir) {
  const productDirName = `product_${productIndex}`;
  const productDir = path.join(mediaDir, productDirName);
  const manifest = readManifest(productDir);

  const images = [];
  const videos = [];

  if (manifest) {
    for (const img of (manifest.images || [])) {
      if (img.localPath && fs.existsSync(img.localPath)) {
        images.push({ type: 'image', path: img.localPath, width: img.width, height: img.height });
      }
    }
    for (const vid of (manifest.videos || [])) {
      if (vid.localPath && fs.existsSync(vid.localPath)) {
        videos.push({ type: 'video', path: vid.localPath, naturalDuration: vid.durationSeconds || null });
      }
    }
  } else {
    // Fallback: scan directory
    const imagesDir = path.join(productDir, 'images');
    const videosDir = path.join(productDir, 'videos');
    if (fs.existsSync(imagesDir)) {
      for (const f of fs.readdirSync(imagesDir)) {
        if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
          images.push({ type: 'image', path: path.join(imagesDir, f) });
        }
      }
    }
    if (fs.existsSync(videosDir)) {
      for (const f of fs.readdirSync(videosDir)) {
        if (/\.(mp4|mov|webm)$/i.test(f)) {
          videos.push({ type: 'video', path: path.join(videosDir, f) });
        }
      }
    }
  }

  // Order: videos first (they carry natural duration info), then images
  return [...videos, ...images];
}

/**
 * Apply manual overrides to a pre-built render plan.
 * Overrides come from the TimelineEditor component saved to timeline_edits.
 *
 * Each override specifies per-clip patches:
 *  { productIndex, clipIndex, duration?, motion?, path? }
 *
 * Duration patches are applied then the whole track is re-normalised to
 * preserve the audio duration exactly.
 */
function applyManualOverrides(plan, manualOverrides) {
  if (!manualOverrides || manualOverrides.length === 0) return plan;

  const tracks = plan.tracks.map((track) => {
    const override = manualOverrides.find((o) => o.productIndex === track.productIndex);
    if (!override || !override.clips || override.clips.length === 0) return track;

    // Apply per-clip patches
    let clips = track.clips.map((clip, ci) => {
      const co = override.clips.find((c) => c.clipIndex === ci);
      if (!co) return clip;
      return {
        ...clip,
        ...(co.duration !== undefined ? { duration: co.duration } : {}),
        ...(co.motion    !== undefined ? { motion: co.motion, ...MOTION_EFFECTS[co.motion] } : {}),
        ...(co.path      !== undefined && co.path !== clip.path ? { path: co.path } : {}),
      };
    });

    // Re-normalise durations so they still sum to track.duration
    const rawTotal = clips.reduce((s, c) => s + c.duration, 0);
    if (Math.abs(rawTotal - track.duration) > 0.01) {
      const factor = track.duration / rawTotal;
      clips = clips.map((c) => ({ ...c, duration: parseFloat((c.duration * factor).toFixed(3)) }));
    }

    return { ...track, clips };
  });

  return { ...plan, tracks };
}

// ── Render plan builder ────────────────────────────────────────────────────────

/**
 * Build the complete render plan from timeline segments.
 */
function buildRenderPlan({ timelineSegments, mediaDir, audioMode, style, quality, manualOverrides }) {
  const resolution = QUALITY_MAP[quality] || DEFAULT_RES;
  const [width, height] = resolution.split('x').map(Number);

  const tracks = [];

  for (const seg of timelineSegments) {
    const mediaItems = scanProductMedia(seg.productIndex, mediaDir);
    const clips = distributeMedia(seg.duration, mediaItems, style);

    // Annotate clips with productIndex
    const annotatedClips = clips.map((c) => ({ ...c, productIndex: seg.productIndex }));

    tracks.push({
      productIndex: seg.productIndex,
      startTime: seg.startTime,
      endTime: seg.endTime,
      duration: seg.duration,
      audioPath: seg.audioPath,
      audioMode,
      mediaCount: mediaItems.length,
      clipCount: annotatedClips.length,
      clips: annotatedClips,
    });
  }

  const totalDuration = timelineSegments.reduce((n, s) => n + s.duration, 0);

  const basePlan = {
    version: 2,
    style,
    quality,
    resolution: { width, height },
    fps: VIDEO_FPS,
    totalDuration: parseFloat(totalDuration.toFixed(3)),
    audioMode,
    tracks,
    createdAt: new Date().toISOString(),
  };

  // Apply any manual overrides from the timeline editor
  return applyManualOverrides(basePlan, manualOverrides);
}

// ── GPU detection ──────────────────────────────────────────────────────────────

async function ffmpegAvailable() {
  try {
    await execFileAsync(ffmpegBin(), ['-version'], { timeout: 5000 });
    return true;
  } catch { return false; }
}

/**
 * Probe FFmpeg for available hardware encoders.
 * Returns an object describing which GPU encoders are available.
 *
 * Priority: NVIDIA NVENC > AMD AMF > Intel QSV > Apple VideoToolbox > CPU
 */
async function detectGpuEncoder() {
  try {
    const { stdout } = await execFileAsync(ffmpegBin(), ['-encoders'], { timeout: 8000 });
    const has = (name) => stdout.includes(name);
    if (has('h264_nvenc'))     return { encoder: 'h264_nvenc',    type: 'nvidia', label: 'NVIDIA NVENC' };
    if (has('hevc_nvenc'))     return { encoder: 'h264_nvenc',    type: 'nvidia', label: 'NVIDIA NVENC' };
    if (has('h264_amf'))       return { encoder: 'h264_amf',      type: 'amd',    label: 'AMD AMF' };
    if (has('h264_qsv'))       return { encoder: 'h264_qsv',      type: 'intel',  label: 'Intel QSV' };
    if (has('h264_videotoolbox')) return { encoder: 'h264_videotoolbox', type: 'apple', label: 'Apple VideoToolbox' };
    return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
  } catch {
    return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
  }
}

/**
 * Validate that a detected GPU encoder actually works by running a 1-frame test.
 * Some systems list NVENC in -encoders but fail at runtime (driver issues).
 * Falls back to CPU if the test encode fails.
 */
async function validateEncoder(encoderInfo) {
  if (encoderInfo.type === 'cpu') return encoderInfo;
  try {
    const testArgs = [
      '-f', 'lavfi', '-i', 'color=black:s=64x64:r=1:d=0.1',
      '-c:v', encoderInfo.encoder,
      '-frames:v', '1',
      '-f', 'null', '-',
    ];
    await execFileAsync(ffmpegBin(), testArgs, { timeout: 10000 });
    return encoderInfo;
  } catch {
    return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264) [GPU unavailable]' };
  }
}

/**
 * Build encoder-specific codec arguments for FFmpeg output.
 *
 * Each GPU encoder has its own quality/preset flags:
 *   NVENC  : -rc vbr -cq 18 -preset p4
 *   AMF    : -quality quality -qp_i 18 -qp_p 20
 *   QSV    : -global_quality 18 -preset medium
 *   VTB    : -q:v 60
 *   CPU    : -crf 18 -preset fast
 */
function buildEncoderArgs(encoderInfo) {
  switch (encoderInfo.type) {
    case 'nvidia':
      return [
        '-c:v', 'h264_nvenc',
        '-rc', 'vbr',
        '-cq', '18',
        '-preset', 'p4',       // p1=fastest … p7=slowest/best
        '-b:v', '0',
        '-profile:v', 'high',
      ];
    case 'amd':
      return [
        '-c:v', 'h264_amf',
        '-quality', 'quality',
        '-qp_i', '18',
        '-qp_p', '20',
        '-profile:v', 'high',
      ];
    case 'intel':
      return [
        '-c:v', 'h264_qsv',
        '-global_quality', '18',
        '-preset', 'medium',
        '-profile:v', 'high',
      ];
    case 'apple':
      return [
        '-c:v', 'h264_videotoolbox',
        '-q:v', '60',
        '-profile:v', 'high',
      ];
    default:
      return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18'];
  }
}

/**
 * Build FFmpeg zoompan filter for a single image clip.
 *
 * xBias / yBias (0..1) control the anchor point:
 *   0=left/top, 0.5=centre, 1=right/bottom
 * The x/y expressions keep the anchor at the desired edge while zooming.
 */
function imageClipFilter(clip, inputLabel, outputLabel, width, height) {
  const frames = Math.max(1, Math.round(clip.duration * VIDEO_FPS));
  const zFrom  = clip.zoomFrom;
  const zTo    = clip.zoomTo;

  // Incremental zoom per frame
  const zStep = (zTo - zFrom) / Math.max(frames - 1, 1);
  const zExpr = zStep >= 0
    ? `min(zoom+${Math.abs(zStep).toFixed(6)},${zTo})`
    : `max(zoom-${Math.abs(zStep).toFixed(6)},${zTo})`;

  // x/y: lerp anchor so the bias point stays fixed as zoom grows
  // x = xBias*(iw - iw/zoom)   →  left=0, centre=iw/2-iw/zoom/2, right=iw-iw/zoom
  const xExpr = `${clip.xBias.toFixed(4)}*(iw-iw/zoom)`;
  const yExpr = `${clip.yBias.toFixed(4)}*(ih-ih/zoom)`;

  return [
    `${inputLabel}`,
    `scale=${width * 2}:${height * 2}:flags=lanczos`,
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${VIDEO_FPS}`,
    `setsar=1`,
    `${outputLabel}`,
  ].join(',');
}

async function buildFFmpegArgs({ renderPlan, outputPath, encoderInfo }) {
  const { resolution: { width, height }, tracks, audioMode } = renderPlan;
  const inputs = [];
  const filterParts = [];
  const concatVParts = [];
  const concatAParts = [];
  let inputIdx = 0;

  for (const track of tracks) {
    for (const clip of track.clips) {
      const vLabel = `[v${inputIdx}]`;

      if (clip.type === 'blank') {
        inputs.push('-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=${VIDEO_FPS}:d=${clip.duration}`);
        filterParts.push(`[${inputIdx}:v]setsar=1${vLabel}`);
        concatVParts.push(vLabel);
        inputIdx++;

      } else if (clip.type === 'image') {
        inputs.push('-loop', '1', '-t', String(clip.duration), '-i', clip.path);
        filterParts.push(imageClipFilter(clip, `[${inputIdx}:v]`, vLabel, width, height));
        concatVParts.push(vLabel);
        inputIdx++;

      } else if (clip.type === 'video') {
        inputs.push('-t', String(clip.duration), '-i', clip.path);
        filterParts.push(
          `[${inputIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1${vLabel}`
        );
        concatVParts.push(vLabel);
        inputIdx++;
      }
    }

    // Audio inputs
    if (audioMode === 'multi') {
      if (track.audioPath && fs.existsSync(track.audioPath)) {
        inputs.push('-i', track.audioPath);
        concatAParts.push(`[${inputIdx}:a]`);
        inputIdx++;
      } else {
        inputs.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${track.duration}`);
        concatAParts.push(`[${inputIdx}:a]`);
        inputIdx++;
      }
    }
  }

  // Single audio: one file for the whole video
  let singleAudioIdx = -1;
  if (audioMode === 'single') {
    const firstAudioPath = tracks[0]?.audioPath;
    if (firstAudioPath && fs.existsSync(firstAudioPath)) {
      inputs.push('-i', firstAudioPath);
      singleAudioIdx = inputIdx;
      inputIdx++;
    }
  }

  const n = concatVParts.length;
  const filterStr = [
    ...filterParts,
    `${concatVParts.join('')}concat=n=${n}:v=1:a=0[vout]`,
    audioMode === 'multi' && concatAParts.length > 0
      ? `${concatAParts.join('')}concat=n=${concatAParts.length}:v=0:a=1[aout]`
      : null,
  ].filter(Boolean).join(';');

  const args = [
    ...inputs,
    '-filter_complex', filterStr,
    '-map', '[vout]',
  ];

  if (audioMode === 'multi' && concatAParts.length > 0) {
    args.push('-map', '[aout]');
  } else if (singleAudioIdx >= 0) {
    args.push('-map', `${singleAudioIdx}:a`);
  }

  args.push(
    ...buildEncoderArgs(encoderInfo),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    '-y', outputPath,
  );

  return args;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Main entry point called from ipcMain.
 */
async function composeVideo({ timelineSegments, audioMode, style, quality, mediaDir, outputDir, projectId, manualOverrides, gpuMode, onProgress }) {
  const emit = (msg) => { if (onProgress) onProgress(msg); };

  try {
    if (!timelineSegments || timelineSegments.length === 0) {
      return { success: false, message: 'No timeline segments provided. Upload and sync audio first.' };
    }

    emit('Building render plan…');
    const plan = buildRenderPlan({ timelineSegments, mediaDir, audioMode, style, quality, manualOverrides });

    const hasOverrides = manualOverrides && manualOverrides.length > 0;

    // Summary for progress display
    const totalClips = plan.tracks.reduce((n, t) => n + t.clips.length, 0);
    const loopedCount = plan.tracks.reduce(
      (n, t) => n + t.clips.filter((c) => c.looped).length, 0
    );
    emit(
      `Plan: ${plan.tracks.length} product track${plan.tracks.length !== 1 ? 's' : ''}, ` +
      `${totalClips} clips, ${plan.totalDuration.toFixed(1)}s` +
      (loopedCount > 0 ? ` (${loopedCount} looped)` : '') +
      (hasOverrides ? ` · manual edits applied` : '')
    );

    fs.mkdirSync(outputDir, { recursive: true });
    const timestamp = Date.now();
    const baseName = projectId ? `video_${projectId}_${timestamp}` : `video_${timestamp}`;
    const planPath = path.join(outputDir, `${baseName}.plan.json`);
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const hasFfmpeg = await ffmpegAvailable();
    if (!hasFfmpeg) {
      emit('FFmpeg not found — render plan saved. Install FFmpeg to enable video export.');
      return {
        success: true,
        outputPath: null,
        planPath,
        plan,
        message: `Render plan saved to ${planPath}. Install FFmpeg to enable video export.`,
        planOnly: true,
      };
    }

    const outputPath = path.join(outputDir, `${baseName}.mp4`);

    // GPU / encoder detection
    emit('Detecting hardware encoder…');
    let encoderInfo;
    if (gpuMode === 'cpu') {
      encoderInfo = { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
    } else if (gpuMode === 'nvidia') {
      encoderInfo = await validateEncoder({ encoder: 'h264_nvenc', type: 'nvidia', label: 'NVIDIA NVENC' });
    } else if (gpuMode === 'amd') {
      encoderInfo = await validateEncoder({ encoder: 'h264_amf', type: 'amd', label: 'AMD AMF' });
    } else if (gpuMode === 'intel') {
      encoderInfo = await validateEncoder({ encoder: 'h264_qsv', type: 'intel', label: 'Intel QSV' });
    } else {
      // 'auto' — detect best available
      const detected = await detectGpuEncoder();
      encoderInfo = await validateEncoder(detected);
    }
    emit(`Encoder: ${encoderInfo.label}`);

    emit('Building FFmpeg command…');
    const ffArgs = await buildFFmpegArgs({ renderPlan: plan, outputPath, encoderInfo });

    emit(`Encoding ${plan.resolution.width}×${plan.resolution.height} @ ${plan.fps}fps…`);

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin(), ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let errBuf = '';

      proc.stderr.on('data', (chunk) => {
        errBuf += chunk.toString();
        const matches = errBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
        if (matches) {
          const last = matches[matches.length - 1];
          const [, hh, mm, ss] = last.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          const elapsed = parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss);
          const pct = plan.totalDuration > 0
            ? Math.min(99, Math.round((elapsed / plan.totalDuration) * 100))
            : 0;
          emit(`Encoding… ${pct}% (${elapsed.toFixed(1)}s / ${plan.totalDuration.toFixed(1)}s)`);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited ${code}. ${errBuf.slice(-400)}`));
      });
      proc.on('error', reject);
    });

    emit('Video export complete!');
    return {
      success: true,
      outputPath,
      planPath,
      plan,
      message: `Video saved to ${outputPath}`,
      planOnly: false,
    };

  } catch (err) {
    emit(`Error: ${err.message}`);
    return { success: false, message: err.message };
  }
}

module.exports = { composeVideo, buildRenderPlan, distributeMedia, scanProductMedia, detectGpuEncoder, validateEncoder };
