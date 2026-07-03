/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Volume2, FileAudio, Check, AlertTriangle, Layers, Trophy, LogOut, Languages, Moon, Sun } from 'lucide-react';
import { AudioFile, ProgressData, LabelMode, PlaybackMode } from './types';
import SettingsPanel from './components/SettingsPanel';
import AudioPlayer from './components/AudioPlayer';
import LabelingConsole from './components/LabelingConsole';
import QueueList from './components/QueueList';
import StatisticsDashboard from './components/StatisticsDashboard';
import { registerLocalFiles, clearAllLocalFiles } from './lib/localFilesRegistry';
import { Language, getTranslations } from './lib/i18n';

const UPLOADED_PREFIX = '[uploaded]';

export default function App() {
  // Localization language
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('app_lang') as Language) || 'zh';
  });
  const t = useMemo(() => getTranslations(lang), [lang]);

  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('is_dark_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('is_dark_mode', isDarkMode ? 'true' : 'false');
  }, [isDarkMode]);

  // Scanned lists
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [backendProgress, setBackendProgress] = useState<Record<string, any>>({});
  const [currentFile, setCurrentFile] = useState<AudioFile | null>(null);

  // Dynamically map backend keys (absolute paths or [uploaded]filenames) to frontend keys (like local-file://...)
  const progress = useMemo(() => {
    const mapped: ProgressData = {};
    // First copy all backend keys directly
    Object.entries(backendProgress).forEach(([key, value]) => {
      mapped[key] = value as any;
    });

    // Then, for each current file, if it's a local file, map its file.path to its entry in backendProgress
    files.forEach(file => {
      if (file.path.startsWith('local-file://') || file.path.startsWith('blob:')) {
        const backendKey = `${UPLOADED_PREFIX}${file.name}`;
        if (backendProgress[backendKey]) {
          mapped[file.path] = backendProgress[backendKey] as any;
        }
      } else {
        if (backendProgress[file.path]) {
          mapped[file.path] = backendProgress[file.path] as any;
        }
      }
    });

    return mapped;
  }, [backendProgress, files]);

  // Path configurations
  const [scannedPath, setScannedPath] = useState<string>(() => {
    return localStorage.getItem('audio_scanned_path') || './demo_audios';
  });
  const [resultFilePath, setResultFilePath] = useState<string>(() => {
    return localStorage.getItem('audio_result_file_path') || './demo_audios/result.txt';
  });

  // Operating status flags
  const [isScanning, setIsScanning] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Interval delays state between audio queue elements
  const [isWaitingInterval, setIsWaitingInterval] = useState(false);
  const [waitingSecondsLeft, setWaitingSecondsLeft] = useState(0);
  const [skipWaitAfterLastTrack, setSkipWaitAfterLastTrack] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(() => {
    const saved = localStorage.getItem('interval_seconds');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 30 && parsed <= 600) {
        return parsed;
      }
    }
    return 300; // default 300
  });

  // Selection configurations
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('order');
  const [labelMode, setLabelMode] = useState<LabelMode>('direct');

  // Timers
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load progress.json on app creation
  useEffect(() => {
    fetchProgress();
    // Pre-scan default path on cold starts to make it instantly functional
    handleScan(scannedPath, true);
  }, []);

  // Save configurations locally to persist user input patterns
  useEffect(() => {
    localStorage.setItem('audio_scanned_path', scannedPath);
  }, [scannedPath]);

  useEffect(() => {
    localStorage.setItem('app_lang', lang);
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('audio_result_file_path', resultFilePath);
  }, [resultFilePath]);

  useEffect(() => {
    localStorage.setItem('interval_seconds', intervalSeconds.toString());
  }, [intervalSeconds]);

  // Handle waiting interval counter decrements
  useEffect(() => {
    if (isWaitingInterval) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = setInterval(() => {
        setWaitingSecondsLeft(prev => {
          if (prev <= 1) {
            handleCountdownCompleted();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    }
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [isWaitingInterval, currentFile, files, progress, playbackMode]);

  // Synchronize state with the server so external automation scripts (e.g. Python OCR helper) can perfectly orchestrate
  useEffect(() => {
    let active = true;
    const syncStatus = async () => {
      if (!active) return;
      try {
        const response = await fetch('/api/update-playback-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: currentFile?.path || null,
            fileName: currentFile?.name || null,
            isPlaying: isPlaying,
            isWaitingInterval: isWaitingInterval,
            waitingSecondsLeft: waitingSecondsLeft,
            absolutePath: currentFile?.absolutePath || null
          })
        });
        const contentType = response.headers.get("content-type");
        if (response.ok && active && contentType && contentType.includes("application/json")) {
          const data = await response.json();
          // Check if there is a command waiting from the server (e.g. from Python assistant API)
          if (data.command) {
            const command = data.command;
            // Clear command immediately so it isn't executed twice
            await fetch('/api/clear-playback-command', { method: 'POST' });
            
            if (command === "skip") {
              handleSkipTrack();
            } else if (command === "label" && data.label) {
              handleSaveLabel(data.label);
            }
          }
        }
      } catch (err) {
        console.error("Failed to sync status with Express backend:", err);
      }
    };

    // Periodically poll every 1500ms to keep status alive and fetch remote helper commands
    const statusInterval = setInterval(syncStatus, 1500);
    // Trigger instantly on state transition
    syncStatus();

    return () => {
      active = false;
      clearInterval(statusInterval);
    };
  }, [currentFile, isPlaying, isWaitingInterval, waitingSecondsLeft]);

  // Fetch labeling history
  const fetchProgress = async () => {
    try {
      const res = await fetch('/api/progress');
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setBackendProgress(data);
      }
    } catch (e) {
      console.error("Failed to fetch progress", e);
    }
  };

  // Trigger scan API over scannedPath
  const handleScan = async (pathString: string, isInitial: boolean = false) => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath: pathString })
      });
      const data = await res.json();
      if (res.ok && data.files) {
        const incomingFiles: AudioFile[] = data.files;
        const existingKeys = new Set(
          files.map(f => f.absolutePath || `[uploaded]${f.name}`)
        );

        const newFiles = incomingFiles.filter(f => {
          const key = f.absolutePath || `[uploaded]${f.name}`;
          return !existingKeys.has(key);
        });

        if (!isInitial) {
          if (newFiles.length === 0) {
            alert("未发现新文件，当前列表已是最新");
          } else {
            alert(`目录扫描成功！共找到 ${incomingFiles.length} 个音频文件，其中新增 ${newFiles.length} 个。`);
          }
        }

        if (newFiles.length > 0) {
          setFiles(prev => [...prev, ...newFiles]);
          
          if (!currentFile) {
            const unlabeled = newFiles.find((f: AudioFile) => !progress[f.path]?.label);
            if (unlabeled) {
              setCurrentFile(unlabeled);
            } else {
              setCurrentFile(newFiles[0]);
            }
          }
        } else {
          if (!currentFile && files.length > 0) {
            const unlabeled = files.find((f: AudioFile) => !progress[f.path]?.label);
            if (unlabeled) {
              setCurrentFile(unlabeled);
            } else {
              setCurrentFile(files[0]);
            }
          }
        }

        setScannedPath(data.scannedPath);
      } else {
        if (!isInitial) {
          alert(data.error || "扫描目录失败");
        }
      }
    } catch (err) {
      console.error("Scan error", err);
    } finally {
      setIsScanning(false);
    }
  };

  // Generate synthetic demo audio waveforms for immediate sandbox trial
  const handleGenerateDemo = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/generate-demo-audios', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setScannedPath(data.scannedPath);
        setResultFilePath(data.resultTxtPath);
        
        // Scan the newly generated directory immediately
        await handleScan(data.scannedPath, true);
        alert(data.message);
      } else {
        alert("合成演示音频失败");
      }
    } catch (err) {
      console.error("Failed to generate demo audios", err);
    } finally {
      setIsScanning(false);
    }
  };

  // Resets metadata database on server
  const handleResetAll = async () => {
    try {
      const res = await fetch('/api/reset-all', { method: 'POST' });
      if (res.ok) {
        // 1. Reset all React state variables
        setBackendProgress({});
        console.trace("[ResetTrace] setFiles([]) triggered inside handleResetAll (session reset).");
        setFiles([]);
        setCurrentFile(null);
        setIsPlaying(false);
        setIsWaitingInterval(false);
        setWaitingSecondsLeft(0);
        setIntervalSeconds(300);
        
        // 2. Clear client-side file uploads registry
        clearAllLocalFiles();

        // 3. Reset paths state to default
        setScannedPath('./demo_audios');
        setResultFilePath('./demo_audios/result.txt');

        // 4. Remove items from localStorage
        localStorage.removeItem('audio_scanned_path');
        localStorage.removeItem('audio_result_file_path');
        localStorage.removeItem('interval_seconds');

        alert("标注会话清理完毕！所有前端状态、音频列表、标注结果与路径缓存均已完全重置。");
      }
    } catch (err) {
      alert("清理重置失败");
    }
  };

  // Direct client browser upload (WAV/MP3s) for online sandboxed previews
  const handleUploadLocalAudios = (uploadedFileList: FileList | File[], isDragAndDrop: boolean = false) => {
    const fileArray = Array.isArray(uploadedFileList) ? uploadedFileList : Array.from(uploadedFileList);
    const list = registerLocalFiles(fileArray, isDragAndDrop);
    if (list.length > 0) {
      const existingKeys = new Set(
        files.map(f => f.absolutePath || `[uploaded]${f.name}`)
      );

      const newFiles = list.filter(f => {
        const key = f.absolutePath || `[uploaded]${f.name}`;
        return !existingKeys.has(key);
      });

      if (newFiles.length > 0) {
        setFiles(prev => [...prev, ...newFiles]);
        if (!currentFile) {
          setCurrentFile(newFiles[0]);
        }
      } else {
        alert("未发现新文件，当前列表已是最新");
      }
    }
  };

  const handleClearLoadedAudios = () => {
    console.trace("[ResetTrace] setFiles([]) triggered inside handleClearLoadedAudios (clear queue button).");
    clearAllLocalFiles();
    setFiles([]);
    setCurrentFile(null);
  };

  // Select a track directly from the Sidebar Queue list
  const handleSelectTrack = (track: AudioFile) => {
    setIsWaitingInterval(false);
    setCurrentFile(track);
    setIsPlaying(true);
  };

  // Triggered when a track has finished playback loops
  const handleTrackCompletedPlayback = async () => {
    if (currentFile) {
      try {
        const res = await fetch('/api/record-play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: currentFile.path,
            fileName: currentFile.name,
            relativePath: currentFile.relativePath,
            absolutePath: currentFile.absolutePath || null
          })
        });
        if (res.ok) {
          const data = await res.json();
          setBackendProgress(data.progress);
        }
      } catch (err) {
        console.error("Failed to record play completion", err);
      }
    }

    // 延迟间歇：为了完美兼容手机端（图灵看护 App）在播放完音频后由于神经网络分析导致的延迟，
    // 我们将等待计时上限设为动态调整的设置值。一旦 Python 脚本扫描到了分类词，网页会瞬时捕获并跳转下一首，不会有任何不必要的空等！
    const waitTime = intervalSeconds; 
    // Check if this is the last track
    const isLastTrack = checkIfLastTrackFinished();
    if (isLastTrack && skipWaitAfterLastTrack) {
      // Direct complete, do not request wait
      setIsPlaying(false);
      alert("全队列所有可标注音频已播放完毕！(已跳过最后一首文件的等待时间)");
      return;
    }

    setWaitingSecondsLeft(waitTime);
    setIsWaitingInterval(true);
  };

  // Finds if the active track is the last one in the scans queue
  const checkIfLastTrackFinished = (): boolean => {
    if (!currentFile || files.length === 0) return true;
    const currentIndex = files.findIndex(f => f.path === currentFile.path);
    return currentIndex === files.length - 1;
  };

  // Select next target track using order/random policies
  const loadNextUnlabeledTrack = () => {
    if (files.length === 0) return;

    let nextTrack: AudioFile | null = null;

    if (playbackMode === 'random') {
      const unlabeled = files.filter(f => !progress[f.path]?.label);
      if (unlabeled.length > 0) {
        const randIdx = Math.floor(Math.random() * unlabeled.length);
        nextTrack = unlabeled[randIdx];
      } else {
        // Fallback to choosing any random track if all labeled
        const randIdx = Math.floor(Math.random() * files.length);
        nextTrack = files[randIdx];
      }
    } else {
      // Order sequence policy
      if (!currentFile) {
        nextTrack = files[0];
      } else {
        const currentIndex = files.findIndex(f => f.path === currentFile.path);
        // Find first unlabeled after currentIndex, or pick from beginning
        let found = false;
        for (let i = currentIndex + 1; i < files.length; i++) {
          if (!progress[files[i].path]?.label) {
            nextTrack = files[i];
            found = true;
            break;
          }
        }
        if (!found) {
          // Wrap around to scan list starting from 0 to current
          for (let i = 0; i <= currentIndex; i++) {
            if (!progress[files[i].path]?.label) {
              nextTrack = files[i];
              found = true;
              break;
            }
          }
        }
        // If still nothing is unlabeled, load the immediate sequence index or circular wrap
        if (!nextTrack) {
          const nextIdx = (currentIndex + 1) % files.length;
          nextTrack = files[nextIdx];
        }
      }
    }

    if (nextTrack) {
      setCurrentFile(nextTrack);
    }
  };

  // Called when wait countdown finishes naturally without any label submittal
  const handleCountdownCompleted = () => {
    setIsWaitingInterval(false);
    loadNextUnlabeledTrack();
  };

  // Save label results to backend database
  const handleSaveLabel = async (labelString: string) => {
    if (!currentFile) return;

    try {
      const res = await fetch('/api/save-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: currentFile.path,
          label: labelString,
          fileName: currentFile.name,
          relativePath: currentFile.relativePath,
          absolutePath: currentFile.absolutePath || null
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBackendProgress(data.progress);

        // Terminate waiting sequence immediately upon receiving label, and proceed to next track!
        setIsWaitingInterval(false);
        loadNextUnlabeledTrack();
        setIsPlaying(true);
      } else {
        console.error("Save label call failed");
      }
    } catch (err) {
      console.error("Error saving label", err);
    }
  };

  const handleSaveLabelForPath = async (filePath: string, labelString: string) => {
    const targetFile = files.find(f => f.path === filePath);
    if (!targetFile) return;

    try {
      const res = await fetch('/api/save-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: targetFile.path,
          label: labelString,
          fileName: targetFile.name,
          relativePath: targetFile.relativePath,
          absolutePath: targetFile.absolutePath || null
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBackendProgress(data.progress);
      } else {
        console.error("Save label for path failed");
      }
    } catch (err) {
      console.error("Error saving label for path", err);
    }
  };

  // Skip manually trigger
  const handleSkipTrack = () => {
    setIsWaitingInterval(false);
    loadNextUnlabeledTrack();
    setIsPlaying(true);
  };

  // Stop current track audio states
  const handleStopPlayback = () => {
    setIsPlaying(false);
    setIsWaitingInterval(false);
  };

  // Total metrics count helpers
  const totalFiles = files.length;
  const loadedLabeledCount = files.filter(f => progress[f.path]?.label !== undefined && progress[f.path]?.label !== "").length;
  const unlabeledCount = Math.max(0, totalFiles - loadedLabeledCount);

  return (
    <div
      id="app-root-layout"
      className={`min-h-screen flex flex-col antialiased ${
        isDarkMode ? 'dark bg-[#0f0f1a] text-[#e0e0e0]' : 'bg-slate-50 text-slate-700'
      }`}
    >
      {/* Premium Header Menu Nav */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200/80 shadow-3xs px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-xs">
            <Layers className="w-5 h-5 text-indigo-100" />
          </div>
          <div>
            <h1 className="font-extrabold text-slate-950 tracking-tight text-lg">
              {t.title} <span className="font-normal text-slate-400">| Auto Audio Labeler</span>
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              {t.subtitle}
            </p>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-3">
          <button
            id="theme-switcher-btn"
            onClick={() => setIsDarkMode(prev => !prev)}
            className={`flex items-center space-x-1.5 font-bold px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all duration-300 border ${
              isDarkMode
                ? 'bg-[#1a1a24] border-[#2a2a38] text-white hover:text-indigo-300'
                : 'bg-slate-100/80 hover:bg-slate-200 border-slate-200 text-slate-700'
            }`}
          >
            <span>
              {isDarkMode 
                ? (lang === 'zh' ? '☀️ 日间模式' : '☀️ Day Mode') 
                : (lang === 'zh' ? '🌙 夜间模式' : '🌙 Night Mode')}
            </span>
          </button>

          <button
            id="lang-switcher-btn"
            onClick={() => setLang(prev => prev === 'zh' ? 'en' : 'zh')}
            className="flex items-center space-x-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer"
          >
            <Languages className="w-3.5 h-3.5 text-indigo-500" />
            <span>{lang === 'zh' ? 'English' : '中文'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout split */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Directory input, Scanned Lists and analytics (size: lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col justify-start">
          <SettingsPanel
            lang={lang}
            scannedPath={scannedPath}
            setScannedPath={setScannedPath}
            resultFilePath={resultFilePath}
            setResultFilePath={setResultFilePath}
            onScan={handleScan}
            onGenerateDemo={handleGenerateDemo}
            onResetAll={handleResetAll}
            isScanning={isScanning}
            totalFiles={totalFiles}
            unlabeledCount={unlabeledCount}
            onUploadLocalAudios={handleUploadLocalAudios}
            intervalSeconds={intervalSeconds}
            setIntervalSeconds={setIntervalSeconds}
          />

          <QueueList
            lang={lang}
            files={files}
            progress={progress}
            currentFile={currentFile}
            onSelectTrack={handleSelectTrack}
            playbackMode={playbackMode}
            setPlaybackMode={setPlaybackMode}
            onClearFiles={handleClearLoadedAudios}
            onSaveLabelForPath={handleSaveLabelForPath}
          />

          <StatisticsDashboard
            lang={lang}
            files={files}
            progress={progress}
          />
        </div>

        {/* Right Side: Primary Active Audios Work Bench (size: lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Main Playback console card */}
          <AudioPlayer
            lang={lang}
            currentFile={currentFile}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            onTrackEnd={handleTrackCompletedPlayback}
            onSkip={handleSkipTrack}
            onStop={handleStopPlayback}
            isWaitingInterval={isWaitingInterval}
            waitingSecondsLeft={waitingSecondsLeft}
            skipWaitAfterLastTrack={skipWaitAfterLastTrack}
            setSkipWaitAfterLastTrack={setSkipWaitAfterLastTrack}
          />

          {/* Dedicated Manual & Automatic Matcher consoles */}
          <LabelingConsole
            lang={lang}
            currentFile={currentFile}
            isPlaying={isPlaying}
            onSaveLabel={handleSaveLabel}
            onSkip={handleSkipTrack}
            labelMode={labelMode}
            setLabelMode={setLabelMode}
            resultFilePath={resultFilePath}
            isWaitingInterval={isWaitingInterval}
          />
        </div>
      </main>

      {/* Simple elegant footer */}
      <footer className="bg-white border-t border-slate-200/75 py-4 px-6 text-center text-[11px] text-slate-400 font-mono">
        &copy; 2026 Audio Labeler Tool. Powered by Express, React and Tailwind. All process logs saved natively.
      </footer>
    </div>
  );
}
