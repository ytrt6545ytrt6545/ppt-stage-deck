import http from 'http';
import WebSocket from 'ws';

console.log('====================================================');
console.log('🕵️ PPT Stage Deck 記憶體與網路 Payload 即時偵測黑匣子啟動');
console.log('====================================================');

function checkHttpState() {
  const req = http.get('http://127.0.0.1:8890/api/state', (res) => {
    let size = 0;
    res.on('data', (c) => { size += c.length; });
    res.on('end', () => {
      console.log(`[HTTP /api/state] 回傳狀態正常 | Payload 大小: ${(size / 1024).toFixed(2)} KB`);
    });
  });
  req.on('error', (err) => {
    // 伺服器可能尚未啟動
  });
}

let ws = null;
function connectWs() {
  ws = new WebSocket('ws://127.0.0.1:8890/?client=monitor');
  ws.on('open', () => {
    console.log('✅ 成功掛載 WebSocket 監聽通道！等待攔截推播訊息...');
  });
  ws.on('message', (data) => {
    const len = data.length;
    console.log(`📡 [WS 推播偵測] 收到封包體積: ${(len / 1024).toFixed(2)} KB`);
    if (len > 500 * 1024) {
      console.warn(`⚠️ [高危巨型封包警報] 單一 WS 封包超過 500KB (${(len / 1024).toFixed(2)} KB)！這會直接灌爆前端記憶體！`);
      try {
        const json = JSON.parse(data.toString());
        if (json.data && json.data.pptPool) {
          console.log(`   簡報池數量: ${json.data.pptPool.length}`);
          json.data.pptPool.forEach(p => {
            console.log(`   - 簡報 [${p.id}]: 共 ${p.slideCount} 頁`);
            if (p.slides && p.slides.length > 50) {
              console.warn(`     🚨 簡報 ${p.id} 頁數高達 ${p.slides.length} 頁！若前端一次渲染所有投影片縮圖 DOM，會引發瀏覽器 OOM！`);
            }
          });
        }
      } catch (e) {
        console.error('JSON 解析異常:', e.message);
      }
    }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    setTimeout(connectWs, 2000);
  });
}

setInterval(checkHttpState, 3000);
connectWs();

