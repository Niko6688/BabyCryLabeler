/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, FileText, CheckCircle2, ListFilter, AlertCircle, Copy, Radio, LogIn, RefreshCw, KeyRound } from 'lucide-react';
import { LABELS, LabelKey, LabelMode, AudioFile } from '../types';
import { Language, getTranslations } from '../lib/i18n';

interface LabelingConsoleProps {
  lang: Language;
  currentFile: AudioFile | null;
  isPlaying: boolean;
  onSaveLabel: (label: string) => void;
  onSkip?: () => void;
  labelMode: LabelMode;
  setLabelMode: (mode: LabelMode) => void;
  resultFilePath: string;
  isWaitingInterval: boolean;
}

export default function LabelingConsole({
  lang,
  currentFile,
  isPlaying,
  onSaveLabel,
  onSkip,
  labelMode,
  setLabelMode,
  resultFilePath,
  isWaitingInterval
}: LabelingConsoleProps) {
  const t = getTranslations(lang);
  const getDisplayLabel = (lbl: string) => {
    if (lang === 'zh') return lbl;
    if (lbl === '饥饿') return t.hungry;
    if (lbl === '不舒服') return t.uncomfortable;
    if (lbl === '犯困') return t.sleepy;
    if (lbl === '需要拍嗝') return t.burp;
    if (lbl === '烦躁') return t.agitated;
    return lbl;
  };
  const [directStatus, setDirectStatus] = useState<'connected' | 'disconnected' | 'error'>("disconnected");
  const [clipboardStatus, setClipboardStatus] = useState<string>("inactive"); // active, inactive, blocked
  const [clipboardContent, setClipboardContent] = useState<string>("");
  const [manualPasteText, setManualPasteText] = useState<string>("");
  const [fileContent, setFileContent] = useState<string>("");
  const [fileStatus, setFileStatus] = useState<string>("disconnected"); // connected, disconnected, error
  const [logs, setLogs] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'warn' }>>([]);
  
  const isCloudEnv = typeof window !== 'undefined' && 
    !window.location.hostname.includes('localhost') && 
    !window.location.hostname.includes('127.0.0.1');

  const directTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clipboardTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper inside helper: Write log entries
  const addLog = (text: string, type: 'info' | 'success' | 'warn' = 'info') => {
    const now = new Date().toTimeString().split(' ')[0];
    setLogs(prev => [{ time: now, text, type }, ...prev.slice(0, 24)]);
  };

  // Keyboard shortcut listener for MANUAL mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Disregard keyboard press if currently typing inside input fields
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (!currentFile) return;

      // Find label matching key (1-5)
      const foundEntry = Object.entries(LABELS).find(([_, details]) =>
        details.keys.includes(e.key)
      );

      if (foundEntry) {
        const [_, details] = foundEntry;
        addLog(`按键快捷键 [${e.key}] 触发: ${details.label}`, 'success');
        onSaveLabel(details.label);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentFile, onSaveLabel]);

  // Reset content caches when active track changes to prevent matching stale tags on a new sound clip
  useEffect(() => {
    setClipboardContent("");
    setFileContent("");
  }, [currentFile]);

  // Main label tag exact helper
  const tryMatchingAndLabel = (textToAnalyze: string, sourceName: string) => {
    if (!currentFile) return false;
    if (!textToAnalyze.trim()) return false;

    const lowerText = textToAnalyze.toLowerCase().trim();
    
    // Check for skip command
    if (lowerText === "skip" || lowerText === "跳过" || lowerText === "自动跳过" || lowerText === "skip_track") {
      addLog(`从[${sourceName}]提取出跳过指令 ➔ 自动跳过并播放下一首`, 'warn');
      if (onSkip) {
        onSkip();
      }
      // If matched from result.txt, automatically clear the physical file on the server
      if (sourceName.includes("result.txt") && resultFilePath) {
        fetch('/api/clear-file-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: resultFilePath })
        }).then(() => {
          setFileContent(""); // Clear local state cache
        }).catch(err => {
          console.error("Failed to empty result file:", err);
        });
      }
      return true;
    }

    for (const [_, details] of Object.entries(LABELS)) {
      const matched = details.keywords.some(kw => lowerText.includes(kw.toLowerCase()));
      if (matched) {
        addLog(`从[${sourceName}]提取并匹配成功 ➔ "${details.label}"`, 'success');
        onSaveLabel(details.label);

        // If matched from result.txt, automatically clear the physical file on the server
        if (sourceName.includes("result.txt") && resultFilePath) {
          fetch('/api/clear-file-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: resultFilePath })
          }).then(() => {
            setFileContent(""); // Clear local state cache
          }).catch(err => {
            console.error("Failed to empty result file:", err);
          });
        }
        return true;
      }
    }
    return false;
  };

  // --- MODE 1.5: Direct Local Helper Mode (No focus required, automatic background syncer) ---
  const checkDirectHelper = async () => {
    try {
      const response = await fetch('http://127.0.0.1:3124/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPlaying,
          isWaitingInterval,
          currentFile
        }),
        // Avoid sending credentials to localhost
        credentials: 'omit'
      });
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          setDirectStatus("connected");
          if (data.label) {
            addLog(`从[本地直连助手]自动匹配成功 ➔ "${data.label}"`, 'success');
            onSaveLabel(data.label);
          } else if (data.skip) {
            addLog(`从[本地直连助手]接收到跳过音轨指令`, 'warn');
            if (onSkip) onSkip();
          }
        } else {
          setDirectStatus("connected");
        }
      } else {
        setDirectStatus("error");
      }
    } catch (err) {
      setDirectStatus("error");
    }
  };

  useEffect(() => {
    if (labelMode === "direct" && currentFile) {
      addLog("已开启本地助手直连接收模式（推荐：高稳定/免聚焦/全自动）", 'info');
      checkDirectHelper(); // Run once immediately
      directTimerRef.current = setInterval(checkDirectHelper, 1500);
    } else {
      if (directTimerRef.current) {
        clearInterval(directTimerRef.current);
      }
      setDirectStatus("disconnected");
    }

    return () => {
      if (directTimerRef.current) clearInterval(directTimerRef.current);
    };
  }, [labelMode, currentFile, isPlaying, isWaitingInterval]);

  // --- MODE 2: Clipboard monitoring (with iframe secure fallback) ---
  const checkClipboard = async () => {
    if (!navigator.clipboard) {
      setClipboardStatus("blocked");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setClipboardStatus("active");
      if (text && text !== clipboardContent) {
        setClipboardContent(text);
        const didLabel = tryMatchingAndLabel(text, "剪贴板");
        if (didLabel) {
          // Empty clipboard immediately after matching to avoid double triggers
          navigator.clipboard.writeText("").catch(() => {});
        } else {
          addLog(`剪贴板文本变更: "${text.substring(0, 30)}..."，未匹配到预设项`, 'info');
        }
      }
    } catch (err: any) {
      // Focus-loss or iframe constraint errors
      if (err?.name === "NotAllowedError" || err?.message?.includes("focus") || err?.message?.includes("gesture")) {
        setClipboardStatus("waiting_focus");
      } else {
        setClipboardStatus("blocked");
      }
    }
  };

  useEffect(() => {
    if (labelMode === "clipboard" && currentFile) {
      setClipboardStatus("active");
      addLog("已开启剪贴板半自动模式（支持轮询提取）", 'info');
      // Set recursive interval timer for clipboard read
      clipboardTimerRef.current = setInterval(checkClipboard, 1500);
    } else {
      if (clipboardTimerRef.current) {
        clearInterval(clipboardTimerRef.current);
      }
      setClipboardStatus("inactive");
    }

    return () => {
      if (clipboardTimerRef.current) clearInterval(clipboardTimerRef.current);
    };
  }, [labelMode, currentFile, clipboardContent]);

  // --- MODE 3: File monitoring (`result.txt` on the Node.js server system) ---
  const checkResultFile = async () => {
    if (!resultFilePath) return;
    try {
      const response = await fetch(`/api/check-file-result?filePath=${encodeURIComponent(resultFilePath)}`);
      if (!response.ok) {
        setFileStatus("error");
        return;
      }
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await response.json();
        if (data.exists) {
          setFileStatus("connected");
          const text = data.content;
          if (text && text !== fileContent) {
            setFileContent(text);
            tryMatchingAndLabel(text, "result.txt 监听记录");
          }
        } else {
          setFileStatus("disconnected");
        }
      }
    } catch (err) {
      setFileStatus("error");
    }
  };

  useEffect(() => {
    if (labelMode === "file" && currentFile) {
      addLog(`已开启服务端 result.txt 文件监听（全自动）`, 'info');
      checkResultFile(); // instant first tick
      fileTimerRef.current = setInterval(checkResultFile, 1500);
    } else {
      if (fileTimerRef.current) {
        clearInterval(fileTimerRef.current);
      }
      setFileStatus("disconnected");
    }

    return () => {
      if (fileTimerRef.current) clearInterval(fileTimerRef.current);
    };
  }, [labelMode, currentFile, fileContent, resultFilePath]);

  // Handle manual mock clipboard analysis submissions (iframe friendly)
  const handleManualPasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFile) {
      alert("请先扫描并播放音频后再进行标注！");
      return;
    }
    const matched = tryMatchingAndLabel(manualPasteText, "手动输入糊文本");
    if (!matched && manualPasteText.trim() !== "") {
      addLog(`手动粘贴提示: "${manualPasteText}" 未匹配到标签，请查考匹配规则`, 'warn');
    }
    setManualPasteText("");
  };

  return (
    <div id="labeling-console-container" className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-indigo-50 text-indigo-700 rounded-md">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <h2 className="font-semibold text-slate-800 text-md">
            {lang === 'zh' ? '3. 模式选择与数据标注' : '3. Mode Selection & Labeling'}
          </h2>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          {lang === 'zh' 
            ? `状态: ${currentFile ? (isWaitingInterval ? '⏳ 间隔中' : '🔊 正在播放') : '📭 空闲'}`
            : `Status: ${currentFile ? (isWaitingInterval ? '⏳ Delay' : '🔊 Playing') : '📭 Idle'}`}
        </div>
      </div>

      {/* Mode Switches */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {/* Mode 1: Manual */}
        <button
          type="button"
          onClick={() => setLabelMode('manual')}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all text-center gap-1 cursor-pointer ${
            labelMode === 'manual'
              ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 shadow-3xs'
              : 'border-slate-200 hover:bg-slate-50 text-slate-600'
          }`}
        >
          <KeyRound className={`w-4 h-4 ${labelMode === 'manual' ? 'text-indigo-600' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold">{lang === 'zh' ? '1. 手动模式' : '1. Manual Mode'}</span>
          <span className="text-[9px] text-slate-400">{lang === 'zh' ? '键盘快捷键或点选' : 'Keyboard hotkeys / click'}</span>
        </button>

        {/* Mode 1.5: Direct Local Helper */}
        <button
          type="button"
          onClick={() => setLabelMode('direct')}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all text-center gap-1 cursor-pointer ${
            labelMode === 'direct'
              ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900 shadow-3xs'
              : 'border-slate-200 hover:bg-slate-50 text-slate-600'
          }`}
        >
          <Radio className={`w-4 h-4 ${labelMode === 'direct' ? 'text-emerald-600 animate-pulse' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold flex items-center gap-1">
            {lang === 'zh' ? '2. 助手直连模式' : '2. Direct Connection'}
            <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 rounded-sm">{lang === 'zh' ? '推荐' : 'Pro'}</span>
          </span>
          <span className="text-[9px] text-slate-400">{lang === 'zh' ? '免剪贴板 免聚焦 全自动' : 'No Clipboard / Auto'}</span>
        </button>

        {/* Mode 2: Clipboard */}
        <button
          type="button"
          onClick={() => setLabelMode('clipboard')}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all text-center gap-1 cursor-pointer ${
            labelMode === 'clipboard'
              ? 'border-slate-400 bg-slate-50 text-slate-900'
              : 'border-slate-200 hover:bg-slate-50 text-slate-600'
          }`}
        >
          <Clipboard className={`w-4 h-4 ${labelMode === 'clipboard' ? 'text-slate-800' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold">{lang === 'zh' ? '3. 剪贴板模式' : '3. Clipboard Mode'}</span>
          <span className="text-[9px] text-slate-400">{lang === 'zh' ? '支持复制/备份粘贴' : 'Copy & paste fallback'}</span>
        </button>

        {/* Mode 3: File Listener */}
        <button
          type="button"
          onClick={() => setLabelMode('file')}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all text-center gap-1 cursor-pointer ${
            labelMode === 'file'
              ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 shadow-3xs'
              : 'border-slate-200 hover:bg-slate-50 text-slate-600'
          }`}
        >
          <FileText className={`w-4 h-4 ${labelMode === 'file' ? 'text-indigo-600' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold">{lang === 'zh' ? '4. 文件监听模式' : '4. File Monitor Mode'}</span>
          <span className="text-[9px] text-slate-400">{lang === 'zh' ? '实时读取 result.txt' : 'Poll local result.txt'}</span>
        </button>
      </div>

      {/* Action panel corresponding to current active mode */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 min-h-[140px] flex flex-col justify-between">
        
        {labelMode === 'manual' && (
          <div className="space-y-3.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700">
                {lang === 'zh' ? '手动快速标签 (支持键盘物理按键 1 - 5)' : 'Quick Label Buttons (Supports Keyboard Keys 1 - 5)'}
              </span>
              <span className="text-[10px] text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-sm font-mono">
                {lang === 'zh' ? '无输入时生效' : 'Active when not typing'}
              </span>
            </div>

            {/* Clickable Quick Color Buttons */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(LABELS).map(([key, details]) => (
                <button
                  key={key}
                  type="button"
                  disabled={!currentFile}
                  onClick={() => {
                    addLog(`点击触发: ${details.label}`, 'success');
                    onSaveLabel(details.label);
                  }}
                  className={`px-3 py-2.5 rounded-lg text-xs font-bold transition-all shadow-3xs hover:shadow-2xs active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer border border-black/10 ${details.color}`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{getDisplayLabel(details.label)}</span>
                    <span className="text-[10px] opacity-75 font-mono">
                      {lang === 'zh' ? `按键 ${details.keys[0]}` : `Key ${details.keys[0]}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {labelMode === 'direct' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                {lang === 'zh' ? '🚀 本地助手智能直连服务 (免剪贴板/免聚焦)' : '🚀 Local Smart Direct Syncer (Clipboard-free)'}
              </span>
              <span className="text-xs font-mono">
                {directStatus === 'connected' && <span className="text-emerald-600 font-semibold animate-pulse">{lang === 'zh' ? '● 助手已连接' : '● Helper Connected'}</span>}
                {directStatus === 'disconnected' && <span className="text-slate-500">{lang === 'zh' ? '○ 正在等待连接...' : '○ Waiting helper connect...'}</span>}
                {directStatus === 'error' && <span className="text-amber-500 font-medium">{lang === 'zh' ? '⚠️ 尝试连接本地 127.0.0.1:3124' : '⚠️ Retrying local port 3124'}</span>}
              </span>
            </div>

            {directStatus !== 'connected' ? (
              <div className="bg-amber-50/80 text-amber-800 text-[11px] p-3 leading-relaxed rounded-lg border border-amber-200/50 space-y-1.5">
                <p className="font-semibold text-amber-900 flex items-center gap-1">
                  {lang === 'zh' ? '🔧 未检测到本地智能助手连接：' : '🔧 Local helper not detected:'}
                </p>
                <p>
                  {lang === 'zh'
                    ? '由于浏览器对系统剪贴板有着极高安全限制（窗口失去焦点、或身处预览 iframe 内时会自动拒绝读取），我们独家支持不依赖剪贴板的“100%自动直连通道”！'
                    : 'Since browsers strictly restrict system clipboard access inside preview sandboxed iframes, clipboard polls fail out of focus. We support fully-automated direct API synchronization instead!'}
                </p>
                <p className="text-slate-650">
                  {lang === 'zh'
                    ? '您只需执行最新版本的本地脚本，它会自动通过本地回环网络开启轻量的 API 服务，由网页自动从其收发状态并全自动极速标注。'
                    : 'Run the python script baby_cry_ocr_helper.py. It initiates a local feedback network API server, enabling the web page to auto-label and advance tracks securely with zero lag.'}
                </p>
              </div>
            ) : (
              <div className="bg-emerald-50/55 text-emerald-800 text-[11px] p-3 leading-relaxed rounded-lg border border-emerald-200/50 space-y-1">
                <p className="font-semibold text-emerald-900">
                  {lang === 'zh' ? '✨ 自动直连服务已成功激活！' : '✨ Syncer Activated successfully!'}
                </p>
                <p>
                  {lang === 'zh'
                    ? '网页正在与您本地的 Python 脚本高频双向。在音轨进入间隔期（Waiting Interval）时，本地脚本会自动提取手机屏幕文字，解析出标签后立即直接通知网页自动标注、切歌，即使网页在后台也能完美畅快运行！'
                    : 'Bidirectional sync is high frequency. During the Waiting Interval, the script OCRs the screen to detect baby states, automatically labels current track and plays next—runs perfectly even in the background!'}
                </p>
              </div>
            )}

            <div className="text-[10px] text-slate-500 font-mono bg-white p-2.5 rounded-lg border border-slate-100 flex flex-col gap-1">
              <div className="flex justify-between">
                <span>
                  {lang === 'zh' ? '直连回环 API 端点:' : 'Local API Endpoint:'}{' '}
                  <code className="text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded font-mono">http://127.0.0.1:3124/sync</code>
                </span>
                <span className="text-[9px] text-slate-400">
                  {lang === 'zh' ? '（不流经公网，保障隐私，0 延迟）' : '(No cloud routing, private, 0ms latency)'}
                </span>
              </div>
            </div>
          </div>
        )}

        {labelMode === 'clipboard' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                {lang === 'zh' ? '剪贴板半自动监听匹配' : 'Clipboard Semi-Auto Poller'}
              </span>
              <span className="text-xs font-mono">
                {clipboardStatus === 'active' && <span className="text-emerald-600">{lang === 'zh' ? '● 1.5s轮询检测中' : '● 1.5s Polling active'}</span>}
                {clipboardStatus === 'waiting_focus' && <span className="text-amber-500 animate-pulse font-semibold">{lang === 'zh' ? '● 运行中 (请点击页面聚焦)' : '● Polling (Please click page to focus)'}</span>}
                {clipboardStatus === 'inactive' && <span className="text-slate-500">{lang === 'zh' ? '○ 已停用' : '○ Deactivated'}</span>}
                {clipboardStatus === 'blocked' && <span className="text-red-500 font-semibold">{lang === 'zh' ? '⚠️ 浏览器策略限制' : '⚠️ Browser permissions restricted'}</span>}
              </span>
            </div>

            {(clipboardStatus === 'blocked' || clipboardStatus === 'waiting_focus') && (
              <div className="bg-amber-50 text-amber-800 text-[11px] p-2 leading-normal rounded border border-amber-200/60 flex gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p>
                  {clipboardStatus === 'waiting_focus' 
                    ? (lang === 'zh' 
                        ? '提示: 当您切换至其他应用程序时，浏览器为了安全性会暂停剪贴板监控。请轻点一下此网页，即可重新激活监控轮询！'
                        : 'Tip: Browsers pause clipboard monitoring when you focus other apps. Click anywhere on this page to reactivate polling!')
                    : (lang === 'zh'
                        ? '由于浏览器安全机制限制，直接自动访问系统剪贴板可能被拦截。可点击下方手动粘贴，或者确保在独立的浏览器窗口中打开以获得完整剪贴板读取权限。'
                        : 'Since browser security policies may restrict direct clipboard queries, you can paste manually below, or ensure the page is running in a standard browser tab.')
                  }
                </p>
              </div>
            )}

            {/* Sandbox Direct paste-fallback */}
            <form onSubmit={handleManualPasteSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder={lang === 'zh' ? "在此粘贴 AI 结果 (如 'hungry', '需要拍嗝', 'pain')" : "Paste AI text results here (e.g., 'hungry', 'pain', 'burp')"}
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-mono focus:outline-hidden focus:border-indigo-500 focus:bg-white"
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{lang === 'zh' ? '立即匹配' : 'Match'}</span>
              </button>
            </form>

            <div className="text-[11px] text-slate-400 font-mono bg-white p-2 rounded border border-slate-100 flex justify-between items-center">
              <span>{lang === 'zh' ? '当前剪贴板缓存：' : 'Clipboard buffer:'}</span>
              <strong className="text-slate-700 truncate max-w-[200px]" title={clipboardContent}>
                {clipboardContent || (lang === 'zh' ? '(空 / 暂未识别)' : '(Empty / Unrecognized)')}
              </strong>
            </div>
          </div>
        )}

        {labelMode === 'file' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 font-mono">
                {lang === 'zh' 
                  ? (isCloudEnv ? "☁️ 云端 API 自动化接收" : "文件轮询结果监听器 (result.txt)")
                  : (isCloudEnv ? "☁️ Cloud Gateway API Direct" : "Local File Poller (result.txt)")}
              </span>
              <span>
                {isCloudEnv ? (
                  <span className="text-indigo-600 text-[10px] font-bold font-mono animate-pulse bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full select-none">
                    {lang === 'zh' ? '● 云网关就绪 (免文件同步)' : '● Cloud Gateway Ready'}
                  </span>
                ) : (
                  <>
                    {fileStatus === 'connected' && <span className="text-emerald-600 text-xs font-mono">{lang === 'zh' ? '● 监听中 | 连接正常' : '● Polling | Connected'}</span>}
                    {fileStatus === 'disconnected' && <span className="text-slate-500 text-xs font-mono">{lang === 'zh' ? '○ 未找到目标文件' : '○ Target file not found'}</span>}
                    {fileStatus === 'error' && <span className="text-red-500 text-xs font-semibold font-mono">{lang === 'zh' ? '⚠️ 读取异常' : '⚠️ Read failed'}</span>}
                  </>
                )}
              </span>
            </div>

            {isCloudEnv ? (
              <div className="text-[11px] text-slate-600 font-normal leading-relaxed space-y-1.5 bg-indigo-50/30 p-3 rounded-lg border border-indigo-100/50">
                <p>
                  {lang === 'zh' ? (
                    <>
                      🚀 <b>云同步运行中：</b>因浏览器处于沙盒环境，本地 Python 脚本启动后遇到报警会直接通过安全网关 HTTP API <strong>向本网页实时交互与标注控制</strong>，因此即便处于云端预览也可无阻使用！
                    </>
                  ) : (
                    <>
                      🚀 <b>Cloud Sync Active:</b> Since the browser is inside a sandbox container, the local Python script invokes the secure Gateway HTTP API to <strong>interact and trigger labels on this tab in real-time</strong>. It works perfectly even in preview mode!
                    </>
                  )}
                </p>
                <div className="text-[10px] text-indigo-900 bg-white border border-indigo-100/60 p-2 rounded-md font-mono select-all select-none">
                  {lang === 'zh' ? '请确保本地 baby_cry_ocr_helper.py 顶部配置为：' : 'Ensure baby_cry_ocr_helper.py compiles with SERVER_URL:'}<br/>
                  <strong className="text-indigo-600 block mt-1 break-all select-all">SERVER_URL = "{window.location.origin}"</strong>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-500">
                  {lang === 'zh' 
                    ? '请确保目标应用程序将结果实时写入指定目录。当前已加载内容: ' 
                    : 'Ensure the helper writes ocr results to your local directory. Loaded content: '}
                  <code className="bg-slate-200/70 border px-1.5 py-0.5 rounded font-mono text-slate-800">
                    {fileContent || (lang === 'zh' ? '(等待写入...)' : '(Waiting for sync...)')}
                  </code>
                </p>

                <div className="flex gap-2 text-[10px] bg-sky-50 text-sky-800 p-2.5 rounded border border-sky-100 flex-col md:flex-row justify-between items-stretch md:items-center">
                  <span className="font-semibold">{lang === 'zh' ? '💡 演示验证提示:' : '💡 Demo Verification Tip:'}</span>
                  <span className="leading-normal">
                    {lang === 'zh'
                      ? '为了测试这个功能，您可以选择 Demo 文件夹 ./demo_audios/result.txt 并写入任意预设文本即可直接进行自动匹配打标签。'
                      : 'To test, write preset keywords into `./demo_audios/result.txt` to trigger real-time auto matching on this component.'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Keywords collapsible reference mapping guide */}
      <div className="bg-slate-50 rounded-lg p-3 text-xs border border-slate-200/40 text-slate-600 space-y-2">
        <span className="font-semibold text-slate-700 block">
          {lang === 'zh' ? '自动关键词匹配表 (含多语言中英文)：' : 'Auto Keyword Mapping Rules:'}
        </span>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-1 font-mono text-[10px]">
          {Object.entries(LABELS).map(([key, details]) => (
            <div key={key} className="bg-white border rounded p-1.5 flex flex-col space-y-1">
              <span className="font-bold text-slate-800 border-b pb-1 text-xs">
                {getDisplayLabel(details.label)}
              </span>
              <span className="text-slate-500 leading-tight">
                {details.keywords.join(', ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Timeline Logs */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>{lang === 'zh' ? '操作与匹配日志 (Time logs)' : 'Activity & Match Logs (Time logs)'}</span>
          <button
            onClick={() => setLogs([])}
            className="hover:text-slate-700 underline text-[10px]"
          >
            {lang === 'zh' ? '清空日志' : 'Clear'}
          </button>
        </div>
        <div className="border border-slate-200/70 rounded-lg p-3 h-32 overflow-y-auto bg-slate-950 font-mono text-[11px] text-slate-300 space-y-1.5 scrollbar-thin">
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-6">
              {lang === 'zh' 
                ? '暂无匹配或分析日志。进行文件夹扫描或播放后开始。' 
                : 'No match logs yet. Scanning folders or playing tracks will populate items.'}
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="flex gap-1.5 leading-normal">
                <span className="text-slate-500">[{log.time}]</span>
                <span className={`
                  ${log.type === 'success' ? 'text-emerald-400 font-semibold' : ''}
                  ${log.type === 'warn' ? 'text-amber-400' : ''}
                  ${log.type === 'info' ? 'text-sky-400' : ''}
                `}>
                  {log.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
