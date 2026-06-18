/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { PlayCircle, CheckCircle2, RotateCcw, Award, Music, Shuffle, AlignLeft, Layers, Volume, Trash2 } from 'lucide-react';
import { AudioFile, ProgressData } from '../types';

interface QueueListProps {
  files: AudioFile[];
  progress: ProgressData;
  currentFile: AudioFile | null;
  onSelectTrack: (file: AudioFile) => void;
  playbackMode: 'order' | 'random';
  setPlaybackMode: (mode: 'order' | 'random') => void;
  onClearFiles?: () => void;
}

export default function QueueList({
  files,
  progress,
  currentFile,
  onSelectTrack,
  playbackMode,
  setPlaybackMode,
  onClearFiles
}: QueueListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'unlabeled' | 'labeled'>('all');

  // Compute stats based only on loaded files
  const totalCount = files.length;
  const labeledCount = files.filter(f => progress[f.path] !== undefined).length;
  const unlabeledCount = Math.max(0, totalCount - labeledCount);

  // Breakdown metrics based only on loaded files
  const labelCounts: Record<string, number> = {};
  files.forEach(f => {
    const prog = progress[f.path];
    if (prog && prog.label) {
      labelCounts[prog.label] = (labelCounts[prog.label] || 0) + 1;
    }
  });

  // Filter queues
  const filteredFiles = files.filter(f => {
    // 1. Searched name match
    const matchesSearch = f.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          f.relativePath.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    // 2. Filter selection
    const isLabeled = progress[f.path] !== undefined;
    if (filterType === 'unlabeled') return !isLabeled;
    if (filterType === 'labeled') return isLabeled;
    return true;
  });

  // Pagination engine for massive audio scales (e.g. 20000+ items)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType]);

  const totalFilteredCount = filteredFiles.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / itemsPerPage));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * itemsPerPage;
  const paginatedFiles = filteredFiles.slice(startIndex, startIndex + itemsPerPage);

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
            工作区标注指标 & 状态统计 (Metrics Breakdown)
          </span>
          {files.length > 0 && onClearFiles && (
            <button
              type="button"
              onClick={onClearFiles}
              className="text-[11px] text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-2.5 py-1 rounded-md flex items-center gap-1 font-bold transition-all shadow-3xs cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空已加音频 ({files.length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
          <div className="bg-slate-50 border border-slate-200/50 rounded-lg p-3">
            <span className="text-[10px] text-slate-500 block">音频总数</span>
            <span className="text-xl font-extrabold text-slate-800 font-mono inline-flex items-center gap-1">
              <Music className="w-4 h-4 text-slate-400" />
              {totalCount}
            </span>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-200/40 rounded-lg p-3">
            <span className="text-[10px] text-emerald-700 block">已打标签</span>
            <span className="text-xl font-extrabold text-emerald-600 font-mono inline-flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              {labeledCount}
            </span>
          </div>

          <div className="bg-indigo-50/40 border border-indigo-200/30 rounded-lg p-3">
            <span className="text-[10px] text-indigo-700 block">待标注进度</span>
            <span className="text-xl font-extrabold text-indigo-600 font-mono">
              {totalCount > 0 ? `${Math.round((labeledCount / totalCount) * 100)}%` : "0%"}
            </span>
          </div>

          <div className="bg-amber-50/40 border border-amber-200/30 rounded-lg p-3">
            <span className="text-[10px] text-amber-700 block">待完成数量</span>
            <span className="text-xl font-extrabold text-amber-600 font-mono">
              {unlabeledCount}
            </span>
          </div>
        </div>
      </div>

      {/* Label counts badges widget */}
      {labeledCount > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50/60 rounded-lg border border-slate-100 items-center">
          <span className="text-[10px] text-slate-400 font-semibold mr-1">标签分布:</span>
          {Object.entries(labelCounts).map(([labelName, count]) => {
            // Pick a matching display badge or default standard text gray
            let badgeBg = "bg-slate-100 text-slate-700";
            if (labelName === "饥饿") badgeBg = "bg-red-50 text-red-700 border-red-200";
            if (labelName === "不舒服") badgeBg = "bg-amber-50 text-amber-700 border-amber-200";
            if (labelName === "犯困") badgeBg = "bg-blue-50 text-blue-700 border-blue-200";
            if (labelName === "需要拍嗝") badgeBg = "bg-emerald-50 text-emerald-700 border-emerald-200";
            if (labelName === "烦躁") badgeBg = "bg-violet-50 text-violet-700 border-violet-200";

            return (
              <span
                key={labelName}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeBg}`}
              >
                {labelName}: <b className="font-mono text-[11px] font-extrabold">{count}</b>
              </span>
            );
          })}
        </div>
      )}

      {/* Toggles & Player Mode selectors */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 pt-2 border-t border-slate-150">
        
        {/* Toggle order/random */}
        <div className="flex items-center gap-1 text-slate-600">
          <span className="text-xs font-semibold mr-2 text-slate-700">播放序列：</span>
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
            <span>顺序播放</span>
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
            <span>随机播放</span>
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
            全部 ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('unlabeled')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              filterType === 'unlabeled' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            未标注 ({unlabeledCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('labeled')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              filterType === 'labeled' ? 'bg-white text-slate-800 shadow-3xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            已标注 ({labeledCount})
          </button>
        </div>
      </div>

      {/* Playlist List Panel */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="搜索音频文件名 / 路径进行定位筛选..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5 text-xs focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-800"
        />

        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100">
          {totalFilteredCount === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs">
              无匹配条件的音频文件，请通过扫描目录或拖入加载。
            </div>
          ) : (
            paginatedFiles.map((file, idx) => {
              const absoluteIdx = startIndex + idx;
              const isCurrent = currentFile?.path === file.path;
              const hasTag = progress[file.path] !== undefined;
              const savedLabel = progress[file.path]?.label;

              let badgeColor = "bg-indigo-100 text-indigo-700 border-indigo-200";
              if (savedLabel === "饥饿") badgeColor = "bg-red-100 text-red-800 border-red-200";
              if (savedLabel === "不舒服") badgeColor = "bg-amber-100 text-amber-800 border-amber-200";
              if (savedLabel === "犯困") badgeColor = "bg-blue-100 text-blue-800 border-blue-200";
              if (savedLabel === "需要拍嗝") badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";
              if (savedLabel === "烦躁") badgeColor = "bg-violet-100 text-violet-800 border-violet-200";

              return (
                <div
                  key={file.path}
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
                      <span className="block truncate text-[10px] text-slate-400 font-mono mt-0.5">
                        {file.relativePath || file.path}
                      </span>
                    </div>
                  </div>

                  {/* Badges / Interaction triggers for tags */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {hasTag ? (
                      <span className={`border text-[10px] font-extrabold px-2 py-0.5 rounded-sm shadow-3xs ${badgeColor}`}>
                        {savedLabel}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-sm opacity-50 group-hover:opacity-100 transition-opacity">
                        未标注
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
              显示 {startIndex + 1} - {Math.min(startIndex + itemsPerPage, totalFilteredCount)}，共 {totalFilteredCount} 个结果 (第 {activePage}/{totalPages} 页)
            </span>
            <div className="flex items-center justify-center sm:justify-end gap-1">
              {isCurrentFileOnAnotherPage && (
                <button
                  type="button"
                  onClick={handleJumpToCurrent}
                  className="mr-1 text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 hover:border-indigo-200 px-2 py-1 rounded-md font-bold cursor-pointer transition-colors"
                >
                  定位当前音轨 (第 {currentTrackPage} 页)
                </button>
              )}
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 disabled:hover:bg-white text-[10px] cursor-pointer"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold disabled:opacity-40 disabled:hover:bg-white text-[10px] cursor-pointer"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
