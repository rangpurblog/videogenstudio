'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const settingsStore = require('./settingsStore.cjs');
const { fetchProductData, extractAsin } = require('./productFetcher.cjs');
const { downloadProductMedia, readMediaIndex } = require('./mediaDownloader.cjs');
const { copyAudioFile, deleteAudioFile, getAudioDir } = require('./audioProcessor.cjs');
const { composeVideo, buildRenderPlan, distributeMedia, scanProductMedia, detectGpuEncoder, validateEncoder } = require('./videoComposer.cjs');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  settingsStore.init(app);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Window controls ───────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── Settings ──────────────────────────────────────────────────────────────────

ipcMain.handle('settings-load', () => settingsStore.load());
ipcMain.handle('settings-save', (_event, settings) => settingsStore.save(settings));

// ── Generate video ────────────────────────────────────────────────────────────

ipcMain.handle('generate-video', async (_event, payload) => {
  const {
    timelineSegments,
    audioMode = 'single',
    style = 'product',
    quality = '1080p',
    projectId,
    manualOverrides = [],
  } = payload || {};

  const settings = settingsStore.load();
  const gpuMode = settings.gpuMode || 'auto';
  const mediaDir = settingsStore.mediaDir();
  const outputDir = path.join(mediaDir, '..', 'output');

  const sendProgress = (message) => {
    mainWindow?.webContents.send('video-compose-progress', { message });
  };

  return composeVideo({
    timelineSegments,
    audioMode,
    style,
    quality,
    mediaDir,
    outputDir,
    projectId,
    manualOverrides,
    gpuMode,
    onProgress: sendProgress,
  });
});

// ── Detect GPU ────────────────────────────────────────────────────────────────

ipcMain.handle('detect-gpu', async () => {
  try {
    const detected = await detectGpuEncoder();
    return await validateEncoder(detected);
  } catch (err) {
    return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
  }
});

// ── Product fetch + media download ───────────────────────────────────────────
//
// Unified handler: calls PAAPI/Puppeteer for metadata, then streams all
// assets through mediaDownloader for dedup, structuring, and optimization.

ipcMain.handle('fetch-product', async (_event, { jobId, productUrl, productIndex }) => {
  const settings = settingsStore.load();
  const mediaBaseDir = settingsStore.mediaDir();
  const credentials = {
    accessKey: settings.paapiAccessKey,
    secretKey: settings.paapiSecretKey,
    partnerTag: settings.paapiPartnerTag,
    marketplace: settings.paapiMarketplace,
  };

  const sendProgress = (message) => {
    mainWindow?.webContents.send('fetch-product-progress', { jobId, productIndex, message });
  };

  try {
    const result = await fetchProductData(productUrl, credentials, mediaBaseDir, productIndex, sendProgress);
    return { success: true, jobId, productIndex, ...result };
  } catch (err) {
    return { success: false, jobId, productIndex, error: err.message, title: '', images: [], videos: [], source: 'failed' };
  }
});

ipcMain.handle('fetch-all-products', async (_event, { products }) => {
  const results = [];
  for (const { jobId, productUrl, productIndex } of products) {
    const settings = settingsStore.load();
    const mediaBaseDir = settingsStore.mediaDir();
    const credentials = {
      accessKey: settings.paapiAccessKey,
      secretKey: settings.paapiSecretKey,
      partnerTag: settings.paapiPartnerTag,
      marketplace: settings.paapiMarketplace,
    };
    const sendProgress = (message) => {
      mainWindow?.webContents.send('fetch-product-progress', { jobId, productIndex, message });
    };
    try {
      const r = await fetchProductData(productUrl, credentials, mediaBaseDir, productIndex, sendProgress);
      results.push({ success: true, jobId, productIndex, ...r });
    } catch (err) {
      results.push({ success: false, jobId, productIndex, error: err.message, title: '', images: [], videos: [], source: 'failed' });
    }
  }
  return results;
});

// ── Media library ─────────────────────────────────────────────────────────────

// Re-download media for a product given pre-fetched URL lists
ipcMain.handle('download-product-media', async (_event, { jobId, productIndex, title, imageUrls, videoUrls }) => {
  const mediaBaseDir = settingsStore.mediaDir();
  const sendProgress = (message) => {
    mainWindow?.webContents.send('download-media-progress', { jobId, productIndex, message });
  };
  try {
    const result = await downloadProductMedia({ productIndex, title, imageUrls, videoUrls, mediaBaseDir, onProgress: sendProgress });
    return { success: true, jobId, ...result };
  } catch (err) {
    return { success: false, jobId, productIndex, error: err.message };
  }
});

// Scan media directory and return all product manifests
ipcMain.handle('get-media-index', () => {
  const mediaBaseDir = settingsStore.mediaDir();
  return readMediaIndex(mediaBaseDir);
});

// Open a folder in the OS file manager
ipcMain.handle('open-folder', (_event, folderPath) => {
  return shell.openPath(folderPath);
});

// Return the current media base directory path
ipcMain.handle('get-media-dir', () => settingsStore.mediaDir());

// ── Audio ─────────────────────────────────────────────────────────────────────

// Copy a dropped/selected audio file into the project audio directory.
// sourcePath comes from File.path (Electron renderer extension).
ipcMain.handle('save-audio-file', async (_event, { sourcePath, mode, productIndex, originalName }) => {
  try {
    const audioBaseDir = getAudioDir(settingsStore.mediaDir());
    const result = copyAudioFile({ sourcePath, mode, productIndex, audioBaseDir, originalName });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete an audio file from disk.
ipcMain.handle('delete-audio-file', (_event, localPath) => {
  try {
    deleteAudioFile(localPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Return the audio directory path.
ipcMain.handle('get-audio-dir', () => getAudioDir(settingsStore.mediaDir()));

// ── Distribution preview ──────────────────────────────────────────────────────
// Compute the clip distribution plan for a set of product segments without
// running FFmpeg. Used by the UI to render a visual preview.

ipcMain.handle('preview-distribution', (_event, { timelineSegments, style, quality }) => {
  try {
    const mediaDir = settingsStore.mediaDir();
    const plan = buildRenderPlan({
      timelineSegments,
      mediaDir,
      audioMode: 'single',
      style: style || 'product',
      quality: quality || '1080p',
    });
    return { success: true, plan };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
