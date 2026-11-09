// ============================================================================
// 🖥️ View Layer: public/app.js (純狀態投影 UI = f(State) · 僅拋出語意化 Action)
// 對標 Physical UI/Logic Decoupling Law
// ============================================================================

let currentState = null;
let ws = null;
let lanUrl = window.location.origin;

export async function dispatchAction(action, payload = {}) {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });
    const data = await res.json();
    if (data && data.state) {
      renderState(data.state);
    }
    return data;
  } catch (err) {
    console.error('[StageDeck] Action failed:', err);
    return null;
  }
}

function renderState(state) {
  if (!state) return;
  currentState = state;

  // 1. 頂部輸出狀態與黑屏按鈕
  const outputModeBadge = document.getElementById('outputModeBadge');
  const btnBlackScreen = document.getElementById('btnBlackScreen');
  const btnStopVideo = document.getElementById('btnStopVideo');

  if (state.isBlackScreen || state.outputMode === 'black') {
    outputModeBadge.textContent = '◼ 第二螢幕黑屏中';
    outputModeBadge.className = 'badge badge-black';
    btnBlackScreen.classList.add('active');
    btnBlackScreen.textContent = '☀ 解除黑屏 (恢復畫面)';
  } else if (state.outputMode === 'video' && state.activeVideo) {
    outputModeBadge.textContent = `🎬 正在播放影片：${state.activeVideo.title}`;
    outputModeBadge.className = 'badge badge-video';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '◼ 黑屏 (Black)';
  } else {
    outputModeBadge.textContent = '📊 PPT 播出中';
    outputModeBadge.className = 'badge badge-live';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '◼ 黑屏 (Black)';
  }

  if (btnStopVideo) {
    btnStopVideo.style.display = state.activeVideo ? 'inline-flex' : 'none';
  }

  // 2. 左卡：現在播出 (PGM)
  const pgm = state.pgm || {};
  document.getElementById('pgmDeckTitle').textContent = pgm.title || '尚未載入簡報';
  document.getElementById('pgmPageBadge').textContent = `${pgm.currentSlide || 0} / ${pgm.totalSlides || 0}`;
  document.getElementById('pgmAnimBadge').textContent =
    pgm.clickCount > 0 ? `動畫 ${pgm.clickIndex || 0} / ${pgm.clickCount}` : '無頁內動畫';

  const pgmImg = document.getElementById('pgmPreviewImg');
  const pgmNextImg = document.getElementById('pgmNextPreviewImg');
  if (pgm.previewUrl) {
    pgmImg.src = pgm.previewUrl;
  }
  if (pgm.nextPreviewUrl) {
    pgmNextImg.src = pgm.nextPreviewUrl;
  }

  // 3. 右卡：準備播出 (PVW)
  const pvw = state.pvw || {};
  document.getElementById('pvwDeckTitle').textContent = pvw.title || '尚未載入簡報';
  document.getElementById('pvwPageBadge').textContent = `${pvw.currentSlide || 0} / ${pvw.totalSlides || 0}`;
  document.getElementById('pvwAnimBadge').textContent =
    pvw.clickCount > 0 ? `動畫 ${pvw.clickIndex || 0} / ${pvw.clickCount}` : '無頁內動畫';

  const pvwImg = document.getElementById('pvwPreviewImg');
  const pvwNextImg = document.getElementById('pvwNextPreviewImg');
  if (pvw.previewUrl) {
    pvwImg.src = pvw.previewUrl;
  }
  if (pvw.nextPreviewUrl) {
    pvwNextImg.src = pvw.nextPreviewUrl;
  }

  // 4. 底部左半：PPT 簡報池
  const pptPool = state.pptPool || [];
  document.getElementById('pptCountBadge').textContent = `${pptPool.length} 份簡報`;
  const pptListEl = document.getElementById('pptPoolList');
  pptListEl.innerHTML = '';

  pptPool.forEach((deck) => {
    const isPgm = pgm.deckId === deck.id;
    const isPvw = pvw.deckId === deck.id;
    const item = document.createElement('div');
    item.className = `pool-item ${isPgm ? 'active-pgm' : isPvw ? 'active-pvw' : ''}`;
    item.dataset.deckId = deck.id;

    const statusTags = [];
    if (isPgm) statusTags.push('<span class="badge badge-live">🔴 現在播出</span>');
    if (isPvw) statusTags.push('<span class="badge badge-pvw">🟢 預覽待命</span>');

    item.innerHTML = `
      <div class="pool-item-info">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span class="pool-item-name">${deck.title}</span>
          ${statusTags.join('')}
        </div>
        <div class="pool-item-meta">${deck.fileName} · 共 ${deck.slideCount} 頁</div>
      </div>
      <div class="pool-item-actions">
        <button type="button" class="btn-outline btn-sm btn-load-pvw" data-deck-id="${deck.id}">放到預覽</button>
        <button type="button" class="btn btn-sm btn-load-pgm" data-deck-id="${deck.id}">直接播出</button>
      </div>
    `;
    pptListEl.appendChild(item);
  });

  // 5. 底部右半：影片池
  const videoPool = state.videoPool || [];
  document.getElementById('videoCountBadge').textContent = `${videoPool.length} 部影片`;
  const videoListEl = document.getElementById('videoPoolList');
  videoListEl.innerHTML = '';

  videoPool.forEach((vid) => {
    const isPlaying = state.activeVideo && state.activeVideo.id === vid.id;
    const item = document.createElement('div');
    item.className = `pool-item ${isPlaying ? 'active-video' : ''}`;
    item.dataset.videoId = vid.id;

    item.innerHTML = `
      <div class="pool-item-info">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="pool-item-name">${vid.title}</span>
          ${isPlaying ? '<span class="badge badge-video">🎬 播放中</span>' : ''}
        </div>
        <div class="pool-item-meta">${vid.fileName} · ${vid.sizeMB} MB (HTTP 206 零雜訊秒播)</div>
      </div>
      <div class="pool-item-actions">
        ${
          isPlaying
            ? `<button type="button" class="btn btn-sm btn-stop-video" style="background:#ef4444;" data-video-id="${vid.id}">⏹ 停止回 PPT</button>`
            : `<button type="button" class="btn btn-sm btn-play-video" data-video-id="${vid.id}">▶ 全螢幕播放</button>`
        }
      </div>
    `;
    videoListEl.appendChild(item);
  });
}

function bindEvents() {
  document.getElementById('btnPgmPrev').addEventListener('click', () => dispatchAction('PGM_PREV'));
  document.getElementById('btnPgmNext').addEventListener('click', () => dispatchAction('PGM_NEXT'));
  document.getElementById('btnPvwPrev').addEventListener('click', () => dispatchAction('PVW_PREV'));
  document.getElementById('btnPvwNext').addEventListener('click', () => dispatchAction('PVW_NEXT'));
  document.getElementById('btnCutSwap').addEventListener('click', () => dispatchAction('CUT_SWAP'));
  document.getElementById('btnBlackScreen').addEventListener('click', () => dispatchAction('TOGGLE_BLACK'));
  document.getElementById('btnRefreshPools').addEventListener('click', () => dispatchAction('REFRESH_POOLS'));
  document.getElementById('btnStopVideo').addEventListener('click', () => dispatchAction('STOP_VIDEO'));

  // 事件委派：PPT 簡報池與影片池按鈕
  document.getElementById('pptPoolList').addEventListener('click', (e) => {
    const pvwBtn = e.target.closest('.btn-load-pvw');
    if (pvwBtn) {
      dispatchAction('LOAD_PVW', { deckId: pvwBtn.dataset.deckId });
      return;
    }
    const pgmBtn = e.target.closest('.btn-load-pgm');
    if (pgmBtn) {
      dispatchAction('LOAD_PGM', { deckId: pgmBtn.dataset.deckId });
    }
  });

  document.getElementById('videoPoolList').addEventListener('click', (e) => {
    const playBtn = e.target.closest('.btn-play-video');
    if (playBtn) {
      dispatchAction('PLAY_VIDEO', { videoId: playBtn.dataset.videoId });
      return;
    }
    const stopBtn = e.target.closest('.btn-stop-video');
    if (stopBtn) {
      dispatchAction('STOP_VIDEO');
    }
  });

  // 手機遙控網址視窗
  const qrModal = document.getElementById('qrModal');
  document.getElementById('btnQrRemote').addEventListener('click', () => {
    document.getElementById('qrUrlBox').textContent = lanUrl;
    qrModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseQrModal').addEventListener('click', () => {
    qrModal.classList.add('hidden');
  });

  // 支援鍵盤左右方向鍵與 B 鍵黑屏快速控場
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      dispatchAction('PGM_NEXT');
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      dispatchAction('PGM_PREV');
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      dispatchAction('TOGGLE_BLACK');
    }
  });
}

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}`);

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'INIT_INFO' && msg.data) {
        lanUrl = `http://${msg.data.lanIp}:${msg.data.port}`;
        if (msg.data.screen) {
          const s = msg.data.screen;
          document.getElementById('screenBadge').textContent =
            `🟢 第二螢幕已就緒 (${s.deviceName.replace('\\\\.\\', '')} ${s.width}×${s.height})`;
        }
      }
      if (msg.type === 'STATE_UPDATE' && msg.data) {
        renderState(msg.data);
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWebSocket, 1500);
  });
}

async function init() {
  bindEvents();
  connectWebSocket();
  const res = await fetch('/api/state');
  const data = await res.json();
  if (data && data.state) {
    renderState(data.state);
  }
}

init();

