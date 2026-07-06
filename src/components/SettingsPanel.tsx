/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Folder, Play, RefreshCw, Trash2, FileSpreadsheet, Sparkles, HelpCircle, UploadCloud, Smartphone, FileJson } from 'lucide-react';
import { Language, getTranslations } from '../lib/i18n';

interface SettingsPanelProps {
  lang: Language;
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
  onUploadLocalAudios?: (files: File[], isDragAndDrop?: boolean) => void;
  intervalSeconds: number;
  setIntervalSeconds: (seconds: number) => void;
  onExportCSV?: () => void;
  onExportJSON?: () => void;
  hasUnexportedData?: boolean;
}

export default function SettingsPanel({
  lang,
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
  onUploadLocalAudios,
  intervalSeconds,
  setIntervalSeconds,
  onExportCSV,
  onExportJSON,
  hasUnexportedData
 }: SettingsPanelProps) {
  const t = getTranslations(lang);
  
  const formatInterval = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (lang === 'zh') {
      if (m === 0) return `当前：${seconds} 秒（${s} 秒）`;
      const minStr = `${m} 分钟`;
      const secStr = s > 0 ? ` ${s} 秒` : '';
      return `当前：${seconds} 秒（${minStr}${secStr}）`;
    } else {
      if (m === 0) return `Current: ${seconds} seconds (${s} sec)`;
      const minStr = `${m} min`;
      const secStr = s > 0 ? ` ${s} sec` : '';
      return `Current: ${seconds} seconds (${minStr}${secStr})`;
    }
  };

  const [localPath, setLocalPath] = useState(scannedPath || './demo_audios');
  const [localResultPath, setLocalResultPath] = useState(resultFilePath || './demo_audios/result.txt');
  const [showHelp, setShowHelp] = useState(false); // Default help collapsed by default as requested
  const [activeTab, setActiveTab] = useState<'browser' | 'server'>('browser'); // Default browser to guide quick online preview
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [browserLoadCount, setBrowserLoadCount] = useState(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
          onUploadLocalAudios(list, true);
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
                  let relPath = entry.fullPath || '';
                  if (relPath.startsWith('/')) {
                    relPath = relPath.slice(1);
                  }
                  try {
                    Object.defineProperty(file, 'webkitRelativePath', {
                      value: relPath,
                      writable: true,
                      enumerable: true,
                      configurable: true
                    });
                  } catch (e) {
                    (file as any).webkitRelativePath = relPath;
                  }
                  (file as any).relativePath = relPath;

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
        onUploadLocalAudios(filesList, true);
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
      const capturedFiles = Array.from(e.target.files) as File[];
      const targetInput = e.target;
      
      if (onUploadLocalAudios) {
        setIsBrowserLoading(true);
        setBrowserLoadCount(0);
        
        // Defer parsing slightly so the CSS loader gets painted first
        setTimeout(() => {
          const supported = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
          const list = capturedFiles.filter((f: File) => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext && supported.includes(ext);
          });
          
          setIsBrowserLoading(false);
          if (list.length > 0) {
            onUploadLocalAudios(list, false);
          } else {
            alert("没有检测到合规的音频文件 (.mp3, .wav, .m4a, .ogg, .flac, .aac)！");
          }
          // Reset input value after deferred parsing completes so the change handler triggers on identical selection next time
          try {
            targetInput.value = '';
          } catch (err) {
            console.error("Error resetting file input value:", err);
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
            <p className="text-sm font-bold text-slate-800">
              {lang === 'zh' ? '正在智能解析并载入本地音频...' : 'Parsing and loading local audios...'}
            </p>
            <p className="text-xs text-indigo-600 font-mono font-bold">
              {lang === 'zh' ? `已发现并读取 ${browserLoadCount} 个支持的音轨` : `Found and read ${browserLoadCount} supported tracks`}
            </p>
            <p className="text-[10px] text-slate-400">
              {lang === 'zh' ? '正在非阻塞式将源文件导入内存，请勿关闭或刷新此页面' : 'Importing files into memory non-blockingly, do not close or reload.'}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-slate-100 text-slate-700 rounded-md">
            <Folder className="w-5 h-5" />
          </div>
          <h2 className="font-semibold text-slate-800 text-md">
            {lang === 'zh' ? '1. 音频加载(双模式选择)' : '1. Audio Loading (Dual Mode Selection)'}
          </h2>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors font-semibold"
        >
          <HelpCircle className="w-4 h-4" />
          {showHelp 
            ? (lang === 'zh' ? '收起说明' : 'Hide Help') 
            : (lang === 'zh' ? '展开说明' : 'Expand Help')}
        </button>
      </div>

      {showHelp && (
        <div className="bg-indigo-50/70 text-slate-700 text-xs rounded-lg p-4 leading-relaxed space-y-3 border border-indigo-100 animate-fadeIn">
          <div>
            <p className="font-bold text-indigo-950 flex items-center gap-1">
              <Smartphone className="w-4 h-4 text-indigo-600" />
              {lang === 'zh' ? 'Q1: 本机或手机屏幕是如何识别的？' : 'Q1: How is the local screen or mobile screen recognized?'}
            </p>
            <p className="text-indigo-900/95 ml-5 mt-1">
              <strong>{lang === 'zh' ? '自动识别原理：' : 'Auto Recognition Principle: '}</strong>
              {lang === 'zh' ? (
                <>手机上的婴儿哭声识别 App 被安放于播音电脑旁。有两种连接模式：
                <br />• <strong>剪贴板同步：</strong>使用跨端同步工具（如 Web/手机共享剪贴板，或 ADB 输入监听。每次手机 App 识别出诸如 “Feed / 饥饿” 并复制，页面将瞬间捕获并完成当前音频打标，无需人工干预！
                <br />• <strong>结果文本输出（OCR / API）：</strong>电脑端开启 <code>scrcpy</code> 实时投影手机画面，电脑运行 Python 脚本采用后台 OCR（例如 EasyOCR / Tesseract）持续截屏手机窗口并把辨识到的词流写入本地 <code>result.txt</code>，本端即可触发秒级轮询完成自动打标！</>
              ) : (
                <>Place the baby cry translator App on your smartphone next to the speaker. Connect with:
                <br />• <strong>Clipboard Sync:</strong> Use cross-device clipboard sync or ADB listener. Whenever the phone app recognizes a state (e.g., "Feed / Hungry") and copies it, this dashboard intercepts it and saves instantly!
                <br />• <strong>File Log (OCR / API):</strong> Project your screen with <code>scrcpy</code>, run the offline Python OCR helper script, which continuously captures screenshots and writes matching tags to <code>result.txt</code> for instant polling!</>
              )}
            </p>
          </div>

          <div className="border-t border-indigo-100/80 pt-2 text-indigo-900/95">
            <p className="font-bold text-indigo-950">
              {lang === 'zh' ? 'Q2: 为什么我的文件夹路径输入后扫描不到文件？' : 'Q2: Why are files not found after entering my folder path?'}
            </p>
            <p className="ml-5 mt-1">
              {lang === 'zh' ? (
                <>请确认以下几点：
                <br />• <strong>填写的是完整的绝对路径：</strong>
                <br />&nbsp;&nbsp;（Mac 示例：<code>/Users/您的用户名/Music/baby</code>）
                <br />&nbsp;&nbsp;（Windows 示例：<code>C:\Users\您的用户名\Music\baby</code>）
                <br />• <strong>路径中不含中文或特殊字符：</strong>确保整个文件夹名称路径全部为英文字符或数字
                <br />• <strong>文件夹内有支持的音频格式：</strong>支持的文件后缀包括 <code>.mp3 .wav .m4a .ogg .flac .aac</code>
                <br /><br />
                如果依然无法使用路径扫描，可切换到下方<strong>「直接选/拖入自己的音频」</strong>标签页，直接拖入或点选电脑上的音频文件即可。</>
              ) : (
                <>Please confirm the following:
                <br />• <strong>Ensure you have entered a complete absolute path:</strong>
                <br />&nbsp;&nbsp;(Mac example: <code>/Users/yourusername/Music/baby</code>)
                <br />&nbsp;&nbsp;(Windows example: <code>C:\Users\yourusername\Music\baby</code>)
                <br />• <strong>Ensure the path contains no special or native characters:</strong> Check that directory names are in English/alphanumeric characters.
                <br />• <strong>Ensure the folder contains supported audio formats:</strong> Files must be formatted as <code>.mp3 .wav .m4a .ogg .flac .aac</code>
                <br /><br />
                If path scanning cannot be used, you can easily switch to the <strong>"Direct Upload / Drop Audios"</strong> tab below, and drag & drop or select the audio files directly from your computer.</>
              )}
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
          {lang === 'zh' ? '🌐 直接选/拖入自己的音频(推荐)' : '🌐 Direct Upload / Drop Audios'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('server')}
          className={`flex-1 text-center py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${
            activeTab === 'server' ? 'bg-white text-indigo-900 shadow-xs border-b border-black/5' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {lang === 'zh' ? '🖥️ 本地绝对路径扫描' : '🖥️ Absolute Directory Path'}
        </button>
      </div>

      {/* Tab: Browser direct upload click/drop */}
      {activeTab === 'browser' && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">
            {lang === 'zh' ? '在浏览器中直接载入本机任意文件夹，自动递归统计并识别所有音频文件：' : 'Directly load folders or files recursively in the browser:'}
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
              <p className="text-xs font-bold text-slate-700">
                {lang === 'zh' ? '点击 或 拖放音频到此' : 'Click or Drag & Drop Audios'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {lang === 'zh' ? '支持把一整个文件夹直接拖进来' : 'Supports dragging an entire folder'}
              </p>
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
              <p className="text-xs font-bold text-slate-700 font-sans">
                {lang === 'zh' ? '点击选择整个音频文件夹' : 'Select Folder via Dialog'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {lang === 'zh' ? '支持本机多级文件夹深度读取' : 'Recursively inspect deep child-directories'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Server Scan relative/absolute folders */}
      {activeTab === 'server' && (
        <form onSubmit={handleScanSubmit} className="space-y-2 animate-fadeIn">
          <label className="block text-xs font-semibold text-slate-600">
            {lang === 'zh' ? '音频文件夹绝对路径 (仅适用于本地电脑终端)' : 'Absolute audio directory path (Runs natively on your local machine)'}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder={lang === 'zh' ? "例如:/Users/name/Music/baby 或 C:\\Music\\baby" : "e.g., /Users/name/Music or C:\\Music"}
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
              {isScanning 
                ? (lang === 'zh' ? '扫描中...' : 'Scanning...') 
                : (lang === 'zh' ? '扫描服务端' : 'Scan Server')}
            </button>
          </div>
        </form>
      )}

      {/* Result File Path Configurator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold text-slate-600">
            {lang === 'zh' ? '文件监听模式配置：result.txt 绝对路径' : 'OCR / File Polling: result.txt Absolute Path'}
          </label>
          <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded font-mono">
            {lang === 'zh' ? '全自动监听' : 'Auto Polling'}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={localResultPath}
            onChange={(e) => setLocalResultPath(e.target.value)}
            placeholder={lang === 'zh' ? "例如: /Users/name/baby/result.txt" : "e.g., /Users/name/baby/result.txt"}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-800 font-mono"
          />
          <button
            type="button"
            onClick={() => setResultFilePath(localResultPath)}
            className="border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium text-xs px-3 py-2 rounded-lg transition-colors"
          >
            {lang === 'zh' ? '保存文件路径' : 'Save File Path'}
          </button>
        </div>
      </div>

      {/* 间隔时长设置 / Waiting Interval Configurator */}
      <div id="interval-settings-group" className="space-y-2 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold text-slate-600">
            {lang === 'zh' ? '播放间隔时长设置' : 'Waiting Interval Setting'}
          </label>
          <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-mono">
            {lang === 'zh' ? '个性化调整' : 'Custom Interval'}
          </span>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">30s</span>
            <input
              type="range"
              min="30"
              max="600"
              step="15"
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              className="flex-1 accent-indigo-600 bg-slate-100 rounded-lg appearance-auto h-1.5 cursor-pointer"
            />
            <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">600s</span>
          </div>
          
          <div className="flex justify-end text-xs font-semibold text-indigo-600">
            {formatInterval(intervalSeconds)}
          </div>
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
          <span>{lang === 'zh' ? '生成演示音频(WAV)' : 'Generate Demo Audios (WAV)'}</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <a
            href="/api/download-csv"
            onClick={() => onExportCSV?.()}
            className="relative flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100 rounded-lg p-2.5 text-xs font-semibold transition-all shadow-2xs hover:shadow-xs animate-none"
          >
            {hasUnexportedData && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            )}
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>{lang === 'zh' ? '导出 CSV 标签' : 'Export CSV Labels'}</span>
          </a>

          <a
            href="/api/download-json"
            onClick={() => onExportJSON?.()}
            className="relative flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-lg p-2.5 text-xs font-semibold transition-all shadow-2xs hover:shadow-xs"
          >
            {hasUnexportedData && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            )}
            <FileJson className="w-4 h-4 text-indigo-500" />
            <span>{lang === 'zh' ? '导出 JSON 标签' : 'Export JSON Labels'}</span>
          </a>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="flex items-center justify-between bg-red-50/70 border border-red-100 rounded-lg p-3">
        <div className="space-y-0.5">
          <h4 className="text-xs font-semibold text-red-800">
            {lang === 'zh' ? '重置标记会话' : 'Reset All Markers'}
          </h4>
          <p className="text-[10px] text-red-600">
            {lang === 'zh' ? '擦除 progress.json 及 CSV 文件内容' : 'Wipe progress.json and local CSV values'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowResetConfirm(true)}
          className="bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-md p-1.5 hover:text-red-700 transition-all shadow-3xs hover:shadow-2xs cursor-pointer"
          title="清空标记数据"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Summary Counts */}
      {totalFiles > 0 && (
        <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-3 text-xs flex justify-between items-center text-slate-600 font-medium">
          <span>
            {lang === 'zh' ? '总共扫描到: ' : 'Total found: '}
            <strong className="text-slate-800 font-mono text-sm">{totalFiles}</strong> 
            {lang === 'zh' ? ' 首音频' : ' audios'}
          </span>
          <span>
            {lang === 'zh' ? '未标注: ' : 'Unlabeled: '}
            <strong className="text-indigo-600 font-mono text-sm">{unlabeledCount}</strong> 
            {lang === 'zh' ? ' 首' : ''}
          </span>
        </div>
      )}

      {/* Custom Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl text-left">
            <h3 className="font-semibold text-gray-900 mb-2 text-base">
              {lang === 'zh' ? '确认重置' : 'Confirm Reset'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {lang === 'zh' 
                ? '确定要删除本地标注 CSV 与 progress.json 吗？此操作无法撤销。' 
                : 'Are you sure you want to permanently erase all progress.json keys and your labeled CSV? This cannot be undone.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 border rounded-md hover:bg-gray-50 cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  onResetAll();
                }}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 cursor-pointer"
              >
                {lang === 'zh' ? '确认重置' : 'Reset Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
