/**
 * 🌸 浏览器本地巨量音频文件多路复用缓存引擎 🌸
 * 
 * 专门针对 20000+ 首超大规模音频文件设计。
 * 1. 传统内存瓶颈：一次性生成 2 万个 `URL.createObjectURL` 会瞬间耗尽浏览器 Blob 内存句柄并极速卡死。
 * 2. 优化方案：采用“即用即建，不用即销”的懒加载生命周期模型，只有在播放或激活指定音轨时才在内存中生成唯一的 Blob URL。
 * 3. 内存释放：每次激活新音轨时调用 `revokeObjectURL` 彻底销毁上一条不再播放的本地临时句柄，确保内存占用恒定保持在几KB，彻底告别崩溃！
 */

import { AudioFile } from '../types';

export const localFileMap = new Map<string, File>();
let activeObjectUrl: string | null = null;

/**
 * 批量注册大量本地音频，将其高效缓存在内存 Map 中，返回极轻量的元数据列表，避免任何庞大的 Blob 耗时
 */
export function registerLocalFiles(files: File[]): AudioFile[] {
  const list: AudioFile[] = [];
  const suffix = Date.now();
  files.forEach((file, index) => {
    // 构造极轻量、高度唯一的 path 索引键 (不存储 Blob 字符串，只做映射句柄)
    const key = `local-file://${file.name}-${file.size}-${index}-${suffix}`;
    localFileMap.set(key, file);
    list.push({
      name: file.name,
      path: key,
      size: file.size,
      relativePath: `[在线选择] ${file.name}`
    });
  });
  return list;
}

/**
 * 懒加载动态产生当前激活音频的 URL。同时精确回收上个激活 URL，维持极高安全边际
 */
export function getLocalFileUrl(path: string): string {
  if (path.startsWith('local-file://')) {
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch (err) {
        // ignore
      }
      activeObjectUrl = null;
    }
    const file = localFileMap.get(path);
    if (file) {
      activeObjectUrl = URL.createObjectURL(file);
      return activeObjectUrl;
    }
  }
  return path;
}

/**
 * 清空重置文件池所有句柄
 */
export function clearAllLocalFiles() {
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch (err) {
      // ignore
    }
    activeObjectUrl = null;
  }
  localFileMap.clear();
}
