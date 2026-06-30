/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BarChart3, CheckCircle, Music, Clock, TrendingUp, ShieldAlert, PieChart, Info, HelpCircle } from 'lucide-react';
import { AudioFile, ProgressData } from '../types';

interface StatisticsDashboardProps {
  files: AudioFile[];
  progress: ProgressData;
}

export default function StatisticsDashboard({ files, progress }: StatisticsDashboardProps) {
  // 1. Calculate General Metrics
  const totalCount = files.length;
  const labeledCount = files.filter(f => progress[f.path]?.label !== undefined && progress[f.path]?.label !== "").length;
  const unlabeledCount = Math.max(0, totalCount - labeledCount);
  const completionRate = totalCount > 0 ? (labeledCount / totalCount) * 100 : 0;

  // 2. Statistics breakdown of labels
  const labelCounts: Record<string, number> = {
    "饥饿": 0,
    "不舒服": 0,
    "犯困": 0,
    "需要拍嗝": 0,
    "烦躁": 0
  };

  // Track any custom or uncategorized labels
  let otherCount = 0;
  const otherLabels: Record<string, number> = {};

  files.forEach(f => {
    const prog = progress[f.path];
    if (prog && prog.label) {
      if (labelCounts[prog.label] !== undefined) {
        labelCounts[prog.label]++;
      } else {
        otherLabels[prog.label] = (otherLabels[prog.label] || 0) + 1;
        otherCount++;
      }
    }
  });

  // Calculate percentages based on labeled items (or total files, let's show relative to labeled for clear share ratio)
  const totalLabeled = labeledCount;

  const labelConfig: Record<string, { color: string; textClass: string; bgClass: string; borderClass: string; icon: string }> = {
    "饥饿": {
      color: "from-red-500 to-rose-400",
      textClass: "text-red-600",
      bgClass: "bg-red-50",
      borderClass: "border-red-150",
      icon: "🍼"
    },
    "不舒服": {
      color: "from-amber-500 to-yellow-400",
      textClass: "text-amber-600",
      bgClass: "bg-amber-50",
      borderClass: "border-amber-150",
      icon: "🤒"
    },
    "犯困": {
      color: "from-blue-500 to-indigo-400",
      textClass: "text-blue-600",
      bgClass: "bg-blue-50",
      borderClass: "border-blue-150",
      icon: "😴"
    },
    "需要拍嗝": {
      color: "from-emerald-500 to-teal-400",
      textClass: "text-emerald-600",
      bgClass: "bg-emerald-50",
      borderClass: "border-emerald-150",
      icon: "💨"
    },
    "烦躁": {
      color: "from-violet-500 to-purple-400",
      textClass: "text-violet-600",
      bgClass: "bg-violet-50",
      borderClass: "border-violet-150",
      icon: "🥺"
    }
  };

  // Find most frequent label (excluding zero occurrences)
  let maxLabel = "";
  let maxLabelCount = 0;
  Object.entries(labelCounts).forEach(([labelName, count]) => {
    if (count > maxLabelCount) {
      maxLabelCount = count;
      maxLabel = labelName;
    }
  });
  Object.entries(otherLabels).forEach(([labelName, count]) => {
    if (count > maxLabelCount) {
      maxLabelCount = count;
      maxLabel = labelName;
    }
  });

  return (
    <div id="statistics-dashboard" className="bg-white rounded-xl border border-slate-200 p-5 space-y-5 shadow-3xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-indigo-50 text-indigo-700 rounded-md">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="font-semibold text-slate-800 text-md">2. 标注数据占比统计分析</h2>
        </div>
        <span className="text-[10px] text-slate-400 font-mono tracking-wider font-semibold">
          REAL-TIME DATA INSIGHTS
        </span>
      </div>

      {totalCount === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2">
          <PieChart className="w-8 h-8 text-slate-300 stroke-[1.5]" />
          <span>暂无音频队列，无法生成标注统计图表。请载入音频文件。</span>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Bento-grid Analytics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            
            {/* Left Box: SVG Gauge & Speedometer style */}
            <div className="md:col-span-5 bg-slate-50 border border-slate-150/70 rounded-xl p-4 flex flex-col items-center justify-center relative overflow-hidden">
              <span className="text-[10px] text-slate-400 font-bold block mb-3 uppercase tracking-wider self-start">
                标注覆盖率 (Coverage)
              </span>
              
              <div className="relative w-28 h-28 flex items-center justify-center">
                {/* SVG Radial Progress */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  {/* Track Circle */}
                  <path
                    className="text-slate-150"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  {/* Active Circle with strokeDasharray */}
                  <path
                    className="text-indigo-600 transition-all duration-500 ease-out"
                    strokeDasharray={`${completionRate}, 100`}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>

                <div className="absolute text-center">
                  <span className="text-2xl font-black text-slate-800 font-mono tracking-tight block">
                    {Math.round(completionRate)}%
                  </span>
                  <span className="text-[9px] text-slate-400 font-semibold block">
                    {labeledCount} / {totalCount} 个
                  </span>
                </div>
              </div>

              {/* Status footer with custom message */}
              <div className="mt-4 text-center">
                {completionRate === 100 ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" />
                     已达成 100% 满标！
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-semibold">
                    剩余 <strong className="text-indigo-600 font-mono font-bold">{unlabeledCount}</strong> 首音轨待标注
                  </span>
                )}
              </div>
            </div>

            {/* Right Box: Key Insights / Smart Summary */}
            <div className="md:col-span-7 bg-indigo-950/5 border border-indigo-950/10 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-bold block mb-2.5 uppercase tracking-wider">
                  标注快照洞察 (Insights Snapshot)
                </span>
                
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1 bg-white border border-slate-100 rounded-md text-xs shadow-3xs mt-0.5">
                      📈
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 font-medium">哭声核心分布特征</p>
                      {maxLabelCount > 0 ? (
                        <p className="text-xs text-slate-800 font-bold mt-0.5">
                          主导诱因是 <span className="text-indigo-600">「{maxLabel}」</span>，累计已达标 <strong className="font-mono text-indigo-700">{maxLabelCount}</strong> 次。
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-0.5">
                          等待第一条标注结果以生成统计结论。
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 border-t border-slate-100 pt-2.5">
                    <div className="p-1 bg-white border border-slate-100 rounded-md text-xs shadow-3xs mt-0.5">
                      ⏱️
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 font-medium">训练数据有效性</p>
                      <p className="text-xs text-slate-700 font-semibold mt-0.5 leading-snug">
                        每个已标注音频要求连播满足至少 30 秒。此举可大幅丰富声学特征深度，让看护端长效监测准确率提升至 95%+！
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-slate-100 text-[10px] text-slate-400 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>导出功能将以 progress 映射状态输出。</span>
              </div>
            </div>
          </div>

          {/* Label Distribution Progress Track bars */}
          <div className="space-y-3 pt-1">
            <span className="text-[10px] text-slate-400 font-bold block mb-2 uppercase tracking-wider">
              具体各维度标签占比明细 (Distribution Details)
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(labelCounts).map(([labelName, count]) => {
                const conf = labelConfig[labelName] || {
                  color: "from-slate-500 to-slate-400",
                  textClass: "text-slate-600",
                  bgClass: "bg-slate-50",
                  borderClass: "border-slate-200",
                  icon: "❓"
                };

                // Percentage relative to labeled files
                const labeledRate = totalLabeled > 0 ? (count / totalLabeled) * 100 : 0;
                // Percentage relative to ALL scanned files
                const absoluteRate = totalCount > 0 ? (count / totalCount) * 100 : 0;

                return (
                  <div
                    key={labelName}
                    className={`p-3 rounded-xl border ${conf.bgClass} ${conf.borderClass} transition-all relative overflow-hidden`}
                  >
                    <div className="flex justify-between items-center mb-1.5 relative z-10">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{conf.icon}</span>
                        <span className="text-xs font-bold text-slate-800">{labelName}</span>
                      </div>
                      <div className="text-right font-mono text-[11px] font-bold">
                        <span className="text-slate-700">{count} 份</span>
                        <span className="text-slate-400 ml-1.5">({Math.round(labeledRate)}%)</span>
                      </div>
                    </div>

                    {/* Clean background tracks */}
                    <div className="h-2 w-full bg-slate-200/60 rounded-full overflow-hidden relative shadow-inner">
                      <div
                        className={`h-full bg-gradient-to-r ${conf.color} rounded-full transition-all duration-300`}
                        style={{ width: `${labeledRate}%` }}
                      />
                    </div>

                    {/* Sub text info */}
                    <div className="flex justify-between text-[9px] text-slate-400 mt-1 font-mono">
                      <span>占已标: {Math.round(labeledRate)}%</span>
                      <span>占队列: {Math.round(absoluteRate)}%</span>
                    </div>
                  </div>
                );
              })}

              {/* Unique Box for Others if any exist */}
              {otherCount > 0 && (
                <div className="p-3 rounded-xl border bg-slate-50 border-slate-200 transition-all relative overflow-hidden">
                  <div className="flex justify-between items-center mb-1.5 relative z-10">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">⚙️</span>
                      <span className="text-xs font-bold text-slate-800">自定义/其他</span>
                    </div>
                    <div className="text-right font-mono text-[11px] font-bold">
                      <span className="text-slate-700">{otherCount} 份</span>
                      <span className="text-slate-400 ml-1.5">({Math.round((otherCount / totalLabeled) * 100)}%)</span>
                    </div>
                  </div>

                  <div className="h-2 w-full bg-slate-200/60 rounded-full overflow-hidden relative shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-slate-500 to-slate-400 rounded-full transition-all duration-300"
                      style={{ width: `${(otherCount / totalLabeled) * 100}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[9px] text-slate-400 mt-1 font-mono">
                    <span>占已标: {Math.round((otherCount / totalLabeled) * 100)}%</span>
                    <span>占队列: {Math.round((otherCount / totalCount) * 100)}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
