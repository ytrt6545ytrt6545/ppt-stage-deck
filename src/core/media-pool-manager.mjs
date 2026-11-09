// ============================================================================
// 📂 MediaPoolManager (PPT 簡報池與零雜訊影片池資產管理深模組 · 0-DOM)
// 負責掃描 assets/slides (*.pptx) 與 assets/videos (*.mp4) 並整合預覽圖索引
// ============================================================================

import fs from 'fs';
import path from 'path';

const VIDEO_LABELS = {
  'prep.mp4': '前行緣念 (聖號/開經偈/皈依發心)',
  'dedication.mp4': '真如老師恭誦大迴向',
  'migtsema.mp4': '密集嘛 經典版官方 MV'
};

export class MediaPoolManager {
  constructor({ slidesDir, videosDir, previewsDir }) {
    this.slidesDir = slidesDir;
    this.videosDir = videosDir;
    this.previewsDir = previewsDir;
    this.ensureDirs();
  }

  ensureDirs() {
    for (const dir of [this.slidesDir, this.videosDir, this.previewsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  scanSlides(metadataMap = {}) {
    this.ensureDirs();
    const files = fs.readdirSync(this.slidesDir)
      .filter((f) => /\.(pptx|ppt|ppsx)$/i.test(f) && !f.startsWith('~$'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(pptx|ppt|ppsx)$/i, '');
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
      .filter((f) => /\.(mp4|webm|mov)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant-TW'));

    return files.map((fileName) => {
      const id = fileName.replace(/\.(mp4|webm|mov)$/i, '');
      const fullPath = path.join(this.videosDir, fileName);
      const stat = fs.statSync(fullPath);
      const sizeMB = Math.round((stat.size / (1024 * 1024)) * 10) / 10;

      return {
        id,
        fileName,
        title: VIDEO_LABELS[fileName.toLowerCase()] || id.replace(/[-_]/g, ' '),
        fullPath,
        sizeMB,
        url: `/videos/${encodeURIComponent(fileName)}`
      };
    });
  }
}

