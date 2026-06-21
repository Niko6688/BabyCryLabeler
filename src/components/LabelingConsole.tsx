/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, FileText, CheckCircle2, ListFilter, AlertCircle, Copy, Radio, LogIn, RefreshCw, KeyRound } from 'lucide-react';
import { LABELS, LabelKey, LabelMode, AudioFile } from '../types';

interface LabelingConsoleProps {
  currentFile: AudioFile | null;
  onSaveLabel: (label: string) => void;
  labelMode: LabelMode;
  setLabelMode: (mode: LabelMode) => void;
  resultFilePath: string;
  isWaitingInterval: boolean;
}

export default function LabelingConsole({
  currentFile,
  onSaveLabel,
  labelMode,
  setLabelMode,
  resultFilePath,
  isWaitingInterval
}: LabelingConsoleProps) {
  const [clipboardStatus, setClipboardStatus] = useState<string>("inactive"); // active, inactive, blocked
  const [clipboardContent, setClipboardContent] = useState<string>("");
  const [manualPasteText, setManualPasteText] = useState<string>("");
  const [fileContent, setFileContent] = useState<string>("");
  const [fileStatus, setFileStatus] = useState<string>("disconnected"); // connected, disconnected, error
  const [logs, setLogs] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'warn' }>>([]);
  
  const isCloudEnv = typeof window !== 'undefined' && 
    !window.location.hostname.includes('localhost') && 
    !window.location.hostname.includes('127.0.0.1');

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

    const lowerText = textToAnalyze.toLowerCase();
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
    if (labelMode === "clipboard" && currentFile && !isWaitingInterval) {
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
  }, [labelMode, currentFile, clipboardContent, isWaitingInterval]);

  // --- MODE 3: File monitoring (`result.txt` on the Node.js server system) ---
  const checkResultFile = async () => {
    if (!resultFilePath) return;
    try {
      const response = await fetch(`/api/check-file-result?filePath=${encodeURIComponent(resultFilePath)}`);
      if (!response.ok) {
        setFileStatus("error");
        return;
      }
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
    } catch (err) {
      setFileStatus("error");
    }
  };

  useEffect(() => {
    if (labelMode === "file" && currentFile && !isWaitingInterval) {
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
  }, [labelMode, currentFile, fileContent, resultFilePath, isWaitingInterval]);

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
          <h2 className="font-semibold text-slate-800 text-md">3. 模式选择与数据标注</h2>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          状态: {currentFile ? (isWaitingInterval ? '⏳ 间隔中' : '🔊 正在播放') : '📭 空闲'}
        </div>
      </div>

      {/* Mode Switches */}
      <div className="grid grid-cols-3 gap-2">
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
          <span className="text-xs font-semibold">1. 手动模式</span>
          <span className="text-[9px] text-slate-400">键盘快捷键或点选</span>
        </button>

        {/* Mode 2: Clipboard */}
        <button
          type="button"
          onClick={() => setLabelMode('clipboard')}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all text-center gap-1 cursor-pointer ${
            labelMode === 'clipboard'
              ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 shadow-3xs'
              : 'border-slate-200 hover:bg-slate-50 text-slate-600'
          }`}
        >
          <Clipboard className={`w-4 h-4 ${labelMode === 'clipboard' ? 'text-indigo-600' : 'text-slate-400'}`} />
          <span className="text-xs font-semibold">2. 剪贴板模式</span>
          <span className="text-[9px] text-slate-400">AI支持复制结果</span>
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
          <span className="text-xs font-semibold">3. 文件监听模式</span>
          <span className="text-[9px] text-slate-400">实时读取 result.txt</span>
        </button>
      </div>

      {/* Action panel corresponding to current active mode */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/60 min-h-[140px] flex flex-col justify-between">
        
        {labelMode === 'manual' && (
          <div className="space-y-3.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700">手动快速标签 (支持键盘物理按键 1 - 5)</span>
              <span className="text-[10px] text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-sm font-mono">无输入时生效</span>
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
                    <span>{details.label}</span>
                    <span className="text-[10px] opacity-75 font-mono">按键 {details.keys[0]}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {labelMode === 'clipboard' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">剪贴板半自动监听匹配</span>
              <span className="text-xs font-mono">
                {clipboardStatus === 'active' && <span className="text-emerald-600">● 1.5s轮询检测中</span>}
                {clipboardStatus === 'waiting_focus' && <span className="text-amber-500 animate-pulse font-semibold">● 运行中 (请点击页面聚焦)</span>}
                {clipboardStatus === 'inactive' && <span className="text-slate-500">○ 已停用</span>}
                {clipboardStatus === 'blocked' && <span className="text-red-500 font-semibold">⚠️ 浏览器策略或沙盒限制</span>}
              </span>
            </div>

            {(clipboardStatus === 'blocked' || clipboardStatus === 'waiting_focus') && (
              <div className="bg-amber-50 text-amber-800 text-[11px] p-2 leading-normal rounded border border-amber-200/60 flex gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p>
                  {clipboardStatus === 'waiting_focus' 
                    ? "提示: 当您切换至 scrcpy 或其他应用程序时，浏览器为了安全性会暂停剪贴板监控。请轻点一下此网页，即可瞬间重新激活高频轮询！"
                    : "由于 AI Studio 沙盒预览环境存在跨域安全保护，直接在 iframe 内访问系统剪贴板可能被拦截。可点击下方手动粘贴，或者点击右上角“新建标签页打开”获得完整读取权限。"
                  }
                </p>
              </div>
            )}

            {/* Sandbox Direct paste-fallback */}
            <form onSubmit={handleManualPasteSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="在此粘贴 AI 结果 (如 'hungry', '需要拍嗝', 'pain')"
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-mono focus:outline-hidden focus:border-indigo-500 focus:bg-white"
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>立即匹配</span>
              </button>
            </form>

            <div className="text-[11px] text-slate-400 font-mono bg-white p-2 rounded border border-slate-100 flex justify-between items-center">
              <span>当前剪贴板缓存：</span>
              <strong className="text-slate-700 truncate max-w-[200px]" title={clipboardContent}>
                {clipboardContent || "(空 / 暂未识别)"}
              </strong>
            </div>
          </div>
        )}

        {labelMode === 'file' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 font-mono">
                {isCloudEnv ? "☁️ 云端 API 自动化接收" : "文件轮询结果监听器 (result.txt)"}
              </span>
              <span>
                {isCloudEnv ? (
                  <span className="text-indigo-600 text-[10px] font-bold font-mono animate-pulse bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full select-none">
                    ● 云网关就绪 (免文件同步)
                  </span>
                ) : (
                  <>
                    {fileStatus === 'connected' && <span className="text-emerald-600 text-xs font-mono">● 监听中 | 连接正常</span>}
                    {fileStatus === 'disconnected' && <span className="text-slate-500 text-xs font-mono">○ 未找到目标文件</span>}
                    {fileStatus === 'error' && <span className="text-red-500 text-xs font-semibold font-mono">⚠️ 读取异常</span>}
                  </>
                )}
              </span>
            </div>

            {isCloudEnv ? (
              <div className="text-[11px] text-slate-600 font-normal leading-relaxed space-y-1.5 bg-indigo-50/30 p-3 rounded-lg border border-indigo-100/50">
                <p>
                  🚀 <b>云同步运行中：</b>因浏览器处于沙盒环境，本地 Python 脚本启动后遇到报警会直接通过安全网关 HTTP API <strong>向本网页实时交互与标注控制</strong>，因此即便处于云端预览也可无阻使用！
                </p>
                <div className="text-[10px] text-indigo-900 bg-white border border-indigo-100/60 p-2 rounded-md font-mono select-all select-none">
                  请确保本地 <code>baby_cry_ocr_helper.py</code> 顶部配置为：<br/>
                  <strong className="text-indigo-600 block mt-1 break-all select-all">SERVER_URL = "{window.location.origin}"</strong>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-500">
                  请确保目标应用程序将结果实时写入指定目录。
                  当前已加载内容: <code className="bg-slate-200/70 border px-1.5 py-0.5 rounded font-mono text-slate-800">{fileContent || "(等待写入...)"}</code>
                </p>

                <div className="flex gap-2 text-[10px] bg-sky-50 text-sky-800 p-2.5 rounded border border-sky-100 flex-col md:flex-row justify-between items-stretch md:items-center">
                  <span className="font-semibold">💡 演示验证提示:</span>
                  <span className="leading-normal">
                    为了测试这个功能，您可以选择 Demo 文件夹 <code>./demo_audios/result.txt</code> 并写入任意预设文本即可直接进行自动匹配打标签。
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Keywords collapsible reference mapping guide */}
      <div className="bg-slate-50 rounded-lg p-3 text-xs border border-slate-200/40 text-slate-600 space-y-2">
        <span className="font-semibold text-slate-700 block">自动关键词匹配表 (含多语言中英文)：</span>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-1 font-mono text-[10px]">
          {Object.entries(LABELS).map(([key, details]) => (
            <div key={key} className="bg-white border rounded p-1.5 flex flex-col space-y-1">
              <span className="font-bold text-slate-800 border-b pb-1 text-xs">{details.label}</span>
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
          <span>操作与匹配日志 (Time logs)</span>
          <button
            onClick={() => setLogs([])}
            className="hover:text-slate-700 underline text-[10px]"
          >
            清空日志
          </button>
        </div>
        <div className="border border-slate-200/70 rounded-lg p-3 h-32 overflow-y-auto bg-slate-950 font-mono text-[11px] text-slate-300 space-y-1.5 scrollbar-thin">
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-6">
              暂无匹配或分析日志。进行文件夹扫描或播放后开始。
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
