'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const settingsStore = require('./settingsStore.cjs');

// Lazy-load heavy modules so a native-module failure doesn't crash startup
let productFetcher, mediaDownloader, audioProcessor, videoComposer;
function loadModules() {
  try { productFetcher = require('./productFetcher.cjs'); } catch (e) { console.error('productFetcher load failed:', e.message); }
  try { mediaDownloader = require('./mediaDownloader.cjs'); } catch (e) { console.error('mediaDownloader load failed:', e.message); }
  try { audioProcessor = require('./audioProcessor.cjs'); } catch (e) { console.error('audioProcessor load failed:', e.message); }
  try { videoComposer = require('./videoComposer.cjs'); } catch (e) { console.error('videoComposer load failed:', e.message); }
}

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
    mainWindow.webContents.openDevTools();
  } else {
    // In asar builds __dirname points inside the asar; app.getAppPath() gives the root
    const distIndex = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(distIndex).catch((err) => {
      // Fallback: try relative to __dirname (unpacked builds)
      mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  settingsStore.init(app);
  loadModules();
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
  if (!videoComposer) return { success: false, error: 'videoComposer not available' };
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

  return videoComposer.composeVideo({
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
    if (!videoComposer) return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
    const detected = await videoComposer.detectGpuEncoder();
    return await videoComposer.validateEncoder(detected);
  } catch (err) {
    return { encoder: 'libx264', type: 'cpu', label: 'CPU (libx264)' };
  }
});

// ── Product fetch + media download ───────────────────────────────────────────

ipcMain.handle('fetch-product', async (_event, { jobId, productUrl, productIndex }) => {
  if (!productFetcher) return { success: false, jobId, productIndex, error: 'productFetcher not available', title: '', images: [], videos: [], source: 'failed' };
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
    const result = await productFetcher.fetchProductData(productUrl, credentials, mediaBaseDir, productIndex, sendProgress);
    return { success: true, jobId, productIndex, ...result };
  } catch (err) {
    return { success: false, jobId, productIndex, error: err.message, title: '', images: [], videos: [], source: 'failed' };
  }
});

ipcMain.handle('fetch-all-products', async (_event, { products }) => {
  const results = [];
  for (const { jobId, productUrl, productIndex } of products) {
    if (!productFetcher) { results.push({ success: false, jobId, productIndex, error: 'productFetcher not available', title: '', images: [], videos: [], source: 'failed' }); continue; }
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
      const r = await productFetcher.fetchProductData(productUrl, credentials, mediaBaseDir, productIndex, sendProgress);
      results.push({ success: true, jobId, productIndex, ...r });
    } catch (err) {
      results.push({ success: false, jobId, productIndex, error: err.message, title: '', images: [], videos: [], source: 'failed' });
    }
  }
  return results;
});

// ── Media library ─────────────────────────────────────────────────────────────

ipcMain.handle('download-product-media', async (_event, { jobId, productIndex, title, imageUrls, videoUrls }) => {
  if (!mediaDownloader) return { success: false, jobId, productIndex, error: 'mediaDownloader not available' };
  const mediaBaseDir = settingsStore.mediaDir();
  const sendProgress = (message) => {
    mainWindow?.webContents.send('download-media-progress', { jobId, productIndex, message });
  };
  try {
    const result = await mediaDownloader.downloadProductMedia({ productIndex, title, imageUrls, videoUrls, mediaBaseDir, onProgress: sendProgress });
    return { success: true, jobId, ...result };
  } catch (err) {
    return { success: false, jobId, productIndex, error: err.message };
  }
});

ipcMain.handle('get-media-index', () => {
  if (!mediaDownloader) return [];
  const mediaBaseDir = settingsStore.mediaDir();
  return mediaDownloader.readMediaIndex(mediaBaseDir);
});

ipcMain.handle('open-folder', (_event, folderPath) => {
  return shell.openPath(folderPath);
});

ipcMain.handle('get-media-dir', () => settingsStore.mediaDir());

// ── Audio ─────────────────────────────────────────────────────────────────────

ipcMain.handle('save-audio-file', async (_event, { sourcePath, mode, productIndex, originalName }) => {
  if (!audioProcessor) return { success: false, error: 'audioProcessor not available' };
  try {
    const audioBaseDir = audioProcessor.getAudioDir(settingsStore.mediaDir());
    const result = audioProcessor.copyAudioFile({ sourcePath, mode, productIndex, audioBaseDir, originalName });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-audio-file', (_event, localPath) => {
  if (!audioProcessor) return { success: false, error: 'audioProcessor not available' };
  try {
    audioProcessor.deleteAudioFile(localPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-audio-dir', () => {
  if (!audioProcessor) return '';
  return audioProcessor.getAudioDir(settingsStore.mediaDir());
});

// ── Distribution preview ──────────────────────────────────────────────────────

ipcMain.handle('preview-distribution', (_event, { timelineSegments, style, quality }) => {
  if (!videoComposer) return { success: false, error: 'videoComposer not available' };
  try {
    const mediaDir = settingsStore.mediaDir();
    const plan = videoComposer.buildRenderPlan({
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
