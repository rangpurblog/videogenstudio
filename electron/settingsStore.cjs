'use strict';

const path = require('path');
const fs = require('fs');

let _app = null;

function init(app) { _app = app; }

function settingsPath() {
  return path.join(_app.getPath('userData'), 'settings.json');
}

const DEFAULTS = {
  paapiAccessKey: '',
  paapiSecretKey: '',
  paapiPartnerTag: '',
  paapiMarketplace: 'www.amazon.com',
  mediaBaseDir: '',
  autoSave: true,
  notifications: true,
  quality: '1080p',
  gpuMode: 'auto',  // 'auto' | 'cpu' | 'nvidia' | 'amd' | 'intel'
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  const merged = { ...load(), ...settings };
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function mediaDir() {
  const s = load();
  return s.mediaBaseDir || path.join(_app.getPath('userData'), 'media');
}

module.exports = { init, load, save, mediaDir };
