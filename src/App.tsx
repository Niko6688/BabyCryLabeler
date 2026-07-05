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
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);

  // Helper: Retrieve progress data dynamically with robust file-matching (exact key, absolute path, uploaded key, or fallback name match)
  const getProgressForFile = (file: AudioFile) => {
    if (backendProgress[file.path]) return backendProgress[file.path];
    if (file.absolutePath && backendProgress[file.absolutePath]) return backendProgress[file.absolutePath];
    
    const uploadedKey = `${UPLOADED_PREFIX}${file.name}`;
    if (backendProgress[uploadedKey]) return backendProgress[uploadedKey];
    
    // Symmetrical fallback: Search backendProgress for any entry where the name matches file.name
    const found = Object.values(backendProgress).find(
      (entry: any) => entry && entry.name === file.name
    );
    return found || null;
  };

  const isAudioFileLabeled = (file: AudioFile): boolean => {
    const p = getProgressForFile(file);
    if (!p) return false;
    if (p.label && p.label.trim() !== "") return true;
    if (p.tags) {
      if (Array.isArray(p.tags) && p.tags.length > 0) return true;
      if (typeof p.tags === 'string' && p.tags.trim() !== "") return true;
    }
    return false;
  };

  // Dynamically map backend keys (absolute paths or [uploaded]filenames) to frontend keys (like local-file://...)
  const progress = useMemo(() => {
    const mapped: ProgressData = {};
    // First copy all backend keys directly
    Object.entries(backendProgress).forEach(([key, value]) => {
      mapped[key] = value as any;
    });

    // Then, for each current file, map its file.path to its best matched entry in backendProgress
    files.forEach(file => {
      const matched = getProgressForFile(file);
      if (matched) {
        mapped[file.path] = matched as any;
      }
    });

    return mapped;
  }, [backendProgress, files]);

  // Sync state modifications into browser's persistent localStorage instantly
  useEffect(() => {
    if (backendProgress && Object.keys(backendProgress).length > 0) {
      localStorage.setItem('baby_cry_progress_backup', JSON.stringify(backendProgress));
    }
  }, [backendProgress]);

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
  const [skipLabeled, setSkipLabeled] = useState<boolean>(() => {
    return localStorage.getItem('skip_labeled') === 'true';
  });
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
  const isScanningRef = useRef(false);

  // Load progress.json on app creation
  useEffect(() => {
    fetchProgress();
    // Do not pre-scan on startup for local deployment as requested
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

  useEffect(() => {
    localStorage.setItem('skip_labeled', skipLabeled ? 'true' : 'false');
  }, [skipLabeled]);

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
      let response: Response | null = null;
      try {
        response = await fetch('/api/update-playback-status', {
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
            const clearRes = await fetch('/api/clear-playback-command', { method: 'POST' });
            if (clearRes.body) {
              await clearRes.body.cancel();
            }
            
            if (command === "skip") {
              handleSkipTrack();
            } else if (command === "label" && data.label) {
              handleSaveLabel(data.label);
            }
          }
        } else {
          if (response && response.body) {
            await response.body.cancel();
          }
        }
      } catch (err) {
        console.error("Failed to sync status with Express backend:", err);
        if (response && response.body) {
          try {
            await response.body.cancel();
          } catch (_) {}
        }
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

  // Periodic memory clean-up (every 30 minutes)
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Clear active Blob URL if labeled and not playing
      import('./lib/localFilesRegistry').then(({ revokeActiveLocalFileUrl }) => {
        revokeActiveLocalFileUrl();
      }).catch(() => {});

      // Clear console logs in other components via custom event
      window.dispatchEvent(new CustomEvent('clear-app-caches'));

      // Prune progress object to keep only essential fields
      setBackendProgress(prev => {
        const pruned: Record<string, any> = {};
        Object.entries(prev).forEach(([key, val]) => {
          if (val && typeof val === 'object') {
            const v = val as any;
            pruned[key] = {
              label: v.label || "",
              time: v.time || "",
              playCount: v.playCount || 0,
              lastPlayedAt: v.lastPlayedAt || ""
            };
          }
        });
        return pruned;
      });

      console.log("30-minute memory cleanup performed successfully!");
    }, 30 * 60 * 1000); // 30 minutes

    return () => clearInterval(intervalId);
  }, []);

  // Memory usage monitoring
  useEffect(() => {
    const checkMemory = () => {
      const perf = window.performance as any;
      if (perf && perf.memory) {
        const usedSize = perf.memory.usedJSHeapSize; // in bytes
        const limitSize = 500 * 1024 * 1024; // 500MB
        if (usedSize > limitSize) {
          const usedMB = (usedSize / (1024 * 1024)).toFixed(1);
          setMemoryWarning(
            lang === 'zh'
              ? `⚠️ 警告：当前页面已占用内存 ${usedMB}MB（超过安全阈值 500MB），可能会导致浏览器卡顿。为了保证标注工作的连续性，建议您在导出并保存当前进度后，点击刷新页面以释放内存。`
              : `⚠️ Warning: Current page memory usage is ${usedMB}MB (exceeding 500MB safety threshold), which may cause lagging. To prevent loss of progress, we highly recommend exporting your work first, then refreshing the page.`
          );
        } else {
          setMemoryWarning(null);
        }
      }
    };

    // Check memory every 10 seconds
    const interval = setInterval(checkMemory, 10000);
    checkMemory();

    return () => clearInterval(interval);
  }, [lang]);

  // Fetch labeling history and sync with localStorage backup
  const fetchProgress = async () => {
    let res: Response | null = null;
    let localBackup: Record<string, any> = {};

    // 1. Try reading from client-side localStorage backup first
    try {
      const saved = localStorage.getItem('baby_cry_progress_backup');
      if (saved) {
        localBackup = JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to parse localStorage backup:", e);
    }

    try {
      res = await fetch('/api/progress');
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const backendData = await res.json();

        // 2. MERGE logic: Combine local backup and backend data
        const merged: Record<string, any> = { ...localBackup };

        Object.entries(backendData).forEach(([key, val]) => {
          if (val && typeof val === 'object') {
            const serverEntry = val as any;
            const localEntry = merged[key] || {};

            // Prefer whichever has non-empty label or higher playCount
            const mergedLabel = serverEntry.label || localEntry.label || "";
            const mergedTags = serverEntry.tags || localEntry.tags || mergedLabel;
            const mergedPlayCount = Math.max(
              typeof serverEntry.playCount === 'number' ? serverEntry.playCount : 0,
              typeof localEntry.playCount === 'number' ? localEntry.playCount : 0
            );
            const mergedLastPlayedAt = serverEntry.lastPlayedAt || localEntry.lastPlayedAt || "";
            const mergedTime = serverEntry.time || localEntry.time || "";

            merged[key] = {
              ...localEntry,
              ...serverEntry,
              label: mergedLabel,
              tags: mergedTags,
              playCount: mergedPlayCount,
              lastPlayedAt: mergedLastPlayedAt,
              time: mergedTime,
              name: serverEntry.name || localEntry.name || "",
              rel: serverEntry.rel || localEntry.rel || "",
              absolutePath: serverEntry.absolutePath || localEntry.absolutePath || ""
            };
          }
        });

        setBackendProgress(merged);
        localStorage.setItem('baby_cry_progress_backup', JSON.stringify(merged));

        // 3. If there's any discrepancy where local backup has more files or details, sync back to backend
        const needsSync = Object.keys(merged).length > Object.keys(backendData).length || 
                          Object.entries(merged).some(([key, val]) => {
                            const bVal = backendData[key];
                            return !bVal || (val as any).label !== (bVal as any).label;
                          });

        if (needsSync && Object.keys(merged).length > 0) {
          console.log("Client backup has more data than server, syncing to backend server...");
          await fetch('/api/sync-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientProgress: merged })
          });
        }
      } else {
        if (res && res.body) await res.body.cancel();
        // Fallback to local backup if backend request fails
        if (Object.keys(localBackup).length > 0) {
          setBackendProgress(localBackup);
        }
      }
    } catch (e) {
      console.error("Failed to fetch progress", e);
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
      // Fallback to local backup on network errors
      if (Object.keys(localBackup).length > 0) {
        setBackendProgress(localBackup);
      }
    }
  };

  // Trigger scan API over scannedPath
  const handleScan = async (pathString: string, isInitial: boolean = false) => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);
    let res: Response | null = null;
    try {
      res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath: pathString })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          const incomingFiles: AudioFile[] = data.files.map((f: any) => ({
            ...f,
            absolutePath: f.absolutePath || f.path
          }));

          const existingKeys = new Set(files.map(f => f.absolutePath || f.path || f.name));

          const newFiles = incomingFiles.filter(f => {
            const key = f.absolutePath || f.path || f.name;
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
            console.trace("[FilesTrace] setFiles called inside handleScan with new files count:", newFiles.length);
            setFiles(prev => {
              const combined = [...prev, ...newFiles];
              const seen = new Set<string>();
              return combined.filter(f => {
                const key = f.absolutePath || f.path || f.name;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
            });
            
            if (!currentFile) {
              const unlabeled = newFiles.find((f: AudioFile) => !isAudioFileLabeled(f));
              if (unlabeled) {
                setCurrentFile(unlabeled);
              } else {
                setCurrentFile(newFiles[0]);
              }
            }
          } else {
            if (!currentFile && files.length > 0) {
              const unlabeled = files.find((f: AudioFile) => !isAudioFileLabeled(f));
              if (unlabeled) {
                setCurrentFile(unlabeled);
              } else {
                setCurrentFile(files[0]);
              }
            }
          }

          setScannedPath(data.scannedPath);
        }
      } else {
        const errorText = await res.text();
        if (!isInitial) {
          alert(errorText || "扫描目录失败");
        }
      }
    } catch (err) {
      console.error("Scan error", err);
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  };

  // Generate synthetic demo audio waveforms for immediate sandbox trial
  const handleGenerateDemo = async () => {
    setIsScanning(true);
    let res: Response | null = null;
    try {
      res = await fetch('/api/generate-demo-audios', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setScannedPath(data.scannedPath);
        setResultFilePath(data.resultTxtPath);
        
        // Scan the newly generated directory immediately
        await handleScan(data.scannedPath, true);
        alert(data.message);
      } else {
        if (res.body) await res.body.cancel();
        alert("合成演示音频失败");
      }
    } catch (err) {
      console.error("Failed to generate demo audios", err);
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
    } finally {
      setIsScanning(false);
    }
  };

  // Resets metadata database on server
  const handleResetAll = async () => {
    let res: Response | null = null;
    try {
      res = await fetch('/api/reset-all', { method: 'POST' });
      if (res.body) {
        await res.body.cancel();
      }
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
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
    }
  };

  // Direct client browser upload (WAV/MP3s) for online sandboxed previews
  const handleUploadLocalAudios = (uploadedFileList: FileList | File[], isDragAndDrop: boolean = false) => {
    const fileArray = Array.isArray(uploadedFileList) ? uploadedFileList : Array.from(uploadedFileList);
    const list = registerLocalFiles(fileArray, isDragAndDrop);
    if (list.length > 0) {
      const existingKeys = new Set(files.map(f => f.absolutePath || f.path || f.name));

      const newFiles = list.filter(f => {
        const key = f.absolutePath || f.path || f.name;
        return !existingKeys.has(key);
      });

      if (newFiles.length > 0) {
        console.trace("[FilesTrace] setFiles called inside handleUploadLocalAudios with new files count:", newFiles.length);
        setFiles(prev => {
          const combined = [...prev, ...newFiles];
          const seen = new Set<string>();
          return combined.filter(f => {
            const key = f.absolutePath || f.path || f.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
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
      let res: Response | null = null;
      try {
        res = await fetch('/api/record-play', {
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
        } else {
          if (res.body) await res.body.cancel();
        }
      } catch (err) {
        console.error("Failed to record play completion", err);
        if (res && res.body) {
          try {
            await res.body.cancel();
          } catch (_) {}
        }
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

  const isFileLabeled = (filePath: string): boolean => {
    const file = files.find(f => f.path === filePath);
    if (file) return isAudioFileLabeled(file);
    const p = progress[filePath];
    if (!p) return false;
    if (p.label && p.label.trim() !== "") return true;
    const tags = (p as any).tags;
    if (tags) {
      if (Array.isArray(tags) && tags.length > 0) return true;
      if (typeof tags === 'string' && tags.trim() !== "") return true;
    }
    return false;
  };

  // Select next target track using order/random policies
  const loadNextUnlabeledTrack = () => {
    if (files.length === 0) return;

    let nextTrack: AudioFile | null = null;

    if (skipLabeled) {
      const unlabeled = files.filter(f => !isFileLabeled(f.path));
      if (unlabeled.length === 0) {
        setIsPlaying(false);
        setIsWaitingInterval(false);
        alert(lang === 'zh' ? '所有音频已完成标注' : 'All audio files have been labeled');
        return;
      }

      if (playbackMode === 'random') {
        const randIdx = Math.floor(Math.random() * unlabeled.length);
        nextTrack = unlabeled[randIdx];
      } else {
        // Order sequence policy, only considering unlabeled files
        if (!currentFile) {
          nextTrack = unlabeled[0];
        } else {
          // Find current index in the full list
          const currentIndex = files.findIndex(f => f.path === currentFile.path);
          // Find first unlabeled after currentIndex
          let found = false;
          for (let i = currentIndex + 1; i < files.length; i++) {
            if (!isFileLabeled(files[i].path)) {
              nextTrack = files[i];
              found = true;
              break;
            }
          }
          if (!found) {
            // Circular wrap around from beginning
            for (let i = 0; i <= currentIndex; i++) {
              if (!isFileLabeled(files[i].path)) {
                nextTrack = files[i];
                found = true;
                break;
              }
            }
          }
        }
      }
    } else {
      if (playbackMode === 'random') {
        const unlabeled = files.filter(f => !isFileLabeled(f.path));
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
            if (!isFileLabeled(files[i].path)) {
              nextTrack = files[i];
              found = true;
              break;
            }
          }
          if (!found) {
            // Wrap around to scan list starting from 0 to current
            for (let i = 0; i <= currentIndex; i++) {
              if (!isFileLabeled(files[i].path)) {
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
    }

    if (nextTrack) {
      setCurrentFile(nextTrack);
    }
  };

  // Automatically skip the current track if skipLabeled is enabled and the track is labeled
  const isCurrentFileLabeled = currentFile ? isFileLabeled(currentFile.path) : false;

  useEffect(() => {
    if (skipLabeled && isCurrentFileLabeled && files.length > 0) {
      const unlabeled = files.filter(f => !isFileLabeled(f.path));
      if (unlabeled.length === 0) {
        setIsPlaying(false);
        setIsWaitingInterval(false);
        alert(lang === 'zh' ? '所有音频已完成标注' : 'All audio files have been labeled');
      } else {
        loadNextUnlabeledTrack();
      }
    }
  }, [skipLabeled, isCurrentFileLabeled, files.length]);

  // Called when wait countdown finishes naturally without any label submittal
  const handleCountdownCompleted = () => {
    setIsWaitingInterval(false);
    loadNextUnlabeledTrack();
  };

  // Save label results to backend database
  const handleSaveLabel = async (labelString: string) => {
    if (!currentFile) return;

    let res: Response | null = null;
    try {
      res = await fetch('/api/save-label', {
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
        if (res.body) await res.body.cancel();
        console.error("Save label call failed");
      }
    } catch (err) {
      console.error("Error saving label", err);
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
    }
  };

  const handleSaveLabelForPath = async (filePath: string, labelString: string) => {
    const targetFile = files.find(f => f.path === filePath);
    if (!targetFile) return;

    let res: Response | null = null;
    try {
      res = await fetch('/api/save-label', {
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
        if (res.body) await res.body.cancel();
        console.error("Save label for path failed");
      }
    } catch (err) {
      console.error("Error saving label for path", err);
      if (res && res.body) {
        try {
          await res.body.cancel();
        } catch (_) {}
      }
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

      {/* Memory Warning Banner */}
      {memoryWarning && (
        <div id="memory-warning-banner" className="bg-red-600 text-white font-bold py-3 px-6 text-sm flex items-center justify-between shadow-md z-50">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{memoryWarning}</span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="ml-4 bg-white text-red-600 hover:bg-slate-100 px-3 py-1 rounded-md text-xs font-extrabold cursor-pointer transition-all shrink-0"
          >
            {lang === 'zh' ? '立即刷新' : 'Refresh Now'}
          </button>
        </div>
      )}

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
            skipLabeled={skipLabeled}
            setSkipLabeled={setSkipLabeled}
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
