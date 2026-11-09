// ============================================================================
// 🧠 DeckStateMachine (無頭雙軌 PPT PGM/PVW 與影片池狀態機 · 0-DOM 純邏輯層)
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
  REFRESH_POOLS: 'REFRESH_POOLS'
});

function buildSlotState(deck, slideNum = 1, clickIndex = 0) {
  if (!deck) {
    return {
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
  const totalSlides = Math.max(1, deck.slideCount || (deck.slides ? deck.slides.length : 1));
  const clampedSlide = Math.min(Math.max(1, slideNum), totalSlides);
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
  const maxClicks = Math.max(0, slideMeta.clickCount || 0);
  const clampedClick = Math.min(Math.max(0, clickIndex), maxClicks);

  return {
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
  if (!deck || !slot.deckId) return slot;
  if (slot.clickIndex < slot.clickCount) {
    return buildSlotState(deck, slot.currentSlide, slot.clickIndex + 1);
  }
  if (slot.currentSlide < slot.totalSlides) {
    return buildSlotState(deck, slot.currentSlide + 1, 0);
  }
  return slot;
}

function stepSlotPrev(slot, deck) {
  if (!deck || !slot.deckId) return slot;
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
  constructor({ pptPool = [], videoPool = [], targetDisplay = 'DISPLAY2' } = {}) {
    this.state = {
      targetDisplay,
      outputMode: 'ppt', // 'ppt' | 'video' | 'black'
      isBlackScreen: false,
      pptPool: [...pptPool],
      videoPool: [...videoPool],
      pgm: buildSlotState(pptPool[0] || null, 1, 0),
      pvw: buildSlotState(pptPool[1] || pptPool[0] || null, 1, 0),
      activeVideo: null,
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

  setPools({ pptPool, videoPool }) {
    if (Array.isArray(pptPool)) {
      this.state.pptPool = [...pptPool];
      const pgmDeck = this.findDeck(this.state.pgm.deckId) || this.state.pptPool[0] || null;
      const pvwDeck = this.findDeck(this.state.pvw.deckId) || this.state.pptPool[1] || pgmDeck;
      this.state.pgm = buildSlotState(pgmDeck, this.state.pgm.currentSlide || 1, this.state.pgm.clickIndex || 0);
      this.state.pvw = buildSlotState(pvwDeck, this.state.pvw.currentSlide || 1, this.state.pvw.clickIndex || 0);
    }
    if (Array.isArray(videoPool)) {
      this.state.videoPool = [...videoPool];
    }
    this.state.updatedAt = Date.now();
    return this.getState();
  }

  dispatch(action, payload = {}) {
    switch (action) {
      case DECK_ACTIONS.LOAD_PGM: {
        const deck = this.findDeck(payload.deckId);
        if (deck) {
          this.state.pgm = buildSlotState(deck, payload.slide || 1, 0);
          this.state.activeVideo = null;
          this.state.isBlackScreen = false;
          this.state.outputMode = 'ppt';
        }
        break;
      }

      case DECK_ACTIONS.LOAD_PVW: {
        const deck = this.findDeck(payload.deckId);
        if (deck) {
          this.state.pvw = buildSlotState(deck, payload.slide || 1, 0);
        }
        break;
      }

      case DECK_ACTIONS.CUT_SWAP: {
        const oldPgm = { ...this.state.pgm };
        const oldPvw = { ...this.state.pvw };
        if (oldPvw.deckId) {
          this.state.pgm = oldPvw;
          this.state.pvw = oldPgm.deckId ? oldPgm : oldPvw;
          this.state.activeVideo = null;
          this.state.isBlackScreen = false;
          this.state.outputMode = 'ppt';
        }
        break;
      }

      case DECK_ACTIONS.PGM_NEXT: {
        const deck = this.findDeck(this.state.pgm.deckId);
        this.state.pgm = stepSlotNext(this.state.pgm, deck);
        this.state.isBlackScreen = false;
        if (!this.state.activeVideo) this.state.outputMode = 'ppt';
        break;
      }

      case DECK_ACTIONS.PGM_PREV: {
        const deck = this.findDeck(this.state.pgm.deckId);
        this.state.pgm = stepSlotPrev(this.state.pgm, deck);
        this.state.isBlackScreen = false;
        if (!this.state.activeVideo) this.state.outputMode = 'ppt';
        break;
      }

      case DECK_ACTIONS.PGM_GOTO: {
        const deck = this.findDeck(this.state.pgm.deckId);
        if (deck) {
          this.state.pgm = buildSlotState(deck, Number(payload.slide) || 1, 0);
          this.state.isBlackScreen = false;
          if (!this.state.activeVideo) this.state.outputMode = 'ppt';
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
          this.state.pvw = buildSlotState(deck, Number(payload.slide) || 1, 0);
        }
        break;
      }

      case DECK_ACTIONS.TOGGLE_BLACK: {
        const nextBlack = typeof payload.force === 'boolean' ? payload.force : !this.state.isBlackScreen;
        this.state.isBlackScreen = nextBlack;
        if (nextBlack) {
          this.state.outputMode = 'black';
        } else {
          this.state.outputMode = this.state.activeVideo ? 'video' : 'ppt';
        }
        break;
      }

      case DECK_ACTIONS.PLAY_VIDEO: {
        const video = this.findVideo(payload.videoId);
        if (video) {
          this.state.activeVideo = {
            id: video.id,
            fileName: video.fileName,
            title: video.title,
            url: video.url || `/videos/${encodeURIComponent(video.fileName)}`,
            startedAt: Date.now()
          };
          this.state.isBlackScreen = false;
          this.state.outputMode = 'video';
        }
        break;
      }

      case DECK_ACTIONS.STOP_VIDEO:
      case DECK_ACTIONS.VIDEO_ENDED: {
        this.state.activeVideo = null;
        this.state.outputMode = this.state.isBlackScreen ? 'black' : 'ppt';
        break;
      }

      case DECK_ACTIONS.SYNC_PPT_RUNTIME: {
        // 由底層 PowerPoint COM 引擎回報真實頁碼與動畫步數
        const { slot = 'pgm', deckId, currentSlide, totalSlides, clickIndex, clickCount } = payload;
        const targetKey = slot === 'pvw' ? 'pvw' : 'pgm';
        const deck = this.findDeck(deckId || this.state[targetKey].deckId);
        if (deck) {
          const updated = buildSlotState(
            deck,
            currentSlide || this.state[targetKey].currentSlide || 1,
            typeof clickIndex === 'number' ? clickIndex : this.state[targetKey].clickIndex
          );
          if (typeof totalSlides === 'number' && totalSlides > 0) updated.totalSlides = totalSlides;
          if (typeof clickCount === 'number' && clickCount >= 0) updated.clickCount = clickCount;
          this.state[targetKey] = updated;
        }
        break;
      }

      case DECK_ACTIONS.REFRESH_POOLS: {
        if (payload.pptPool || payload.videoPool) {
          this.setPools(payload);
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

