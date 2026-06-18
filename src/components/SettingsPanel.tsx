/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Folder, Play, RefreshCw, Trash2, FileSpreadsheet, Sparkles, HelpCircle, UploadCloud, Smartphone, FileJson } from 'lucide-react';

interface SettingsPanelProps {
  scannedPath: string;
  setScannedPath: (path: string) => void;
  resultFilePath: string;
  setResultFilePath: (path: string) => void;
  onScan: (pathString: string) => Promise<void>;
  onGenerateDemo: () => Promise<void>;
  onResetAll: () => Promise<void>;
  isScanning: boolean;
  totalFiles: number;
  unlabeledCount: number;
  onUploadLocalAudios?: (files: File[]) => void;
}

export default function SettingsPanel({
  scannedPath,
  setScannedPath,
  resultFilePath,
  setResultFilePath,
  onScan,
  onGenerateDemo,
  onResetAll,
  isScanning,
  totalFiles,
  unlabeledCount,
  onUploadLocalAudios
 }: SettingsPanelProps) {
  const [localPath, setLocalPath] = useState(scannedPath || './demo_audios');
  const [localResultPath, setLocalResultPath] = useState(resultFilePath || './demo_audios/result.txt');
  const [showHelp, setShowHelp] = useState(true); // Default show help to guide user
  const [activeTab, setActiveTab] = useState<'browser' | 'server'>('browser'); // Default browser to guide quick online preview
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [browserLoadCount, setBrowserLoadCount] = useState(0);

  // Synchronize when parent updates path (e.g. on demo generation)
  React.useEffect(() => {
    if (scannedPath) setLocalPath(scannedPath);
  }, [scannedPath]);

  React.useEffect(() => {
    if (resultFilePath) setLocalResultPath(resultFilePath);
  }, [resultFilePath]);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onScan(localPath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!onUploadLocalAudios) return;

    const items = e.dataTransfer.items;
    if (!items) {
      if (e.dataTransfer.files) {
        const fileList = Array.from(e.dataTransfer.files) as File[];
        const supported = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
        const list = fileList.filter((f: File) => {
          const ext = f.name.split('.').pop()?.toLowerCase();
          return ext && supported.includes(ext);
        });
        if (list.length > 0) {
          onUploadLocalAudios(list);
        }
      }
      return;
    }

    setIsBrowserLoading(true);
    setBrowserLoadCount(0);

    const filesList: File[] = [];
    const entriesQueue: any[] = [];
    
    // Add all initial drop items to the queue
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          entriesQueue.push(entry);
        }
      }
    }

    try {
      let filesFound = 0;
      // Flat stack-based non-blocking loop prevents call-stack overflow on massive counts
      while (entriesQueue.length > 0) {
        const entry = entriesQueue.shift();
        if (!entry) continue;

        if (entry.isFile) {
          await new Promise<void>((resolveFile) => {
            entry.file(
              (file: File) => {
                const ext = file.name.split('.').pop()?.toLowerCase();
                const supported = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
                if (ext && supported.includes(ext)) {
                  filesList.push(file);
                  filesFound++;
                  // Batch counter updates dynamically to keep rendering smooth
                  if (filesFound % 100 === 0 || filesFound === 1) {
                    setBrowserLoadCount(filesFound);
                  }
                }
                resolveFile();
              },
              () => resolveFile()
            );
          });
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          const readBatch = (): Promise<any[]> => {
            return new Promise((resBatch) => {
              dirReader.readEntries(
                (entries) => {
                  resBatch(entries || []);
                },
                () => resBatch([])
              );
            });
          };

          let hasMore = true;
          while (hasMore) {
            const batchEntries = await readBatch();
            if (batchEntries.length > 0) {
              entriesQueue.push(...batchEntries);
            } else {
              hasMore = false;
            }
          }
        }
      }

      setIsBrowserLoading(false);
      if (filesList.length > 0) {
        onUploadLocalAudios(filesList);
      } else {
        alert("拖入的内容未包含任何支持的音频格式文件 (.mp3, .wav, .m4a, .ogg, .flac, .aac)！");
      }
    } catch (err) {
      setIsBrowserLoading(false);
      console.error("Scanning dropped directory error:", err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (onUploadLocalAudios) {
        setIsBrowserLoading(true);
        setBrowserLoadCount(0);
        
        // Defer parsing slightly so the CSS loader gets painted first
        setTimeout(() => {
          const fileList: File[] = Array.from(e.target.files || []);
          const supported = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
          const list = fileList.filter((f: File) => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext && supported.includes(ext);
          });
          
          setIsBrowserLoading(false);
          if (list.length > 0) {
            onUploadLocalAudios(list);
          } else {
            alert("没有检测到合规的音频文件 (.mp3, .wav, .m4a, .ogg, .flac, .aac)！");
          }
        }, 150);
      }
    }
  };

  return (
    <div id="settings-panel" className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-5 relative">
      {isBrowserLoading && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-xs flex flex-col items-center justify-center z-50 rounded-xl space-y-4 animate-fadeIn">
          <div className="relative">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <Folder className="w-5 h-5 text-indigo-600 absolute inset-0 m-auto" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-slate-800">正在智能解析并载入本地音频...</p>
            <p className="text-xs text-indigo-600 font-mono font-bold">已发现并读取 {browserLoadCount} 个支持的音轨</p>
            <p className="text-[10px] text-slate-400">正在非阻塞式将源文件导入内存，请勿关闭或刷新此页面</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-slate-100 text-slate-700 rounded-md">
            <Folder className="w-5 h-5" />
          </div>
          <h2 className="font-semibold text-slate-800 text-md">1. 音频加载(双模式选择)</h2>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors font-semibold"
        >
          <HelpCircle className="w-4 h-4" />
          {showHelp ? "收起说明" : "查看说明 / 手机识别"}
        </button>
      </div>

      {showHelp && (
        <div className="bg-indigo-50/70 text-slate-700 text-xs rounded-lg p-4 leading-relaxed space-y-3 border border-indigo-100 animate-fadeIn">
          <div>
            <p className="font-bold text-indigo-950 flex items-center gap-1">
              <Smartphone className="w-4 h-4 text-indigo-600" />
              Q1: 本机或手机屏幕是如何识别的？
            </p>
            <p className="text-indigo-900/95 ml-5 mt-1">
              <strong>自动识别原理：</strong>手机上的婴儿哭声识别 App 被安放于播音电脑旁。有两种连接模式：
              <br />• <strong>剪贴板同步：</strong>使用跨端同步工具（如 Web/手机共享剪贴板，或 ADB 输入监听。每次手机 App 识别出诸如 “Feed / 饥饿” 并复制，页面将瞬间捕获并完成当前音频打标，无需人工干预！
              <br />• <strong>结果文本输出（OCR / API）：</strong>电脑端开启 <code>scrcpy</code> 实时投影手机画面，电脑运行 Python 脚本采用后台 OCR（例如 EasyOCR / Tesseract）持续截屏手机窗口并把辨识到的词流写入本地 <code>result.txt</code>，本端即可触发秒级轮询完成自动打标！
            </p>
          </div>

          <div className="border-t border-indigo-100/80 pt-2 text-indigo-900/95">
            <p className="font-bold text-indigo-950">Q2: 为什么输入框里不能直接选自己的文件夹？</p>
            <p className="ml-5 mt-1">
              <strong>沙盒运行机制保障：</strong>您当前在 Google AI Studio 的 **网页云端预览环境**，出于浏览器的安全边界沙箱设计，云端服务器是<strong>无法访问您个人电脑的物理 C盘/D盘 或 macOS 文件夹的</strong>！
              <br />
              <strong>两步解决使用限制：</strong>
              <br />
              1. <strong>极速云端体验（直接上传）：</strong>请直接在下方切换到 <code>[选择自己的文件直接加载]</code> 标签页，<strong>点选或拖入电脑上的任意音频</strong>即可在网页中直接试听和标注！
              <br />
              2. <strong>本地执行（递归扫描目录）：</strong>您可以导出项目代码，在本地终端运行 <code>npm start</code>，打开 <code>http://localhost:3000</code>，Node 就会完美读取任意本机路径了！
            </p>
          </div>
        </div>
      )}

      {/* Mode / Tabs selectors */}
      <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('browser')}
          className={`flex-1 text-center py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${
            activeTab === 'browser' ? 'bg-white text-indigo-900 shadow-xs border-b border-black/5' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🌐 直接选/拖入自己的音频(推荐预览)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('server')}
          className={`flex-1 text-center py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${
            activeTab === 'server' ? 'bg-white text-indigo-900 shadow-xs border-b border-black/5' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          🖥️ 本地绝对路径扫描(适合本地运行)
        </button>
      </div>

      {/* Tab: Browser direct upload click/drop */}
      {activeTab === 'browser' && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">
            在浏览器中直接载入本机任意文件夹，自动递归统计并识别所有音频文件：
          </label>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Standard file selector box */}
            <div
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-all relative group flex flex-col items-center justify-center min-h-[140px] cursor-pointer ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50/70'
                  : 'border-slate-300 hover:border-indigo-400 bg-slate-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                multiple
                accept="audio/*"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-indigo-500 transition-colors mb-2" />
              <p className="text-xs font-bold text-slate-700">点击 或 拖放音频到此</p>
              <p className="text-[11px] text-slate-400 mt-1">支持把一整个文件夹直接拖进来</p>
            </div>

            {/* Folder selection box using webkitdirectory */}
            <div
              className="border-2 border-dashed border-slate-300 hover:border-emerald-400 bg-slate-50 rounded-xl p-5 text-center transition-all relative group flex flex-col items-center justify-center min-h-[140px] cursor-pointer"
            >
              <input
                type="file"
                {...{
                  webkitdirectory: "",
                  directory: ""
                } as any}
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Folder className="w-10 h-10 text-slate-400 group-hover:text-emerald-500 transition-colors mb-2" />
              <p className="text-xs font-bold text-slate-700 font-sans">点击选择整个音频文件夹</p>
              <p className="text-[11px] text-slate-400 mt-1">支持本机多级文件夹深度读取</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Server Scan relative/absolute folders */}
      {activeTab === 'server' && (
        <form onSubmit={handleScanSubmit} className="space-y-2 animate-fadeIn">
          <label className="block text-xs font-semibold text-slate-600">
            音频文件夹绝对路径 (仅适用于电脑本地终端 <code>npm start</code> 后)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="例如:/Users/name/Music/baby 或 C:\Music\baby"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pl-9 text-xs focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-800 font-mono"
              />
              <span className="absolute left-3 top-2.5 text-slate-400">
                <Folder className="w-4 h-4" />
              </span>
            </div>
            <button
              type="submit"
              disabled={isScanning}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? '扫描中...' : '扫描服务端'}
            </button>
          </div>
        </form>
      )}

      {/* Result File Path Configurator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold text-slate-600">
            文件监听模式配置：<code>result.txt</code> 绝对路径
          </label>
          <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-mono">
            全自动监听
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={localResultPath}
            onChange={(e) => setLocalResultPath(e.target.value)}
            placeholder="例如: /Users/name/baby/result.txt"
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-800 font-mono"
          />
          <button
            type="button"
            onClick={() => setResultFilePath(localResultPath)}
            className="border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-xs px-3 py-2 rounded-lg transition-colors"
          >
            保存文件路径
          </button>
        </div>
      </div>

      {/* Interactive Helper & Download Actions */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onGenerateDemo}
          className="w-full flex items-center justify-center gap-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 rounded-lg p-2.5 text-xs font-semibold transition-all shadow-2xs hover:shadow-xs group"
        >
          <Sparkles className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" />
          <span>生成演示音频(WAV)</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <a
            href="/api/download-csv"
            className="flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100 rounded-lg p-2.5 text-xs font-semibold transition-all shadow-2xs hover:shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>导出 CSV 标签</span>
          </a>

          <a
            href="/api/download-json"
            className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-lg p-2.5 text-xs font-semibold transition-all shadow-2xs hover:shadow-xs"
          >
            <FileJson className="w-4 h-4 text-indigo-500" />
            <span>导出 JSON 标签</span>
          </a>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="flex items-center justify-between bg-red-50/70 border border-red-100 rounded-lg p-3">
        <div className="space-y-0.5">
          <h4 className="text-xs font-semibold text-red-800">重置标记会话</h4>
          <p className="text-[10px] text-red-600">擦除 progress.json 及 CSV 文件内容</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("确定要删除本地标注 CSV 与 progress.json 吗？此操作无法撤销。")) {
              onResetAll();
            }
          }}
          className="bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-md p-1.5 hover:text-red-700 transition-all shadow-3xs hover:shadow-2xs"
          title="清空标记数据"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Summary Counts */}
      {totalFiles > 0 && (
        <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-3 text-xs flex justify-between items-center text-slate-600 font-medium">
          <span>总共扫描到: <strong className="text-slate-800 font-mono text-sm">{totalFiles}</strong> 首音频</span>
          <span>未标注: <strong className="text-indigo-600 font-mono text-sm">{unlabeledCount}</strong> 首</span>
        </div>
      )}
    </div>
  );
}
