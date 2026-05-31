'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ── Sharp (optional — gracefully disabled if not built for this Electron) ────

let sharp = null;
try { sharp = require('sharp'); } catch { /* image optimisation skipped */ }

// ── Streaming download ────────────────────────────────────────────────────────
// Streams URL to destPath; follows up to 6 redirects; returns bytes written.

function streamToFile(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) return reject(new Error('Too many redirects'));

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 30000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error('Redirect with no Location'));
        return streamToFile(loc, destPath, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let bytes = 0;
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(bytes); });
      out.on('error', (err) => { try { fs.unlinkSync(destPath); } catch {} reject(err); });
    });
    req.on('error', (err) => { try { fs.unlinkSync(destPath); } catch {} reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

// ── File hashing ──────────────────────────────────────────────────────────────

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// ── Image optimisation ────────────────────────────────────────────────────────
// Resize to ≤1920px on the longest edge, encode as progressive JPEG q85.
// Returns { outPath, width, height, sizeBytes, optimized }.

async function optimiseImage(rawPath, finalPath) {
  if (!sharp) {
    // sharp unavailable — just rename raw to final
    fs.renameSync(rawPath, finalPath);
    const stat = fs.statSync(finalPath);
    return { outPath: finalPath, width: 0, height: 0, sizeBytes: stat.size, optimized: false };
  }

  try {
    const info = await sharp(rawPath)
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .toFile(finalPath);

    try { fs.unlinkSync(rawPath); } catch {}
    return { outPath: finalPath, width: info.width, height: info.height, sizeBytes: info.size, optimized: true };
  } catch {
    // Optimization failed — fall back to raw
    fs.renameSync(rawPath, finalPath);
    const stat = fs.statSync(finalPath);
    return { outPath: finalPath, width: 0, height: 0, sizeBytes: stat.size, optimized: false };
  }
}

// ── Manifest helpers ──────────────────────────────────────────────────────────

function loadManifest(productDir) {
  const p = path.join(productDir, 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { images: [], videos: [], hashes: new Set(), updatedAt: null };
  }
}

function serialiseManifest(m) {
  return { ...m, hashes: [...(m.hashes instanceof Set ? m.hashes : new Set(m.hashes))] };
}

function saveManifest(productDir, manifest) {
  fs.mkdirSync(productDir, { recursive: true });
  fs.writeFileSync(
    path.join(productDir, 'manifest.json'),
    JSON.stringify(serialiseManifest(manifest), null, 2),
    'utf8'
  );
}

function deserialisedHashes(manifest) {
  return new Set(Array.isArray(manifest.hashes) ? manifest.hashes : []);
}

// ── Per-product media downloader ──────────────────────────────────────────────

async function downloadProductMedia({ productIndex, title, imageUrls, videoUrls, mediaBaseDir, onProgress }) {
  const productDir = path.join(mediaBaseDir, `product_${productIndex}`);
  const imagesDir = path.join(productDir, 'images');
  const videosDir = path.join(productDir, 'videos');

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });

  const manifest = loadManifest(productDir);
  const knownHashes = deserialisedHashes(manifest);

  const resultImages = [];
  const resultVideos = [];
  const stats = { newImages: 0, skippedImages: 0, failedImages: 0, newVideos: 0, skippedVideos: 0, failedVideos: 0 };

  // ── Images ──────────────────────────────────────────────────────────────────

  const existingImageCount = manifest.images.filter((i) => i.localPath).length;
  let imgIdx = existingImageCount + 1;

  for (const img of imageUrls) {
    if (!img.url) continue;
    const rawPath = path.join(imagesDir, `image_${imgIdx}_raw.tmp`);
    const finalPath = path.join(imagesDir, `image_${imgIdx}.jpg`);

    onProgress(`Image ${imgIdx}: downloading…`);

    try {
      const originalSize = await streamToFile(img.url, rawPath);
      const hash = await hashFile(rawPath);

      if (knownHashes.has(hash)) {
        // Duplicate — discard
        try { fs.unlinkSync(rawPath); } catch {}
        onProgress(`Image ${imgIdx}: duplicate, skipped`);
        stats.skippedImages++;
        continue;
      }

      onProgress(`Image ${imgIdx}: optimising…`);
      const { outPath, width, height, sizeBytes, optimized } = await optimiseImage(rawPath, finalPath);

      knownHashes.add(hash);
      resultImages.push({
        url: img.url,
        localPath: outPath,
        hash,
        width,
        height,
        originalSizeBytes: originalSize,
        fileSizeBytes: sizeBytes,
        optimized,
      });
      stats.newImages++;
      imgIdx++;
    } catch (err) {
      try { fs.unlinkSync(rawPath); } catch {}
      onProgress(`Image ${imgIdx}: failed — ${err.message}`);
      resultImages.push({ url: img.url, localPath: null, error: err.message });
      stats.failedImages++;
    }
  }

  // ── Videos ──────────────────────────────────────────────────────────────────

  const existingVideoCount = manifest.videos.filter((v) => v.localPath).length;
  let vidIdx = existingVideoCount + 1;

  for (const vid of videoUrls) {
    if (!vid.url) continue;
    const tmpPath = path.join(videosDir, `video_${vidIdx}.tmp`);
    const finalPath = path.join(videosDir, `video_${vidIdx}.mp4`);

    onProgress(`Video ${vidIdx}: downloading…`);

    try {
      const originalSize = await streamToFile(vid.url, tmpPath);
      const hash = await hashFile(tmpPath);

      if (knownHashes.has(hash)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        onProgress(`Video ${vidIdx}: duplicate, skipped`);
        stats.skippedVideos++;
        continue;
      }

      fs.renameSync(tmpPath, finalPath);
      const sizeBytes = fs.statSync(finalPath).size;

      knownHashes.add(hash);
      resultVideos.push({
        url: vid.url,
        localPath: finalPath,
        hash,
        fileSizeBytes: sizeBytes,
        originalSizeBytes: originalSize,
      });
      stats.newVideos++;
      vidIdx++;
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch {}
      onProgress(`Video ${vidIdx}: failed — ${err.message}`);
      resultVideos.push({ url: vid.url, localPath: null, error: err.message });
      stats.failedVideos++;
    }
  }

  // ── Persist manifest ─────────────────────────────────────────────────────────

  manifest.productIndex = productIndex;
  manifest.title = title || manifest.title || '';
  manifest.images = [...(manifest.images || []), ...resultImages.filter((i) => i.localPath)];
  manifest.videos = [...(manifest.videos || []), ...resultVideos.filter((v) => v.localPath)];
  manifest.hashes = knownHashes;
  manifest.updatedAt = new Date().toISOString();
  saveManifest(productDir, manifest);

  return {
    productIndex,
    productDir,
    title: manifest.title,
    images: manifest.images,
    videos: manifest.videos,
    newImages: resultImages.filter((i) => i.localPath),
    newVideos: resultVideos.filter((v) => v.localPath),
    stats,
  };
}

// ── Media index reader ────────────────────────────────────────────────────────
// Scans mediaBaseDir for product_N folders and returns all manifests.

function readMediaIndex(mediaBaseDir) {
  if (!fs.existsSync(mediaBaseDir)) return [];

  const entries = fs.readdirSync(mediaBaseDir, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^product_\d+$/.test(entry.name)) continue;
    const productDir = path.join(mediaBaseDir, entry.name);
    const manifest = loadManifest(productDir);
    const serialised = serialiseManifest(manifest);

    // Compute totals
    const totalImageSize = serialised.images.reduce((n, i) => n + (i.fileSizeBytes || 0), 0);
    const totalVideoSize = serialised.videos.reduce((n, v) => n + (v.fileSizeBytes || 0), 0);

    manifests.push({
      ...serialised,
      productDir,
      folderName: entry.name,
      totalSizeBytes: totalImageSize + totalVideoSize,
      imageCount: serialised.images.length,
      videoCount: serialised.videos.length,
    });
  }

  manifests.sort((a, b) => (a.productIndex || 0) - (b.productIndex || 0));
  return manifests;
}

module.exports = { downloadProductMedia, readMediaIndex };
