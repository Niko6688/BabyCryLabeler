/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { PlayCircle, CheckCircle2, RotateCcw, Award, Music, Shuffle, AlignLeft, Layers, Volume, Trash2 } from 'lucide-react';
import { AudioFile, ProgressData, LABELS } from '../types';
import { createTempLocalFileUrl } from '../lib/localFilesRegistry';
import { Language, getTranslations } from '../lib/i18n';

interface QueueListProps {
  lang: Language;
  files: AudioFile[];
  progress: ProgressData;
  currentFile: AudioFile | null;
  onSelectTrack: (file: AudioFile) => void;
  playbackMode: 'order' | 'random';
  setPlaybackMode: (mode: 'order' | 'random') => void;
  onClearFiles?: () => void;
  onSaveLabelForPath?: (filePath: string, label: string) => void;
}

export default function QueueList({
  lang,
  files,
  progress,
  currentFile,
  onSelectTrack,
  playbackMode,
  setPlaybackMode,
  onClearFiles,
  onSaveLabelForPath
}: QueueListProps) {
  const t = getTranslations(lang);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'unlabeled' | 'labeled'>('all');
  const [cachedDurations, setCachedDurations] = useState<Record<string, number>>({});

  // Helper: Format seconds to m:ss or milliseconds
  const formatItemDuration = (secs: number | undefined) => {
    if (secs === undefined || isNaN(secs) || secs === Infinity || secs <= 0) return "0:00";
    if (secs < 1) {
      return `${(secs * 1000).toFixed(0)}ms`;
    }
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Helper: Get loop count (each track played at least 30 seconds)
  const getLoopCount = (secs: number | undefined) => {
    if (secs === undefined || isNaN(secs) || secs === Infinity || secs <= 0) return 1;
    return Math.ceil(30 / secs);
  };

  // Helper: Format ISO string to local YYYY-MM-DD HH:mm:ss
  const formatLocalDate = (isoString: string | undefined) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "";
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch (e) {
      return "";
    }
  };

  // Compute stats based only on loaded files - memoized for high efficiency
  const totalCount = files.length;
  
  const { labeledCount, labelCounts } = useMemo(() => {
    let count = 0;
    const counts: Record<string, number> = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const prog = progress[f.path];
      if (prog && prog.label && prog.label.trim() !== "") {
        count++;
        counts[prog.label] = (counts[prog.label] || 0) + 1;
      }
    }
    return { labeledCount: count, labelCounts: counts };
  }, [files, progress]);

  const unlabeledCount = useMemo(() => Math.max(0, totalCount - labeledCount), [totalCount, labeledCount]);

  // Filter queues - Memoized to prevent heavy re-filtering and identity changes on every render
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      // 1. Searched name match
      const matchesSearch = f.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            f.relativePath.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      // 2. Filter selection
      const isLabeled = progress[f.path]?.label !== undefined && progress[f.path]?.label !== "";
      if (filterType === 'unlabeled') return !isLabeled;
      if (filterType === 'labeled') return isLabeled;
      return true;
    });
  }, [files, searchTerm, filterType, progress]);

  // Pagination engine for massive audio scales (e.g. 20000+ items)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType]);

  const totalFilteredCount = filteredFiles.length;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalFilteredCount / itemsPerPage)), [totalFilteredCount, itemsPerPage]);
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * itemsPerPage;

  // Memoize paginated slice to ensure stable array identity when contents don't change
  const paginatedFiles = useMemo(() => {
    return filteredFiles.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredFiles, startIndex, itemsPerPage]);

  // A stringified representation of the file paths on the current page.
  // This acts as a highly stable dependency for our metadata preloading effect,
  // preventing it from tearing down and restarting when irrelevant states (e.g. playback timer) update.
  const paginatedFilePaths = useMemo(() => {
    return paginatedFiles.map(f => f.path).join(',');
  }, [paginatedFiles]);

  // Dynamic preloading of metadata for visible files
  useEffect(() => {
    const activeAudios: HTMLAudioElement[] = [];
    const urlsToRevoke: string[] = [];

    paginatedFiles.forEach(file => {
      if (cachedDurations[file.path] !== undefined) return;

      let streamUrl = file.path;
      let isTempUrl = false;
      if (file.path.startsWith('local-file://')) {
        streamUrl = createTempLocalFileUrl(file.path);
        isTempUrl = streamUrl.startsWith('blob:');
      } else if (!file.path.startsWith('blob:')) {
        streamUrl = `/api/stream?filePath=${encodeURIComponent(file.path)}`;
      }

      const audio = new Audio();
      audio.src = streamUrl;
      audio.preload = "metadata";

      const cleanupTempUrl = () => {
        if (isTempUrl && streamUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(streamUrl);
          } catch (e) {
            // ignore
          }
        }
      };

      const handleLoaded = () => {
        const d = audio.duration;
        if (d && !isNaN(d) && d !== Infinity) {
          setCachedDurations(prev => ({
            ...prev,
            [file.path]: d
          }));
        }
        cleanupTempUrl();
      };

      const handleError = () => {
        setCachedDurations(prev => ({
          ...prev,
          [file.path]: 30 // fallback
        }));
        cleanupTempUrl();
      };

      audio.addEventListener('loadedmetadata', handleLoaded);
      audio.addEventListener('error', handleError);
      audio.load();

      activeAudios.push(audio);
      if (isTempUrl) {
        urlsToRevoke.push(streamUrl);
      }
    });

    return () => {
      activeAudios.forEach(audio => {
        audio.src = '';
        audio.load();
      });
      // Cleanup any remaining temporary URLs just in case
      urlsToRevoke.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          // ignore
        }
      });
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [paginatedFilePaths]);

  const handleJumpToCurrent = () => {
    if (!currentFile) return;
    const fileIdx = filteredFiles.findIndex(f => f.path === currentFile.path);
    if (fileIdx !== -1) {
      const targetPage = Math.floor(fileIdx / itemsPerPage) + 1;
      setCurrentPage(targetPage);
    }
  };

  const currentFileIdxInFiltered = currentFile ? filteredFiles.findIndex(f => f.path === currentFile.path) : -1;
  const currentTrackPage = currentFileIdxInFiltered !== -1 ? Math.floor(currentFileIdxInFiltered / itemsPerPage) + 1 : -1;
  const isCurrentFileOnAnotherPage = currentTrackPage !== -1 && currentTrackPage !== activePage;

  return (
    <div id="queue-list-container" className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      {/* Metrics breakdown board */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] text-slate-400 font-extrabold block uppercase tracking-wider">
            {lang === 'zh' ? '工作区标注指标 & 状态统计 (Metrics Breakdown)' : 'Workspace Annotation Metrics Breakdown'}
          </span>
          {files.length > 0 && onClearFiles && (
            <button
              type="button"
              onClick={onClearFiles}
              className="text-[11px] text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-2.5 py-1 rounded-md flex items-center gap-1 font-bold transition-all shadow-3xs cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {lang === 'zh' ? `清空已加音频 (${files.length})` : `Clear Loaded Audios (${files.length})`}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
          <div className="bg-slate-50 border border-slate-200/50 rounded-lg p-3">
            <span className="text-[10px] text-slate-500 block">{lang === 'zh' ? '音频总数' : 'Total Audios'}</span>
            <span className="text-xl font-extrabold text-slate-800 font-mono inline-flex items-center gap-1">
              <Music className="w-4 h-4 text-slate-400" />
              {totalCount}
            </span>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-200/40 rounded-lg p-3">
            <span className="text-[10px] text-emerald-700 block">{lang === 'zh' ? '已打标签' : 'Labeled Qty'}</span>
            <span className="text-xl font-extrabold text-emerald-600 font-mono inline-flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              {labeledCount}
            </span>
          </div>

          <div className="bg-indigo-50/40 border border-indigo-200/30 rounded-lg p-3">
            <span className="text-[10px] text-indigo-700 block">{lang === 'zh' ? '任务完成率' : 'Completion Rate'}</span>
            <span className="text-xl font-extrabold text-indigo-600 font-mono">
              {totalCount > 0 ? `${Math.round((labeledCount / totalCount) * 100)}%` : "0%"}
            </span>
          </div>

          <div className="bg-amber-50/40 border border-amber-200/30 rounded-lg p-3">
            <span className="text-[10px] text-amber-700 block">{lang === 'zh' ? '待完成数量' : 'Remaining Unlabeled'}</span>
            <span className="text-xl font-extrabold text-amber-600 font-mono">
              {unlabeledCount}
            </span>
          </div>
        </div>
      </div>

      {/* Label counts badges widget */}
      {labeledCount > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50/60 rounded-lg border border-slate-100 items-center">
          <span className="text-[10px] text-slate-400 font-semibold mr-1">
            {lang === 'zh' ? '标签分布:' : 'Label Distribution:'}
          </span>
          {Object.entries(labelCounts).map(([labelName, count]) => {
            // Pick a matching display badge or default standard text gray
            let badgeBg = "bg-slate-100 text-slate-700";
            if (labelName === "饥饿") badgeBg = "bg-red-50 text-red-700 border-red-200";
            if (labelName === "不舒服") badgeBg = "bg-amber-50 text-amber-700 border-amber-200";
            if (labelName === "犯困") badgeBg = "bg-blue-50 text-blue-700 border-blue-200";
            if (labelName === "需要拍嗝") badgeBg = "bg-emerald-50 text-emerald-700 border-emerald-200";
            if (labelName === "烦躁") badgeBg = "bg-violet-50 text-violet-700 border-violet-200";

            // Localize label name
            let localizedName = labelName;
            if (labelName === "饥饿") localizedName = t.hungry;
            else if (labelName === "不舒服") localizedName = t.uncomfortable;
            else if (labelName === "犯困") localizedName = t.sleepy;
            else if (labelName === "需要拍嗝") localizedName = t.burp;
            else if (labelName === "烦躁") localizedName = t.agitated;

            return (
              <span
                key={labelName}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeBg}`}
              >
                {localizedName}: <b className="font-mono text-[11px] font-extrabold">{count}</b>
              </span>
            );
          })}
        </div>
      )}

      {/* Toggles & Player Mode selectors */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 pt-2 border-t border-slate-150">
        
        {/* Toggle order/random */}
        <div className="flex items-center gap-1 text-slate-600">
          <span className="text-xs font-semibold mr-2 text-slate-700">
            {lang === 'zh' ? '播放序列：' : 'Playback Sequence:'}
          </span>
          <button
            type="button"
            onClick={() => setPlaybackMode('order')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              playbackMode === 'order'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>{t.orderPlayback}</span>
          </button>

          <button
            type="button"
            onClick={() => setPlaybackMode('random')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              playbackMode === 'random'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>{t.randomPlayback}</span>
          </button>
        </div>

        {/* Filter Selection Tabs */}
        <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              filterType === 'all' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.all} ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('unlabeled')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              filterType === 'unlabeled' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.unlabeled} ({unlabeledCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('labeled')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              filterType === 'labeled' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.labeled} ({labeledCount})
          </button>
        </div>
      </div>

      {/* Playlist List Panel */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder={lang === 'zh' ? "搜索音频文件名 / 路径进行定位筛选..." : "Search audio files / paths..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5 text-xs focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-800"
        />

        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100">
          {totalFilteredCount === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs">
              {lang === 'zh' ? '无匹配条件的音频文件，请通过扫描目录或拖入加载。' : 'No matching audio files found. Load files by dragging them or scanning a folder.'}
            </div>
          ) : (
            paginatedFiles.map((file, idx) => {
              const absoluteIdx = startIndex + idx;
              const isCurrent = currentFile?.path === file.path;
              const fileProgress = progress[file.path];
              const savedLabel = fileProgress?.label;
              const hasTag = savedLabel !== undefined && savedLabel !== "";
              const playCount = fileProgress?.playCount || 0;
              const hasPlayed = playCount > 0;

              const fileDuration = cachedDurations[file.path];
              const durationStr = formatItemDuration(fileDuration);
              const loopsNeeded = getLoopCount(fileDuration);

              let badgeColor = "bg-indigo-100 text-indigo-700 border-indigo-200";
              if (savedLabel === "饥饿") badgeColor = "bg-red-100 text-red-800 border-red-200";
              if (savedLabel === "不舒服") badgeColor = "bg-amber-100 text-amber-800 border-amber-200";
              if (savedLabel === "犯困") badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
              if (savedLabel === "需要拍嗝") badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";
              if (savedLabel === "烦躁") badgeColor = "bg-violet-100 text-violet-800 border-violet-200";

              let displayTag = savedLabel;
              if (savedLabel === "饥饿") displayTag = t.hungry;
              else if (savedLabel === "不舒服") displayTag = t.uncomfortable;
              else if (savedLabel === "犯困") displayTag = t.sleepy;
              else if (savedLabel === "需要拍嗝") displayTag = t.burp;
              else if (savedLabel === "烦躁") displayTag = t.agitated;

              return (
                <div
                  key={file.absolutePath || file.path || file.name}
                  id={`track-${absoluteIdx}`}
                  onClick={() => onSelectTrack(file)}
                  className={`flex items-center justify-between p-3 transition-colors text-xs cursor-pointer group ${
                    isCurrent
                      ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600 font-medium'
                      : 'hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate">
                    {/* State Icon */}
                    {isCurrent ? (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center relative shadow-3xs animate-pulse">
                        <Volume className="w-3.5 h-3.5" />
                      </div>
                    ) : hasTag ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 border border-slate-200 group-hover:bg-slate-200">
                        <span className="font-mono text-[10px]">{absoluteIdx + 1}</span>
                      </div>
                    )}

                    <div className="truncate">
                      <span className={`block truncate text-slate-800 font-medium ${isCurrent ? 'text-indigo-900 font-semibold text-sm' : ''}`}>
                        {file.name}
                      </span>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2.5 text-[10px] text-slate-400 mt-0.5 font-mono">
                        <span className="truncate max-w-[150px] sm:max-w-[200px]" title={file.relativePath || file.path}>
                          {file.relativePath || file.path}
                        </span>
                        <span className="shrink-0 text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded text-[9px] border border-slate-200/60 font-bold">
                          {durationStr} ×{loopsNeeded}
                        </span>
                      </div>

                      {/* 5 inline classification label buttons under filename as in the screenshot */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {Object.entries(LABELS).map(([labelKey, details]) => {
                          const isSelected = savedLabel === details.label;
                          return (
                            <button
                              key={labelKey}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onSaveLabelForPath) {
                                  onSaveLabelForPath(file.path, details.label);
                                }
                              }}
                              className={`tag-btn px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-[#1a6655] border-[#1a6655] text-white selected-tag'
                                  : 'bg-slate-100/80 border-slate-200 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {lang === 'zh' ? details.label : (
                                details.label === '饥饿' ? t.hungry :
                                details.label === '不舒服' ? t.uncomfortable :
                                details.label === '犯困' ? t.sleepy :
                                details.label === '需要拍嗝' ? t.burp : t.agitated
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right side aligned information: Play counts, tags, and times */}
                  <div className="flex flex-col items-end justify-between text-right shrink-0 space-y-1 min-w-[120px]">
                    <span className={`text-[10px] font-mono font-semibold ${hasPlayed ? 'played-count-text text-orange-600' : 'text-slate-500'}`}>
                      {hasPlayed 
                        ? (lang === 'zh' ? `已播 ${playCount} 次` : `Played ${playCount}x`) 
                        : (lang === 'zh' ? '未播放' : 'Unplayed')}
                    </span>

                    <div>
                      {hasTag ? (
                        <span className={`border text-[10px] font-extrabold px-2 py-0.5 rounded-sm shadow-3xs ${badgeColor}`}>
                          {displayTag}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-sm opacity-60 group-hover:opacity-100 transition-opacity">
                          {lang === 'zh' ? '未标注' : 'Unlabeled'}
                        </span>
                      )}
                    </div>

                    {fileProgress?.lastPlayedAt && (
                      <span className="text-[9px] font-mono text-slate-400 timestamp-text">
                        {formatLocalDate(fileProgress.lastPlayedAt)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 text-xs">
            <span className="text-slate-500 font-medium text-center sm:text-left">
              {lang === 'zh' 
                ? `显示 ${startIndex + 1} - ${Math.min(startIndex + itemsPerPage, totalFilteredCount)}，共 ${totalFilteredCount} 个结果 (第 ${activePage}/${totalPages} 页)`
                : `Showing ${startIndex + 1} - ${Math.min(startIndex + itemsPerPage, totalFilteredCount)} of ${totalFilteredCount} items (Page ${activePage}/${totalPages})`}
            </span>
            <div className="flex items-center justify-center sm:justify-end gap-1">
              {isCurrentFileOnAnotherPage && (
                <button
                  type="button"
                  onClick={handleJumpToCurrent}
                  className="mr-1 text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-2 py-1 rounded-md font-bold cursor-pointer transition-colors"
                >
                  {lang === 'zh' ? `定位当前音轨 (第 ${currentTrackPage} 页)` : `Locate active track (Page ${currentTrackPage})`}
                </button>
              )}
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 disabled:hover:bg-white text-[10px] cursor-pointer"
              >
                {lang === 'zh' ? '上一页' : 'Previous'}
              </button>
              <button
                type="button"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 disabled:hover:bg-white text-[10px] cursor-pointer"
              >
                {lang === 'zh' ? '下一页' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
