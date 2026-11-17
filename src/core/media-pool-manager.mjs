// ============================================================================
// 📂 MediaPoolManager (萬能多媒體流程素材資產管理深模組 · 0-DOM)
// 支援掃描 slides (*.pptx), videos (*.mp4/.webm), images (*.png/.jpg), audios (*.mp3/.wav/.m4a)
// ============================================================================

import fs from 'fs';
import path from 'path';

const VIDEO_LABELS = {
  'prep.mp4': '前行緣念 (聖號/開經偈/皈依發心)',
  'dedication.mp4': '真如老師恭誦大迴向',
  'migtsema.mp4': '密集嘛 經典版官方 MV'
};

export class MediaPoolManager {
  constructor({ slidesDir, videosDir, previewsDir, imagesDir, audiosDir }) {
    this.slidesDir = slidesDir;
    this.videosDir = videosDir;
    this.previewsDir = previewsDir;
    this.imagesDir = imagesDir || path.join(path.dirname(slidesDir), 'images');
    this.audiosDir = audiosDir || path.join(path.dirname(slidesDir), 'audios');
    this.ensureDirs();
  }

  ensureDirs() {
    for (const dir of [this.slidesDir, this.videosDir, this.previewsDir, this.imagesDir, this.audiosDir]) {
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 正常退出系統或關閉主控台視窗 (X) 時，清空所有已載入的實體檔案與預覽快取（含主視覺底圖）
   */
  purgeAllAssets(extraDirs = []) {
    const targetDirs = [
      this.slidesDir,
      this.videosDir,
      this.previewsDir,
      this.imagesDir,
      this.audiosDir,
      ...(Array.isArray(extraDirs) ? extraDirs : [])
    ];
    for (const dir of targetDirs) {
      if (!dir) continue;
      try {
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            if (entry === '.gitkeep') continue;
            const fullPath = path.join(dir, entry);
            try {
              fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            } catch {}
          }
        } else {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch {}
    }
  }

  scanSlides(metadataMap = {}) {
    this.ensureDirs();
    const files = fs.readdirSync(this.slidesDir)
      .filter((f) => /\.(pptx|ppt|ppsx|pptm|ppsm)$/i.test(f) && !f.startsWith('~$'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(pptx|ppt|ppsx|pptm|ppsm)$/i, '');
      const fullPath = path.join(this.slidesDir, fileName);
      const stat = fs.statSync(fullPath);
      const meta = metadataMap[id] || metadataMap[fileName] || {};
      const previewDeckDir = path.join(this.previewsDir, id);

      // 統計已導出的投影片預覽圖數量
      let exportedCount = 0;
      if (fs.existsSync(previewDeckDir)) {
        exportedCount = fs.readdirSync(previewDeckDir).filter((f) => /^slide-\d+\.png$/i.test(f)).length;
      }

      const slideCount = Math.max(1, meta.slideCount || exportedCount || 3);
      const slides = [];
      for (let i = 1; i <= slideCount; i++) {
        const slideClickCount = (meta.slideClicks && typeof meta.slideClicks[i - 1] === 'number')
          ? meta.slideClicks[i - 1]
          : 0;
        slides.push({
          index: i,
          clickCount: slideClickCount,
          previewUrl: `/previews/${encodeURIComponent(id)}/slide-${i}.png`
        });
      }

      return {
        id,
        type: 'ppt',
        fileName,
        title: meta.title || id.replace(/[-_]/g, ' '),
        fullPath,
        sizeKB: Math.round(stat.size / 1024),
        slideCount,
        slides
      };
    });
  }

  scanVideos() {
    this.ensureDirs();
    const files = fs.readdirSync(this.videosDir)
      .filter((f) => /\.(mp4|webm|mov|mkv)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(mp4|webm|mov|mkv)$/i, '');
      const fullPath = path.join(this.videosDir, fileName);
      const stat = fs.statSync(fullPath);
      const sizeMB = Math.round((stat.size / (1024 * 1024)) * 10) / 10;

      return {
        id,
        type: 'video',
        fileName,
        title: VIDEO_LABELS[fileName.toLowerCase()] || id.replace(/[-_]/g, ' '),
        fullPath,
        sizeMB,
        url: `/videos/${encodeURIComponent(fileName)}`
      };
    });
  }

  scanImages() {
    this.ensureDirs();
    if (!fs.existsSync(this.imagesDir)) return [];
    const files = fs.readdirSync(this.imagesDir)
      .filter((f) => /\.(png|jpe?g|webp|svg|gif)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(png|jpe?g|webp|svg|gif)$/i, '');
      const fullPath = path.join(this.imagesDir, fileName);
      const stat = fs.statSync(fullPath);
      const sizeKB = Math.round(stat.size / 1024);

      return {
        id,
        type: 'image',
        fileName,
        title: id.replace(/[-_]/g, ' '),
        fullPath,
        sizeKB,
        url: `/images/${encodeURIComponent(fileName)}`
      };
    });
  }

  scanAudios() {
    this.ensureDirs();
    if (!fs.existsSync(this.audiosDir)) return [];
    const files = fs.readdirSync(this.audiosDir)
      .filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '');
      const fullPath = path.join(this.audiosDir, fileName);
      const stat = fs.statSync(fullPath);
      const sizeMB = Math.round((stat.size / (1024 * 1024)) * 10) / 10;

      return {
        id,
        type: 'audio',
        fileName,
        title: id.replace(/[-_]/g, ' '),
        fullPath,
        sizeMB,
        url: `/audios/${encodeURIComponent(fileName)}`
      };
    });
  }
}
