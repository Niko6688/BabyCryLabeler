/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AudioFile {
  name: string;
  path: string;
  size: number;
  relativePath: string;
}

export type LabelKey = 'hungry' | 'uncomfortable' | 'sleepy' | 'burp' | 'fussy';

export const LABELS: Record<LabelKey, { label: string; color: string; keys: string[]; keywords: string[] }> = {
  hungry: {
    label: "饥饿",
    color: "bg-red-500 hover:bg-red-600 text-white shadow-red-200 focus:ring-red-300",
    keys: ["1"],
    keywords: ["hungry", "hunger", "饥饿", "feed"]
  },
  uncomfortable: {
    label: "不舒服",
    color: "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200 focus:ring-amber-300",
    keys: ["2"],
    keywords: ["uncomfortable", "pain", "不舒服", "painful"]
  },
  sleepy: {
    label: "犯困",
    color: "bg-blue-500 hover:bg-blue-600 text-white shadow-blue-200 focus:ring-blue-300",
    keys: ["3"],
    keywords: ["sleepy", "tired", "drowsy", "犯困"]
  },
  burp: {
    label: "需要拍嗝",
    color: "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-200 focus:ring-emerald-300",
    keys: ["4"],
    keywords: ["burp", "gas", "wind", "需要拍嗝"]
  },
  fussy: {
    label: "烦躁",
    color: "bg-violet-500 hover:bg-violet-600 text-white shadow-violet-200 focus:ring-violet-300",
    keys: ["5"],
    keywords: ["fussy", "irritable", "cranky", "烦躁"]
  }
};

export type LabelMode = 'manual' | 'clipboard' | 'file';

export type PlaybackMode = 'order' | 'random';

export interface ProgressData {
  [filePath: string]: {
    label: string;
    time: string;
  };
}
