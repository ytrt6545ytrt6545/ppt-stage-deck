// ============================================================================
// 🧠 DeckStateMachine (無頭多媒體 PGM/PVW 與流程佇列狀態機 · 0-DOM 純邏輯層)
// 嚴格遵循 Physical UI/Logic Decoupling Law：物理禁止引用任何瀏覽器 DOM API
// ============================================================================

export const DECK_ACTIONS = Object.freeze({
  LOAD_PGM: 'LOAD_PGM',
  LOAD_PVW: 'LOAD_PVW',
  CUT_SWAP: 'CUT_SWAP',
  PGM_NEXT: 'PGM_NEXT',
  PGM_PREV: 'PGM_PREV',
  PGM_GOTO: 'PGM_GOTO',
  PVW_NEXT: 'PVW_NEXT',
  PVW_PREV: 'PVW_PREV',
  PVW_GOTO: 'PVW_GOTO',
  TOGGLE_BLACK: 'TOGGLE_BLACK',
  PLAY_VIDEO: 'PLAY_VIDEO',
  STOP_VIDEO: 'STOP_VIDEO',
  VIDEO_ENDED: 'VIDEO_ENDED',
  SYNC_PPT_RUNTIME: 'SYNC_PPT_RUNTIME',
  REFRESH_POOLS: 'REFRESH_POOLS',
  LOAD_PVW_VIDEO: 'LOAD_PVW_VIDEO',
  SEEK_PVW_VIDEO: 'SEEK_PVW_VIDEO',
  CLEAR_PVW_VIDEO: 'CLEAR_PVW_VIDEO',
  SET_KEY_VISUAL: 'SET_KEY_VISUAL',
  CLEAR_KEY_VISUAL: 'CLEAR_KEY_VISUAL',
  TOGGLE_KV_MODE: 'TOGGLE_KV_MODE',
  // 萬能媒體通用操作
  LOAD_MEDIA_PVW: 'LOAD_MEDIA_PVW',
  PLAY_MEDIA_PGM: 'PLAY_MEDIA_PGM',
  STOP_MEDIA: 'STOP_MEDIA',
  TOGGLE_PGM_VIDEO: 'TOGGLE_PGM_VIDEO',
  SEEK_PGM_VIDEO: 'SEEK_PGM_VIDEO'
});

function toSafeInt(val, fallback) {
  if (val === null || val === undefined || val === '' || typeof val === 'boolean') {
    return fallback;
  }
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clonePool(pool) {
  if (!Array.isArray(pool)) return [];
  return structuredClone(pool);
}

export function buildSlotState(deck, slideNum = 1, clickIndex = 0) {
  if (!deck) {
    return {
      type: 'empty',
      deckId: null,
      fileName: null,
      title: '尚未載入簡報',
      currentSlide: 0,
      totalSlides: 0,
      clickIndex: 0,
      clickCount: 0,
      previewUrl: null,
      nextPreviewUrl: null
    };
  }
  const totalSlides = Math.max(1, toSafeInt(deck.slideCount, deck.slides ? deck.slides.length : 1));
  const safeSlideNum = toSafeInt(slideNum, 1);
  const clampedSlide = Math.min(Math.max(1, safeSlideNum), totalSlides);
  const slideMeta = (deck.slides && deck.slides[clampedSlide - 1]) || {
    index: clampedSlide,
    clickCount: 0,
    previewUrl: `/previews/${encodeURIComponent(deck.id)}/slide-${clampedSlide}.png`
  };
  const nextSlideNum = clampedSlide < totalSlides ? clampedSlide + 1 : clampedSlide;
  const nextSlideMeta = (deck.slides && deck.slides[nextSlideNum - 1]) || {
    index: nextSlideNum,
    clickCount: 0,
    previewUrl: `/previews/${encodeURIComponent(deck.id)}/slide-${nextSlideNum}.png`
  };
  const maxClicks = Math.max(0, toSafeInt(slideMeta.clickCount, 0));
  const safeClickIdx = toSafeInt(clickIndex, 0);
  const clampedClick = Math.min(Math.max(0, safeClickIdx), maxClicks);

  return {
    type: 'ppt',
    deckId: deck.id,
    fileName: deck.fileName,
    title: deck.title || deck.fileName,
    currentSlide: clampedSlide,
    totalSlides,
    clickIndex: clampedClick,
    clickCount: maxClicks,
    previewUrl: slideMeta.previewUrl,
    nextPreviewUrl: nextSlideMeta.previewUrl
  };
}

function stepSlotNext(slot, deck) {
  if (!deck || !slot || !slot.deckId) return slot;
  if (slot.clickIndex < slot.clickCount) {
    return buildSlotState(deck, slot.currentSlide, slot.clickIndex + 1);
  }
  if (slot.currentSlide < slot.totalSlides) {
    return buildSlotState(deck, slot.currentSlide + 1, 0);
  }
  return slot;
}

function stepSlotPrev(slot, deck) {
  if (!deck || !slot || !slot.deckId) return slot;
  if (slot.clickIndex > 0) {
    return buildSlotState(deck, slot.currentSlide, slot.clickIndex - 1);
  }
  if (slot.currentSlide > 1) {
    const prevSlideNum = slot.currentSlide - 1;
    const prevSlideMeta = (deck.slides && deck.slides[prevSlideNum - 1]) || { clickCount: 0 };
    return buildSlotState(deck, prevSlideNum, Math.max(0, prevSlideMeta.clickCount || 0));
  }
  return slot;
}

export class DeckStateMachine {
  constructor(options = {}) {
    const safeOpts = options && typeof options === 'object' ? options : {};
    const safePptPool = clonePool(safeOpts.pptPool);
    const safeVideoPool = clonePool(safeOpts.videoPool);
    const safeImagePool = clonePool(safeOpts.imagePool);
    const safeAudioPool = clonePool(safeOpts.audioPool);
    const targetDisplay = safeOpts.targetDisplay || 'DISPLAY2';
    const hasKeyVisual = typeof safeOpts.keyVisualUrl === 'string' && safeOpts.keyVisualUrl;

    // 開機初始狀態：
    // 若 cleanColdBoot 為 true (如伺服器現場預設)，PGM 與 PVW 強制為純淨空槽待命 (無任何預載素材)
    // 否則若 safePptPool 有簡報，預設載入供單元測試與算法驗證
    let initialPgm = buildSlotState(null);
    let initialPvw = buildSlotState(null);
    let defaultOutputMode = 'empty';

    if (safeOpts.cleanColdBoot) {
      initialPgm = buildSlotState(null);
      initialPvw = buildSlotState(null);
      defaultOutputMode = hasKeyVisual ? 'kv' : 'empty';
    } else if (safePptPool.length > 0) {
      initialPgm = buildSlotState(safePptPool[0] || null, 1, 0);
      initialPvw = buildSlotState(safePptPool[1] || safePptPool[0] || null, 1, 0);
      defaultOutputMode = 'ppt';
    } else if (hasKeyVisual) {
      defaultOutputMode = 'kv';
    }

    this.state = {
      targetDisplay,
      outputMode: defaultOutputMode, // 'empty' | 'ppt' | 'video' | 'image' | 'audio' | 'black' | 'kv'
      isBlackScreen: false,
      keyVisualUrl: hasKeyVisual ? safeOpts.keyVisualUrl : null,
      pptPool: safePptPool,
      videoPool: safeVideoPool,
      imagePool: safeImagePool,
      audioPool: safeAudioPool,
      pgm: initialPgm,
      pvw: initialPvw,
      pvwVideo: null, // { id, type, fileName, title, url, currentTime, isPlaying, muted: true }
      pvwMedia: null, // 萬能媒體預覽：{ type: 'video'|'image'|'audio', id, title, url, ... }
      activeVideo: null,
      activeMedia: null, // 萬能媒體 PGM 播出：{ type: 'video'|'image'|'audio', id, title, url, ... }
      updatedAt: Date.now()
    };
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  findDeck(deckId) {
    if (!deckId) return null;
    return this.state.pptPool.find(
      (d) => d.id === deckId || d.fileName === deckId
    ) || null;
  }

  findVideo(videoId) {
    if (!videoId) return null;
    return this.state.videoPool.find(
      (v) => v.id === videoId || v.fileName === videoId
    ) || null;
  }

  findImage(imageId) {
    if (!imageId) return null;
    return (this.state.imagePool || []).find(
      (img) => img.id === imageId || img.fileName === imageId
    ) || null;
  }

  findAudio(audioId) {
    if (!audioId) return null;
    return (this.state.audioPool || []).find(
      (a) => a.id === audioId || a.fileName === audioId
    ) || null;
  }

  findMedia(mediaId, type = null) {
    if (!mediaId) return null;
    if (type === 'ppt' || !type) {
      const d = this.findDeck(mediaId);
      if (d) return { ...d, mediaType: 'ppt' };
    }
    if (type === 'video' || !type) {
      const v = this.findVideo(mediaId);
      if (v) return { ...v, mediaType: 'video' };
    }
    if (type === 'image' || !type) {
      const img = this.findImage(mediaId);
      if (img) return { ...img, mediaType: 'image' };
    }
    if (type === 'audio' || !type) {
      const a = this.findAudio(mediaId);
      if (a) return { ...a, mediaType: 'audio' };
    }
    return null;
  }

  setPools(pools = {}) {
    const safePools = pools && typeof pools === 'object' ? pools : {};
    if (Array.isArray(safePools.pptPool)) {
      this.state.pptPool = clonePool(safePools.pptPool);
      if (this.state.pgm && this.state.pgm.deckId) {
        const pgmDeck = this.findDeck(this.state.pgm.deckId);
        if (pgmDeck) {
          this.state.pgm = buildSlotState(pgmDeck, this.state.pgm.currentSlide || 1, this.state.pgm.clickIndex || 0);
        }
      }
      if (this.state.pvw && this.state.pvw.deckId) {
        const pvwDeck = this.findDeck(this.state.pvw.deckId);
        if (pvwDeck) {
          this.state.pvw = buildSlotState(pvwDeck, this.state.pvw.currentSlide || 1, this.state.pvw.clickIndex || 0);
        }
      }
    }
    if (Array.isArray(safePools.videoPool)) {
      this.state.videoPool = clonePool(safePools.videoPool);
    }
    if (Array.isArray(safePools.imagePool)) {
      this.state.imagePool = clonePool(safePools.imagePool);
    }
    if (Array.isArray(safePools.audioPool)) {
      this.state.audioPool = clonePool(safePools.audioPool);
    }
    this.state.updatedAt = Date.now();
    return this.getState();
  }

  dispatch(action, payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    switch (action) {
      case DECK_ACTIONS.LOAD_PGM: {
        const deck = this.findDeck(safePayload.deckId);
        if (deck) {
          const prevPgm = { ...this.state.pgm };
          if (this.state.pvw.deckId === deck.id && prevPgm.deckId && prevPgm.deckId !== deck.id) {
            const prevPgmDeck = this.findDeck(prevPgm.deckId);
            this.state.pvw = prevPgmDeck
              ? buildSlotState(prevPgmDeck, prevPgm.currentSlide || 1, prevPgm.clickIndex || 0)
              : prevPgm;
          }
          this.state.pgm = buildSlotState(deck, toSafeInt(safePayload.slide, 1), 0);
          this.state.activeVideo = null;
          this.state.activeMedia = null;
          this.state.isBlackScreen = false;
          this.state.outputMode = 'ppt';
        }
        break;
      }

      case DECK_ACTIONS.LOAD_PVW: {
        const deck = this.findDeck(safePayload.deckId);
        if (deck) {
          const prevPvw = { ...this.state.pvw };
          if (this.state.pgm.deckId === deck.id && prevPvw.deckId && prevPvw.deckId !== deck.id) {
            const prevPvwDeck = this.findDeck(prevPvw.deckId);
            this.state.pgm = prevPvwDeck
              ? buildSlotState(prevPvwDeck, prevPvw.currentSlide || 1, prevPvw.clickIndex || 0)
              : prevPvw;
          }
          this.state.pvw = buildSlotState(deck, toSafeInt(safePayload.slide, 1), 0);
          this.state.pvwVideo = null;
          this.state.pvwMedia = null;
        }
        break;
      }

      case DECK_ACTIONS.LOAD_PVW_VIDEO: {
        const video = this.findVideo(safePayload.videoId);
        if (video) {
          // 廣播級互斥鐵律：若該影片正在 PGM 播出中，禁止在 PVW 槽位重複啟動播放實體，防止雙重播放與時間爭搶！
          if (this.state.activeVideo && (this.state.activeVideo.id === video.id || this.state.activeVideo.fileName === video.fileName)) {
            console.log(`[DeckStateMachine] 互斥防禦：影片 ${video.fileName} 正在 PGM 播出中，拒絕送入 PVW 重複播放。`);
            break;
          }
          const seekTime = Number.isFinite(Number(safePayload.currentTime)) ? Math.max(0, Number(safePayload.currentTime)) : 0;
          const vObj = {
            id: video.id,
            type: 'video',
            fileName: video.fileName,
            title: video.title,
            url: video.url || `/videos/${encodeURIComponent(video.fileName)}`,
            currentTime: seekTime,
            isPlaying: !!safePayload.isPlaying,
            muted: true // 預覽槽強制靜音！
          };
          this.state.pvwVideo = vObj;
          this.state.pvwMedia = vObj;
        }
        break;
      }

      case DECK_ACTIONS.SEEK_PVW_VIDEO: {
        if (this.state.pvwVideo) {
          const seekTime = Number.isFinite(Number(safePayload.currentTime)) ? Math.max(0, Number(safePayload.currentTime)) : 0;
          this.state.pvwVideo.currentTime = seekTime;
          if (typeof safePayload.isPlaying === 'boolean') {
            this.state.pvwVideo.isPlaying = safePayload.isPlaying;
          }
          if (this.state.pvwMedia && this.state.pvwMedia.type === 'video') {
            this.state.pvwMedia.currentTime = seekTime;
            if (typeof safePayload.isPlaying === 'boolean') {
              this.state.pvwMedia.isPlaying = safePayload.isPlaying;
            }
          }
        }
        break;
      }

      case DECK_ACTIONS.CLEAR_PVW_VIDEO: {
        this.state.pvwVideo = null;
        if (this.state.pvwMedia && (this.state.pvwMedia.type === 'video' || this.state.pvwMedia.type === 'audio')) {
          this.state.pvwMedia = null;
        }
        break;
      }

      case DECK_ACTIONS.LOAD_MEDIA_PVW: {
        const { mediaId, type, currentTime = 0, isPlaying = false } = safePayload;
        const media = this.findMedia(mediaId, type);
        if (media) {
          if (media.mediaType === 'ppt') {
            this.state.pvw = buildSlotState(media, 1, 0);
            this.state.pvwVideo = null;
            this.state.pvwMedia = null;
          } else {
            // 廣播級互斥鐵律：若該素材正在 PGM 播出中，禁止在 PVW 槽位重複啟動播放實體，防止雙重播放與時間爭搶！
            const isPgmPlaying = (this.state.activeVideo && (this.state.activeVideo.id === media.id || this.state.activeVideo.fileName === media.fileName)) ||
                                 (this.state.activeMedia && (this.state.activeMedia.id === media.id || this.state.activeMedia.fileName === media.fileName));
            if (isPgmPlaying) {
              console.log(`[DeckStateMachine] 互斥防禦：素材 ${media.fileName || media.id} 正在 PGM 播出中，拒絕送入 PVW 重複播放。`);
              break;
            }
            const safeCurrentTime = Number.isFinite(Number(currentTime)) && Number(currentTime) >= 0 ? Number(currentTime) : 0;
            const mediaObj = {
              id: media.id,
              type: media.mediaType,
              fileName: media.fileName,
              title: media.title,
              url: media.url,
              currentTime: safeCurrentTime,
              isPlaying: Boolean(isPlaying),
              muted: true // 預覽槽影音一律 100% 靜音！
            };
            this.state.pvwMedia = mediaObj;
            if (media.mediaType === 'video') {
              this.state.pvwVideo = mediaObj;
            } else {
              this.state.pvwVideo = null;
            }
          }
        }
        break;
      }

      case DECK_ACTIONS.PLAY_MEDIA_PGM: {
        const { mediaId, type, startTime = 0 } = safePayload;
        const media = this.findMedia(mediaId, type);
        if (media) {
          // 廣播級互斥鐵律：若該素材原先正在 PVW 預覽，登上 PGM 後自動清空 PVW！
          if (this.state.pvwVideo && (this.state.pvwVideo.id === media.id || this.state.pvwVideo.fileName === media.fileName)) {
            this.state.pvwVideo = null;
          }
          if (this.state.pvwMedia && (this.state.pvwMedia.id === media.id || this.state.pvwMedia.fileName === media.fileName)) {
            this.state.pvwMedia = null;
          }

          if (media.mediaType === 'ppt') {
            this.state.pgm = buildSlotState(media, 1, 0);
            this.state.activeVideo = null;
            this.state.activeMedia = null;
            this.state.isBlackScreen = false;
            this.state.outputMode = 'ppt';
          } else if (media.mediaType === 'video') {
            const sTime = Number.isFinite(Number(startTime)) ? Math.max(0, Number(startTime)) : 0;
            const vObj = {
              id: media.id,
              type: 'video',
              fileName: media.fileName,
              title: media.title,
              url: media.url || `/videos/${encodeURIComponent(media.fileName)}`,
              startTime: sTime,
              startedAt: Date.now(),
              muted: false // PGM 播出解鎖聲音
            };
            this.state.activeVideo = vObj;
            this.state.activeMedia = vObj;
            this.state.isBlackScreen = false;
            this.state.outputMode = 'video';
          } else if (media.mediaType === 'image') {
            const imgObj = {
              id: media.id,
              type: 'image',
              fileName: media.fileName,
              title: media.title,
              url: media.url || `/images/${encodeURIComponent(media.fileName)}`
            };
            this.state.activeVideo = null;
            this.state.activeMedia = imgObj;
            this.state.isBlackScreen = false;
            this.state.outputMode = 'image';
          } else if (media.mediaType === 'audio') {
            const sTime = Number.isFinite(Number(startTime)) ? Math.max(0, Number(startTime)) : 0;
            const aObj = {
              id: media.id,
              type: 'audio',
              fileName: media.fileName,
              title: media.title,
              url: media.url || `/audios/${encodeURIComponent(media.fileName)}`,
              startTime: sTime,
              startedAt: Date.now(),
              muted: false // PGM 播出解鎖聲音
            };
            this.state.activeVideo = null;
            this.state.activeMedia = aObj;
            this.state.isBlackScreen = false;
            this.state.outputMode = 'audio';
          }
        }
        break;
      }

      case DECK_ACTIONS.STOP_MEDIA: {
        this.state.activeVideo = null;
        this.state.activeMedia = null;
        if (this.state.isBlackScreen) {
          this.state.outputMode = 'black';
        } else if (this.state.pgm && this.state.pgm.deckId) {
          this.state.outputMode = 'ppt';
        } else if (this.state.keyVisualUrl) {
          this.state.outputMode = 'kv';
        } else {
          this.state.outputMode = 'empty';
        }
        break;
      }

      case DECK_ACTIONS.TOGGLE_PGM_VIDEO: {
        if (this.state.activeVideo) {
          const isPaused = !this.state.activeVideo.isPaused;
          this.state.activeVideo.isPaused = isPaused;
          if (Number.isFinite(Number(safePayload.currentTime))) {
            this.state.activeVideo.currentTime = Number(safePayload.currentTime);
          }
          if (this.state.activeMedia) {
            this.state.activeMedia.isPaused = isPaused;
          }
        }
        break;
      }

      case DECK_ACTIONS.SEEK_PGM_VIDEO: {
        if (this.state.activeVideo) {
          const targetTime = Number.isFinite(Number(safePayload.currentTime)) ? Math.max(0, Number(safePayload.currentTime)) : 0;
          this.state.activeVideo.currentTime = targetTime;
          if (safePayload.isPaused !== undefined) {
            this.state.activeVideo.isPaused = Boolean(safePayload.isPaused);
          }
          if (this.state.activeMedia) {
            this.state.activeMedia.currentTime = targetTime;
            if (safePayload.isPaused !== undefined) {
              this.state.activeMedia.isPaused = Boolean(safePayload.isPaused);
            }
          }
        }
        break;
      }

      case DECK_ACTIONS.CUT_SWAP: {
        // 保存當前 PGM 與 PVW 的完整原始狀態快照 (廣播級真正雙向無縫互換 SWAP)
        const oldPgm = { ...this.state.pgm };
        const oldPvw = { ...this.state.pvw };
        const oldActiveVideo = this.state.activeVideo ? { ...this.state.activeVideo } : null;
        const oldActiveMedia = this.state.activeMedia ? { ...this.state.activeMedia } : null;
        const oldPvwVideo = this.state.pvwVideo ? { ...this.state.pvwVideo } : null;
        const oldPvwMedia = this.state.pvwMedia ? { ...this.state.pvwMedia } : null;
        const oldOutputMode = this.state.outputMode;

        // 1. 決定新的 PGM（由原 PVW 內容推上主畫面）
        if (oldPvwMedia || oldPvwVideo) {
          const m = oldPvwMedia || oldPvwVideo;
          this.state.pgm = buildSlotState(null);
          if (m.type === 'video' || (!m.type && oldPvwVideo)) {
            const v = oldPvwVideo || m;
            const startTime = Number.isFinite(v.currentTime) ? Math.max(0, v.currentTime) : 0;
            const newActiveVideo = {
              id: v.id,
              type: 'video',
              fileName: v.fileName,
              title: v.title,
              url: v.url,
              startTime,
              startedAt: Date.now(),
              muted: false // 登台解鎖聲音！
            };
            this.state.activeVideo = newActiveVideo;
            this.state.activeMedia = newActiveVideo;
            this.state.outputMode = 'video';
          } else if (m.type === 'image') {
            this.state.activeMedia = {
              id: m.id,
              type: 'image',
              fileName: m.fileName,
              title: m.title,
              url: m.url
            };
            this.state.activeVideo = null;
            this.state.outputMode = 'image';
          } else if (m.type === 'audio') {
            const startTime = Number.isFinite(m.currentTime) ? Math.max(0, m.currentTime) : 0;
            const newActiveAudio = {
              id: m.id,
              type: 'audio',
              fileName: m.fileName,
              title: m.title,
              url: m.url,
              startTime,
              startedAt: Date.now(),
              muted: false
            };
            this.state.activeMedia = newActiveAudio;
            this.state.activeVideo = null;
            this.state.outputMode = 'audio';
          }
        } else if (oldPvw.deckId) {
          // 原 PVW 是 PPT (透過 buildSlotState 重建標準預覽圖 URL，後續若 COM 視窗可見再升級為 livePreviewUrl)
          const pgmDeck = this.findDeck(oldPvw.deckId);
          this.state.pgm = pgmDeck
            ? buildSlotState(pgmDeck, oldPvw.currentSlide || 1, oldPvw.clickIndex || 0)
            : { ...oldPvw };
          this.state.activeVideo = null;
          this.state.activeMedia = null;
          this.state.outputMode = 'ppt';
        } else {
          // 原 PVW 是空槽
          this.state.pgm = buildSlotState(null);
          this.state.activeVideo = null;
          this.state.activeMedia = null;
          this.state.outputMode = this.state.keyVisualUrl ? 'kv' : 'empty';
        }

        // 2. 決定新的 PVW（由原 PGM 內容退回預覽槽待命，絕不丟失影片！）
        if (oldOutputMode === 'video' && oldActiveVideo) {
          // 原 PGM 是影片：退回 PVW 槽位停格待命！
          const pgmCurTime = Number.isFinite(Number(safePayload.pgmCurrentTime))
            ? Math.max(0, Number(safePayload.pgmCurrentTime))
            : (Number.isFinite(Number(oldActiveVideo.currentTime)) ? Number(oldActiveVideo.currentTime) : 0);

          const newPvwVideo = {
            id: oldActiveVideo.id,
            type: 'video',
            fileName: oldActiveVideo.fileName,
            title: oldActiveVideo.title,
            url: oldActiveVideo.url,
            currentTime: pgmCurTime,
            isPlaying: false, // 退回預覽一律靜音停格待命
            muted: true
          };
          this.state.pvwVideo = newPvwVideo;
          this.state.pvwMedia = newPvwVideo;
          this.state.pvw = buildSlotState(null);
        } else if (oldOutputMode === 'image' && oldActiveMedia) {
          // 原 PGM 是圖片：退回 PVW
          this.state.pvwMedia = {
            id: oldActiveMedia.id,
            type: 'image',
            fileName: oldActiveMedia.fileName,
            title: oldActiveMedia.title,
            url: oldActiveMedia.url
          };
          this.state.pvwVideo = null;
          this.state.pvw = buildSlotState(null);
        } else if (oldOutputMode === 'audio' && oldActiveMedia) {
          // 原 PGM 是音訊：退回 PVW
          const pgmCurTime = Number.isFinite(Number(safePayload.pgmCurrentTime))
            ? Math.max(0, Number(safePayload.pgmCurrentTime))
            : (Number.isFinite(Number(oldActiveMedia.currentTime)) ? Number(oldActiveMedia.currentTime) : 0);

          const newPvwAudio = {
            id: oldActiveMedia.id,
            type: 'audio',
            fileName: oldActiveMedia.fileName,
            title: oldActiveMedia.title,
            url: oldActiveMedia.url,
            currentTime: pgmCurTime,
            isPlaying: false,
            muted: true
          };
          this.state.pvwMedia = newPvwAudio;
          this.state.pvwVideo = null;
          this.state.pvw = buildSlotState(null);
        } else if (oldPgm.deckId) {
          // 原 PGM 是 PPT：退回 PVW (必須透過 buildSlotState 重建標準預覽圖 URL，嚴禁直接繼承舊的 _live_pgm.png 避免被非 PPT 模式隱藏後的黑屏覆蓋！)
          const pvwDeck = this.findDeck(oldPgm.deckId);
          if (pvwDeck) {
            this.state.pvw = buildSlotState(pvwDeck, oldPgm.currentSlide || 1, oldPgm.clickIndex || 0);
          } else {
            this.state.pvw = { ...oldPgm };
          }
          this.state.pvwVideo = null;
          this.state.pvwMedia = null;
        } else {
          // 原 PGM 是空槽或 KV：PVW 變空槽
          this.state.pvw = buildSlotState(null);
          this.state.pvwVideo = null;
          this.state.pvwMedia = null;
        }

        this.state.isBlackScreen = false;
        break;
      }

      case DECK_ACTIONS.PGM_NEXT: {
        const deck = this.findDeck(this.state.pgm.deckId);
        this.state.pgm = stepSlotNext(this.state.pgm, deck);
        this.state.isBlackScreen = false;
        if (!this.state.activeVideo && !this.state.activeMedia) this.state.outputMode = 'ppt';
        break;
      }

      case DECK_ACTIONS.PGM_PREV: {
        const deck = this.findDeck(this.state.pgm.deckId);
        this.state.pgm = stepSlotPrev(this.state.pgm, deck);
        this.state.isBlackScreen = false;
        if (!this.state.activeVideo && !this.state.activeMedia) this.state.outputMode = 'ppt';
        break;
      }

      case DECK_ACTIONS.PGM_GOTO: {
        const deck = this.findDeck(this.state.pgm.deckId);
        if (deck) {
          this.state.pgm = buildSlotState(deck, toSafeInt(safePayload.slide, 1), 0);
          this.state.isBlackScreen = false;
          if (!this.state.activeVideo && !this.state.activeMedia) this.state.outputMode = 'ppt';
        }
        break;
      }

      case DECK_ACTIONS.PVW_NEXT: {
        const deck = this.findDeck(this.state.pvw.deckId);
        this.state.pvw = stepSlotNext(this.state.pvw, deck);
        break;
      }

      case DECK_ACTIONS.PVW_PREV: {
        const deck = this.findDeck(this.state.pvw.deckId);
        this.state.pvw = stepSlotPrev(this.state.pvw, deck);
        break;
      }

      case DECK_ACTIONS.PVW_GOTO: {
        const deck = this.findDeck(this.state.pvw.deckId);
        if (deck) {
          this.state.pvw = buildSlotState(deck, toSafeInt(safePayload.slide, 1), 0);
        }
        break;
      }

      case DECK_ACTIONS.TOGGLE_BLACK: {
        const nextBlack = typeof safePayload.force === 'boolean' ? safePayload.force : !this.state.isBlackScreen;
        this.state.isBlackScreen = nextBlack;
        if (nextBlack) {
          this.state.outputMode = 'black';
        } else {
          if (this.state.activeVideo) this.state.outputMode = 'video';
          else if (this.state.activeMedia) this.state.outputMode = this.state.activeMedia.type || 'video';
          else if (this.state.pgm && this.state.pgm.deckId) this.state.outputMode = 'ppt';
          else if (this.state.keyVisualUrl) this.state.outputMode = 'kv';
          else this.state.outputMode = 'empty';
        }
        break;
      }

      case DECK_ACTIONS.PLAY_VIDEO: {
        const video = this.findVideo(safePayload.videoId);
        if (video) {
          // 廣播級互斥鐵律：若該影片原先正在 PVW 預覽，登上 PGM 後自動清空 PVW！
          if (this.state.pvwVideo && (this.state.pvwVideo.id === video.id || this.state.pvwVideo.fileName === video.fileName)) {
            this.state.pvwVideo = null;
          }
          if (this.state.pvwMedia && (this.state.pvwMedia.id === video.id || this.state.pvwMedia.fileName === video.fileName)) {
            this.state.pvwMedia = null;
          }

          const startTime = Number.isFinite(Number(safePayload.startTime)) ? Math.max(0, Number(safePayload.startTime)) : 0;
          const vObj = {
            id: video.id,
            type: 'video',
            fileName: video.fileName,
            title: video.title,
            url: video.url || `/videos/${encodeURIComponent(video.fileName)}`,
            startTime,
            startedAt: Date.now(),
            muted: false
          };
          this.state.activeVideo = vObj;
          this.state.activeMedia = vObj;
          this.state.isBlackScreen = false;
          this.state.outputMode = 'video';
        }
        break;
      }

      case DECK_ACTIONS.STOP_VIDEO:
      case DECK_ACTIONS.VIDEO_ENDED: {
        this.state.activeVideo = null;
        this.state.activeMedia = null;
        if (this.state.isBlackScreen) {
          this.state.outputMode = 'black';
        } else if (this.state.pgm && this.state.pgm.deckId) {
          this.state.outputMode = 'ppt';
        } else if (this.state.keyVisualUrl) {
          this.state.outputMode = 'kv';
        } else {
          this.state.outputMode = 'empty';
        }
        break;
      }

      case DECK_ACTIONS.SET_KEY_VISUAL: {
        const url = typeof safePayload.url === 'string' && safePayload.url.trim() ? safePayload.url.trim() : null;
        this.state.keyVisualUrl = url;
        break;
      }

      case DECK_ACTIONS.CLEAR_KEY_VISUAL: {
        this.state.keyVisualUrl = null;
        if (this.state.outputMode === 'kv') {
          if (this.state.activeVideo) this.state.outputMode = 'video';
          else if (this.state.activeMedia) this.state.outputMode = this.state.activeMedia.type || 'video';
          else if (this.state.isBlackScreen) this.state.outputMode = 'black';
          else if (this.state.pgm && this.state.pgm.deckId) this.state.outputMode = 'ppt';
          else this.state.outputMode = 'empty';
        }
        break;
      }

      case DECK_ACTIONS.TOGGLE_KV_MODE: {
        if (this.state.outputMode === 'kv') {
          if (this.state.activeVideo) this.state.outputMode = 'video';
          else if (this.state.activeMedia) this.state.outputMode = this.state.activeMedia.type || 'video';
          else if (this.state.isBlackScreen) this.state.outputMode = 'black';
          else if (this.state.pgm && this.state.pgm.deckId) this.state.outputMode = 'ppt';
          else this.state.outputMode = 'empty';
        } else {
          this.state.outputMode = 'kv';
          this.state.isBlackScreen = false;
        }
        break;
      }

      case DECK_ACTIONS.SYNC_PPT_RUNTIME: {
        // 由底層 PowerPoint COM 引擎回報真實頁碼、動畫步數與即時 PrintWindow 畫面
        const { slot = 'pgm', deckId, currentSlide, totalSlides, clickIndex, clickCount, livePreviewUrl, hwnd, topCenterHwnd } = safePayload;
        const targetKey = slot === 'pvw' ? 'pvw' : 'pgm';
        const deck = this.findDeck(deckId || (this.state[targetKey] && this.state[targetKey].deckId));
        if (deck) {
          const fallbackSlide = (this.state[targetKey] && this.state[targetKey].currentSlide) || 1;
          const fallbackClick = (this.state[targetKey] && this.state[targetKey].clickIndex) || 0;
          const updated = buildSlotState(
            deck,
            toSafeInt(currentSlide, fallbackSlide),
            toSafeInt(clickIndex, fallbackClick)
          );
          const safeTotal = toSafeInt(totalSlides, -1);
          const safeClicks = toSafeInt(clickCount, -1);
          if (safeTotal > 0) updated.totalSlides = safeTotal;
          if (safeClicks >= 0) updated.clickCount = safeClicks;
          if (livePreviewUrl) updated.previewUrl = livePreviewUrl;
          if (hwnd) updated.hwnd = hwnd;
          if (topCenterHwnd) updated.topCenterHwnd = topCenterHwnd;
          this.state[targetKey] = updated;
        }
        break;
      }

      case DECK_ACTIONS.REFRESH_POOLS: {
        if (safePayload.pptPool || safePayload.videoPool || safePayload.imagePool || safePayload.audioPool) {
          this.setPools(safePayload);
        }
        break;
      }

      default:
        break;
    }

    this.state.updatedAt = Date.now();
    return this.getState();
  }
}
