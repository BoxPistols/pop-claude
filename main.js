/**
 * Claude Guard - メインプロセス
 * Claude Codeのコマンドをインターセプトして許可/拒否するmacOSメニューバーアプリ
 */

const { app, Menu, Tray, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── 設定 ────────────────────────────────────────────────
const PORT = 3759; // Claude Guard専用ポート
const MAX_QUEUE = 50;
const AUTO_APPROVE_TIMEOUT_MS = 30_000; // 30秒でタイムアウト → デフォルト拒否

// ─── 状態管理 ────────────────────────────────────────────
let tray = null;
let popupWindow = null;
let pendingRequests = new Map(); // id → { resolve, meta, timer }
let requestHistory = [];
let settings = loadSettings();

function loadSettings() {
  const settingsPath = path.join(os.homedir(), '.claude-guard', 'settings.json');
  const defaults = {
    autoApprove: false,
    alwaysOnTop: true,
    showNotifications: true,
    trustedCommands: ['ls', 'cat', 'echo', 'pwd', 'git status', 'git log'],
    blockedPatterns: ['rm -rf /', 'sudo rm', '> /dev/sda'],
    theme: 'dark',
  };
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
    }
  } catch {}
  return defaults;
}

function saveSettings() {
  const dir = path.join(os.homedir(), '.claude-guard');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  );
}

// ─── HTTP サーバー (Claude Code hooks から呼ばれる) ────────
function startHookServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', pending: pendingRequests.size }));
      return;
    }

    if (req.method === 'GET' && req.url === '/history') {
      res.writeHead(200);
      res.end(JSON.stringify(requestHistory.slice(-100)));
      return;
    }

    if (req.method === 'POST' && req.url === '/approve') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { id, approved } = JSON.parse(body);
          resolveRequest(id, approved);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // メインエンドポイント: コマンド許可リクエスト
    if (req.method === 'POST' && req.url === '/check') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const meta = JSON.parse(body);
          const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          // 自動承認チェック
          const autoResult = checkAutoRules(meta);
          if (autoResult !== null) {
            recordHistory(meta, autoResult, 'auto');
            res.writeHead(200);
            res.end(JSON.stringify({ id, approved: autoResult, reason: 'auto' }));
            return;
          }

          // ユーザー確認待ち
          const approved = await waitForUserApproval(id, meta);
          recordHistory(meta, approved, 'user');
          res.writeHead(200);
          res.end(JSON.stringify({ id, approved }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Claude Guard hook server running on port ${PORT}`);
    updateTrayMenu();
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
    }
  });

  return server;
}

function checkAutoRules(meta) {
  const cmd = (meta.command || meta.tool || '').toLowerCase();

  // ブロックパターンチェック
  for (const pattern of settings.blockedPatterns) {
    if (cmd.includes(pattern.toLowerCase())) return false;
  }

  // 自動承認コマンドチェック
  if (settings.autoApprove) return true;
  for (const trusted of settings.trustedCommands) {
    if (cmd.startsWith(trusted.toLowerCase())) return true;
  }

  return null; // ユーザー確認が必要
}

function waitForUserApproval(id, meta) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false); // タイムアウト → 拒否
      pendingRequests.delete(id);
      updatePopupWindow();
    }, AUTO_APPROVE_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, meta, timer, timestamp: Date.now() });
    showPopupWindow();
    updatePopupWindow();
    updateTrayMenu();
  });
}

function resolveRequest(id, approved) {
  const pending = pendingRequests.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.resolve(approved);
  pendingRequests.delete(id);
  updatePopupWindow();
  updateTrayMenu();
}

function recordHistory(meta, approved, method) {
  requestHistory.push({
    ...meta,
    approved,
    method,
    timestamp: new Date().toISOString(),
  });
  if (requestHistory.length > MAX_QUEUE) {
    requestHistory = requestHistory.slice(-MAX_QUEUE);
  }
}

// ─── Tray (メニューバー) ──────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'tray-iconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Claude Guard');
  tray.on('click', () => showPopupWindow());
  updateTrayMenu();
}

function updateTrayTitle() {
  if (!tray) return;
  const count = pendingRequests.size;
  tray.setTitle(count > 0 ? ' ' + count : '');
}

function updateTrayMenu() {
  if (!tray) return;

  const pendingCount = pendingRequests.size;
  const pendingItems = [...pendingRequests.entries()].map(([id, { meta }]) => ({
    label: `⏳ ${truncate(meta.command || meta.tool || 'unknown', 40)}`,
    click: () => showPopupWindow(),
  }));

  const menuItems = [
    {
      label: `Claude Guard`,
      enabled: false,
    },
    { type: 'separator' },
    pendingCount > 0
      ? { label: `🔴 ${pendingCount}件の承認待ち`, click: () => showPopupWindow() }
      : { label: '✅ 待機中', enabled: false },
    ...(pendingItems.length > 0 ? [{ type: 'separator' }, ...pendingItems.slice(0, 5)] : []),
    { type: 'separator' },
    {
      label: '全て承認',
      enabled: pendingCount > 0,
      click: () => approveAll(true),
    },
    {
      label: '全て拒否',
      enabled: pendingCount > 0,
      click: () => approveAll(false),
    },
    { type: 'separator' },
    {
      label: '自動承認モード',
      type: 'checkbox',
      checked: settings.autoApprove,
      click: (item) => {
        settings.autoApprove = item.checked;
        saveSettings();
        updateTrayMenu();
      },
    },
    {
      label: 'パネルを開く',
      click: () => showPopupWindow(),
    },
    {
      label: '履歴を表示',
      click: () => showHistoryWindow(),
    },
    { type: 'separator' },
    {
      label: 'Claude Guard を終了',
      click: () => app.quit(),
    },
  ];

  const menu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(menu);

  updateTrayTitle();
}

function approveAll(approved) {
  for (const [id] of pendingRequests) {
    resolveRequest(id, approved);
  }
}

// ─── ポップアップウィンドウ ───────────────────────────────
function showPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
    return;
  }

  popupWindow = new BrowserWindow({
    width: 520,
    height: 640,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: settings.alwaysOnTop,
    backgroundColor: '#0D1117',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const htmlPath = path.join(__dirname, 'popup.html');
  popupWindow.loadFile(htmlPath);

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
    updatePopupWindow();
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

function showHistoryWindow() {
  const win = new BrowserWindow({
    width: 700,
    height: 500,
    backgroundColor: '#0D1117',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.loadFile(path.join(__dirname, 'history.html'));
}

function updatePopupWindow() {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const requests = [...pendingRequests.entries()].map(([id, { meta, timestamp }]) => ({
    id,
    ...meta,
    timestamp,
    elapsed: Date.now() - timestamp,
    timeoutIn: AUTO_APPROVE_TIMEOUT_MS - (Date.now() - timestamp),
  }));
  popupWindow.webContents.send('update-requests', requests);
}

// ─── IPC ──────────────────────────────────────────────────
ipcMain.on('approve', (event, id) => resolveRequest(id, true));
ipcMain.on('reject', (event, id) => resolveRequest(id, false));
ipcMain.on('approve-all', () => approveAll(true));
ipcMain.on('reject-all', () => approveAll(false));
ipcMain.on('get-settings', (event) => event.reply('settings', settings));
ipcMain.on('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  updateTrayMenu();
});
ipcMain.on('get-history', (event) => event.reply('history', requestHistory.slice(-50)));
ipcMain.on('close-window', () => {
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
});

// ─── ユーティリティ ───────────────────────────────────────
function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ─── App 起動 ─────────────────────────────────────────────
app.whenReady().then(() => {
  app.dock?.hide(); // macOS: Dock非表示

  startHookServer();
  createTray();

  // 初回起動時にセットアップガイドを表示
  const firstRunFlag = path.join(os.homedir(), '.claude-guard', '.initialized');
  if (!fs.existsSync(firstRunFlag)) {
    showPopupWindow();
    fs.mkdirSync(path.dirname(firstRunFlag), { recursive: true });
    fs.writeFileSync(firstRunFlag, '');
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // メニューバーアプリなので終了しない
});
