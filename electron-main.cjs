const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let serverProcess = null;
let mainWindow = null;

// Determine if we're running in packaged production mode
const isProd = app.isPackaged;

function startBackend() {
  if (isProd) {
    // In production, run the bundled, self-contained distributor server
    const serverPath = path.join(__dirname, 'dist', 'server.cjs');
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '3124' // Use separate port in desktop shell to prevent 3000 collision
      }
    });
  } else {
    // In development mode, spin up the typescript development engine
    const serverPath = path.join(__dirname, 'server.ts');
    serverProcess = fork(
      path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      [serverPath],
      {
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PORT: '3124'
        }
      }
    );
  }

  serverProcess.on('error', (err) => {
    console.error('Failed to start native labeling server backend process:', err);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: '婴儿哭声精准标注系统 (Vite-Express Native App)',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Necessary for loading direct disk files via localhost stream safely
    }
  });

  // Customize native app menu
  const template = [
    {
      label: '文件 (File)',
      submenu: [
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑 (Edit)',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图 (View)',
      submenu: [
        { label: '重载页面', role: 'reload' },
        { label: '强制刷新', role: 'forceReload' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '进入/退出全屏', role: 'togglefullscreen' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Load backend url (Express handles local SPA router fallback)
  const appUrl = 'http://127.0.0.1:3124';

  const loadPage = () => {
    mainWindow.loadURL(appUrl).then(() => {
      mainWindow.show();
    }).catch(() => {
      // Retry in 1 second if backend still launching
      setTimeout(loadPage, 1000);
    });
  };

  // Wait extra time for the multi-functional system to warm up
  setTimeout(loadPage, 1500);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
