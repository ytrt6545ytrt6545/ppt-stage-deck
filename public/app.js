// ============================================================================
// 🖥️ View Layer: public/app.js (純狀態投影 UI = f(State) · 僅拋出語意化 Action)
// 對標 Physical UI/Logic Decoupling Law
// ============================================================================

let currentState = null;
let ws = null;
let lanUrl = window.location.origin;
let selectedVideoItem = null;
let currentMediaFilter = 'all';
let currentPurePlayingAudio = null; // { id, title, url } 純播放中之背景音訊
const popoutSyncChannel = (typeof window !== 'undefined' && 'BroadcastChannel' in window) ? new BroadcastChannel('stage_deck_popout_sync') : null;

export function togglePurePlayAudio(audioItem, startTime = null) {
  const bgPlayer = document.getElementById('bgAudioPlayer');
  const bgBadge = document.getElementById('bgAudioBadge');
  if (!bgPlayer || !audioItem) return;

  const audioUrl = audioItem.url || `/audios/${encodeURIComponent(audioItem.fileName)}`;

  // 長官鐵律：同一個檔案只能在一個地方播。若此音訊當前正於 PGM 播出中，啟動純播放前停止 PGM 播出！
  if (currentState && currentState.activeMedia && (currentState.activeMedia.id === audioItem.id || currentState.activeMedia.fileName === audioItem.fileName)) {
    dispatchAction('STOP_MEDIA');
  }

  if (currentPurePlayingAudio && currentPurePlayingAudio.id === audioItem.id && !bgPlayer.paused) {
    // 暫停目前正在純播放的音訊
    bgPlayer.pause();
    popoutSyncChannel?.postMessage({ type: 'PURE_AUDIO_PAUSE', audioId: audioItem.id });
    // 保持 currentPurePlayingAudio 引用，確保暫停後拖曳進度桿依然能精確控制與維持該音訊狀態
    if (bgBadge) bgBadge.style.display = 'none';
    renderScheduleQueue(currentState);
    syncMediaDock(currentState);
    return;
  }

  currentPurePlayingAudio = { ...audioItem, url: audioUrl };
  selectedVideoItem = { ...audioItem, url: audioUrl, type: 'audio' };

  const isSameSrc = (bgPlayer.src === window.location.origin + audioUrl || bgPlayer.getAttribute('src') === audioUrl);
  if (!isSameSrc) {
    bgPlayer.src = audioUrl;
  }

  if (Number.isFinite(startTime) && startTime !== null && startTime >= 0) {
    bgPlayer.currentTime = startTime;
  } else if (!isSameSrc || bgPlayer.currentTime === bgPlayer.duration || Number.isNaN(bgPlayer.currentTime)) {
    bgPlayer.currentTime = 0;
  }

  bgPlayer.muted = false; // 純播放：直接現場放音！
  bgPlayer.play().catch((err) => console.warn('[StageDeck] Pure play failed:', err));
  popoutSyncChannel?.postMessage({
    type: 'PURE_AUDIO_PLAY',
    audioItem: currentPurePlayingAudio,
    startTime: bgPlayer.currentTime
  });

  if (bgBadge) {
    bgBadge.textContent = `🎵 背景音：${audioItem.title || audioItem.fileName}`;
    bgBadge.style.display = 'inline-flex';
  }

  renderScheduleQueue(currentState);
  syncMediaDock(currentState);
}

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

const STORAGE_KEY_REMOVED_FLOW = 'stage_deck_removed_flow_keys';
const STORAGE_KEY_FLOW_ORDER = 'stage_deck_flow_order_keys';

function getRemovedFlowKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REMOVED_FLOW);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveRemovedFlowKeys(keys) {
  try {
    localStorage.setItem(STORAGE_KEY_REMOVED_FLOW, JSON.stringify(keys));
  } catch (e) {}
}

function getFlowOrderKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FLOW_ORDER);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveFlowOrderKeys(keys) {
  try {
    localStorage.setItem(STORAGE_KEY_FLOW_ORDER, JSON.stringify(keys));
  } catch (e) {}
}

let currentDraggedFlowKey = null;

function setupFlowItemDragAndDrop(el, queueEl) {
  el.addEventListener('dragstart', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) {
      e.preventDefault();
      return;
    }
    currentDraggedFlowKey = el.dataset.flowKey;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.flowKey);
    setTimeout(() => el.classList.add('is-dragging'), 0);
  });

  el.addEventListener('dragend', () => {
    currentDraggedFlowKey = null;
    el.classList.remove('is-dragging');
    queueEl.querySelectorAll('.pool-item').forEach((item) => {
      item.classList.remove('drag-over-top', 'drag-over-bottom', 'is-dragging');
    });
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!currentDraggedFlowKey || currentDraggedFlowKey === el.dataset.flowKey) return;

    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      el.classList.add('drag-over-top');
      el.classList.remove('drag-over-bottom');
    } else {
      el.classList.add('drag-over-bottom');
      el.classList.remove('drag-over-top');
    }
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over-top', 'drag-over-bottom');
    const draggedKey = currentDraggedFlowKey || e.dataTransfer.getData('text/plain');
    const targetKey = el.dataset.flowKey;
    if (!draggedKey || draggedKey === targetKey) return;

    const rect = el.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;

    const currentKeys = Array.from(queueEl.querySelectorAll('.pool-item'))
      .map((item) => item.dataset.flowKey)
      .filter((k) => Boolean(k));

    const fromIdx = currentKeys.indexOf(draggedKey);
    if (fromIdx > -1) {
      currentKeys.splice(fromIdx, 1);
    }
    const toIdx = currentKeys.indexOf(targetKey);
    if (toIdx > -1) {
      currentKeys.splice(insertBefore ? toIdx : toIdx + 1, 0, draggedKey);
    } else {
      currentKeys.push(draggedKey);
    }

    saveFlowOrderKeys(currentKeys);
    renderScheduleQueue(currentState);
  });
}

function renderScheduleQueue(state) {
  const queueEl = document.getElementById('scheduleQueueList');
  if (!queueEl) return;
  queueEl.innerHTML = '';

  // 萬能佇列：收納 PPT、影片、圖片、音檔
  const pptPool = state.pptPool || [];
  const videoPool = state.videoPool || [];
  const imagePool = state.imagePool || [];
  const audioPool = state.audioPool || [];
  let combined = [];

  pptPool.forEach((p) => combined.push({
    type: 'ppt',
    id: p.id,
    flowKey: `ppt:${p.id}`,
    title: p.title || p.fileName,
    meta: `PPT 簡報 · 共 ${p.slideCount} 頁`,
    badge: '📑 PPT',
    badgeColor: 'background:#e0f2fe; color:#0369a1;',
    raw: p
  }));

  videoPool.forEach((v) => combined.push({
    type: 'video',
    id: v.id,
    flowKey: `video:${v.id}`,
    title: v.title || v.fileName,
    meta: `影音檔 · ${v.sizeMB} MB`,
    badge: '🎬 影片',
    badgeColor: 'background:#fef3c7; color:#b45309;',
    raw: v
  }));

  imagePool.forEach((img) => combined.push({
    type: 'image',
    id: img.id,
    flowKey: `image:${img.id}`,
    title: img.title || img.fileName,
    meta: `靜態圖片 · ${img.sizeKB} KB`,
    badge: '🖼️ 圖片',
    badgeColor: 'background:#dcfce7; color:#15803d;',
    raw: img
  }));

  audioPool.forEach((a) => combined.push({
    type: 'audio',
    id: a.id,
    flowKey: `audio:${a.id}`,
    title: a.title || a.fileName,
    meta: `純音訊檔 · ${a.sizeMB} MB`,
    badge: '🎵 音訊',
    badgeColor: 'background:#f3e8ff; color:#7e22ce;',
    raw: a
  }));

  // 0. 若後端所有素材池皆已清空（例如前次正常退出已全數清除），自動重置隱藏清單與排序快取
  if (combined.length === 0) {
    saveRemovedFlowKeys([]);
    saveFlowOrderKeys([]);
  }

  // 1. 過濾已被移出的項目
  const removedKeys = new Set(getRemovedFlowKeys());
  combined = combined.filter((item) => !removedKeys.has(item.flowKey));

  // 2. 依照持久化自訂順序排序
  const orderKeys = getFlowOrderKeys();
  const orderIndexMap = new Map();
  orderKeys.forEach((key, idx) => orderIndexMap.set(key, idx));

  combined.sort((a, b) => {
    const hasA = orderIndexMap.has(a.flowKey);
    const hasB = orderIndexMap.has(b.flowKey);
    if (hasA && hasB) {
      return orderIndexMap.get(a.flowKey) - orderIndexMap.get(b.flowKey);
    }
    if (hasA) return -1;
    if (hasB) return 1;
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  });

  const countBadge = document.getElementById('scheduleCountBadge');
  if (countBadge) {
    countBadge.textContent = `${combined.length} 項流程`;
  }

  combined.forEach((item, idx) => {
    const el = document.createElement('div');
    let isPgm = false;
    let isPvw = false;

    if (item.type === 'ppt') {
      isPgm = state.pgm && state.pgm.deckId === item.id;
      isPvw = state.pvw && state.pvw.deckId === item.id && !state.pvwVideo && !state.pvwMedia;
    } else if (item.type === 'video') {
      isPgm = state.activeVideo && state.activeVideo.id === item.id;
      isPvw = (state.pvwVideo && state.pvwVideo.id === item.id) || (state.pvwMedia && state.pvwMedia.id === item.id);
    } else {
      isPgm = state.activeMedia && state.activeMedia.id === item.id;
      isPvw = state.pvwMedia && state.pvwMedia.id === item.id;
    }

    // 廣播級互斥鐵律：若已在 PGM 播出，隊列徽章絕不重複標示 PVW 待命！
    if (isPgm) {
      isPvw = false;
    }

    el.className = `pool-item ${isPgm ? 'active-pgm' : isPvw ? 'active-pvw' : ''}`;
    el.draggable = true;
    el.dataset.flowKey = item.flowKey;
    el.dataset.index = idx;

    const isPurePlayingThis = item.type === 'audio' && currentPurePlayingAudio && currentPurePlayingAudio.id === item.id && !document.getElementById('bgAudioPlayer')?.paused;

    el.innerHTML = `
      <button type="button" class="btn-remove-flow-item" data-flow-key="${item.flowKey}" title="從現場流程隊列徹底刪除">✕</button>
      <div class="pool-item-row-top">
        <div class="pool-item-title-wrap">
          <span class="drag-handle" title="按住上下拖曳排序">⋮⋮</span>
          <span class="pool-item-seq">${String(idx + 1).padStart(2, '0')}</span>
          <span class="badge" style="${item.badgeColor} font-size:11px;">
            ${item.badge}
          </span>
          <span class="pool-item-name" title="${item.title}">${item.title}</span>
        </div>
        <div style="flex-shrink:0; display:flex; align-items:center; gap:4px;">
          ${isPurePlayingThis ? '<span class="badge" style="background:#7e22ce; color:#fff;">🎵 放音中</span>' : ''}
          ${isPgm ? '<span class="badge badge-live">🔴 播出中</span>' : ''}
          ${isPvw ? '<span class="badge badge-pvw">🟢 預覽待命</span>' : ''}
        </div>
      </div>
      <div class="pool-item-row-bottom">
        <div class="pool-item-meta">${item.meta}</div>
        <div class="pool-item-actions">
          ${item.type === 'audio' ? `
            <button type="button" class="btn btn-sm btn-pure-play-audio ${isPurePlayingThis ? 'is-playing' : ''}" data-id="${item.id}" title="不排進 PGM/PVW，直接背景放音">
              ${isPurePlayingThis ? '⏸ 停止' : '🔊 放音'}
            </button>
          ` : ''}
          <button type="button" class="btn-outline btn-sm btn-load-pvw-universal" data-id="${item.id}" data-type="${item.type}" title="送至預覽 (PVW)">預覽</button>
          <button type="button" class="btn btn-sm btn-load-pgm-universal" data-id="${item.id}" data-type="${item.type}" style="background:#ef4444; border-color:#ef4444;" title="直接播出 (PGM)">🔴 播出</button>
        </div>
      </div>
    `;

    setupFlowItemDragAndDrop(el, queueEl);
    queueEl.appendChild(el);
  });
}

function renderAllMediaPool(state) {
  const poolListEl = document.getElementById('allMediaPoolList');
  if (!poolListEl) return;
  poolListEl.innerHTML = '';

  const pptPool = state.pptPool || [];
  const videoPool = state.videoPool || [];
  const imagePool = state.imagePool || [];
  const audioPool = state.audioPool || [];
  const allItems = [];

  pptPool.forEach((p) => {
    allItems.push({
      type: 'ppt',
      id: p.id,
      title: p.title || p.fileName,
      fileName: p.fileName,
      meta: `PPT 簡報 · 共 ${p.slideCount} 頁`,
      badge: '📑 PPT',
      badgeColor: 'background:#e0f2fe; color:#0369a1;',
      raw: p
    });
  });

  videoPool.forEach((v) => {
    allItems.push({
      type: 'video',
      id: v.id,
      title: v.title || v.fileName,
      fileName: v.fileName,
      meta: `影音檔 · ${v.sizeMB} MB`,
      badge: '🎬 影片',
      badgeColor: 'background:#fef3c7; color:#b45309;',
      raw: v
    });
  });

  imagePool.forEach((img) => {
    allItems.push({
      type: 'image',
      id: img.id,
      title: img.title || img.fileName,
      fileName: img.fileName,
      meta: `圖片 · ${img.sizeKB} KB`,
      badge: '🖼️ 圖片',
      badgeColor: 'background:#dcfce7; color:#15803d;',
      raw: img
    });
  });

  audioPool.forEach((a) => {
    allItems.push({
      type: 'audio',
      id: a.id,
      title: a.title || a.fileName,
      fileName: a.fileName,
      meta: `音訊 · ${a.sizeMB} MB`,
      badge: '🎵 音訊',
      badgeColor: 'background:#f3e8ff; color:#7e22ce;',
      raw: a
    });
  });

  allItems.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));

  const badgeCount = document.getElementById('allMediaCountBadge');
  if (badgeCount) badgeCount.textContent = `${allItems.length} 件`;

  const filtered = allItems.filter((item) => {
    if (currentMediaFilter === 'ppt') return item.type === 'ppt';
    if (currentMediaFilter === 'video') return item.type === 'video';
    if (currentMediaFilter === 'image') return item.type === 'image';
    if (currentMediaFilter === 'audio') return item.type === 'audio';
    return true;
  });

  filtered.forEach((item) => {
    const el = document.createElement('div');
    let isPgm = false;
    let isPvw = false;
    if (item.type === 'ppt') {
      isPgm = state.pgm && state.pgm.deckId === item.id;
      isPvw = state.pvw && state.pvw.deckId === item.id && !state.pvwVideo && !state.pvwMedia;
    } else if (item.type === 'video') {
      isPgm = state.activeVideo && state.activeVideo.id === item.id;
      isPvw = (state.pvwVideo && state.pvwVideo.id === item.id) || (state.pvwMedia && state.pvwMedia.id === item.id);
    } else {
      isPgm = state.activeMedia && state.activeMedia.id === item.id;
      isPvw = state.pvwMedia && state.pvwMedia.id === item.id;
    }

    // 廣播級互斥鐵律：若已在 PGM 播出，隊列徽章絕不重複標示 PVW 待命！
    if (isPgm) {
      isPvw = false;
    }
    const isPlaying = isPgm && (item.type === 'video' || item.type === 'audio');
    const isSelected = item.type === 'video' && selectedVideoItem && selectedVideoItem.id === item.id;

    el.className = `pool-item ${isPgm ? 'active-pgm' : ''} ${isPvw ? 'active-pvw' : ''} ${isPlaying ? 'active-video' : ''} ${isSelected ? 'selected-video' : ''}`.trim();
    if (item.type === 'video') el.dataset.videoId = item.id;
    if (item.type === 'ppt') el.dataset.deckId = item.id;

    el.innerHTML = `
      <div class="pool-item-row-top">
        <div class="pool-item-title-wrap">
          <span class="badge" style="${item.badgeColor} font-size:11px;">
            ${item.badge}
          </span>
          <span class="pool-item-name" title="${item.title}">${item.title}</span>
        </div>
        <div style="flex-shrink:0;">
          ${isPgm ? '<span class="badge badge-live">🔴 播出中</span>' : ''}
          ${isPvw ? '<span class="badge badge-pvw">🟢 預覽中</span>' : ''}
        </div>
      </div>
      <div class="pool-item-row-bottom">
        <div class="pool-item-meta">${item.meta}</div>
        <div class="pool-item-actions">
          ${
            item.type === 'ppt'
              ? `<button type="button" class="btn-outline btn-sm btn-load-pvw" data-deck-id="${item.id}">送至預覽</button>
                 <button type="button" class="btn btn-sm btn-load-pgm" data-deck-id="${item.id}">直接播出</button>`
              : item.type === 'video'
              ? `<button type="button" class="btn-outline btn-sm btn-pvw-video" data-video-id="${item.id}">送至預覽</button>
                 ${
                   isPlaying
                     ? `<button type="button" class="btn btn-sm btn-stop-video" style="background:#ef4444;" data-video-id="${item.id}">停止影片</button>`
                     : `<button type="button" class="btn btn-sm btn-play-video" data-video-id="${item.id}">直接播出</button>`
                 }`
              : `<button type="button" class="btn-outline btn-sm btn-load-pvw-universal" data-id="${item.id}" data-type="${item.type}">送至預覽</button>
                 ${
                   isPlaying
                     ? `<button type="button" class="btn btn-sm btn-stop-media" style="background:#ef4444;" data-id="${item.id}">停止播出</button>`
                     : `<button type="button" class="btn btn-sm btn-load-pgm-universal" data-id="${item.id}" data-type="${item.type}">直接播出</button>`
                 }`
          }
        </div>
      </div>
    `;
    poolListEl.appendChild(el);
  });

  // 向後相容保留節點填充 (確保既有 E2E 測試與外部掛載 100% 綠燈)
  const pptCompat = document.getElementById('pptPoolList');
  const vidCompat = document.getElementById('videoPoolList');
  if (pptCompat) {
    pptCompat.innerHTML = '';
    pptPool.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'pool-item';
      d.dataset.deckId = p.id;
      pptCompat.appendChild(d);
    });
  }
  if (vidCompat) {
    vidCompat.innerHTML = '';
    videoPool.forEach((v) => {
      const d = document.createElement('div');
      d.className = 'pool-item';
      d.dataset.videoId = v.id;
      vidCompat.appendChild(d);
    });
  }
}

export function renderState(state) {
  if (!state) return;
  currentState = state;

  // 長官鐵律：同一個檔案不能在純播放/試播播，又同時在 PGM 裡面播 (唯一播放互斥排他)
  const isPgmPlayingAudio = state.activeMedia && state.activeMedia.type === 'audio';
  if (isPgmPlayingAudio) {
    const bgPlayer = document.getElementById('bgAudioPlayer');
    const isSameAudio = currentPurePlayingAudio && (currentPurePlayingAudio.id === state.activeMedia.id || currentPurePlayingAudio.fileName === state.activeMedia.fileName);
    if (isSameAudio && bgPlayer && !bgPlayer.paused) {
      bgPlayer.pause();
      currentPurePlayingAudio = null;
      const bgBadge = document.getElementById('bgAudioBadge');
      if (bgBadge) bgBadge.style.display = 'none';
      console.log(`[StageDeck] 互斥防禦：音訊 ${state.activeMedia.title} 已登台 PGM，自動停止背景純播放。`);
    }
  }

  const isPgmPlayingMedia = !!(state.activeVideo || (state.activeMedia && (state.activeMedia.type === 'video' || state.activeMedia.type === 'audio')));
  if (isPgmPlayingMedia) {
    const activeMediaId = state.activeVideo?.id || state.activeMedia?.id;
    const activeMediaName = state.activeVideo?.fileName || state.activeMedia?.fileName;
    const deskVideoMaster = document.getElementById('deskVideoMasterPlayer');
    const btnDeskPlay = document.getElementById('btnDeskMasterPlay');
    const isSameDockMedia = selectedVideoItem && (selectedVideoItem.id === activeMediaId || selectedVideoItem.fileName === activeMediaName);
    if (isSameDockMedia && deskVideoMaster && !deskVideoMaster.paused) {
      deskVideoMaster.pause();
      if (btnDeskPlay) btnDeskPlay.textContent = '▶ 試播';
      console.log(`[StageDeck] 互斥防禦：媒體 ${activeMediaName} 已登台 PGM，自動暫停播控艙試播。`);
    }
  }

  // 1. 頂部輸出狀態與黑屏按鈕
  const outputModeBadge = document.getElementById('outputModeBadge');
  const btnBlackScreen = document.getElementById('btnBlackScreen');
  const btnStopVideo = document.getElementById('btnStopVideo');

  if (state.isBlackScreen || state.outputMode === 'black') {
    outputModeBadge.textContent = '黑屏中';
    outputModeBadge.className = 'badge badge-black';
    btnBlackScreen.classList.add('active');
    btnBlackScreen.textContent = '解除黑屏';
  } else if (state.outputMode === 'video' && state.activeVideo) {
    outputModeBadge.textContent = `播放影片：${state.activeVideo.title}`;
    outputModeBadge.className = 'badge badge-video';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  } else if (state.outputMode === 'image' && state.activeMedia) {
    outputModeBadge.textContent = `展示圖片：${state.activeMedia.title}`;
    outputModeBadge.className = 'badge badge-live';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  } else if (state.outputMode === 'audio' && state.activeMedia) {
    outputModeBadge.textContent = `播放音訊：${state.activeMedia.title}`;
    outputModeBadge.className = 'badge badge-pvw';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  } else if (state.outputMode === 'kv') {
    outputModeBadge.textContent = '主視覺展示中';
    outputModeBadge.className = 'badge badge-pvw';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  } else if (state.outputMode === 'empty') {
    outputModeBadge.textContent = '空槽待命中';
    outputModeBadge.className = 'badge';
    outputModeBadge.style.background = '#64748b';
    outputModeBadge.style.color = '#ffffff';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  } else {
    outputModeBadge.textContent = 'PPT 播出中';
    outputModeBadge.className = 'badge badge-live';
    btnBlackScreen.classList.remove('active');
    btnBlackScreen.textContent = '黑屏';
  }

  if (btnStopVideo) {
    const isPlayingMedia = !!(state.activeVideo || (state.activeMedia && (state.activeMedia.type === 'video' || state.activeMedia.type === 'audio')));
    btnStopVideo.style.display = isPlayingMedia ? 'inline-flex' : 'none';
  }

  // 1-B. 頂部主視覺底圖狀態與切換按鈕
  const btnToggleKvMode = document.getElementById('btnToggleKvMode');
  const kvStatusWrap = document.getElementById('kvStatusWrap');
  const kvThumbnail = document.getElementById('kvThumbnail');

  if (btnToggleKvMode && kvStatusWrap && kvThumbnail) {
    if (state.keyVisualUrl) {
      kvStatusWrap.style.display = 'inline-flex';
      if (kvThumbnail.getAttribute('src') !== state.keyVisualUrl) {
        kvThumbnail.src = state.keyVisualUrl;
      }
      btnToggleKvMode.style.display = 'inline-flex';
      if (state.outputMode === 'kv') {
        btnToggleKvMode.textContent = '切回主控';
        btnToggleKvMode.classList.add('btn');
        btnToggleKvMode.classList.remove('btn-outline');
      } else {
        btnToggleKvMode.textContent = '回主視覺';
        btnToggleKvMode.classList.remove('btn');
        btnToggleKvMode.classList.add('btn-outline');
      }
    } else {
      kvStatusWrap.style.display = 'none';
      btnToggleKvMode.style.display = 'none';
    }
  }

  // 2. 左卡：現在播出 (PGM)
  const pgm = state.pgm || {};
  const isPgmVideo = state.outputMode === 'video' && state.activeVideo;
  const isPgmImage = state.outputMode === 'image' && state.activeMedia;
  const isPgmAudio = state.outputMode === 'audio' && state.activeMedia;
  const isPgmEmpty = !isPgmVideo && !isPgmImage && !isPgmAudio && (!pgm.deckId || pgm.type === 'empty');

  const pgmImg = document.getElementById('pgmPreviewImg');
  const pgmNextImg = document.getElementById('pgmNextPreviewImg');
  const pgmVideoPlayer = document.getElementById('pgmVideoPlayer');
  const pgmNextPip = document.getElementById('pgmNextPip');
  const pgmNavRow = document.getElementById('pgmNavRow');
  const pgmVideoNavRow = document.getElementById('pgmVideoNavRow');
  const pgmEmptyPlaceholder = document.getElementById('pgmEmptyPlaceholder');

  if (isPgmEmpty) {
    if (pgmEmptyPlaceholder) {
      pgmEmptyPlaceholder.style.display = state.keyVisualUrl ? 'none' : 'flex';
    }
  } else {
    if (pgmEmptyPlaceholder) {
      pgmEmptyPlaceholder.style.display = 'none';
    }
  }

  const pgmAnimBadgeEl = document.getElementById('pgmAnimBadge');

  if (isPgmVideo) {
    document.getElementById('pgmDeckTitle').textContent = `影片播出：${state.activeVideo.title}`;
    document.getElementById('pgmPageBadge').textContent = '影片播出中';
    if (pgmAnimBadgeEl) {
      pgmAnimBadgeEl.textContent = '音畫同步';
      pgmAnimBadgeEl.style.display = 'inline-flex';
    }

    if (pgmImg) pgmImg.style.display = 'none';
    if (pgmNextPip) pgmNextPip.style.display = 'none';
    if (pgmNavRow) pgmNavRow.style.display = 'none';
    if (pgmVideoNavRow) pgmVideoNavRow.style.display = 'flex';

    // 先行釋放 PVW 舊視訊連線，避免 Chromium 同源媒體快取鎖定阻擋首次 CUT 播出
    const pvwVideoEarly = document.getElementById('pvwVideoPlayer');
    const nextPvwHasVideo = Boolean((state.pvwMedia && state.pvwMedia.type === 'video') || state.pvwVideo);
    if (!nextPvwHasVideo && pvwVideoEarly && pvwVideoEarly.getAttribute('src')) {
      pvwVideoEarly.pause();
      pvwVideoEarly.preload = 'none';
      pvwVideoEarly.removeAttribute('src');
      delete pvwVideoEarly.dataset.rawUrl;
      try { pvwVideoEarly.load(); } catch {}
    }

    if (pgmVideoPlayer) {
      pgmVideoPlayer.style.display = 'block';
      const sep = state.activeVideo.url.includes('?') ? '&' : '?';
      const pgmScopedUrl = `${state.activeVideo.url}${sep}slot=pgm`;
      if (pgmVideoPlayer.dataset.rawUrl !== state.activeVideo.url) {
        pgmVideoPlayer.dataset.rawUrl = state.activeVideo.url;
        pgmVideoPlayer.preload = 'auto';
        pgmVideoPlayer.src = pgmScopedUrl;
        const targetStart = (Number.isFinite(state.activeVideo.startTime) && state.activeVideo.startTime > 0)
          ? state.activeVideo.startTime
          : 0;
        if (targetStart > 0) {
          try { pgmVideoPlayer.currentTime = targetStart; } catch {}
          pgmVideoPlayer.addEventListener('loadedmetadata', () => {
            try { pgmVideoPlayer.currentTime = targetStart; } catch {}
          }, { once: true });
        }
        pgmVideoPlayer.muted = true; // 主控台預覽靜音防干擾 (由第二螢幕放映艙發聲)
        const ensurePgmPlay = () => {
          if (currentState?.outputMode === 'video' && currentState?.activeVideo && !currentState.activeVideo.isPaused) {
            pgmVideoPlayer.play().catch(() => {});
          }
        };
        if (state.activeVideo.isPaused) {
          pgmVideoPlayer.pause();
        } else {
          ensurePgmPlay();
          pgmVideoPlayer.addEventListener('loadeddata', ensurePgmPlay, { once: true });
          pgmVideoPlayer.addEventListener('canplay', ensurePgmPlay, { once: true });
        }
      } else {
        if (Number.isFinite(state.activeVideo.currentTime)) {
          if (Math.abs(pgmVideoPlayer.currentTime - state.activeVideo.currentTime) > 1.2) {
            try { pgmVideoPlayer.currentTime = state.activeVideo.currentTime; } catch {}
          }
        }
        if (state.activeVideo.isPaused) {
          pgmVideoPlayer.pause();
        } else if (pgmVideoPlayer.paused) {
          pgmVideoPlayer.play().catch(() => {});
        }
      }
    }
  } else if (isPgmImage) {
    document.getElementById('pgmDeckTitle').textContent = `圖片展示：${state.activeMedia.title}`;
    document.getElementById('pgmPageBadge').textContent = '靜態圖片';
    if (pgmAnimBadgeEl) {
      pgmAnimBadgeEl.textContent = '全螢幕放映';
      pgmAnimBadgeEl.style.display = 'none';
    }

    if (pgmVideoPlayer) {
      pgmVideoPlayer.pause();
      pgmVideoPlayer.preload = 'none';
      pgmVideoPlayer.removeAttribute('src');
      delete pgmVideoPlayer.dataset.rawUrl;
      try { pgmVideoPlayer.load(); } catch {}
      pgmVideoPlayer.style.display = 'none';
    }
    if (pgmNextPip) pgmNextPip.style.display = 'none';
    if (pgmNavRow) pgmNavRow.style.display = 'none';
    if (pgmVideoNavRow) pgmVideoNavRow.style.display = 'flex';

    if (pgmImg) {
      pgmImg.src = state.activeMedia.url;
      pgmImg.style.display = 'block';
    }
  } else if (isPgmAudio) {
    document.getElementById('pgmDeckTitle').textContent = `音訊播放：${state.activeMedia.title}`;
    document.getElementById('pgmPageBadge').textContent = '純音訊';
    if (pgmAnimBadgeEl) {
      pgmAnimBadgeEl.textContent = '現場音響';
      pgmAnimBadgeEl.style.display = 'none';
    }

    if (pgmVideoPlayer) {
      pgmVideoPlayer.pause();
      pgmVideoPlayer.preload = 'none';
      pgmVideoPlayer.removeAttribute('src');
      delete pgmVideoPlayer.dataset.rawUrl;
      try { pgmVideoPlayer.load(); } catch {}
      pgmVideoPlayer.style.display = 'none';
    }
    if (pgmNextPip) pgmNextPip.style.display = 'none';
    if (pgmNavRow) pgmNavRow.style.display = 'none';
    if (pgmVideoNavRow) pgmVideoNavRow.style.display = 'flex';

    if (pgmImg) {
      pgmImg.src = state.keyVisualUrl || '';
      pgmImg.style.display = state.keyVisualUrl ? 'block' : 'none';
    }
  } else if (isPgmEmpty) {
    // 空槽待命 (長官全新思維冷啟動)
    document.getElementById('pgmDeckTitle').textContent = state.outputMode === 'kv' ? '主視覺 (KV) 放映中' : '⚪ 空槽待命 (STANDBY)';
    document.getElementById('pgmPageBadge').textContent = state.outputMode === 'kv' ? '主視覺' : '待命';
    if (pgmAnimBadgeEl) {
      pgmAnimBadgeEl.textContent = '無內容';
      pgmAnimBadgeEl.style.display = 'none';
    }

    if (pgmVideoPlayer) {
      pgmVideoPlayer.pause();
      pgmVideoPlayer.preload = 'none';
      pgmVideoPlayer.removeAttribute('src');
      delete pgmVideoPlayer.dataset.rawUrl;
      try { pgmVideoPlayer.load(); } catch {}
      pgmVideoPlayer.style.display = 'none';
    }
    if (pgmNextPip) pgmNextPip.style.display = 'none';
    if (pgmNavRow) pgmNavRow.style.display = 'none';
    if (pgmVideoNavRow) pgmVideoNavRow.style.display = 'none';

    if (pgmImg) {
      if (state.keyVisualUrl) {
        pgmImg.src = state.keyVisualUrl;
        pgmImg.style.display = 'block';
      } else {
        pgmImg.removeAttribute('src');
        pgmImg.style.display = 'none';
      }
    }
  } else {
    // PPT 正常播出
    document.getElementById('pgmDeckTitle').textContent = pgm.title || '尚未載入簡報';
    document.getElementById('pgmPageBadge').textContent = `${pgm.currentSlide || 0} / ${pgm.totalSlides || 0}`;
    if (pgmAnimBadgeEl) {
      pgmAnimBadgeEl.textContent =
        pgm.clickCount > 0 ? `動畫 ${pgm.clickIndex || 0} / ${pgm.clickCount}` : '無頁內動畫';
      pgmAnimBadgeEl.style.display = pgm.clickCount > 0 ? 'inline-flex' : 'none';
    }

    if (pgmImg) pgmImg.style.display = 'block';
    if (pgmNextPip) pgmNextPip.style.display = 'block';
    if (pgmNavRow) pgmNavRow.style.display = 'flex';
    if (pgmVideoNavRow) pgmVideoNavRow.style.display = 'none';

    if (pgmVideoPlayer) {
      pgmVideoPlayer.pause();
      pgmVideoPlayer.preload = 'none';
      pgmVideoPlayer.removeAttribute('src');
      delete pgmVideoPlayer.dataset.rawUrl;
      try { pgmVideoPlayer.load(); } catch {}
      pgmVideoPlayer.style.display = 'none';
    }

    if (state.outputMode === 'kv') {
      document.getElementById('pgmDeckTitle').textContent = '主視覺 (KV) 放映中';
      document.getElementById('pgmPageBadge').textContent = '底層主視覺';
      if (pgmAnimBadgeEl) {
        pgmAnimBadgeEl.textContent = '純淨底圖';
        pgmAnimBadgeEl.style.display = 'none';
      }
      if (pgmNextPip) pgmNextPip.style.display = 'none';
      if (state.keyVisualUrl && pgmImg) {
        pgmImg.src = state.keyVisualUrl;
        pgmImg.style.display = 'block';
      }
    } else {
      if (pgm.previewUrl && pgmImg) {
        pgmImg.src = pgm.previewUrl;
      }
      if (pgm.nextPreviewUrl && pgmNextImg) {
        pgmNextImg.src = pgm.nextPreviewUrl;
      }
    }
  }

  // 3. 右卡：準備播出 (PVW)
  const pvw = state.pvw || {};
  const pvwMedia = state.pvwMedia || (state.pvwVideo ? { ...state.pvwVideo, type: 'video' } : null);
  const isPvwEmpty = !pvwMedia && (!pvw.deckId || pvw.type === 'empty');

  const pvwImg = document.getElementById('pvwPreviewImg');
  const pvwNextImg = document.getElementById('pvwNextPreviewImg');
  const pvwVideoPlayer = document.getElementById('pvwVideoPlayer');
  const pvwVideoControls = document.getElementById('pvwVideoControls');
  const pvwNavRow = document.getElementById('pvwNavRow');
  const pvwNextPip = document.getElementById('pvwNextPip');
  const pvwEmptyPlaceholder = document.getElementById('pvwEmptyPlaceholder');
  const pvwAnimBadgeEl = document.getElementById('pvwAnimBadge');

  if (pvwMedia) {
    if (pvwEmptyPlaceholder) pvwEmptyPlaceholder.style.display = 'none';
    if (pvwNextPip) pvwNextPip.style.display = 'none';
    document.getElementById('pvwDeckTitle').textContent = `預覽${pvwMedia.type === 'video' ? '影片' : pvwMedia.type === 'image' ? '圖片' : '音訊'}：${pvwMedia.title}`;
    document.getElementById('pvwPageBadge').textContent = pvwMedia.type === 'video' ? '影片預覽' : pvwMedia.type === 'image' ? '圖片預覽' : '音訊預覽';
    if (pvwAnimBadgeEl) {
      pvwAnimBadgeEl.textContent = '絕對靜音';
      pvwAnimBadgeEl.style.display = 'none';
    }

    if (pvwMedia.type === 'video' || pvwMedia.type === 'audio') {
      const isVideo = pvwMedia.type === 'video';
      if (isVideo) {
        pvwImg.style.display = 'none';
        pvwVideoPlayer.style.display = 'block';
      } else {
        pvwImg.style.display = 'none';
        pvwVideoPlayer.style.display = 'none';
      }
      pvwVideoControls.style.display = 'block';
      pvwNavRow.style.display = 'none';

      const targetCurrentTime = Number.isFinite(pvwMedia.currentTime) ? pvwMedia.currentTime : 0;
      const pvwSeekSlider = document.getElementById('pvwVideoSeekSlider');
      const pvwTimeDisp = document.getElementById('pvwVideoTimeDisplay');
      const pvwToggleBtn = document.getElementById('btnPvwVideoPlayToggle');

      const applyPvwPlaybackState = () => {
        try {
          pvwVideoPlayer.currentTime = targetCurrentTime;
        } catch (e) {}
        const dur = pvwVideoPlayer.duration || 1;
        if (pvwTimeDisp) {
          pvwTimeDisp.textContent = `${formatTime(targetCurrentTime)} / ${formatTime(dur)}`;
        }
        if (pvwSeekSlider && !pvwSeekSlider.matches(':active')) {
          pvwSeekSlider.value = dur > 0 ? (targetCurrentTime / dur) * 100 : 0;
        }
      };

      if (pvwVideoPlayer.dataset.rawUrl !== pvwMedia.url) {
        pvwVideoPlayer.dataset.rawUrl = pvwMedia.url;
        const sep = pvwMedia.url.includes('?') ? '&' : '?';
        pvwVideoPlayer.preload = 'metadata';
        pvwVideoPlayer.src = `${pvwMedia.url}${sep}slot=pvw`;
        pvwVideoPlayer.muted = true;
        pvwVideoPlayer.addEventListener('loadedmetadata', applyPvwPlaybackState, { once: true });
      }

      applyPvwPlaybackState();

      if (pvwMedia.isPlaying) {
        pvwVideoPlayer.play().catch(() => {});
        if (pvwToggleBtn) pvwToggleBtn.textContent = '暫停預覽';
      } else {
        pvwVideoPlayer.pause();
        if (pvwToggleBtn) pvwToggleBtn.textContent = '播放預覽';
      }
    } else if (pvwMedia.type === 'image') {
      pvwVideoPlayer.style.display = 'none';
      pvwVideoControls.style.display = 'none';
      pvwNavRow.style.display = 'none';
      pvwImg.src = pvwMedia.url;
      pvwImg.style.display = 'block';
    }
  } else if (isPvwEmpty) {
    // 空槽待命 (無素材)
    document.getElementById('pvwDeckTitle').textContent = '⚪ 空槽待命 (STANDBY)';
    document.getElementById('pvwPageBadge').textContent = '待命';
    if (pvwAnimBadgeEl) {
      pvwAnimBadgeEl.textContent = '無內容';
      pvwAnimBadgeEl.style.display = 'none';
    }

    if (pvwImg) {
      pvwImg.removeAttribute('src');
      pvwImg.style.display = 'none';
    }
    if (pvwVideoPlayer) {
      pvwVideoPlayer.pause();
      pvwVideoPlayer.preload = 'none';
      pvwVideoPlayer.removeAttribute('src');
      delete pvwVideoPlayer.dataset.rawUrl;
      try { pvwVideoPlayer.load(); } catch {}
      pvwVideoPlayer.style.display = 'none';
    }
    if (pvwVideoControls) pvwVideoControls.style.display = 'none';
    if (pvwNavRow) pvwNavRow.style.display = 'none';
    if (pvwNextPip) pvwNextPip.style.display = 'none';
    if (pvwEmptyPlaceholder) pvwEmptyPlaceholder.style.display = 'flex';
  } else {
    // PPT 正常預覽
    if (pvwEmptyPlaceholder) pvwEmptyPlaceholder.style.display = 'none';
    if (pvwNextPip) pvwNextPip.style.display = 'block';
    document.getElementById('pvwDeckTitle').textContent = pvw.title || '尚未載入簡報';
    document.getElementById('pvwPageBadge').textContent = `${pvw.currentSlide || 0} / ${pvw.totalSlides || 0}`;
    if (pvwAnimBadgeEl) {
      pvwAnimBadgeEl.textContent =
        pvw.clickCount > 0 ? `動畫 ${pvw.clickIndex || 0} / ${pvw.clickCount}` : '無頁內動畫';
      pvwAnimBadgeEl.style.display = pvw.clickCount > 0 ? 'inline-flex' : 'none';
    }

    pvwImg.style.display = 'block';
    pvwVideoPlayer.style.display = 'none';
    pvwVideoControls.style.display = 'none';
    pvwNavRow.style.display = 'flex';
    if (pvwVideoPlayer.getAttribute('src')) {
      pvwVideoPlayer.pause();
      pvwVideoPlayer.preload = 'none';
      pvwVideoPlayer.removeAttribute('src');
      delete pvwVideoPlayer.dataset.rawUrl;
      try { pvwVideoPlayer.load(); } catch {}
    }

    if (pvw.previewUrl) {
      pvwImg.src = pvw.previewUrl;
    }
    if (pvw.nextPreviewUrl) {
      pvwNextImg.src = pvw.nextPreviewUrl;
    }
  }

  // 4. 現場流程與綜合素材池渲染
  renderScheduleQueue(state);
  renderAllMediaPool(state);

  // 5. 【長官全新鐵律】：影片與 MP3 被選取、被放到「預覽」或「播出」時，自動聯動右下角播控艙！
  syncMediaDock(state);
  renderPptDock(state);
  renderNoticeDock();
  syncMiniTransportPill(state);
}

let currentDockTab = 'player'; // 'player' | 'ppt' | 'notice'
let currentPptDockTargetSlot = 'pvw'; // 'pvw' | 'pgm'
let currentPptSlideTextShapes = [];
let previewCacheBust = 0;

export function switchDockTab(tabName) {
  if (!['player', 'ppt', 'notice'].includes(tabName)) return;
  currentDockTab = tabName;

  document.querySelectorAll('#dockTabBar .dock-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.dockTab === tabName);
  });

  document.querySelectorAll('#rightMediaWorkspace .dock-pane').forEach((pane) => {
    pane.style.display = pane.dataset.dockPane === tabName ? 'flex' : 'none';
  });

  if (currentState) {
    if (tabName === 'ppt') renderPptDock(currentState);
    if (tabName === 'notice') renderNoticeDock();
    syncMiniTransportPill(currentState);
  }
}

function getActivePptForDock(state) {
  if (!state) return { slot: currentPptDockTargetSlot, slotState: null, deck: null };
  let slot = currentPptDockTargetSlot;
  let slotState = slot === 'pgm' ? state.pgm : state.pvw;

  // 若目標槽位目前無 PPT，自動智慧回退至另一槽位的 PPT
  if (!slotState || !slotState.deckId || slotState.type === 'empty') {
    const altSlot = slot === 'pvw' ? 'pgm' : 'pvw';
    const altState = altSlot === 'pgm' ? state.pgm : state.pvw;
    if (altState && altState.deckId && altState.type !== 'empty') {
      slot = altSlot;
      slotState = altState;
    }
  }

  const deck = (slotState && slotState.deckId)
    ? (state.pptPool || []).find((d) => d.id === slotState.deckId)
    : null;
  return { slot, slotState, deck };
}

function renderPptDock(state) {
  const stripEl = document.getElementById('pptSlideThumbStrip');
  const deckNameEl = document.getElementById('pptDockActiveDeckName');
  const btnTargetPvw = document.getElementById('btnPptDockTargetPvw');
  const btnTargetPgm = document.getElementById('btnPptDockTargetPgm');
  if (!stripEl || !deckNameEl) return;

  const { slot, slotState, deck } = getActivePptForDock(state);
  if (btnTargetPvw) btnTargetPvw.classList.toggle('active', slot === 'pvw');
  if (btnTargetPgm) btnTargetPgm.classList.toggle('active', slot === 'pgm');

  if (!deck || !slotState) {
    deckNameEl.textContent = '尚未載入簡報（請從左欄點選簡報送預覽或播出）';
    stripEl.innerHTML = `<div class="ppt-thumb-empty">請先將任一份 PPT 送至預覽 (PVW) 或播出 (PGM)，此處即顯示全頁縮圖供一鍵跳頁</div>`;
    return;
  }

  const curSlide = slotState.currentSlide || 1;
  const totalSlides = deck.slideCount || (deck.slides ? deck.slides.length : 1);
  deckNameEl.textContent = `[${slot === 'pgm' ? '播出 PGM' : '預覽 PVW'}] ${deck.title || deck.fileName} (第 ${curSlide}/${totalSlides} 頁)`;

  stripEl.innerHTML = '';
  const slides = deck.slides && deck.slides.length > 0
    ? deck.slides
    : Array.from({ length: totalSlides }, (_, idx) => ({
        index: idx + 1,
        previewUrl: `/previews/${encodeURIComponent(deck.id)}/slide-${idx + 1}.png`
      }));

  slides.forEach((sl) => {
    const sNum = sl.index;
    const item = document.createElement('div');
    item.className = `ppt-thumb-item ${sNum === curSlide ? 'active' : ''}`;
    item.dataset.slide = String(sNum);
    item.dataset.slot = slot;
    item.dataset.deckId = deck.id;
    item.title = `點擊直接跳至第 ${sNum} 頁`;
    const bust = previewCacheBust ? `?t=${previewCacheBust}` : '';
    item.innerHTML = `
      <img src="${sl.previewUrl}${bust}" alt="Slide ${sNum}" loading="lazy" />
      <span class="ppt-thumb-num">${sNum}</span>
    `;
    stripEl.appendChild(item);
  });

  // 當前選中頁平滑捲動至視野中 (滿了垂直拉時自動追蹤播放頁)
  const activeThumb = stripEl.querySelector('.ppt-thumb-item.active');
  if (activeThumb && stripEl.dataset.lastActiveSlide !== String(curSlide)) {
    stripEl.dataset.lastActiveSlide = String(curSlide);
    setTimeout(() => {
      activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 40);
  }
}

let currentEditingDeckId = null;
let currentEditingSlideNum = 1;

async function fetchSlideTextForDock(deckId, slideNum) {
  if (!deckId) return;
  const selectEl = document.getElementById('pptShapeSelect');
  const inputEl = document.getElementById('pptQuickTextInput');
  const labelEl = document.getElementById('pptQuickEditLabel');
  if (!selectEl || !inputEl) return;

  currentEditingDeckId = deckId;
  currentEditingSlideNum = slideNum;

  const isPgm = currentState?.pgm?.deckId === deckId;
  const slotBadge = isPgm ? '🔴 PGM' : '🟢 PVW';

  try {
    const res = await fetch('/api/ppt-slide-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId, slide: slideNum })
    });
    const data = await res.json();
    currentPptSlideTextShapes = (data && Array.isArray(data.items)) ? data.items : [];
    selectEl.innerHTML = '';

    if (currentPptSlideTextShapes.length === 0) {
      const opt = document.createElement('option');
      opt.value = '1';
      opt.textContent = `第 ${slideNum} 頁無可編輯文字框`;
      selectEl.appendChild(opt);
      inputEl.value = '';
      if (labelEl) labelEl.textContent = `📝 [${slotBadge}] 第 ${slideNum} 頁無文字框`;
      return;
    }

    currentPptSlideTextShapes.forEach((sh, i) => {
      const opt = document.createElement('option');
      opt.value = String(sh.shapeIndex);
      const preview = String(sh.text || '').replace(/\s+/g, ' ').slice(0, 18);
      opt.textContent = `文字框 #${i + 1}: ${preview || '(空白)'}`;
      selectEl.appendChild(opt);
    });
    inputEl.value = currentPptSlideTextShapes[0].text || '';
    if (labelEl) labelEl.textContent = `📝 [${slotBadge}] 第 ${slideNum} 頁文字 (${currentPptSlideTextShapes.length} 處)`;
  } catch (err) {
    console.warn('[StageDeck] 讀取投影片文字失敗:', err);
    if (labelEl) labelEl.textContent = `📝 [${slotBadge}] 第 ${slideNum} 頁讀取失敗`;
  }
}

function renderNoticeDock() {
  const lbl = document.getElementById('removedFlowCountLabel');
  if (lbl) {
    const removed = getRemovedFlowKeys();
    lbl.textContent = `已隱藏流程: ${removed.length} 項`;
  }
}

function syncMiniTransportPill(state) {
  const pill = document.getElementById('dockMiniTransportPill');
  const label = document.getElementById('dockMiniTransportLabel');
  const btn = document.getElementById('btnDockMiniToggle');
  if (!pill || !label || !btn || !state) return;

  const bgPlayer = document.getElementById('bgAudioPlayer');
  const isBgAudioPlaying = Boolean(currentPurePlayingAudio && bgPlayer && !bgPlayer.paused);
  const isPgmMedia = Boolean(state.activeVideo || (state.activeMedia && (state.activeMedia.type === 'video' || state.activeMedia.type === 'audio')));
  const isPvwMedia = Boolean(state.pvwVideo || (state.pvwMedia && (state.pvwMedia.type === 'video' || state.pvwMedia.type === 'audio')));

  if (currentDockTab === 'player' || (!isBgAudioPlaying && !isPgmMedia && !isPvwMedia)) {
    pill.style.display = 'none';
    return;
  }

  pill.style.display = 'inline-flex';
  if (isBgAudioPlaying) {
    label.textContent = `🎵 背景音: ${currentPurePlayingAudio.title || currentPurePlayingAudio.fileName}`;
    btn.textContent = '⏸ 暫停';
  } else if (isPgmMedia) {
    const m = state.activeVideo || state.activeMedia;
    const isPaused = Boolean(m?.isPaused);
    label.textContent = `${isPaused ? '⏸ PGM 暫停' : '🔴 PGM 播出'}: ${m.title || m.fileName}`;
    btn.textContent = isPaused ? '▶ 繼續' : '⏸ 暫停';
  } else if (isPvwMedia) {
    const m = state.pvwVideo || state.pvwMedia;
    const pvwEl = document.getElementById('pvwVideoPlayer');
    const playing = Boolean(pvwEl && !pvwEl.paused);
    label.textContent = `🟢 PVW 預覽: ${m.title || m.fileName}`;
    btn.textContent = playing ? '⏸ 暫停' : '▶ 試播';
  }
}

function syncMediaDock(state) {
  const deskVideoEl = document.getElementById('deskVideoMasterPlayer');
  const deskAudioVisual = document.getElementById('deskAudioMasterVisual');
  const deskTitleEl = document.getElementById('deskMasterVideoTitle');
  const deskStatusEl = document.getElementById('deskMasterVideoStatusBadge');

  if (!deskTitleEl || !deskStatusEl) return;

  // 判定優先級：播出中 (PGM) 影音 ➔ 預覽中 (PVW) 影音 ➔ 使用者當前選取之影音
  let targetMedia = null;
  let statusText = '待命中';
  let statusColor = '#334155';

  if (state.activeVideo) {
    targetMedia = { ...state.activeVideo, type: 'video' };
    const isPaused = Boolean(state.activeVideo.isPaused);
    statusText = isPaused ? '⏸ PGM 已暫停 (停格中)' : '🔴 PGM 播出中';
    statusColor = isPaused ? '#d97706' : '#ef4444';
  } else if (state.activeMedia && (state.activeMedia.type === 'video' || state.activeMedia.type === 'audio')) {
    targetMedia = state.activeMedia;
    const isPaused = Boolean(state.activeMedia.isPaused);
    statusText = isPaused ? '⏸ PGM 媒體已暫停 (停格)' : (state.activeMedia.type === 'video' ? '🔴 影片播出中' : '🔴 音訊播出中');
    statusColor = isPaused ? '#d97706' : '#ef4444';
  } else if (state.pvwVideo) {
    targetMedia = { ...state.pvwVideo, type: 'video' };
    statusText = '🟢 PVW 預覽中 (靜音)';
    statusColor = '#10b981';
  } else if (state.pvwMedia && (state.pvwMedia.type === 'video' || state.pvwMedia.type === 'audio')) {
    targetMedia = state.pvwMedia;
    statusText = state.pvwMedia.type === 'video' ? '🟢 影片預覽 (靜音)' : '🟢 音訊預覽 (靜音)';
    statusColor = '#10b981';
  } else if (selectedVideoItem) {
    targetMedia = selectedVideoItem;
    const isPurePlayingThis = currentPurePlayingAudio && currentPurePlayingAudio.id === targetMedia.id && !document.getElementById('bgAudioPlayer')?.paused;
    if (isPurePlayingThis) {
      statusText = '🎵 背景純放音中';
      statusColor = '#7e22ce';
    } else {
      statusText = '已選取 (待命)';
      statusColor = '#0284c7';
    }
  }

  if (targetMedia) {
    selectedVideoItem = targetMedia;
    deskTitleEl.textContent = `${targetMedia.type === 'audio' ? '🎵 [音訊] ' : '🎬 [影片] '}${targetMedia.title || targetMedia.fileName}`;
    deskStatusEl.textContent = statusText;
    deskStatusEl.style.background = statusColor;

    const url = targetMedia.url || (targetMedia.type === 'audio' ? `/audios/${encodeURIComponent(targetMedia.fileName)}` : `/videos/${encodeURIComponent(targetMedia.fileName)}`);
    const sep = url.includes('?') ? '&' : '?';
    const dockScopedUrl = `${url}${sep}slot=dock`;
    if (deskVideoEl && deskVideoEl.dataset.rawUrl !== url) {
      deskVideoEl.dataset.rawUrl = url;
      deskVideoEl.src = dockScopedUrl;
    }

    const bgPlayer = document.getElementById('bgAudioPlayer');
    if (targetMedia.type === 'audio' && bgPlayer) {
      if (bgPlayer.getAttribute('src') !== url && bgPlayer.src !== window.location.origin + url) {
        bgPlayer.src = url;
        bgPlayer.preload = 'metadata';
      }
    }

    if (targetMedia.type === 'audio') {
      if (deskVideoEl) deskVideoEl.style.display = 'none';
      if (deskAudioVisual) deskAudioVisual.style.display = 'flex';
    } else {
      if (deskVideoEl) deskVideoEl.style.display = 'block';
      if (deskAudioVisual) deskAudioVisual.style.display = 'none';
    }
  }

  const btnPurePlay = document.getElementById('btnDeskMasterPurePlay');
  if (btnPurePlay) {
    if (targetMedia && targetMedia.type === 'audio') {
      btnPurePlay.style.display = 'inline-flex';
      const isPurePlayingThis = currentPurePlayingAudio && currentPurePlayingAudio.id === targetMedia.id && !document.getElementById('bgAudioPlayer')?.paused;
      btnPurePlay.textContent = isPurePlayingThis ? '⏸ 停止純播放' : '🔊 純播放';
      btnPurePlay.style.background = isPurePlayingThis ? '#ef4444' : '#8b5cf6';
    } else {
      btnPurePlay.style.display = 'none';
    }
  }

  // 長官鐵律：若當前素材正在 PVW 預覽，播控艙進度條與 Preview 預覽進度條保持一致狀態
  const isPvwTarget = (state.pvwVideo && targetMedia && state.pvwVideo.id === targetMedia.id) ||
                      (state.pvwMedia && targetMedia && state.pvwMedia.id === targetMedia.id);
  if (isPvwTarget) {
    const pvwVideoEl = document.getElementById('pvwVideoPlayer');
    const pvwSeekSlider = document.getElementById('pvwVideoSeekSlider');
    const deskSeek = document.getElementById('deskMasterVideoSeek');
    const deskTimeDisp = document.getElementById('deskMasterVideoTimeDisplay');
    const btnDeskPlay = document.getElementById('btnDeskMasterPlay');
    if (pvwSeekSlider && deskSeek && !deskSeek.matches(':active')) {
      deskSeek.value = pvwSeekSlider.value;
    }
    if (pvwVideoEl) {
      const cur = pvwVideoEl.currentTime || 0;
      const dur = pvwVideoEl.duration || 1;
      if (deskTimeDisp) deskTimeDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      if (btnDeskPlay) {
        btnDeskPlay.textContent = !pvwVideoEl.paused ? '⏸ 暫停' : '▶ 試播';
      }
    }
  }

  // 長官最新鐵律：若當前素材正在 PGM 播出，播控艙進度條與按鈕直接反映 PGM 狀態 (原地暫停/繼續，絕不退回主視覺)
  const isPgmTarget = (state.activeVideo && targetMedia && state.activeVideo.id === targetMedia.id) ||
                      (state.activeMedia && targetMedia && state.activeMedia.id === targetMedia.id);
  if (isPgmTarget) {
    const pgmVideoEl = document.getElementById('pgmVideoPlayer');
    const deskSeek = document.getElementById('deskMasterVideoSeek');
    const deskTimeDisp = document.getElementById('deskMasterVideoTimeDisplay');
    const btnDeskPlay = document.getElementById('btnDeskMasterPlay');
    const isPaused = Boolean(state.activeVideo?.isPaused || state.activeMedia?.isPaused);

    if (btnDeskPlay) {
      btnDeskPlay.textContent = isPaused ? '▶ 繼續播放 (PGM)' : '⏸ 原地暫停 (PGM)';
    }
    if (pgmVideoEl) {
      const cur = pgmVideoEl.currentTime || (state.activeVideo?.currentTime || 0);
      const dur = pgmVideoEl.duration || 1;
      if (deskTimeDisp) deskTimeDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
        deskSeek.value = (cur / dur) * 100;
      }
    }
  }
}

const STORAGE_KEY_UI_SCALE = 'stage_deck_ui_scale';
const ALLOWED_UI_SCALES = [0.8, 0.9, 1, 1.1];

export function applyUiScale(rawScale) {
  const num = Number(rawScale);
  const scale = ALLOWED_UI_SCALES.includes(num) ? num : 1;
  document.documentElement.style.setProperty('--font-scale', String(scale));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  try {
    localStorage.setItem(STORAGE_KEY_UI_SCALE, String(scale));
  } catch (e) {}

  const scaleBtns = document.querySelectorAll('#uiScaleControl .btn-scale-opt');
  scaleBtns.forEach((btn) => {
    const btnScale = Number(btn.dataset.scale);
    if (Math.abs(btnScale - scale) < 0.01) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  return scale;
}

function bindEvents() {
  // 介面縮放比例 (80% / 90% / 100% / 110%) 初始化與切換綁定
  let initialScale = 1;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_UI_SCALE);
    if (saved && ALLOWED_UI_SCALES.includes(Number(saved))) {
      initialScale = Number(saved);
    }
  } catch (e) {}
  applyUiScale(initialScale);

  const uiScaleControl = document.getElementById('uiScaleControl');
  if (uiScaleControl) {
    uiScaleControl.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-scale-opt');
      if (!btn) return;
      applyUiScale(Number(btn.dataset.scale));
    });
  }

  document.getElementById('btnPgmPrev').addEventListener('click', () => dispatchAction('PGM_PREV'));
  document.getElementById('btnPgmNext').addEventListener('click', () => dispatchAction('PGM_NEXT'));
  document.getElementById('btnPvwPrev').addEventListener('click', () => dispatchAction('PVW_PREV'));
  document.getElementById('btnPvwNext').addEventListener('click', () => dispatchAction('PVW_NEXT'));
  document.getElementById('btnCutSwap').addEventListener('click', () => {
    const pgmVid = document.getElementById('pgmVideoPlayer');
    const curTime = pgmVid ? pgmVid.currentTime : 0;
    dispatchAction('CUT_SWAP', { pgmCurrentTime: curTime });
  });
  document.getElementById('btnBlackScreen').addEventListener('click', () => dispatchAction('TOGGLE_BLACK'));
  document.getElementById('btnRefreshPools').addEventListener('click', () => dispatchAction('REFRESH_POOLS'));

  // 主視覺底圖選取與上傳
  const btnSelectKv = document.getElementById('btnSelectKeyVisual');
  const kvFileInput = document.getElementById('keyVisualFileInput');
  if (btnSelectKv && kvFileInput) {
    btnSelectKv.addEventListener('click', () => kvFileInput.click());
    kvFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const dataUrl = evt.target.result;
        try {
          const res = await fetch('/api/upload-key-visual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, fileName: file.name })
          });
          const result = await res.json();
          if (result && result.ok) {
            console.log('[StageDeck] 主視覺上傳成功:', result.url);
          }
        } catch (err) {
          console.error('[StageDeck] 主視覺上傳失敗:', err);
        }
      };
      reader.readAsDataURL(file);
      kvFileInput.value = '';
    });
  }

  // 清除主視覺底圖按鈕
  const btnClearKv = document.getElementById('btnClearKeyVisual');
  if (btnClearKv) {
    btnClearKv.addEventListener('click', () => dispatchAction('CLEAR_KEY_VISUAL'));
  }

  // 一鍵回主視覺模式
  const btnToggleKv = document.getElementById('btnToggleKvMode');
  if (btnToggleKv) {
    btnToggleKv.addEventListener('click', () => dispatchAction('TOGGLE_KV_MODE'));
  }

  // 退出系統與停止播放
  const btnShutdown = document.getElementById('btnShutdownAll');
  if (btnShutdown) {
    btnShutdown.addEventListener('click', () => {
      if (confirm('確定要關閉現場導播系統並退出所有放映嗎？（將一併清空本次載入的所有素材與主視覺）')) {
        saveRemovedFlowKeys([]);
        saveFlowOrderKeys([]);
        fetch('/api/shutdown', { method: 'POST' });
        window.close();
      }
    });
  }

  const btnStopVid = document.getElementById('btnStopVideo');
  if (btnStopVid) {
    btnStopVid.addEventListener('click', () => dispatchAction('STOP_MEDIA'));
  }

  const btnPgmStopVid = document.getElementById('btnPgmStopVideo');
  if (btnPgmStopVid) {
    btnPgmStopVid.addEventListener('click', () => dispatchAction('STOP_MEDIA'));
  }

  // PVW 影片控制
  const pvwVideoEl = document.getElementById('pvwVideoPlayer');
  const btnPvwToggle = document.getElementById('btnPvwVideoPlayToggle');
  const pvwSeekSlider = document.getElementById('pvwVideoSeekSlider');
  const btnPvwClear = document.getElementById('btnPvwVideoClear');

  // 長官最新指令：Preview 與播控艙共用同一 Play 核心 (Single Play Core)
  const updateUnifiedPlayButtons = (isPlaying) => {
    const btnPvw = document.getElementById('btnPvwVideoPlayToggle');
    const btnDesk = document.getElementById('btnDeskMasterPlay');
    if (btnPvw) btnPvw.textContent = isPlaying ? '暫停預覽' : '播放預覽';
    if (btnDesk) btnDesk.textContent = isPlaying ? '⏸ 暫停' : '▶ 試播';
  };

  const toggleUnifiedPlayback = () => {
    // 0. 長官最新鐵律：若該影片/媒體正在 PGM 播出中，點擊是原地停格暫停與原地繼續，絕不退回主視覺！
    const isPgmPlaying = Boolean(
      (currentState?.outputMode === 'video' && currentState?.activeVideo) ||
      (currentState?.outputMode === 'audio' && currentState?.activeMedia)
    );
    const isPgmTarget = (currentState?.activeVideo && selectedVideoItem && currentState.activeVideo.id === selectedVideoItem.id) ||
                        (currentState?.activeMedia && selectedVideoItem && currentState.activeMedia.id === selectedVideoItem.id) ||
                        (isPgmPlaying && !currentState?.pvwVideo && !currentState?.pvwMedia);

    if (isPgmPlaying && (isPgmTarget || !selectedVideoItem)) {
      const pgmVid = document.getElementById('pgmVideoPlayer');
      const curTime = pgmVid ? pgmVid.currentTime : (currentState.activeVideo?.currentTime || 0);
      dispatchAction('TOGGLE_PGM_VIDEO', { currentTime: curTime });
      return;
    }

    const isPvwTarget = (currentState?.pvwVideo && selectedVideoItem && currentState.pvwVideo.id === selectedVideoItem.id) ||
                        (currentState?.pvwMedia && selectedVideoItem && currentState.pvwMedia.id === selectedVideoItem.id);

    if (isPvwTarget && pvwVideoEl) {
      if (pvwVideoEl.paused) {
        pvwVideoEl.muted = true;
        pvwVideoEl.play().catch(() => {});
        updateUnifiedPlayButtons(true);
        dispatchAction('SEEK_PVW_VIDEO', { currentTime: pvwVideoEl.currentTime, isPlaying: true });
      } else {
        pvwVideoEl.pause();
        updateUnifiedPlayButtons(false);
        dispatchAction('SEEK_PVW_VIDEO', { currentTime: pvwVideoEl.currentTime, isPlaying: false });
      }
      return;
    }

    if (btnDeskPlay && deskVideoMaster) {
      if (!selectedVideoItem) return;

      const url = selectedVideoItem.url || (selectedVideoItem.type === 'audio' ? `/audios/${encodeURIComponent(selectedVideoItem.fileName)}` : `/videos/${encodeURIComponent(selectedVideoItem.fileName)}`);
      const isSameSrc = (deskVideoMaster.src === window.location.origin + url || deskVideoMaster.getAttribute('src') === url);
      if (!isSameSrc) {
        deskVideoMaster.src = url;
      }
      if (deskVideoMaster.paused) {
        if (deskVideoMaster.currentTime === deskVideoMaster.duration || Number.isNaN(deskVideoMaster.currentTime)) {
          deskVideoMaster.currentTime = 0;
        }
        deskVideoMaster.play().catch(() => {});
        updateUnifiedPlayButtons(true);
      } else {
        deskVideoMaster.pause();
        updateUnifiedPlayButtons(false);
      }
    }
  };

  if (pvwVideoEl) {
    pvwVideoEl.muted = true; // 強制靜音！
    pvwVideoEl.addEventListener('play', () => updateUnifiedPlayButtons(true));
    pvwVideoEl.addEventListener('pause', () => updateUnifiedPlayButtons(false));
    pvwVideoEl.addEventListener('ended', () => {
      updateUnifiedPlayButtons(false);
      const pvwSlider = document.getElementById('pvwVideoSeekSlider');
      const deskSlider = document.getElementById('deskMasterVideoSeek');
      if (pvwSlider) pvwSlider.value = 0;
      if (deskSlider) deskSlider.value = 0;
    });
    pvwVideoEl.addEventListener('timeupdate', () => {
      const cur = pvwVideoEl.currentTime || 0;
      const dur = pvwVideoEl.duration || 1;
      const percent = (cur / dur) * 100;

      // 1. 更新 PVW 面板上的時間與進度條
      const timeDisplay = document.getElementById('pvwVideoTimeDisplay');
      if (timeDisplay) {
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      }
      if (pvwSeekSlider && !pvwSeekSlider.matches(':active')) {
        pvwSeekSlider.value = percent;
      }

      // 2. 長官鐵律：若右下播控艙目前對應此預覽素材，播控艙進度條與時間必須一模一樣同步！
      const isDockPvw = (currentState?.pvwVideo && selectedVideoItem && currentState.pvwVideo.id === selectedVideoItem.id) ||
                        (currentState?.pvwMedia && selectedVideoItem && currentState.pvwMedia.id === selectedVideoItem.id);
      if (isDockPvw) {
        const deskTimeDisp = document.getElementById('deskMasterVideoTimeDisplay');
        const deskSeek = document.getElementById('deskMasterVideoSeek');
        if (deskTimeDisp) deskTimeDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
          deskSeek.value = percent;
        }
      }
    });
  }

  if (btnPvwToggle) {
    btnPvwToggle.addEventListener('click', toggleUnifiedPlayback);
  }

  if (pvwSeekSlider && pvwVideoEl) {
    const handlePvwSeek = () => {
      const dur = pvwVideoEl.duration || 1;
      const percent = Number(pvwSeekSlider.value);
      const targetTime = (percent / 100) * dur;
      pvwVideoEl.currentTime = targetTime;

      // 長官鐵律：雙向鏡像同步更新右下播控艙進度條與時間
      const deskSeek = document.getElementById('deskMasterVideoSeek');
      const deskTimeDisp = document.getElementById('deskMasterVideoTimeDisplay');
      if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
        deskSeek.value = percent;
      }
      if (deskTimeDisp) {
        deskTimeDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
      }
      if (deskVideoMaster) {
        deskVideoMaster.currentTime = targetTime;
      }

      dispatchAction('SEEK_PVW_VIDEO', { currentTime: targetTime, isPlaying: !pvwVideoEl.paused });
    };

    pvwSeekSlider.addEventListener('input', handlePvwSeek);
    pvwSeekSlider.addEventListener('change', handlePvwSeek);
  }

  if (btnPvwClear) {
    btnPvwClear.addEventListener('click', () => dispatchAction('CLEAR_PVW_VIDEO'));
  }

  const btnResetFlow = document.getElementById('btnResetFlowQueue');
  if (btnResetFlow) {
    btnResetFlow.addEventListener('click', () => {
      // 徹底刪除模式：重置僅還原卡片上下排列順序，絕對不恢復已被刪除的檔案！
      saveFlowOrderKeys([]);
      renderScheduleQueue(currentState);
    });
  }

  // 萬能佇列與綜合池事件代理
  document.addEventListener('click', (e) => {
    // 防止點擊按鈕後按鈕殘留焦點，導致後續按空白鍵或簡報筆 Enter 誤觸舊按鈕
    const clickedButton = e.target.closest('button');
    if (clickedButton && typeof clickedButton.blur === 'function') {
      setTimeout(() => clickedButton.blur(), 0);
    }

    // 0. 流程項目移出按鈕
    const removeFlowBtn = e.target.closest('.btn-remove-flow-item');
    if (removeFlowBtn) {
      const flowKey = removeFlowBtn.dataset.flowKey;
      if (flowKey) {
        const removed = getRemovedFlowKeys();
        if (!removed.includes(flowKey)) {
          removed.push(flowKey);
          saveRemovedFlowKeys(removed);
        }
        renderScheduleQueue(currentState);
      }
      return;
    }

    // 0-B. 音訊純播放按鈕 (長官最新需求：不排進 PGM/PVW 直接現場放音)
    const purePlayAudioBtn = e.target.closest('.btn-pure-play-audio');
    if (purePlayAudioBtn) {
      const audioId = purePlayAudioBtn.dataset.id;
      const audioItem = currentState?.audioPool?.find((a) => a.id === audioId);
      if (audioItem) {
        const bgPlayer = document.getElementById('bgAudioPlayer');
        const deskSeek = document.getElementById('deskMasterVideoSeek');
        const isSameAudio = currentPurePlayingAudio && currentPurePlayingAudio.id === audioId;
        let resumeTime = null;
        if (isSameAudio && bgPlayer && Number.isFinite(bgPlayer.currentTime) && bgPlayer.currentTime > 0) {
          resumeTime = bgPlayer.currentTime;
        } else if (isSameAudio && deskSeek && Number(deskSeek.value) > 0) {
          const dur = (Number.isFinite(bgPlayer?.duration) && bgPlayer.duration > 0) ? bgPlayer.duration : 1;
          resumeTime = (Number(deskSeek.value) / 100) * dur;
        }
        togglePurePlayAudio({ ...audioItem, type: 'audio' }, resumeTime);
      }
      return;
    }

    // 1. 萬能預覽按鈕
    const loadPvwUniversalBtn = e.target.closest('.btn-load-pvw-universal');
    if (loadPvwUniversalBtn) {
      const mediaId = loadPvwUniversalBtn.dataset.id;
      const type = loadPvwUniversalBtn.dataset.type;

      let currentTime = 0;
      let isPlaying = false;
      if (selectedVideoItem && selectedVideoItem.id === mediaId) {
        const deskSeek = document.getElementById('deskMasterVideoSeek');
        const bgPlayer = document.getElementById('bgAudioPlayer');
        const deskVideoMaster = document.getElementById('deskVideoMasterPlayer');
        const seekPercent = deskSeek ? Number(deskSeek.value) / 100 : 0;
        if (type === 'audio') {
          const dur = (Number.isFinite(bgPlayer?.duration) && bgPlayer.duration > 0) ? bgPlayer.duration : (deskVideoMaster?.duration || 1);
          if (bgPlayer && !bgPlayer.paused && Number.isFinite(bgPlayer.currentTime)) {
            currentTime = bgPlayer.currentTime;
            isPlaying = true;
          } else if (bgPlayer && Number.isFinite(bgPlayer.currentTime) && bgPlayer.currentTime > 0) {
            currentTime = bgPlayer.currentTime;
          } else {
            currentTime = seekPercent * dur;
          }
        } else {
          const dur = deskVideoMaster?.duration || 1;
          if (deskVideoMaster && !deskVideoMaster.paused && Number.isFinite(deskVideoMaster.currentTime)) {
            currentTime = deskVideoMaster.currentTime;
            isPlaying = true;
          } else if (deskVideoMaster && Number.isFinite(deskVideoMaster.currentTime) && deskVideoMaster.currentTime > 0) {
            currentTime = deskVideoMaster.currentTime;
          } else {
            currentTime = seekPercent * dur;
          }
        }
      }

      dispatchAction('LOAD_MEDIA_PVW', { mediaId, type, currentTime, isPlaying });
      return;
    }

    // 2. 萬能直接播出按鈕
    const loadPgmUniversalBtn = e.target.closest('.btn-load-pgm-universal');
    if (loadPgmUniversalBtn) {
      const mediaId = loadPgmUniversalBtn.dataset.id;
      const type = loadPgmUniversalBtn.dataset.type;
      dispatchAction('PLAY_MEDIA_PGM', { mediaId, type });
      return;
    }

    // 3. 既有 PPT / Video 相容按鈕
    const pvwPptBtn = e.target.closest('.btn-load-pvw');
    if (pvwPptBtn) {
      const deckId = pvwPptBtn.dataset.deckId;
      dispatchAction('LOAD_PVW', { deckId });
      return;
    }

    const pgmPptBtn = e.target.closest('.btn-load-pgm');
    if (pgmPptBtn) {
      const deckId = pgmPptBtn.dataset.deckId;
      dispatchAction('LOAD_PGM', { deckId });
      return;
    }

    const pvwVidBtn = e.target.closest('.btn-pvw-video');
    if (pvwVidBtn) {
      const videoId = pvwVidBtn.dataset.videoId;
      dispatchAction('LOAD_PVW_VIDEO', { videoId, currentTime: 0, isPlaying: false });
      return;
    }

    const playVidBtn = e.target.closest('.btn-play-video');
    if (playVidBtn) {
      const videoId = playVidBtn.dataset.videoId;
      dispatchAction('PLAY_VIDEO', { videoId });
      return;
    }

    const stopVidBtn = e.target.closest('.btn-stop-video') || e.target.closest('.btn-stop-media');
    if (stopVidBtn) {
      dispatchAction('STOP_MEDIA');
      return;
    }
    // 點擊流程隊列或綜合池中的影片、音訊或 PPT 項目進行選取與智慧分頁聯動
    const poolItem = e.target.closest('.pool-item');
    if (poolItem && !e.target.closest('button')) {
      const vId = poolItem.dataset.videoId;
      const dId = poolItem.dataset.deckId;
      const uBtn = poolItem.querySelector('.btn-load-pvw-universal');
      const uType = uBtn ? uBtn.dataset.type : null;
      const uId = uBtn ? uBtn.dataset.id : null;

      if (uType === 'video' || uType === 'audio') {
        const item = (uType === 'video' ? currentState?.videoPool : currentState?.audioPool)?.find(x => x.id === uId);
        if (item) {
          selectedVideoItem = { ...item, type: uType };
          switchDockTab('player');
          syncMediaDock(currentState);
        }
      } else if (uType === 'ppt' || dId) {
        const targetId = uId || dId;
        if (currentState?.pgm?.deckId === targetId) {
          currentPptDockTargetSlot = 'pgm';
        } else if (currentState?.pvw?.deckId === targetId) {
          currentPptDockTargetSlot = 'pvw';
        }
        switchDockTab('ppt');
      } else if (vId) {
        const item = currentState?.videoPool?.find(x => x.id === vId);
        if (item) {
          selectedVideoItem = { ...item, type: 'video' };
          switchDockTab('player');
          syncMediaDock(currentState);
        }
      }
    }
  });

  // 🎛️ 右下角多功能分頁工作塢 (Multi-Tab Utility Dock) 事件綁定
  const dockTabBar = document.getElementById('dockTabBar');
  if (dockTabBar) {
    dockTabBar.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.dock-tab-btn');
      if (tabBtn && tabBtn.dataset.dockTab) {
        switchDockTab(tabBtn.dataset.dockTab);
      }
    });
  }

  const btnDockMiniToggle = document.getElementById('btnDockMiniToggle');
  if (btnDockMiniToggle) {
    btnDockMiniToggle.addEventListener('click', () => {
      const bgPlayer = document.getElementById('bgAudioPlayer');
      if (currentPurePlayingAudio && bgPlayer && !bgPlayer.paused) {
        togglePurePlayAudio(currentPurePlayingAudio);
        return;
      }
      toggleUnifiedPlayback();
    });
  }

  const btnTargetPvw = document.getElementById('btnPptDockTargetPvw');
  const btnTargetPgm = document.getElementById('btnPptDockTargetPgm');
  if (btnTargetPvw) {
    btnTargetPvw.addEventListener('click', () => {
      currentPptDockTargetSlot = 'pvw';
      renderPptDock(currentState);
      const { slotState, deck } = getActivePptForDock(currentState);
      if (deck && slotState) fetchSlideTextForDock(deck.id, slotState.currentSlide || 1);
    });
  }
  if (btnTargetPgm) {
    btnTargetPgm.addEventListener('click', () => {
      currentPptDockTargetSlot = 'pgm';
      renderPptDock(currentState);
      const { slotState, deck } = getActivePptForDock(currentState);
      if (deck && slotState) fetchSlideTextForDock(deck.id, slotState.currentSlide || 1);
    });
  }

  // B. 點擊 PPT 縮圖橫向快選帶直接跳頁 (0 秒定位)
  const pptSlideThumbStrip = document.getElementById('pptSlideThumbStrip');
  if (pptSlideThumbStrip) {
    pptSlideThumbStrip.addEventListener('click', async (e) => {
      const thumb = e.target.closest('.ppt-thumb-item');
      if (!thumb) return;
      const slideNum = Number(thumb.dataset.slide) || 1;
      const slot = thumb.dataset.slot || currentPptDockTargetSlot;
      const deckId = thumb.dataset.deckId;
      if (slot === 'pgm') {
        await dispatchAction('PGM_GOTO', { slide: slideNum });
      } else {
        await dispatchAction('PVW_GOTO', { slide: slideNum });
      }
      fetchSlideTextForDock(deckId, slideNum);
    });
  }

  // A. 喚起原生 PowerPoint 修改 & 存檔後熱重載
  const btnOpenPptNativeEdit = document.getElementById('btnOpenPptNativeEdit');
  if (btnOpenPptNativeEdit) {
    btnOpenPptNativeEdit.addEventListener('click', async () => {
      const { slotState, deck } = getActivePptForDock(currentState);
      if (!deck) return;
      await fetch('/api/ppt-open-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId: deck.id, slide: slotState?.currentSlide || 1 })
      });
    });
  }

  const btnReloadPptDeck = document.getElementById('btnReloadPptDeck');
  if (btnReloadPptDeck) {
    btnReloadPptDeck.addEventListener('click', async () => {
      const { deck } = getActivePptForDock(currentState);
      if (!deck) return;
      const origText = btnReloadPptDeck.textContent;
      btnReloadPptDeck.textContent = '🔄 重載中...';
      try {
        const res = await fetch('/api/ppt-reload-deck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckId: deck.id })
        });
        const data = await res.json();
        previewCacheBust = Date.now();
        if (data && data.state) renderState(data.state);
      } finally {
        btnReloadPptDeck.textContent = origText;
      }
    });
  }

  // C-1. 網頁直接讀取與修改本頁投影片文字
  const btnReadSlideText = document.getElementById('btnReadSlideText');
  const pptShapeSelect = document.getElementById('pptShapeSelect');
  const pptQuickTextInput = document.getElementById('pptQuickTextInput');
  const btnSaveSlideText = document.getElementById('btnSaveSlideText');

  if (btnReadSlideText) {
    btnReadSlideText.addEventListener('click', () => {
      const { slotState, deck } = getActivePptForDock(currentState);
      if (!deck) return;
      fetchSlideTextForDock(deck.id, slotState?.currentSlide || 1);
    });
  }

  if (pptShapeSelect && pptQuickTextInput) {
    pptShapeSelect.addEventListener('change', () => {
      const shIdx = Number(pptShapeSelect.value);
      const found = currentPptSlideTextShapes.find((s) => s.shapeIndex === shIdx);
      if (found) pptQuickTextInput.value = found.text || '';
    });
  }

  if (btnSaveSlideText && pptQuickTextInput) {
    btnSaveSlideText.addEventListener('click', async () => {
      const { slotState, deck } = getActivePptForDock(currentState);
      const deckId = currentEditingDeckId || deck?.id;
      const slideNum = currentEditingSlideNum || slotState?.currentSlide || 1;
      if (!deckId) return;

      const shapeIndex = Number(pptShapeSelect?.value) || 1;
      const newText = pptQuickTextInput.value;
      const origText = '💾 寫回';
      btnSaveSlideText.disabled = true;
      btnSaveSlideText.textContent = '寫回中...';
      try {
        const res = await fetch('/api/ppt-save-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckId, slide: slideNum, shapeIndex, text: newText })
        });
        const data = await res.json();
        previewCacheBust = Date.now();
        if (data && data.ok) {
          btnSaveSlideText.textContent = '✅ 已寫回';
          btnSaveSlideText.style.background = '#10b981';
          setTimeout(() => {
            btnSaveSlideText.textContent = origText;
            btnSaveSlideText.style.background = '#0ea5e9';
            btnSaveSlideText.disabled = false;
          }, 1500);
          if (data.state) {
            renderState(data.state);
          }
        } else {
          btnSaveSlideText.textContent = '❌ 寫回失敗';
          btnSaveSlideText.style.background = '#ef4444';
          btnSaveSlideText.title = data?.error || '寫回失敗，請確認該頁或文字框可編輯';
          setTimeout(() => {
            btnSaveSlideText.textContent = origText;
            btnSaveSlideText.style.background = '#0ea5e9';
            btnSaveSlideText.disabled = false;
          }, 2000);
        }
      } catch (err) {
        btnSaveSlideText.textContent = '❌ 網路錯誤';
        btnSaveSlideText.style.background = '#ef4444';
        setTimeout(() => {
          btnSaveSlideText.textContent = origText;
          btnSaveSlideText.style.background = '#0ea5e9';
          btnSaveSlideText.disabled = false;
        }, 2000);
      }
    });
  }

  // C-2. 臨時公告字卡送預覽/直接播出 & 恢復已隱藏流程
  const sendQuickNotice = async (target) => {
    const title = document.getElementById('quickNoticeTitleInput')?.value || '現場重要公告';
    const content = document.getElementById('quickNoticeContentInput')?.value || '請留意現場指引';
    const theme = document.getElementById('quickNoticeThemeSelect')?.value || 'navy';
    const res = await fetch('/api/quick-notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, theme, target })
    });
    const data = await res.json();
    if (data && data.state) {
      renderState(data.state);
    }
  };

  const btnSendNoticePvw = document.getElementById('btnSendNoticePvw');
  const btnSendNoticePgm = document.getElementById('btnSendNoticePgm');
  if (btnSendNoticePvw) btnSendNoticePvw.addEventListener('click', () => sendQuickNotice('pvw'));
  if (btnSendNoticePgm) btnSendNoticePgm.addEventListener('click', () => sendQuickNotice('pgm'));

  const btnRestoreRemovedFlow = document.getElementById('btnRestoreRemovedFlow');
  if (btnRestoreRemovedFlow) {
    btnRestoreRemovedFlow.addEventListener('click', () => {
      saveRemovedFlowKeys([]);
      renderScheduleQueue(currentState);
      renderNoticeDock();
    });
  }

  // 影片/音訊播控艙 master player
  const deskVideoMaster = document.getElementById('deskVideoMasterPlayer');
  const btnDeskPlay = document.getElementById('btnDeskMasterPlay');
  const btnDeskSendPvw = document.getElementById('btnDeskMasterSendPvw');
  const btnDeskCutLive = document.getElementById('btnDeskMasterCutLive');
  const deskSeek = document.getElementById('deskMasterVideoSeek');

  if (deskVideoMaster) {
    deskVideoMaster.muted = true; // 控場台試播預設靜音防干擾
    deskVideoMaster.addEventListener('timeupdate', () => {
      const cur = deskVideoMaster.currentTime || 0;
      const dur = deskVideoMaster.duration || 1;
      const tDisp = document.getElementById('deskMasterVideoTimeDisplay');
      if (tDisp) tDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
        deskSeek.value = (cur / dur) * 100;
      }
    });

    deskVideoMaster.addEventListener('ended', () => {
      if (btnDeskPlay) btnDeskPlay.textContent = '▶ 試播';
      if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
        deskSeek.value = 0;
      }
    });
  }

  // PGM 播出視窗播放器事件監聽：當影片在 PGM 播出時，右下播控艙進度條與按鈕 100% 即時跟隨！
  const pgmVideoPlayerEl = document.getElementById('pgmVideoPlayer');
  if (pgmVideoPlayerEl) {
    pgmVideoPlayerEl.addEventListener('timeupdate', () => {
      const isPgmTarget = (currentState?.activeVideo && selectedVideoItem && currentState.activeVideo.id === selectedVideoItem.id) ||
                          (currentState?.activeMedia && selectedVideoItem && currentState.activeMedia.id === selectedVideoItem.id);
      if (isPgmTarget) {
        const cur = pgmVideoPlayerEl.currentTime || 0;
        const dur = pgmVideoPlayerEl.duration || 1;
        const tDisp = document.getElementById('deskMasterVideoTimeDisplay');
        const deskSeek = document.getElementById('deskMasterVideoSeek');
        if (tDisp) tDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
          deskSeek.value = (cur / dur) * 100;
        }
      }
    });

    pgmVideoPlayerEl.addEventListener('play', () => {
      const isPgmTarget = (currentState?.activeVideo && selectedVideoItem && currentState.activeVideo.id === selectedVideoItem.id) ||
                          (currentState?.activeMedia && selectedVideoItem && currentState.activeMedia.id === selectedVideoItem.id);
      if (isPgmTarget && btnDeskPlay) {
        btnDeskPlay.textContent = '⏸ 原地暫停 (PGM)';
      }
    });

    pgmVideoPlayerEl.addEventListener('pause', () => {
      const isPgmTarget = (currentState?.activeVideo && selectedVideoItem && currentState.activeVideo.id === selectedVideoItem.id) ||
                          (currentState?.activeMedia && selectedVideoItem && currentState.activeMedia.id === selectedVideoItem.id);
      if (isPgmTarget && btnDeskPlay) {
        btnDeskPlay.textContent = '▶ 繼續播放 (PGM)';
      }
    });

    pgmVideoPlayerEl.addEventListener('ended', () => {
      dispatchAction('VIDEO_ENDED');
    });
  }

  if (btnDeskPlay) {
    btnDeskPlay.addEventListener('click', toggleUnifiedPlayback);
  }

  // 右下播控艙「🔊 純播放」按鈕 (不用排進 PGM 或 Preview，按了直接現場背景放音)
  const btnDeskPurePlay = document.getElementById('btnDeskMasterPurePlay');
  const bgPlayer = document.getElementById('bgAudioPlayer');

  if (btnDeskPurePlay) {
    btnDeskPurePlay.addEventListener('click', () => {
      if (!selectedVideoItem || selectedVideoItem.type !== 'audio') return;
      const dur = (Number.isFinite(bgPlayer?.duration) && bgPlayer.duration > 0)
        ? bgPlayer.duration
        : (deskVideoMaster?.duration || 1);
      const seekVal = deskSeek ? Number(deskSeek.value) : 0;
      const targetTime = (seekVal / 100) * dur;
      togglePurePlayAudio(selectedVideoItem, targetTime);
    });
  }

  // 頂部背景音訊標籤點擊暫停
  const bgAudioBadge = document.getElementById('bgAudioBadge');
  if (bgAudioBadge) {
    bgAudioBadge.addEventListener('click', () => {
      if (currentPurePlayingAudio) {
        togglePurePlayAudio(currentPurePlayingAudio);
      }
    });
  }

  // 避免進度桿拖曳時被 timeupdate 反向干擾覆蓋
  let isDraggingDeskSeek = false;
  if (deskSeek) {
    const markDragStart = () => { isDraggingDeskSeek = true; };
    const markDragEnd = () => { isDraggingDeskSeek = false; };
    deskSeek.addEventListener('pointerdown', markDragStart);
    deskSeek.addEventListener('pointerup', markDragEnd);
    deskSeek.addEventListener('mousedown', markDragStart);
    deskSeek.addEventListener('mouseup', markDragEnd);
    deskSeek.addEventListener('touchstart', markDragStart, { passive: true });
    deskSeek.addEventListener('touchend', markDragEnd);
  }

  // 純播放專用背景音訊播放器事件
  if (bgPlayer) {
    bgPlayer.addEventListener('timeupdate', () => {
      if (currentPurePlayingAudio && selectedVideoItem && selectedVideoItem.id === currentPurePlayingAudio.id) {
        const cur = bgPlayer.currentTime || 0;
        const dur = bgPlayer.duration || 1;
        const tDisp = document.getElementById('deskMasterVideoTimeDisplay');
        if (tDisp) tDisp.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        if (deskSeek && !deskSeek.matches(':active') && !isDraggingDeskSeek) {
          deskSeek.value = (cur / dur) * 100;
        }
      }
    });

    bgPlayer.addEventListener('ended', () => {
      currentPurePlayingAudio = null;
      if (deskSeek) deskSeek.value = 0;
      if (bgAudioBadge) bgAudioBadge.style.display = 'none';
      renderScheduleQueue(currentState);
      syncMediaDock(currentState);
    });
  }

  if (deskSeek) {
    const handleSeekInput = () => {
      const seekPercent = Number(deskSeek.value) / 100;
      const tDisp = document.getElementById('deskMasterVideoTimeDisplay');

      // 1. 若當前素材正在 PGM 播出中，拖動進度條直接推動 PGM 播放器與舞台螢幕！
      const isPgmTarget = (currentState?.activeVideo && selectedVideoItem && currentState.activeVideo.id === selectedVideoItem.id) ||
                          (currentState?.activeMedia && selectedVideoItem && currentState.activeMedia.id === selectedVideoItem.id);
      if (isPgmTarget) {
        const pgmVideoEl = document.getElementById('pgmVideoPlayer');
        if (pgmVideoEl) {
          const dur = pgmVideoEl.duration || 1;
          const targetTime = Math.max(0, Math.min(dur, seekPercent * dur));
          pgmVideoEl.currentTime = targetTime;
          if (tDisp) tDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
          dispatchAction('SEEK_PGM_VIDEO', { currentTime: targetTime, isPaused: pgmVideoEl.paused });
        }
        return;
      }

      // 2. 檢查此素材是否正在 PVW 預覽槽中 (長官鐵律：播放控制器跟 Preview 裡面的進度條應該是一樣的)
      const isPvwTarget = (currentState?.pvwVideo && selectedVideoItem && currentState.pvwVideo.id === selectedVideoItem.id) ||
                          (currentState?.pvwMedia && selectedVideoItem && currentState.pvwMedia.id === selectedVideoItem.id);

      if (selectedVideoItem && selectedVideoItem.type === 'audio') {
        const dur = (Number.isFinite(bgPlayer?.duration) && bgPlayer.duration > 0)
          ? bgPlayer.duration
          : ((Number.isFinite(pvwVideoEl?.duration) && pvwVideoEl.duration > 0) ? pvwVideoEl.duration : (deskVideoMaster?.duration || 1));
        const targetTime = Math.max(0, Math.min(dur, seekPercent * dur));

        if (bgPlayer) {
          bgPlayer.currentTime = targetTime;
        }
        if (deskVideoMaster) {
          deskVideoMaster.currentTime = targetTime;
        }
        if (tDisp) tDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;

        // 若在 PVW 預覽中，播控艙進度條與 Preview 預覽進度條 100% 鏡像連動！
        if (isPvwTarget && pvwVideoEl) {
          pvwVideoEl.currentTime = targetTime;
          if (pvwSeekSlider && !pvwSeekSlider.matches(':active')) {
            pvwSeekSlider.value = deskSeek.value;
          }
          const pvwTimeDisp = document.getElementById('pvwVideoTimeDisplay');
          if (pvwTimeDisp) pvwTimeDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
          dispatchAction('SEEK_PVW_VIDEO', { currentTime: targetTime, isPlaying: !pvwVideoEl.paused });
        }
      } else if (deskVideoMaster) {
        const dur = (Number.isFinite(pvwVideoEl?.duration) && pvwVideoEl.duration > 0 && isPvwTarget)
          ? pvwVideoEl.duration
          : (deskVideoMaster.duration || 1);
        const targetTime = Math.max(0, Math.min(dur, seekPercent * dur));
        deskVideoMaster.currentTime = targetTime;
        if (tDisp) tDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;

        // 若在 PVW 預覽中，播控艙進度條與 Preview 預覽進度條 100% 鏡像連動！
        if (isPvwTarget && pvwVideoEl) {
          pvwVideoEl.currentTime = targetTime;
          if (pvwSeekSlider && !pvwSeekSlider.matches(':active')) {
            pvwSeekSlider.value = deskSeek.value;
          }
          const pvwTimeDisp = document.getElementById('pvwVideoTimeDisplay');
          if (pvwTimeDisp) pvwTimeDisp.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
          dispatchAction('SEEK_PVW_VIDEO', { currentTime: targetTime, isPlaying: !pvwVideoEl.paused });
        }
      }
    };

    deskSeek.addEventListener('input', handleSeekInput);
    deskSeek.addEventListener('change', handleSeekInput);
  }

  if (btnDeskSendPvw) {
    btnDeskSendPvw.addEventListener('click', () => {
      if (selectedVideoItem) {
        const deskSeek = document.getElementById('deskMasterVideoSeek');
        const bgPlayer = document.getElementById('bgAudioPlayer');
        const seekPercent = deskSeek ? Number(deskSeek.value) / 100 : 0;

        let currentPlaybackTime = 0;
        let isCurrentlyPlaying = false;

        if (selectedVideoItem.type === 'audio') {
          const dur = (Number.isFinite(bgPlayer?.duration) && bgPlayer.duration > 0)
            ? bgPlayer.duration
            : (deskVideoMaster?.duration || 1);

          if (bgPlayer && !bgPlayer.paused && Number.isFinite(bgPlayer.currentTime)) {
            currentPlaybackTime = bgPlayer.currentTime;
            isCurrentlyPlaying = true;
          } else if (deskVideoMaster && !deskVideoMaster.paused && Number.isFinite(deskVideoMaster.currentTime)) {
            currentPlaybackTime = deskVideoMaster.currentTime;
            isCurrentlyPlaying = true;
          } else if (bgPlayer && Number.isFinite(bgPlayer.currentTime) && bgPlayer.currentTime > 0) {
            currentPlaybackTime = bgPlayer.currentTime;
          } else if (deskVideoMaster && Number.isFinite(deskVideoMaster.currentTime) && deskVideoMaster.currentTime > 0) {
            currentPlaybackTime = deskVideoMaster.currentTime;
          } else {
            currentPlaybackTime = seekPercent * dur;
          }

          dispatchAction('LOAD_MEDIA_PVW', {
            mediaId: selectedVideoItem.id,
            type: 'audio',
            currentTime: currentPlaybackTime,
            isPlaying: isCurrentlyPlaying
          });
        } else {
          const dur = deskVideoMaster?.duration || 1;
          if (deskVideoMaster && !deskVideoMaster.paused && Number.isFinite(deskVideoMaster.currentTime)) {
            currentPlaybackTime = deskVideoMaster.currentTime;
            isCurrentlyPlaying = true;
          } else if (deskVideoMaster && Number.isFinite(deskVideoMaster.currentTime) && deskVideoMaster.currentTime > 0) {
            currentPlaybackTime = deskVideoMaster.currentTime;
          } else {
            currentPlaybackTime = seekPercent * dur;
          }

          dispatchAction('LOAD_PVW_VIDEO', {
            videoId: selectedVideoItem.id,
            currentTime: currentPlaybackTime,
            isPlaying: isCurrentlyPlaying
          });
        }
      }
    });
  }

  if (btnDeskCutLive && deskVideoMaster) {
    btnDeskCutLive.addEventListener('click', () => {
      if (selectedVideoItem) {
        if (selectedVideoItem.type === 'audio') {
          dispatchAction('PLAY_MEDIA_PGM', {
            mediaId: selectedVideoItem.id,
            type: 'audio',
            startTime: deskVideoMaster.currentTime || 0
          });
        } else {
          dispatchAction('PLAY_VIDEO', {
            videoId: selectedVideoItem.id,
            startTime: deskVideoMaster.currentTime || 0
          });
        }
      }
    });
  }

  // 檔案抓取與拖曳加入流程 (方案 1)
  const dropZone = document.getElementById('mediaDropZone');
  const pickBtn = document.getElementById('btnPickMediaFiles');
  const dropInput = document.getElementById('mediaDropFileInput');

  if (pickBtn && dropInput) {
    pickBtn.addEventListener('click', () => dropInput.click());
    dropInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      enqueueFilesForUpload(files);
      dropInput.value = '';
    });
  }

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = Array.from(dt.files || []);
      enqueueFilesForUpload(files);
    });
  }

  // 鍵盤與無線簡報筆 (USB HID Presenter Remote) 全域翻頁與動畫推進支援
  let keyStepChain = Promise.resolve();
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (tag === 'INPUT') {
      const inputType = ((e.target.type) || '').toLowerCase();
      if (!['range', 'button', 'checkbox', 'radio', 'file'].includes(inputType)) return;
    }

    const key = e.key;
    // 簡報筆與鍵盤「下一頁 / 下一個動畫」：PageDown, ArrowRight, ArrowDown, Space, Enter, N
    if (
      key === 'PageDown' ||
      key === 'ArrowRight' ||
      key === 'ArrowDown' ||
      key === ' ' ||
      key === 'Spacebar' ||
      key === 'Enter' ||
      key === 'n' ||
      key === 'N'
    ) {
      e.preventDefault();
      e.stopPropagation();
      keyStepChain = keyStepChain.then(() => dispatchAction('PGM_NEXT')).catch(() => {});
      return;
    }

    // 簡報筆與鍵盤「上一頁 / 上一個動畫」：PageUp, ArrowLeft, ArrowUp, Backspace, P
    if (
      key === 'PageUp' ||
      key === 'ArrowLeft' ||
      key === 'ArrowUp' ||
      key === 'Backspace' ||
      key === 'p' ||
      key === 'P'
    ) {
      e.preventDefault();
      e.stopPropagation();
      keyStepChain = keyStepChain.then(() => dispatchAction('PGM_PREV')).catch(() => {});
      return;
    }

    // 簡報筆「黑屏鍵」：Period (.) 或 B
    if (key === '.' || key === 'b' || key === 'B') {
      e.preventDefault();
      e.stopPropagation();
      keyStepChain = keyStepChain.then(() => dispatchAction('TOGGLE_BLACK')).catch(() => {});
    }
  }, { capture: true });

  // 水平與垂直分隔條拖曳邏輯
  setupSplitters();
}

let isUploadingQueue = false;
const uploadQueue = [];

function enqueueFilesForUpload(fileList) {
  if (!fileList || fileList.length === 0) return;
  for (const f of fileList) {
    uploadQueue.push(f);
  }
  processUploadQueue();
}

async function processUploadQueue() {
  if (isUploadingQueue || uploadQueue.length === 0) return;
  isUploadingQueue = true;

  const countBadge = document.getElementById('scheduleCountBadge');
  const initialTotal = uploadQueue.length;
  let finishedCount = 0;

  while (uploadQueue.length > 0) {
    const file = uploadQueue.shift();
    finishedCount++;
    if (countBadge) {
      countBadge.textContent = `匯入中 (${finishedCount}/${initialTotal})...`;
    }

    try {
      await uploadSingleBinaryFile(file);
    } catch (err) {
      console.error('[UploadQueue] 檔案匯入失敗:', file.name, err);
      alert(`檔案「${file.name}」匯入失敗：${err.message}`);
    }
  }

  isUploadingQueue = false;

  // 全部傳輸完成後拉取最新狀態更新
  try {
    const res = await fetch('/api/state');
    const d = await res.json();
    if (d && d.state) {
      renderState(d.state);
    }
  } catch {}
}

async function uploadSingleBinaryFile(file) {
  const encodedName = encodeURIComponent(file.name);
  const res = await fetch(`/api/upload-media?filename=${encodedName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodedName
    },
    body: file
  });
  const data = await res.json();
  if (!data || !data.ok) {
    throw new Error(data?.error || '伺服器拒絕接收');
  }

  // 長官鐵律：新抓進來的檔案，若先前曾被移出隊列，強制自動解鎖 (從 removedFlowKeys 移除)！
  // 並自動置頂到現場隊列最前面，保證 100% 抓得進來且立即可見！
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  let prefix = 'ppt';
  if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) prefix = 'video';
  else if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) prefix = 'image';
  else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) prefix = 'audio';

  const baseId = file.name.replace(/\.[^/.]+$/, '');
  const candidateKeys = [
    `${prefix}:${baseId}`,
    `${prefix}:${file.name}`,
    `${prefix}:${data.fileName}`,
    `${prefix}:${data.fileName?.replace(/\.[^/.]+$/, '')}`
  ];

  const removed = getRemovedFlowKeys();
  const nextRemoved = removed.filter(k => !candidateKeys.includes(k));
  if (nextRemoved.length !== removed.length) {
    saveRemovedFlowKeys(nextRemoved);
  }

  const orderKeys = getFlowOrderKeys();
  const targetKey = `${prefix}:${baseId}`;
  const filteredOrder = orderKeys.filter(k => !candidateKeys.includes(k));
  saveFlowOrderKeys([targetKey, ...filteredOrder]);

  if (data.state) {
    renderState(data.state);
  }
  return data;
}

function uploadFileToPool(file) {
  enqueueFilesForUpload([file]);
}

function setupSplitters() {
  const vSplitter = document.getElementById('mainVerticalSplitter');
  const leftCol = document.getElementById('leftFlowColumn');
  const rightCol = document.getElementById('rightControlColumn');

  if (vSplitter && leftCol && rightCol) {
    let isDraggingV = false;
    vSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingV = true;
      document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingV) return;
      const totalWidth = window.innerWidth;
      const newLeftWidth = Math.min(Math.max(260, e.clientX), totalWidth - 400);
      const pct = (newLeftWidth / totalWidth) * 100;
      leftCol.style.flex = `0 0 ${pct}%`;
      rightCol.style.flex = `1 1 ${100 - pct}%`;
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingV) {
        isDraggingV = false;
        document.body.style.cursor = '';
      }
    });

    vSplitter.addEventListener('dblclick', () => {
      leftCol.style.flex = '0 0 36%';
      rightCol.style.flex = '1 1 64%';
    });
  }

  const hSplitter = document.getElementById('horizontalSplitter');
  const masterSection = document.querySelector('.master-deck-section');
  const mediaWorkspace = document.getElementById('rightMediaWorkspace');

  if (hSplitter && masterSection && mediaWorkspace) {
    let isDraggingH = false;
    hSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingH = true;
      document.body.style.cursor = 'row-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingH) return;
      const containerRect = document.querySelector('.main-deck-workspace').getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      const totalHeight = containerRect.height;
      const clampedY = Math.min(Math.max(240, relativeY), totalHeight - 160);
      masterSection.style.flex = `0 0 ${clampedY}px`;
      mediaWorkspace.style.flex = `1 1 ${totalHeight - clampedY - 10}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingH) {
        isDraggingH = false;
        document.body.style.cursor = '';
      }
    });

    hSplitter.addEventListener('dblclick', () => {
      masterSection.style.flex = '1 1 auto';
      mediaWorkspace.style.flex = '0 0 160px';
    });
  }
}

function formatTime(sec) {
  const s = Math.floor(sec || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

// ============================================================================
// 🪟 多視窗獨立彈出系統 (Multi-Window Pop-out Architecture)
// ============================================================================
const openedPopoutWins = new Map(); // viewName -> WindowProxy
let activePoppedViews = new Set();

function initPopoutSystem() {
  const urlParams = new URLSearchParams(window.location.search);
  const currentView = urlParams.get('view') || 'all';

  if (currentView !== 'all') {
    // 處於子視窗模式 (flow / monitors / dock)
    document.body.dataset.view = currentView;
    document.title = `PPT 現場導播控場台 · [${currentView.toUpperCase()}] 獨立視窗`;

    const appTitle = document.querySelector('.app-title');
    if (appTitle) {
      if (currentView === 'flow') appTitle.textContent = '📋 現場流程隊列 · 獨立視窗';
      if (currentView === 'monitors') appTitle.textContent = '🖥️ 主控雙監視器 · 獨立視窗';
      if (currentView === 'dock') appTitle.textContent = '🎛️ 多功能工作塢 · 獨立視窗';
    }

    const btnDockSelfIn = document.getElementById('btnDockSelfIn');
    if (btnDockSelfIn) {
      btnDockSelfIn.style.display = 'inline-flex';
      btnDockSelfIn.addEventListener('click', () => {
        window.close();
      });
    }

    // 子視窗隱藏母視窗專用控件
    const uiScale = document.getElementById('uiScaleControl');
    if (uiScale) uiScale.style.display = 'none';
    const btnPopoutAll = document.getElementById('btnPopoutAll');
    if (btnPopoutAll) btnPopoutAll.style.display = 'none';
    const btnSelectKv = document.getElementById('btnSelectKeyVisual');
    if (btnSelectKv && currentView !== 'monitors') btnSelectKv.style.display = 'none';
    const btnToggleKv = document.getElementById('btnToggleKvMode');
    if (btnToggleKv && currentView !== 'monitors') btnToggleKv.style.display = 'none';

    // 告知母視窗此子視窗已上線
    popoutSyncChannel?.postMessage({ type: 'POPOUT_HELLO', view: currentView });

    // 監聽關閉事件，告知母視窗已退場
    const notifyGoodbye = () => {
      popoutSyncChannel?.postMessage({ type: 'POPOUT_GOODBYE', view: currentView });
    };
    window.addEventListener('beforeunload', notifyGoodbye);
    window.addEventListener('pagehide', notifyGoodbye);

    // 監聽來自母視窗的收回全部指令
    if (popoutSyncChannel) {
      popoutSyncChannel.addEventListener('message', (ev) => {
        if (!ev.data) return;
        if (ev.data.type === 'DOCK_ALL_IN') {
          window.close();
        }
        if (ev.data.type === 'PURE_AUDIO_PLAY') {
          // 其他視窗正在播放背景音訊，本視窗靜音/暫停避免雙重回音
          const bgPlayer = document.getElementById('bgAudioPlayer');
          if (bgPlayer && !bgPlayer.paused) {
            bgPlayer.pause();
          }
          currentPurePlayingAudio = ev.data.audioItem;
          const bgBadge = document.getElementById('bgAudioBadge');
          if (bgBadge && ev.data.audioItem) {
            bgBadge.textContent = `🎵 背景音：${ev.data.audioItem.title || ev.data.audioItem.fileName}`;
            bgBadge.style.display = 'inline-flex';
          }
          if (currentState) {
            renderScheduleQueue(currentState);
            syncMediaDock(currentState);
          }
        }
        if (ev.data.type === 'PURE_AUDIO_PAUSE') {
          const bgBadge = document.getElementById('bgAudioBadge');
          if (bgBadge) bgBadge.style.display = 'none';
          if (currentState) {
            renderScheduleQueue(currentState);
            syncMediaDock(currentState);
          }
        }
      });
    }

    return; // 子視窗完成初始化
  }

  // --- 以下為母視窗 (view === 'all') 專屬邏輯 ---

  function updatePanelOverlay(viewName, isPopped) {
    if (isPopped) {
      activePoppedViews.add(viewName);
    } else {
      activePoppedViews.delete(viewName);
    }

    const overlayMap = {
      flow: document.getElementById('flowPoppedOverlay'),
      monitors: document.getElementById('monitorsPoppedOverlay'),
      dock: document.getElementById('dockPoppedOverlay')
    };

    const targetOverlay = overlayMap[viewName];
    if (targetOverlay) {
      targetOverlay.style.display = isPopped ? 'flex' : 'none';
    }

    const btnDockAllIn = document.getElementById('btnDockAllIn');
    if (btnDockAllIn) {
      btnDockAllIn.style.display = activePoppedViews.size > 0 ? 'inline-flex' : 'none';
    }
  }

  function openPopout(viewName) {
    const existing = openedPopoutWins.get(viewName);
    if (existing && !existing.closed) {
      existing.focus();
      return existing;
    }

    let w = 820, h = 600;
    if (viewName === 'flow') {
      w = 540; h = 860;
    } else if (viewName === 'monitors') {
      w = 1120; h = 700;
    } else if (viewName === 'dock') {
      w = 1000; h = 460;
    }

    const left = Math.max(20, window.screenX + (viewName === 'flow' ? 20 : viewName === 'monitors' ? 100 : 60));
    const top = Math.max(20, window.screenY + (viewName === 'flow' ? 40 : viewName === 'monitors' ? 40 : 420));
    const features = `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`;

    const childWin = window.open(`/?view=${viewName}`, `stage_deck_win_${viewName}`, features);
    if (childWin) {
      openedPopoutWins.set(viewName, childWin);
      updatePanelOverlay(viewName, true);
      childWin.focus();
    }
    return childWin;
  }

  function focusPopout(viewName) {
    const win = openedPopoutWins.get(viewName);
    if (win && !win.closed) {
      win.focus();
    } else {
      openPopout(viewName);
    }
  }

  function dockIn(viewName) {
    const win = openedPopoutWins.get(viewName);
    if (win && !win.closed) {
      win.close();
    }
    openedPopoutWins.delete(viewName);
    updatePanelOverlay(viewName, false);
  }

  function dockAllIn() {
    popoutSyncChannel?.postMessage({ type: 'DOCK_ALL_IN' });
    openedPopoutWins.forEach((win) => {
      try {
        if (win && !win.closed) win.close();
      } catch {}
    });
    openedPopoutWins.clear();
    ['flow', 'monitors', 'dock'].forEach((v) => updatePanelOverlay(v, false));
  }

  // 綁定各區塊彈出按鈕
  document.getElementById('btnPopoutFlow')?.addEventListener('click', () => openPopout('flow'));
  document.getElementById('btnPopoutMonitors')?.addEventListener('click', () => openPopout('monitors'));
  document.getElementById('btnPopoutDock')?.addEventListener('click', () => openPopout('dock'));

  // 頂部全部拆分與全部收回按鈕
  document.getElementById('btnPopoutAll')?.addEventListener('click', () => {
    openPopout('flow');
    setTimeout(() => openPopout('monitors'), 150);
    setTimeout(() => openPopout('dock'), 300);
  });
  document.getElementById('btnDockAllIn')?.addEventListener('click', dockAllIn);

  // 遮罩上的按鈕
  document.getElementById('btnFocusPopoutFlow')?.addEventListener('click', () => focusPopout('flow'));
  document.getElementById('btnDockInFlow')?.addEventListener('click', () => dockIn('flow'));

  document.getElementById('btnFocusPopoutMonitors')?.addEventListener('click', () => focusPopout('monitors'));
  document.getElementById('btnDockInMonitors')?.addEventListener('click', () => dockIn('monitors'));

  document.getElementById('btnFocusPopoutDock')?.addEventListener('click', () => focusPopout('dock'));
  document.getElementById('btnDockInDock')?.addEventListener('click', () => dockIn('dock'));

  // 監聽廣播同步狀態
  if (popoutSyncChannel) {
    popoutSyncChannel.addEventListener('message', (ev) => {
      if (!ev.data) return;
      if (ev.data.type === 'POPOUT_HELLO' && ev.data.view) {
        updatePanelOverlay(ev.data.view, true);
      } else if (ev.data.type === 'POPOUT_GOODBYE' && ev.data.view) {
        openedPopoutWins.delete(ev.data.view);
        updatePanelOverlay(ev.data.view, false);
      } else if (ev.data.type === 'PURE_AUDIO_PLAY') {
        const bgPlayer = document.getElementById('bgAudioPlayer');
        if (bgPlayer && !bgPlayer.paused) {
          bgPlayer.pause();
        }
        currentPurePlayingAudio = ev.data.audioItem;
        const bgBadge = document.getElementById('bgAudioBadge');
        if (bgBadge && ev.data.audioItem) {
          bgBadge.textContent = `🎵 背景音：${ev.data.audioItem.title || ev.data.audioItem.fileName}`;
          bgBadge.style.display = 'inline-flex';
        }
        if (currentState) {
          renderScheduleQueue(currentState);
          syncMediaDock(currentState);
        }
      } else if (ev.data.type === 'PURE_AUDIO_PAUSE') {
        const bgBadge = document.getElementById('bgAudioBadge');
        if (bgBadge) bgBadge.style.display = 'none';
        if (currentState) {
          renderScheduleQueue(currentState);
          syncMediaDock(currentState);
        }
      }
    });
  }

  // 週期性心跳檢測：子視窗若被使用者手動透過作業系統 ✕ 關閉，自動清除佔位遮罩
  setInterval(() => {
    openedPopoutWins.forEach((win, viewName) => {
      if (win && win.closed) {
        openedPopoutWins.delete(viewName);
        updatePanelOverlay(viewName, false);
      }
    });
  }, 1000);
}

function connectWs() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}/?client=desk`);
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'SHUTDOWN') {
        saveRemovedFlowKeys([]);
        saveFlowOrderKeys([]);
        window.close();
        return;
      }
      if (msg.type === 'STATE_UPDATE' && msg.data) {
        renderState(msg.data);
      }
    } catch {}
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 1500));
}

// ============================================================================
// 🚀 GitHub 自動更新與版本檢測模組 (Client-Side Update Sentinel)
// ============================================================================

function initUpdateSystem() {
  const btnVersionBadge = document.getElementById('btnVersionBadge');
  const updateModal = document.getElementById('updateModal');
  const btnCloseUpdateModal = document.getElementById('btnCloseUpdateModal');
  const btnDismissUpdateModal = document.getElementById('btnDismissUpdateModal');
  const btnCheckUpdateManual = document.getElementById('btnCheckUpdateManual');
  const btnStartPerformUpdate = document.getElementById('btnStartPerformUpdate');
  const btnOpenGithubRelease = document.getElementById('btnOpenGithubRelease');
  const currentVerText = document.getElementById('currentVerText');
  const latestVerText = document.getElementById('latestVerText');
  const updateNotesSection = document.getElementById('updateNotesSection');
  const updateNotesContent = document.getElementById('updateNotesContent');
  const updateStatusMsg = document.getElementById('updateStatusMsg');
  const updateProgressBar = document.getElementById('updateProgressBar');

  let currentCheckData = null;

  function openModal() {
    if (updateModal) updateModal.style.display = 'flex';
  }

  function closeModal() {
    if (updateModal) updateModal.style.display = 'none';
  }

  async function checkUpdate(silent = false, force = false) {
    if (!silent) {
      openModal();
      if (latestVerText) latestVerText.textContent = '檢測中...';
      if (updateStatusMsg) {
        updateStatusMsg.className = 'update-status-msg info';
        updateStatusMsg.textContent = '正在向 GitHub 查詢最新版本...';
        updateStatusMsg.style.display = 'block';
      }
      if (btnStartPerformUpdate) btnStartPerformUpdate.style.display = 'none';
      if (updateNotesSection) updateNotesSection.style.display = 'none';
    }

    try {
      const res = await fetch(`/api/check-update${force ? '?force=1' : ''}`);
      const data = await res.json();
      currentCheckData = data;

      if (data && data.currentVersion) {
        if (currentVerText) currentVerText.textContent = `v${data.currentVersion}`;
      }

      if (data && data.hasUpdate) {
        // 發現新版本！
        if (btnVersionBadge) {
          btnVersionBadge.classList.add('has-update');
          btnVersionBadge.textContent = `🟢 發現新版 v${data.latestVersion}`;
          btnVersionBadge.title = `有新版本 v${data.latestVersion} 可更新！點擊開啟更新視窗`;
        }

        if (!silent) {
          if (latestVerText) latestVerText.textContent = `v${data.latestVersion}`;
          if (updateNotesContent && data.releaseNotes) {
            updateNotesContent.textContent = data.releaseNotes;
            if (updateNotesSection) updateNotesSection.style.display = 'block';
          }
          if (updateStatusMsg) {
            updateStatusMsg.className = 'update-status-msg info';
            updateStatusMsg.textContent = `🎉 發現最新版本 v${data.latestVersion}！點擊下方按鈕即可一鍵更新。`;
            updateStatusMsg.style.display = 'block';
          }
          if (btnStartPerformUpdate) btnStartPerformUpdate.style.display = 'inline-flex';
          if (btnOpenGithubRelease) {
            btnOpenGithubRelease.href = data.releaseUrl || 'https://github.com/ytrt6545ytrt6545/ppt-stage-deck/releases';
            btnOpenGithubRelease.style.display = 'inline-flex';
          }
        }
      } else {
        // 已是最新版
        if (btnVersionBadge) {
          btnVersionBadge.classList.remove('has-update');
          btnVersionBadge.textContent = `v${data?.currentVersion || '1.0.0'}`;
          btnVersionBadge.title = `目前版本 v${data?.currentVersion || '1.0.0'} (已是最新版)`;
        }

        if (!silent) {
          const cur = data?.currentVersion || '1.0.0';
          if (latestVerText) latestVerText.textContent = `v${data?.latestVersion || cur} (已是最新版)`;
          if (updateStatusMsg) {
            updateStatusMsg.className = 'update-status-msg success';
            updateStatusMsg.textContent = '✅ 目前已是最新版本，系統運作正常。';
            updateStatusMsg.style.display = 'block';
          }
          if (btnStartPerformUpdate) btnStartPerformUpdate.style.display = 'none';
        }
      }
    } catch (err) {
      if (!silent && updateStatusMsg) {
        updateStatusMsg.className = 'update-status-msg error';
        updateStatusMsg.textContent = `⚠️ 連線 GitHub 檢查失敗: ${err.message}`;
        updateStatusMsg.style.display = 'block';
      }
    }
  }

  async function performUpdate() {
    if (!btnStartPerformUpdate) return;
    btnStartPerformUpdate.disabled = true;
    if (btnCheckUpdateManual) btnCheckUpdateManual.disabled = true;
    if (updateProgressBar) updateProgressBar.style.display = 'block';
    if (updateStatusMsg) {
      updateStatusMsg.className = 'update-status-msg info';
      updateStatusMsg.textContent = '🚀 正在下載最新更新包並熱覆蓋核心檔案，請勿關閉視窗...';
      updateStatusMsg.style.display = 'block';
    }

    try {
      const res = await fetch('/api/perform-update', { method: 'POST' });
      const data = await res.json();
      if (updateProgressBar) updateProgressBar.style.display = 'none';

      if (data && data.ok) {
        if (updateStatusMsg) {
          updateStatusMsg.className = 'update-status-msg success';
          updateStatusMsg.textContent = `✅ ${data.message || '更新完成！將在 3 秒後自動重新整理主控台...'}`;
          updateStatusMsg.style.display = 'block';
        }
        btnStartPerformUpdate.style.display = 'none';
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        if (updateStatusMsg) {
          updateStatusMsg.className = 'update-status-msg error';
          updateStatusMsg.textContent = `❌ 更新失敗: ${data?.error || '發生未知錯誤'}`;
          updateStatusMsg.style.display = 'block';
        }
        btnStartPerformUpdate.disabled = false;
        if (btnCheckUpdateManual) btnCheckUpdateManual.disabled = false;
      }
    } catch (err) {
      if (updateProgressBar) updateProgressBar.style.display = 'none';
      if (updateStatusMsg) {
        updateStatusMsg.className = 'update-status-msg error';
        updateStatusMsg.textContent = `❌ 更新請求發生錯誤: ${err.message}`;
        updateStatusMsg.style.display = 'block';
      }
      btnStartPerformUpdate.disabled = false;
      if (btnCheckUpdateManual) btnCheckUpdateManual.disabled = false;
    }
  }

  // 事件監聽綁定
  btnVersionBadge?.addEventListener('click', () => checkUpdate(false, false));
  btnCheckUpdateManual?.addEventListener('click', () => checkUpdate(false, true));
  btnStartPerformUpdate?.addEventListener('click', performUpdate);
  btnCloseUpdateModal?.addEventListener('click', closeModal);
  btnDismissUpdateModal?.addEventListener('click', closeModal);
  updateModal?.addEventListener('click', (e) => {
    if (e.target === updateModal) closeModal();
  });

  // 開機後延遲 1.5 秒執行靜默檢查
  setTimeout(() => checkUpdate(true, false), 1500);
}

// ============================================================================
// 📖 現場操作指引與系統解決方案彈窗 (Help Guide Sentinel)
// ============================================================================

function initHelpGuideSystem() {
  const btnOpenHelpModal = document.getElementById('btnOpenHelpModal');
  const helpModal = document.getElementById('helpModal');
  const btnCloseHelpModal = document.getElementById('btnCloseHelpModal');
  const btnDismissHelpModal = document.getElementById('btnDismissHelpModal');

  function openHelp() {
    if (helpModal) helpModal.style.display = 'flex';
  }

  function closeHelp() {
    if (helpModal) helpModal.style.display = 'none';
  }

  btnOpenHelpModal?.addEventListener('click', openHelp);
  btnCloseHelpModal?.addEventListener('click', closeHelp);
  btnDismissHelpModal?.addEventListener('click', closeHelp);
  helpModal?.addEventListener('click', (e) => {
    if (e.target === helpModal) closeHelp();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal && helpModal.style.display !== 'none') {
      closeHelp();
    }
  });
}

// 啟動入口
window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initPopoutSystem();
  initUpdateSystem();
  initHelpGuideSystem();
  connectWs();
  fetch('/api/state')
    .then((r) => r.json())
    .then((d) => {
      if (d && d.state) {
        renderState(d.state);
      }
    })
    .catch(() => {});
});
