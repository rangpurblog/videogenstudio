'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Video generation
  generateVideo: (payload) => ipcRenderer.invoke('generate-video', payload),
  onVideoProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('video-compose-progress', h);
    return () => ipcRenderer.removeListener('video-compose-progress', h);
  },

  // Settings
  loadSettings: () => ipcRenderer.invoke('settings-load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings-save', settings),

  // Product fetch (metadata + downloads)
  fetchProduct: (args) => ipcRenderer.invoke('fetch-product', args),
  fetchAllProducts: (args) => ipcRenderer.invoke('fetch-all-products', args),
  onFetchProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('fetch-product-progress', h);
    return () => ipcRenderer.removeListener('fetch-product-progress', h);
  },

  // Media library
  downloadProductMedia: (args) => ipcRenderer.invoke('download-product-media', args),
  getMediaIndex: () => ipcRenderer.invoke('get-media-index'),
  getMediaDir: () => ipcRenderer.invoke('get-media-dir'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  onDownloadProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('download-media-progress', h);
    return () => ipcRenderer.removeListener('download-media-progress', h);
  },

  // Audio
  saveAudioFile: (args) => ipcRenderer.invoke('save-audio-file', args),
  deleteAudioFile: (localPath) => ipcRenderer.invoke('delete-audio-file', localPath),
  getAudioDir: () => ipcRenderer.invoke('get-audio-dir'),

  // Distribution preview
  previewDistribution: (args) => ipcRenderer.invoke('preview-distribution', args),

  // GPU detection
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
});
