/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipForward, Square, RotateCcw, Volume2, Sparkles, Infinity as InfinityIcon } from 'lucide-react';
import { AudioFile } from '../types';
import { getLocalFileUrl } from '../lib/localFilesRegistry';

interface AudioPlayerProps {
  currentFile: AudioFile | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onTrackEnd: () => void; // Triggered when fully completed (loops finished)
  onSkip: () => void;
  onStop: () => void;
  isWaitingInterval: boolean;
  waitingSecondsLeft: number;
  skipWaitAfterLastTrack: boolean;
  setSkipWaitAfterLastTrack: (skip: boolean) => void;
}

export default function AudioPlayer({
  currentFile,
  isPlaying,
  setIsPlaying,
  onTrackEnd,
  onSkip,
  onStop,
  isWaitingInterval,
  waitingSecondsLeft,
  skipWaitAfterLastTrack,
  setSkipWaitAfterLastTrack
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Waveform visualization states
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [isLoadingPeaks, setIsLoadingPeaks] = useState(false);

  // Monitor audio binary data and extract peak amplitude nodes for real-time soundwave mapping
  useEffect(() => {
    if (!currentFile) {
      setAudioPeaks([]);
      return;
    }

    let streamUrl = currentFile.path;
    if (currentFile.path.startsWith('local-file://')) {
      streamUrl = getLocalFileUrl(currentFile.path);
    } else if (!currentFile.path.startsWith('blob:')) {
      streamUrl = `/api/stream?filePath=${encodeURIComponent(currentFile.path)}&t=${Date.now()}`;
    }

    setIsLoadingPeaks(true);
    let active = true;

    const loadRealPeaks = async () => {
      try {
        const response = await fetch(streamUrl);
        if (!response.ok) throw new Error('Fetch audio stream failed');
        const arrayBuffer = await response.arrayBuffer();
        
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) throw new Error('No AudioContext support');
        const audioCtx = new AudioCtx();
        
        // decodeAudioData
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0); // Left channel peak samples
        
        const numPoints = 120; // Exact count of visualizer bars
        const step = Math.floor(channelData.length / numPoints);
        const peaks: number[] = [];
        
        for (let i = 0; i < numPoints; i++) {
          let max = 0;
          const start = i * step;
          const end = Math.min(start + step, channelData.length);
          for (let j = start; j < end; j++) {
            const val = Math.abs(channelData[j]);
            if (val > max) max = val;
          }
          peaks.push(max);
        }
        
        await audioCtx.close();
        
        if (active) {
          // Normalize peaks for balanced visual height
          const maxPeak = Math.max(...peaks, 0.05);
          const normalized = peaks.map(p => p / maxPeak);
          setAudioPeaks(normalized);
          setIsLoadingPeaks(false);
        }
      } catch (err) {
        console.warn("Could not decode audio peaks, falling back to mock peaks:", err);
        // Fallback: Generate a high-fidelity visual matching pattern reflecting silent and active portions
        if (active) {
          const dummyPeaks: number[] = [];
          const numPoints = 120;
          let seed = 0;
          if (currentFile.name) {
            for (let i = 0; i < currentFile.name.length; i++) {
              seed += currentFile.name.charCodeAt(i);
            }
          }
          
          for (let i = 0; i < numPoints; i++) {
            // Seeded sin/cos generation with elegant quiet blocks
            const section = Math.floor(i / 15);
            const isSilentBlock = (section % 3 === 0 && i % 5 !== 0) || (section % 5 === 4 && i % 7 !== 0);
            if (isSilentBlock) {
              dummyPeaks.push(0.01 + Math.abs(Math.sin(i * 0.2)) * 0.04);
            } else {
              const val = Math.abs(Math.sin(i * 0.12 + seed)) * 0.45 + Math.abs(Math.cos(i * 0.35)) * 0.45;
              dummyPeaks.push(Math.min(1.0, Math.max(0.12, val)));
            }
          }
          setAudioPeaks(dummyPeaks);
          setIsLoadingPeaks(false);
        }
      }
    };

    loadRealPeaks();

    return () => {
      active = false;
    };
  }, [currentFile]);

  // Stats / loops tracking
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopsNeeded, setLoopsNeeded] = useState(1);
  const [currentLoop, setCurrentLoop] = useState(1);
  const [accumulatedPlayTime, setAccumulatedPlayTime] = useState(0);

  // Volume control State
  const [volume, setVolume] = useState(0.8);

  // Initialize and load new file
  useEffect(() => {
    if (audioRef.current && currentFile) {
      // Stream path (support local File blobs in the browser sandbox mode)
      let streamUrl = currentFile.path;
      if (currentFile.path.startsWith('local-file://')) {
        streamUrl = getLocalFileUrl(currentFile.path);
      } else if (!currentFile.path.startsWith('blob:')) {
        streamUrl = `/api/stream?filePath=${encodeURIComponent(currentFile.path)}&t=${Date.now()}`;
      }
      audioRef.current.src = streamUrl;
      audioRef.current.load();
      audioRef.current.volume = volume;

      // Reset local file execution stats
      setCurrentTime(0);
      setDuration(0);
      setLoopsNeeded(1);
      setCurrentLoop(1);
      setAccumulatedPlayTime(0);

      if (isPlaying) {
        audioRef.current.play().catch(() => {
          // Auto-play was blocked or failed
          setIsPlaying(false);
        });
      }
    } else if (!currentFile && audioRef.current) {
      audioRef.current.pause();
    }
  }, [currentFile]);

  // Handle Play / Pause commands
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying && currentFile && !isWaitingInterval) {
      audioRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, isWaitingInterval]);

  // Audio metadata loaded handler
  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    const fileDuration = audioRef.current.duration;
    if (!fileDuration || isNaN(fileDuration)) {
      setDuration(30); // fallback
      return;
    }
    setDuration(fileDuration);

    // Calculate loops: At least 30 seconds total duration
    const minRequiredDuration = 30;
    const needed = Math.ceil(minRequiredDuration / fileDuration);
    setLoopsNeeded(needed > 0 ? needed : 1);
  };

  // Monitor playback details
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  // Handle local track audio loop cycles
  const handleAudioEnded = () => {
    if (!audioRef.current) return;

    if (currentLoop < loopsNeeded) {
      // Loop again!
      setCurrentLoop(prev => prev + 1);
      setAccumulatedPlayTime(prev => prev + duration);
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      // Fully completed the required sequential length
      onTrackEnd();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
    }
  };

  // Format seconds to MM:SS
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Calculate percentage of track play
  const playProgress = duration > 0 ? (currentTime / duration) * 100 : 0;
  // Calculate total integrated progress across loops
  const totalTargetTime = Math.max(30, Math.ceil(duration) * loopsNeeded);
  const currentTotalPassed = accumulatedPlayTime + currentTime;
  const overallProgressPercent = totalTargetTime > 0 ? Math.min(100, (currentTotalPassed / totalTargetTime) * 100) : 0;

  // Jump to specific playback location on waveform click
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration || duration === Infinity) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const targetTime = percentage * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  return (
    <div id="audio-player-container" className="bg-slate-900 text-white rounded-xl border border-slate-800 shadow-xl p-6 relative overflow-hidden">
      {/* Decorative background grid and blurs */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-indigo-500/10 to-transparent pointer-events-none" />
      <div className="absolute top-10 right-10 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* HTML Audio element */}
      <audio
        ref={audioRef}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleAudioEnded}
      />

      {/* Main Track info layout */}
      <div className="relative space-y-5">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <span className="text-[10px] text-indigo-400 bg-indigo-500/15 border border-indigo-500/20 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider">
              2. 音频控制台
            </span>
            <h3 className="font-bold text-lg text-slate-100 tracking-tight line-clamp-1">
              {currentFile ? currentFile.name : '等待扫描并开始播放'}
            </h3>
            <p className="text-xs text-slate-400 font-mono select-all line-clamp-1">
              {currentFile ? currentFile.path : '请先在上方进行目录扫描...'}
            </p>
          </div>

          {/* Skip waiting toggle */}
          <div className="flex items-center space-x-2 text-xs bg-slate-800/80 border border-slate-700/60 rounded-lg p-2 shrink-0">
            <label className="text-[11px] text-slate-300 font-medium cursor-pointer" htmlFor="skip-wait-cb">
              最后一首播完不等待
            </label>
            <input
              id="skip-wait-cb"
              type="checkbox"
              checked={skipWaitAfterLastTrack}
              onChange={(e) => setSkipWaitAfterLastTrack(e.target.checked)}
              className="accent-indigo-500 rounded border-slate-700 w-3.5 h-3.5 cursor-pointer"
            />
          </div>
        </div>

        {/* Playback Stats Dashboard */}
        {currentFile && !isWaitingInterval && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-800/40 p-4 rounded-xl border border-slate-800/80">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">单曲时长</span>
              <span className="text-sm font-semibold text-slate-200 font-mono">
                {formatTime(duration)}
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">所需循环次数</span>
              <span className="text-sm font-semibold text-indigo-400 flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="font-mono">{loopsNeeded} 次</span>
                <span className="text-[10px] text-slate-500">(时长 &lt; 30s 自动)</span>
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">当前播放循环</span>
              <span className="text-sm font-semibold text-emerald-400 font-mono">
                第 {currentLoop} / {loopsNeeded} 轮
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 block">累计播放时长</span>
              <span className="text-sm font-semibold text-amber-400 font-mono">
                {Math.floor(currentTime + accumulatedPlayTime)}s
                <span className="text-xs text-slate-500 font-normal"> / 最少30s</span>
              </span>
            </div>
          </div>
        )}

        {/* Waiting / Delay Countdown Display */}
        {isWaitingInterval ? (
          <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-6 text-center space-y-3 relative overflow-hidden animate-pulse">
            <div className="absolute inset-0 bg-linear-to-r from-amber-500/5 via-transparent to-amber-500/5 pointer-events-none" />
            <span className="text-xs text-amber-400 uppercase tracking-widest font-semibold block">
              两首音频随机间隔中 (用于分析与手机传输)
            </span>
            <div className="flex items-baseline justify-center space-x-1">
              <span className="text-4xl font-extrabold text-amber-400 font-mono">
                {waitingSecondsLeft}
              </span>
              <span className="text-sm text-amber-500">秒</span>
            </div>
            <p className="text-xs text-slate-400">
              倒计时结束后，将自动载入队列中的下一首未标记音频
            </p>
          </div>
        ) : (
          /* Normal Audio Player Progress Bars & Interactive Waveform Visualizer */
          <div className="space-y-4">
            {currentFile && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs text-slate-400 font-mono">
                  <span className="flex items-center gap-1.5 text-indigo-400">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    安全离线音频波形 (点击任意点跳转播放)
                  </span>
                  <span className="bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700 text-slate-300">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Main Interactive Waveform Track Container */}
                <div
                  id="waveform-visual-container"
                  onClick={handleWaveformClick}
                  className="relative h-18 w-full bg-slate-950/50 hover:bg-slate-950/80 border border-slate-800/80 rounded-xl px-4 flex flex-col justify-center cursor-pointer select-none group transition-all duration-200 shadow-inner overflow-hidden"
                  title="点击波形以调整播放进度"
                >
                  {/* Subtle Shimmer background effect during peak loading */}
                  {isLoadingPeaks && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent animate-[shimmer_1.5s_infinite] pointer-events-none" />
                  )}

                  {/* Top hover indicator */}
                  <div className="absolute inset-x-4 top-1 flex justify-between items-center text-[9px] pointer-events-none">
                    <span className="text-slate-600 font-mono">00:00</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-300 font-semibold tracking-wider uppercase text-[8px] bg-indigo-950/80 border border-indigo-800/40 px-1.5 py-0.5 rounded shadow-lg">
                      🎛️ 点击这里快速跳转播放位置
                    </span>
                    <span className="text-slate-600 font-mono">{formatTime(duration)}</span>
                  </div>

                  {/* Waveform Peak Bars Layout */}
                  <div className="w-full h-11 flex items-center justify-between gap-[2px] pt-3">
                    {audioPeaks.length > 0 ? (
                      audioPeaks.map((peak, idx) => {
                        const barProgress = (idx / audioPeaks.length) * 100;
                        const isPast = playProgress >= barProgress;
                        // Bar height representation based on calculated peak amplitudes
                        const barHeightPercent = Math.max(12, peak * 82);

                        return (
                          <div
                            key={idx}
                            className={`w-full rounded-sm transition-all duration-200 ${
                              isPast
                                ? 'bg-gradient-to-t from-indigo-500 via-violet-500 to-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]'
                                : 'bg-slate-800 hover:bg-slate-700'
                            }`}
                            style={{ height: `${barHeightPercent}%` }}
                          />
                        );
                      })
                    ) : (
                      /* Waveform loading / fallback skeleton bars */
                      [...Array(100)].map((_, idx) => (
                        <div
                          key={idx}
                          className="w-full bg-slate-800/50 rounded-sm animate-pulse"
                          style={{
                            height: `${15 + Math.abs(Math.sin(idx * 0.15)) * 40}%`,
                            animationDelay: `${idx * 0.01}s`,
                          }}
                        />
                      ))
                    )}
                  </div>

                  {/* Minimal progress pointer line along the wave */}
                  {duration > 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-[1.5px] bg-indigo-400 group-hover:bg-indigo-300 pointer-events-none transition-all duration-100"
                      style={{ left: `calc(${playProgress}% - 0.75px)` }}
                    >
                      <div className="w-2 h-2 bg-indigo-400 rounded-full -translate-x-[3.25px] border border-slate-900 shadow-sm" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {currentFile && loopsNeeded > 1 && (
              <div className="space-y-1.5 bg-slate-950/20 p-2.5 rounded-lg border border-slate-800/40">
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>累计达标时间最少 30 秒进度</span>
                  <span className="text-emerald-400 font-semibold">
                    {Math.min(30, Math.floor(currentTotalPassed))}s / 30s
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800/50">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-lg transition-all duration-150"
                    style={{ width: `${overallProgressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Volume & Audio Wave decorative animation & player controls Row */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-2 border-t border-slate-800/80">
          
          {/* Controls Box */}
          <div className="flex items-center space-x-3 order-2 md:order-1">
            {isPlaying ? (
              <button
                type="button"
                onClick={() => setIsPlaying(false)}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold p-3 rounded-full transition-all shadow-md hover:scale-105"
                title="暂停"
              >
                <Pause className="w-5 h-5 fill-slate-950" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (currentFile) {
                    setIsPlaying(true);
                  }
                }}
                disabled={!currentFile}
                className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold p-3 rounded-full transition-all shadow-md hover:scale-105 disabled:pointer-events-none"
                title="播放"
              >
                <Play className="w-5 h-5 fill-current ml-0.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onSkip}
              disabled={!currentFile}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 p-2.5 rounded-lg transition-all disabled:opacity-50"
              title="跳过当前并继续下一首"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onStop}
              disabled={!currentFile}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-red-400 p-2.5 rounded-lg transition-all disabled:opacity-50"
              title="暂停并停止播放状态"
            >
              <Square className="w-4 h-4 fill-red-400/20" />
            </button>
          </div>

          {/* Volume control block */}
          <div className="flex items-center space-x-2 text-slate-400 w-full md:w-48 order-1 md:order-2 justify-end">
            <Volume2 className="w-4 h-4 shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="w-full accent-indigo-500 bg-slate-800 rounded-lg appearance-auto h-1"
            />
          </div>
        </div>

        {/* Interactive soundwave graphics visualization */}
        {isPlaying && !isWaitingInterval && (
          <div className="flex items-center justify-center space-x-1 h-6 pt-1">
            {[...Array(16)].map((_, i) => {
              // Custom heights simulation
              const height = [12, 24, 16, 8, 20, 14, 24, 10, 18, 12, 22, 16, 8, 14, 20, 10][i];
              return (
                <div
                  key={i}
                  className="bg-indigo-500 rounded-full w-1 origin-bottom animate-bounce"
                  style={{
                    height: `${height}px`,
                    animationDuration: `${0.8 + (i % 5) * 0.15}s`,
                    animationDelay: `${i * 0.05}s`
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
