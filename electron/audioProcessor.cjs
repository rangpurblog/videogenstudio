'use strict';

const path = require('path');
const fs = require('fs');

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

function getAudioDir(mediaBaseDir) {
  return path.join(mediaBaseDir, 'audio');
}

/**
 * Copies an audio file from its original location into the project audio dir.
 * Naming convention:
 *   single mode  → full_narration.ext
 *   multi mode   → product_1.ext, product_2.ext, …
 *
 * Returns { localPath, fileName, fileSizeBytes } on success.
 */
function copyAudioFile({ sourcePath, mode, productIndex, audioBaseDir, originalName }) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }

  fs.mkdirSync(audioBaseDir, { recursive: true });

  const destName =
    mode === 'single' ? `full_narration${ext}` : `product_${productIndex}${ext}`;
  const destPath = path.join(audioBaseDir, destName);

  fs.copyFileSync(sourcePath, destPath);

  const stat = fs.statSync(destPath);
  return { localPath: destPath, fileName: destName, fileSizeBytes: stat.size };
}

/**
 * Deletes an audio file from disk (best-effort — ignores missing files).
 */
function deleteAudioFile(localPath) {
  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch {
    // ignore
  }
}

module.exports = { copyAudioFile, deleteAudioFile, getAudioDir };
