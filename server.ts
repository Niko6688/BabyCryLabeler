import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// In packaged app environments, override process.cwd() gracefully to standard writable folders to avoid EACCES
if (process.env.USER_DATA_DIR) {
  const targetDir = path.resolve(process.env.USER_DATA_DIR);
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      console.error('Failed to pre-create environment directories:', e);
    }
  }
  process.cwd = () => targetDir;
}

// Define safe ESM / CommonJS path resolvers without variable redeclaration collisions in Node/Electron environment
const currentFilename = typeof __filename !== "undefined"
  ? __filename
  : fileURLToPath(import.meta.url || "file:");

const currentDirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(currentFilename);

const UPLOADED_PREFIX = "[uploaded]";

async function startServer() {
  const app = express();
  const PORT = 3000;
  console.log(`[Express] Starting server in NODE_ENV=${process.env.NODE_ENV}`);

  // Rate-limiting/deduplication map for playCount incrementing
  const lastPlayIncrementTimes: Record<string, number> = {};

  // Memory-resident labeling progress data loaded from progress.json at startup
  let progressMemory: Record<string, any> = {};

  // Helper to normalize absolute paths to prevent any mismatch after restart
  function normalizeAbsolutePath(p: string): string {
    if (!p) return "";
    if (p.startsWith("local-file://") || p.startsWith("blob:") || p.startsWith("[uploaded]")) {
      return p;
    }
    // Standardize backslashes to forward slashes (cross-compatibility)
    let normalized = p.replace(/\\/g, "/");
    // Resolve relative path to absolute
    normalized = path.resolve(normalized).replace(/\\/g, "/");
    // Remove any trailing slashes (except root '/')
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    // Convert drive letter to lowercase on Windows if present (e.g. C:/foo -> c:/foo)
    if (/^[A-Za-z]:\//.test(normalized)) {
      normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }
    return normalized;
  }

  // Memory-resident CSV rows cache to avoid scanning and formatting the entire database repeatedly
  const csvRowsCache = new Map<string, string>();

  // Helper to format a single progress memory row into a CSV line
  const formatRowToCsvLine = (key: string, item: any): string => {
    let absPath = item.absolutePath || "";
    if (key && !key.startsWith("[uploaded]") && !key.startsWith("local-file:") && !key.startsWith("blob:")) {
      absPath = key;
    }
    if (absPath.startsWith("[uploaded]") && key && !key.startsWith("[uploaded]") && !key.startsWith("local-file:") && !key.startsWith("blob:")) {
      absPath = key;
    }
    absPath = normalizeAbsolutePath(absPath);

    let tagsArr: string[] = [];
    const rawTags = item.tags || item.label || "";
    if (Array.isArray(rawTags)) {
      tagsArr = rawTags.map((t: any) => String(t).trim()).filter(Boolean);
    } else if (typeof rawTags === "string") {
      tagsArr = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    } else if (rawTags) {
      tagsArr = [String(rawTags).trim()];
    }
    const tagsStr = tagsArr.join(",");

    const playCount = typeof item.playCount === 'number' ? item.playCount : 0;
    const lastPlayedAt = item.lastPlayedAt || "";

    return [
      escapeCsv(item.name || ""),
      escapeCsv(item.rel || ""),
      escapeCsv(absPath),
      escapeCsv(tagsStr),
      playCount,
      escapeCsv(lastPlayedAt)
    ].join(",");
  };

  // Sequential write queue to prevent all concurrent filesystem writes (especially during high concurrency)
  const writeQueue: Array<() => Promise<void>> = [];
  let isQueueProcessing = false;

  const enqueueTask = (task: () => Promise<void>) => {
    writeQueue.push(task);
    processQueue();
  };

  const processQueue = async () => {
    if (isQueueProcessing) return;
    isQueueProcessing = true;
    while (writeQueue.length > 0) {
      const task = writeQueue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error("[Write Queue] Error executing task:", err);
        }
      }
    }
    isQueueProcessing = false;
  };

  let rebuildBothTimer: NodeJS.Timeout | null = null;
  let rebuildJsonTimer: NodeJS.Timeout | null = null;

  const writeProgressImmediately = () => {
    try {
      const progressPath = path.join(process.cwd(), "progress.json");
      const progressTmpPath = progressPath + ".tmp";
      
      // Deep copy progressMemory to prevent mutation during serialization
      const dataToSave = JSON.parse(JSON.stringify(progressMemory));

      // Write progress.json atomically immediately (critical data security, no queue, no debounce)
      fs.writeFileSync(progressTmpPath, JSON.stringify(dataToSave, null, 2), "utf-8");
      fs.renameSync(progressTmpPath, progressPath);
      console.log(`[Immediate Write] progress.json written successfully. Entries: ${Object.keys(dataToSave).length}`);
    } catch (err) {
      console.error("[Immediate Write] Error writing progress.json:", err);
    }
  };

  const triggerDebouncedBothRebuild = (delay: number) => {
    // Both rebuild covers JSON rebuild too, so cancel any pending JSON-only rebuilds
    if (rebuildJsonTimer) {
      clearTimeout(rebuildJsonTimer);
      rebuildJsonTimer = null;
    }
    if (rebuildBothTimer) {
      clearTimeout(rebuildBothTimer);
    }
    rebuildBothTimer = setTimeout(() => {
      enqueueTask(async () => {
        rebuildCSVAndJSON();
      });
      rebuildBothTimer = null;
    }, delay);
  };

  const triggerDebouncedJsonRebuild = (delay: number) => {
    // If a full rebuild is already scheduled, we don't need to trigger a separate JSON-only rebuild
    if (rebuildBothTimer) {
      return;
    }
    if (rebuildJsonTimer) {
      clearTimeout(rebuildJsonTimer);
    }
    rebuildJsonTimer = setTimeout(() => {
      enqueueTask(async () => {
        rebuildJSONOnly();
      });
      rebuildJsonTimer = null;
    }, delay);
  };

  const handleProgressUpdate = (key: string, isNewEntry: boolean, opType: "new-tag" | "edit-tag" | "play-update") => {
    // 1. Write progress.json IMMEDIATELY for data safety
    writeProgressImmediately();

    const item = progressMemory[key];
    const csvLine = formatRowToCsvLine(key, item);
    
    // Check if the key already exists in our CSV rows cache BEFORE updating it
    const keyAlreadyExistsInCsv = csvRowsCache.has(key);
    
    csvRowsCache.set(key, csvLine);

    if (opType === "new-tag" && !keyAlreadyExistsInCsv) {
      // Incremental append optimization: append the new row directly to CSV via queue atomically without rebuilding the whole file
      enqueueTask(async () => {
        try {
          const csvPath = path.join(process.cwd(), "labeled_output.csv");
          const csvTmpPath = csvPath + ".tmp";
          let existingContent = "";
          if (fs.existsSync(csvPath)) {
            existingContent = fs.readFileSync(csvPath, "utf-8");
          } else {
            existingContent = "\uFEFFname,rel,absolutePath,tags,playCount,lastPlayedAt\n";
          }
          if (existingContent && !existingContent.endsWith("\n")) {
            existingContent += "\n";
          }
          const newContent = existingContent + csvLine + "\n";
          fs.writeFileSync(csvTmpPath, newContent, "utf-8");
          fs.renameSync(csvTmpPath, csvPath);
          console.log(`[Queue CSV Append] Atomically appended new tagged track: ${key}`);
        } catch (err) {
          console.error("[Queue CSV Append] Failed to append, falling back to full rebuild:", err);
          rebuildCSVAndJSON();
        }
      });

      // JSON must always be rebuilt completely, but we limit frequency with 300ms debounce
      triggerDebouncedJsonRebuild(300);
    } else if (opType === "new-tag") {
      // Key existed, but got labeled. Rebuild BOTH with 300ms debounce.
      triggerDebouncedBothRebuild(300);
    } else if (opType === "edit-tag") {
      // Editing an existing tag. Rebuild BOTH with 300ms debounce (per user instruction: "修改已有标注：防抖300ms后全量重建")
      triggerDebouncedBothRebuild(300);
    } else if (opType === "play-update") {
      // Playbeat statistics update.
      if (!keyAlreadyExistsInCsv) {
        enqueueTask(async () => {
          try {
            const csvPath = path.join(process.cwd(), "labeled_output.csv");
            const csvTmpPath = csvPath + ".tmp";
            let existingContent = "";
            if (fs.existsSync(csvPath)) {
              existingContent = fs.readFileSync(csvPath, "utf-8");
            } else {
              existingContent = "\uFEFFname,rel,absolutePath,tags,playCount,lastPlayedAt\n";
            }
            if (existingContent && !existingContent.endsWith("\n")) {
              existingContent += "\n";
            }
            const newContent = existingContent + csvLine + "\n";
            fs.writeFileSync(csvTmpPath, newContent, "utf-8");
            fs.renameSync(csvTmpPath, csvPath);
            console.log(`[Queue CSV Append] Automatically appended new play track: ${key}`);
          } catch (err) {
            console.error("[Queue CSV Append] Failed to append play track:", err);
          }
        });
      }
      triggerDebouncedBothRebuild(1000);
    }
  };

  // Middleware for parsing JSON and URL encoded bodies
  app.use((req, res, next) => {
    const isFiltered = req.url.startsWith('/api/update-playback-status') || 
                       req.url.startsWith('/api/get-playback-status') || 
                       req.url.startsWith('/api/progress') ||
                       req.url.startsWith('/api/scan') ||
                       req.url.startsWith('/api/record-play');
    if (!isFiltered) {
      console.log(`[Express] Incoming Request: ${req.method} ${req.url}`);
    }
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Helper to prevent path traversal / directory escaping
  function getSafePath(inputPath: string): string | null {
    if (!inputPath) return null;
    const resolved = path.resolve(inputPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    const workspaceRoot = path.resolve(process.cwd());
    const originalRoot = path.resolve(currentDirname);
    if (resolved.startsWith(workspaceRoot) || resolved.startsWith(originalRoot)) {
      return resolved;
    }
    return null;
  }

  // Helper: Recursive directory scanner
  function scanDirectory(dir: string, baseDir: string = dir): Array<{ name: string; path: string; size: number; relativePath: string }> {
    let results: Array<{ name: string; path: string; size: number; relativePath: string }> = [];
    if (!fs.existsSync(dir)) {
      return results;
    }
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        // Skip hidden files/directories (e.g. .git, ._apple_double, .DS_Store, etc.)
        if (file.startsWith(".")) {
          continue;
        }

        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const dirName = file.toLowerCase();
            const excludedDirs = ["node_modules", "dist", "build", "out", ".next", "venv", ".venv", "env", "__pycache__", "__macosx"];
            if (excludedDirs.includes(dirName)) {
              continue;
            }
            results = results.concat(scanDirectory(fullPath, baseDir));
          } else {
            const ext = path.extname(file).toLowerCase();
            const supported = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"];
            if (supported.includes(ext)) {
              results.push({
                name: file,
                path: fullPath,
                size: stat.size,
                relativePath: path.relative(baseDir, fullPath)
              });
            }
          }
        } catch (e) {
          // Skip inaccessible files or directories
        }
      }
    } catch (e) {
      // Skip inaccessible root folders
    }
    return results;
  }

  // Helper: WAV Audio Synthesizer for Demo Mode
  function generateWavBuffer(frequency: number, durationSeconds: number, labelName: string): Buffer {
    const sampleRate = 8000;
    const numSamples = sampleRate * durationSeconds;
    const bufferSize = 44 + numSamples;
    const buffer = Buffer.alloc(bufferSize);

    // RIFF identifier
    buffer.write("RIFF", 0);
    // File size - 8
    buffer.writeUInt32LE(bufferSize - 8, 4);
    // WAVE identifier
    buffer.write("WAVE", 8);
    // fmt chunk identifier
    buffer.write("fmt ", 12);
    // Chunk size
    buffer.writeUInt32LE(16, 16);
    // Audio format 1 (PCM)
    buffer.writeUInt16LE(1, 20);
    // Number of channels 1 (Mono)
    buffer.writeUInt16LE(1, 22);
    // Sample rate
    buffer.writeUInt32LE(sampleRate, 24);
    // Byte rate (sampleRate * bitsPerSample * channels / 8) -> 8000 * 8 * 1 / 8 = 8000
    buffer.writeUInt32LE(sampleRate, 28);
    // Block align (channels * bitsPerSample / 8) -> 1 * 8 / 8 = 1
    buffer.writeUInt16LE(1, 32);
    // Bits per sample (8)
    buffer.writeUInt16LE(8, 34);
    // data chunk identifier
    buffer.write("data", 36);
    // data chunk size
    buffer.writeUInt32LE(numSamples, 40);

    // Generate simulated frequency wave mimicking high-low baby hum/crying
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sine = 0;
      if (labelName === "hungry") {
        // High rapid chirping crying
        sine = Math.sin(2 * Math.PI * frequency * t + Math.sin(2 * Math.PI * 12 * t) * 8);
      } else if (labelName === "sleepy") {
        // Low, sleepy yawning sound (descending pitch)
        const currentFreq = frequency * (1 - t / durationSeconds * 0.5);
        sine = Math.sin(2 * Math.PI * currentFreq * t);
      } else if (labelName === "uncomfortable") {
        // Harsh interrupted sound (square-like modulation)
        const f = Math.sin(2 * Math.PI * frequency * t) > 0 ? 1 : -1;
        sine = f * Math.sin(2 * Math.PI * 3 * t);
      } else if (labelName === "burp") {
        // Deep grunts
        sine = Math.sin(2 * Math.PI * 120 * t + Math.sin(2 * Math.PI * 4 * t) * 5);
      } else {
        // Irritable chaotic sound
        sine = Math.sin(2 * Math.PI * frequency * t) * 0.5 + Math.sin(2 * Math.PI * (frequency * 1.5) * t) * 0.5;
      }
      const byteValue = Math.floor((sine + 1) * 127);
      buffer.writeUInt8(byteValue, 44 + i);
    }

    return buffer;
  }

  // --- API ROUTE: Scan Directory ---
  app.post("/api/scan", (req, res) => {
    let { directoryPath } = req.body;
    if (!directoryPath) {
      return res.status(400).json({ error: "Missing directoryPath parameter." });
    }

    // Support resolving relative or absolute paths safely
    let targetPath = directoryPath;
    if (directoryPath.startsWith("./") || directoryPath === "demo_audios") {
      targetPath = path.resolve(process.cwd(), directoryPath);
    } else {
      targetPath = path.resolve(directoryPath);
    }

    const safeTarget = getSafePath(targetPath);
    if (!safeTarget || !fs.existsSync(safeTarget)) {
      return res.status(404).json({ error: `Directory not found or access denied: ${directoryPath}` });
    }

    const files = scanDirectory(safeTarget);
    res.json({
      scannedPath: safeTarget,
      totalCount: files.length,
      files: files
    });
  });

  // --- API ROUTE: Get Labeling Progress ---
  app.get("/api/progress", (req, res) => {
    return res.json(progressMemory);
  });

  const escapeCsv = (str: string) => {
    if (str === null || str === undefined) return "";
    const s = String(str);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const buildCSV = () => {
    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    const csvTmp = csvPath + ".tmp";
    const headers = "name,rel,absolutePath,tags,playCount,lastPlayedAt";
    const body = Array.from(csvRowsCache.values()).join("\n");
    fs.writeFileSync(csvTmp, "\uFEFF" + headers + "\n" + (body ? body + "\n" : ""), "utf-8");
    fs.renameSync(csvTmp, csvPath);
  };

  const buildJSON = () => {
    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    const rows = Object.entries(progressMemory)
      .filter(([key, item]) => item && item.name && item.name.trim() !== "")
      .map(([key, item]) => {
        let absPath = item.absolutePath || "";
        if (key && !key.startsWith("[uploaded]") && !key.startsWith("local-file:") && !key.startsWith("blob:")) {
          absPath = key;
        }
        if (absPath.startsWith("[uploaded]") && key && !key.startsWith("[uploaded]") && !key.startsWith("local-file:") && !key.startsWith("blob:")) {
          absPath = key;
        }
        absPath = normalizeAbsolutePath(absPath);

        let tagsArr: string[] = [];
        const rawTags = item.tags || item.label || "";
        if (Array.isArray(rawTags)) {
          tagsArr = rawTags.map((t: any) => String(t).trim()).filter(Boolean);
        } else if (typeof rawTags === "string") {
          tagsArr = rawTags.split(",").map(t => t.trim()).filter(Boolean);
        } else if (rawTags) {
          tagsArr = [String(rawTags).trim()];
        }

        return {
          name: item.name || "",
          rel: item.rel || "",
          absolutePath: absPath,
          tagsArr: tagsArr,
          playCount: typeof item.playCount === 'number' ? item.playCount : 0,
          lastPlayedAt: item.lastPlayedAt || ""
        };
      });

    let root = "";
    const realRows = rows.filter(r => 
      r.absolutePath && 
      !r.absolutePath.startsWith("[uploaded]") &&
      !r.absolutePath.startsWith("uploaded_") && 
      !r.absolutePath.startsWith("local-file:") && 
      !r.absolutePath.startsWith("blob:")
    );

    if (realRows.length > 0) {
      const candidateRoots = realRows.map(r => {
        const abs = r.absolutePath;
        const rel = r.rel;
        if (rel && abs.endsWith(rel)) {
          let cand = abs.slice(0, abs.length - rel.length);
          if (cand.endsWith("/") && cand.length > 1) cand = cand.slice(0, -1);
          if (cand.endsWith("\\") && cand.length > 1) cand = cand.slice(0, -1);
          return cand;
        } else {
          const lastSlash = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
          if (lastSlash > 0) {
            return abs.slice(0, lastSlash);
          }
          return abs;
        }
      });

      if (candidateRoots.length > 0) {
        const splitPaths = candidateRoots.map(p => p.split(/[/\\]/));
        let commonSegments: string[] = [];
        const firstPathParts = splitPaths[0];
        
        for (let i = 0; i < firstPathParts.length; i++) {
          const segment = firstPathParts[i];
          const allMatch = splitPaths.every(parts => parts[i] === segment);
          if (allMatch) {
            commonSegments.push(segment);
          } else {
            break;
          }
        }
        
        const isAbsoluteUnix = candidateRoots[0].startsWith("/");
        let result = commonSegments.join(candidateRoots[0].includes("\\") ? "\\" : "/");
        if (isAbsoluteUnix && !result.startsWith("/")) {
          result = "/" + result;
        }
        root = result;
      }
    }

    if (root.includes("[uploaded]") || root.includes("uploaded_") || root.includes("local-file:") || root.includes("blob:")) {
      root = "";
    }

    const jsonItems = rows.map(r => {
      return {
        name: r.name,
        rel: r.rel,
        absolutePath: r.absolutePath,
        tags: r.tagsArr,
        playCount: r.playCount,
        lastPlayedAt: r.lastPlayedAt
      };
    });

    const jsonOutput = {
      exportedAt: jsonItems.length === 0 ? "" : new Date().toISOString(),
      root: jsonItems.length === 0 ? "" : root,
      count: jsonItems.length,
      items: jsonItems
    };

    const jsonTmp = jsonPath + ".tmp";
    fs.writeFileSync(jsonTmp, JSON.stringify(jsonOutput, null, 2), "utf-8");
    fs.renameSync(jsonTmp, jsonPath);
  };

  const rebuildCSVAndJSON = () => {
    try {
      buildCSV();
      buildJSON();
      console.log(`[Rebuild] Successfully rebuilt CSV and JSON. Entries count: ${Object.keys(progressMemory).length}`);
    } catch (err) {
      console.error("[Rebuild] Error rebuilding result files:", err);
    }
  };

  const rebuildJSONOnly = () => {
    try {
      buildJSON();
      console.log(`[Rebuild] Successfully rebuilt JSON only. Entries count: ${Object.keys(progressMemory).length}`);
    } catch (err) {
      console.error("[Rebuild] Error rebuilding JSON only:", err);
    }
  };

  const rebuildResultFiles = (progressData: Record<string, any>) => {
    rebuildCSVAndJSON();
  };

  const getUnifiedKey = (filePath: string, fileName?: string): string => {
    if (!filePath) return "";
    if (filePath.startsWith("local-file://") || filePath.startsWith("blob:") || filePath.startsWith("[uploaded]")) {
      const name = fileName || path.basename(filePath.replace("local-file://", ""));
      return `${UPLOADED_PREFIX}${name}`;
    }
    const cleanedPath = getSafePath(filePath) || path.resolve(filePath);
    return normalizeAbsolutePath(cleanedPath);
  };

  const recordTrackPlayback = (filePath: string, fileName?: string, relativePath?: string, clientAbsolutePath?: string): Record<string, any> => {
    const key = getUnifiedKey(filePath, fileName);
    
    const cleanedPath = (filePath.startsWith("local-file://") || filePath.startsWith("blob:")) 
      ? filePath 
      : (getSafePath(filePath) || path.resolve(filePath));

    const name = fileName || path.basename(cleanedPath);
    const rel = relativePath || name;

    let absolutePathVal = cleanedPath;
    if (cleanedPath.startsWith("local-file://") || cleanedPath.startsWith("blob:")) {
      if (clientAbsolutePath && !clientAbsolutePath.startsWith("local-file:") && !clientAbsolutePath.startsWith("blob:")) {
        absolutePathVal = clientAbsolutePath;
      } else {
        absolutePathVal = `${UPLOADED_PREFIX}${name}`;
      }
    }

    // Apply path standardization
    absolutePathVal = normalizeAbsolutePath(absolutePathVal);

    const progressPath = path.join(process.cwd(), "progress.json");
    if (Object.keys(progressMemory).length === 0 && fs.existsSync(progressPath)) {
      try {
        progressMemory = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore
      }
    }

    const currentEntry = progressMemory[key] || {};
    const isNewEntry = !progressMemory[key];
    
    // 5-second rate-limiting window per track to prevent double counting
    const now = Date.now();
    const lastIncrement = lastPlayIncrementTimes[key] || 0;
    const timeDiff = now - lastIncrement;
    
    let playCount = currentEntry.playCount || 0;
    let lastPlayedAt = currentEntry.lastPlayedAt || "";

    if (timeDiff > 5000) {
      lastPlayIncrementTimes[key] = now;
      playCount += 1;
      lastPlayedAt = new Date().toISOString();
    }

    progressMemory[key] = {
      ...currentEntry,
      label: currentEntry.label || "",
      time: currentEntry.time || "",
      name: name,
      rel: currentEntry.rel || rel,
      absolutePath: absolutePathVal,
      tags: currentEntry.tags || currentEntry.label || "",
      playCount: playCount,
      lastPlayedAt: lastPlayedAt
    };

    // Use our highly optimized handleProgressUpdate
    handleProgressUpdate(key, isNewEntry, "play-update");

    return progressMemory;
  };

  // --- API ROUTE: Save Label / Update CSV and progress.json ---
  app.post("/api/save-label", (req, res) => {
    const { filePath, label, labelTime, fileName, relativePath, absolutePath } = req.body;
    if (!filePath || !label) {
      return res.status(400).json({ error: "Missing filePath or label" });
    }

    const key = getUnifiedKey(filePath, fileName);
    
    const cleanedPath = (filePath.startsWith("local-file://") || filePath.startsWith("blob:")) 
      ? filePath 
      : (getSafePath(filePath) || path.resolve(filePath));
    
    const name = fileName || path.basename(cleanedPath);
    const rel = relativePath || name;

    let absolutePathVal = cleanedPath;
    if (cleanedPath.startsWith("local-file://") || cleanedPath.startsWith("blob:")) {
      if (absolutePath && !absolutePath.startsWith("local-file:") && !absolutePath.startsWith("blob:")) {
        absolutePathVal = absolutePath;
      } else {
        absolutePathVal = `${UPLOADED_PREFIX}${name}`;
      }
    }

    // Apply path standardization
    absolutePathVal = normalizeAbsolutePath(absolutePathVal);

    const timeString = labelTime || new Date().toISOString().replace("T", " ").substring(0, 19);

    // 1. Update progress.json
    const progressPath = path.join(process.cwd(), "progress.json");
    if (Object.keys(progressMemory).length === 0 && fs.existsSync(progressPath)) {
      try {
        progressMemory = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore and overwrite on error
      }
    }

    const currentEntry = progressMemory[key] || {};
    const isNewEntry = !progressMemory[key];
    const hadLabelBefore = !!(currentEntry.label || currentEntry.tags);
    const opType = isNewEntry 
      ? "new-tag" 
      : (hadLabelBefore ? "edit-tag" : "new-tag");

    // MERGE logic: preserve existing playCount and lastPlayedAt
    progressMemory[key] = {
      ...currentEntry,
      label: label,
      time: timeString,
      name: name,
      rel: rel,
      absolutePath: absolutePathVal,
      tags: label,
      playCount: typeof currentEntry.playCount === 'number' ? currentEntry.playCount : 0,
      lastPlayedAt: currentEntry.lastPlayedAt || ""
    };
    
    // 2. Use our highly optimized handleProgressUpdate
    handleProgressUpdate(key, isNewEntry, opType);

    res.json({ success: true, progress: progressMemory });
  });

  // --- API ROUTE: Bulk Sync / Restore Progress from Client localStorage Backup ---
  app.post("/api/sync-progress", (req, res) => {
    const { clientProgress } = req.body;
    if (!clientProgress || typeof clientProgress !== "object") {
      return res.status(400).json({ error: "Missing or invalid clientProgress" });
    }

    const progressPath = path.join(process.cwd(), "progress.json");
    if (Object.keys(progressMemory).length === 0 && fs.existsSync(progressPath)) {
      try {
        progressMemory = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore and overwrite on error
      }
    }

    // Merge logic: merge client progress data into backend progress data
    Object.entries(clientProgress).forEach(([key, val]) => {
      if (val && typeof val === "object") {
        const clientEntry = val as any;
        const normalizedKey = key.startsWith("local-file:") || key.startsWith("blob:") || key.startsWith("[uploaded]")
          ? key 
          : normalizeAbsolutePath(key);

        const serverEntry = progressMemory[normalizedKey] || {};
        
        // Merge preferring non-empty labels and higher play counts
        const mergedLabel = clientEntry.label || serverEntry.label || "";
        const mergedTags = clientEntry.tags || serverEntry.tags || mergedLabel;
        const mergedPlayCount = Math.max(
          typeof clientEntry.playCount === 'number' ? clientEntry.playCount : 0,
          typeof serverEntry.playCount === 'number' ? serverEntry.playCount : 0
        );
        const mergedLastPlayedAt = clientEntry.lastPlayedAt || serverEntry.lastPlayedAt || "";
        const mergedTime = clientEntry.time || serverEntry.time || "";

        const rawClientAbsPath = clientEntry.absolutePath || serverEntry.absolutePath || "";
        const normalizedClientAbsPath = rawClientAbsPath.startsWith("local-file:") || rawClientAbsPath.startsWith("blob:") || rawClientAbsPath.startsWith("[uploaded]")
          ? rawClientAbsPath
          : normalizeAbsolutePath(rawClientAbsPath);

        const mergedEntry = {
          ...serverEntry,
          ...clientEntry,
          label: mergedLabel,
          tags: mergedTags,
          playCount: mergedPlayCount,
          lastPlayedAt: mergedLastPlayedAt,
          time: mergedTime,
          name: clientEntry.name || serverEntry.name || "",
          rel: clientEntry.rel || serverEntry.rel || "",
          absolutePath: normalizedClientAbsPath
        };

        progressMemory[normalizedKey] = mergedEntry;

        // Update the in-memory cache for this synchronized entry
        csvRowsCache.set(normalizedKey, formatRowToCsvLine(normalizedKey, mergedEntry));
      }
    });

    // Write progress.json immediately for data durability
    writeProgressImmediately();

    // Trigger debounced rebuild of CSV and JSON files (500ms since it's a bulk sync)
    triggerDebouncedBothRebuild(500);

    res.json({ success: true, progress: progressMemory });
  });

  // --- API ROUTE: Record Playback Completion ---
  app.post("/api/record-play", (req, res) => {
    const { filePath, fileName, relativePath, absolutePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "Missing filePath" });
    }
    const progressData = recordTrackPlayback(filePath, fileName, relativePath, absolutePath);
    res.json({ success: true, progress: progressData });
  });

  // --- API ROUTE: Get Raw CSV Content ---
  app.get("/api/download-csv", (req, res) => {
    rebuildResultFiles(progressMemory);

    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    if (!fs.existsSync(csvPath)) {
      return res.status(404).send("labeled_output.csv not found.");
    }

    const now = new Date();
    const iso = now.toISOString();
    const timestamp = iso
      .replace(/:/g, '-')
      .replace('.', '-');
    const csvFilename = `auto-play-export-${timestamp}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${csvFilename}`);
    res.sendFile(csvPath);
  });

  // --- API ROUTE: Get Raw JSON Content ---
  app.get("/api/download-json", (req, res) => {
    rebuildResultFiles(progressMemory);

    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).send("labeled_output.json not found.");
    }

    const now = new Date();
    const iso = now.toISOString();
    const timestamp = iso
      .replace(/:/g, '-')
      .replace('.', '-');
    const jsonFilename = `auto-play-export-${timestamp}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${jsonFilename}`);
    res.sendFile(jsonPath);
  });

  // --- API ROUTE: Dynamic Result File Reader ---
  app.get("/api/check-file-result", (req, res) => {
    const { filePath } = req.query;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ error: "Missing filePath URL query parameter" });
    }

    const safePath = getSafePath(filePath);
    if (!safePath || !fs.existsSync(safePath)) {
      return res.json({ exists: false, content: "" });
    }

    try {
      const content = fs.readFileSync(safePath, "utf-8").trim();
      return res.json({ exists: true, content });
    } catch (err) {
      return res.status(500).json({ error: "Failed to read result file" });
    }
  });

  // --- API ROUTE: Clear Result File Content ---
  app.post("/api/clear-file-result", (req, res) => {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ error: "Missing filePath parameter" });
    }
    const safePath = getSafePath(filePath);
    if (safePath && fs.existsSync(safePath)) {
      try {
        fs.writeFileSync(safePath, "", "utf-8");
        return res.json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: "Failed to clear result file" });
      }
    }
    res.json({ success: false, message: "File not found or access denied" });
  });

  // --- API ROUTE: Stream Local Audio ---
  app.get("/api/stream", (req, res) => {
    const { filePath } = req.query;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).send("Parameter 'filePath' is required");
    }

    const safePath = getSafePath(filePath);
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).send(`Audio file not found or access denied: ${filePath}`);
    }

    const stats = fs.statSync(safePath);
    const range = req.headers.range;

    // Standard HTTP audio content headers
    const ext = path.extname(safePath).toLowerCase();
    let contentType = "audio/mpeg";
    if (ext === ".wav") contentType = "audio/wav";
    if (ext === ".ogg") contentType = "audio/ogg";
    if (ext === ".flac") contentType = "audio/flac";
    if (ext === ".aac") contentType = "audio/aac";
    if (ext === ".m4a") contentType = "audio/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(safePath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        "Content-Length": stats.size,
        "Content-Type": contentType,
      };
      res.writeHead(200, head);
      fs.createReadStream(safePath).pipe(res);
    }
  });

  // --- API ROUTE: Reset / Clear Labeling Files ---
  app.post("/api/reset-all", (req, res) => {
    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    const progressFilePath = path.join(process.cwd(), "progress.json");
    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    try {
      // Clear the memory variable and reset the write queue and locks to prevent conflicts
      const beforeKeys = Object.keys(progressMemory);
      progressMemory = {};
      csvRowsCache.clear();
      if (rebuildBothTimer) {
        clearTimeout(rebuildBothTimer);
        rebuildBothTimer = null;
      }
      if (rebuildJsonTimer) {
        clearTimeout(rebuildJsonTimer);
        rebuildJsonTimer = null;
      }
      writeQueue.length = 0;
      isQueueProcessing = false;

      // Clear the rate-limiting map
      for (const k of Object.keys(lastPlayIncrementTimes)) {
        delete lastPlayIncrementTimes[k];
      }

      // Write progress.json atomically
      const progressTmp = progressFilePath + ".tmp";
      fs.writeFileSync(progressTmp, '{}', 'utf-8');
      fs.renameSync(progressTmp, progressFilePath);

      // 2. Reset labeled_output.csv to headers only (with UTF-8 BOM) atomically
      const headers = "\uFEFFname,rel,absolutePath,tags,playCount,lastPlayedAt\n";
      const csvTmp = csvPath + ".tmp";
      fs.writeFileSync(csvTmp, headers, "utf-8");
      fs.renameSync(csvTmp, csvPath);

      // 3. Reset labeled_output.json to the target empty template atomically
      const emptyTemplate = {
        exportedAt: "",
        root: "",
        count: 0,
        items: []
      };
      const jsonTmp = jsonPath + ".tmp";
      fs.writeFileSync(jsonTmp, JSON.stringify(emptyTemplate, null, 2), "utf-8");
      fs.renameSync(jsonTmp, jsonPath);

      res.json({ 
        success: true,
        beforeKeys: beforeKeys,
        afterContent: '{}',
        afterMemoryKeys: []
      });
    } catch (e) {
      console.error("Failed to clear state files:", e);
      res.status(500).json({ error: "Failed to clear state files" });
    }
  });

  // --- REAL-TIME PLAYBACK COORDINATION FOR PYTHON OCR ASSISTANT ---
  const playbackStatus = {
    filePath: null as string | null,
    fileName: null as string | null,
    isPlaying: false,
    isWaitingInterval: false,
    waitingSecondsLeft: 0,
    serverCommand: null as string | null, // "skip" | "label"
    pendingLabel: null as string | null,
  };

  app.post("/api/update-playback-status", (req, res) => {
    const { filePath, fileName, isPlaying, isWaitingInterval, waitingSecondsLeft } = req.body;
    
    const wasPlaying = playbackStatus.isPlaying;
    const nowPlaying = !!isPlaying;
    const oldFilePath = playbackStatus.filePath;
    const newFilePath = filePath || null;
    const wasWaiting = playbackStatus.isWaitingInterval;
    const nowWaiting = !!isWaitingInterval;

    if (wasPlaying !== nowPlaying || oldFilePath !== newFilePath || wasWaiting !== nowWaiting) {
      const unifiedKey = newFilePath ? getUnifiedKey(newFilePath, fileName || undefined) : 'none';
      const displayName = unifiedKey !== 'none' 
        ? (unifiedKey.startsWith(UPLOADED_PREFIX) ? unifiedKey.replace(UPLOADED_PREFIX, '') : path.basename(unifiedKey)) 
        : 'none';
      console.log(`[Playback Status Change] file: ${displayName}, playing: ${nowPlaying}, waiting: ${nowWaiting}`);
    }

    playbackStatus.filePath = newFilePath;
    playbackStatus.fileName = fileName || null;
    playbackStatus.isPlaying = nowPlaying;
    playbackStatus.isWaitingInterval = nowWaiting;
    playbackStatus.waitingSecondsLeft = waitingSecondsLeft || 0;
    
    res.json({
      success: true,
      command: playbackStatus.serverCommand,
      label: playbackStatus.pendingLabel
    });
  });

  app.post("/api/clear-playback-command", (req, res) => {
    playbackStatus.serverCommand = null;
    playbackStatus.pendingLabel = null;
    res.json({ success: true });
  });

  app.get("/api/get-playback-status", (req, res) => {
    res.json(playbackStatus);
  });

  app.post("/api/submit-automatic-label", (req, res) => {
    const { filePath, label, skip } = req.body;
    
    // Fallback to active file if not explicitly specified
    const targetPath = filePath || playbackStatus.filePath;
    if (!targetPath) {
      return res.status(400).json({ error: "No active audio file path to label or skip." });
    }

    if (skip) {
      playbackStatus.serverCommand = "skip";
      return res.json({ success: true, action: "skip", targetPath });
    }

    if (label) {
      playbackStatus.serverCommand = "label";
      playbackStatus.pendingLabel = label;
      return res.json({ success: true, action: "label", label, targetPath });
    }

    res.status(400).json({ error: "Missing 'label' or 'skip: true' in request body" });
  });

  // --- API ROUTE: Create Demo Audio Audios ---
  app.post("/api/generate-demo-audios", (req, res) => {
    const demoDir = path.join(process.cwd(), "demo_audios");
    if (!fs.existsSync(demoDir)) {
      fs.mkdirSync(demoDir, { recursive: true });
    }

    // Generate 5 distinct files simulating baby cries for each of the 5 labels
    const demoFiles = [
      { name: "baby_cry_hungry_01.wav", freq: 440, length: 10, label: "hungry" }, // Under 30s so the player can test loop counting!
      { name: "baby_cry_uncomfortable_02.wav", freq: 330, length: 15, label: "uncomfortable" },
      { name: "baby_cry_sleepy_03.wav", freq: 520, length: 45, label: "sleepy" }, // Above 30s so only 1 plays
      { name: "baby_cry_burp_04.wav", freq: 220, length: 12, label: "burp" },
      { name: "baby_cry_fuss_05.wav", freq: 480, length: 8, label: "fussy" },
    ];

    for (const d of demoFiles) {
      const wavBuf = generateWavBuffer(d.freq, d.length, d.label);
      fs.writeFileSync(path.join(demoDir, d.name), wavBuf);
    }

    // Also write a default result.txt for testing file listener mode
    const resultTxtPath = path.join(demoDir, "result.txt");
    if (!fs.existsSync(resultTxtPath)) {
      fs.writeFileSync(resultTxtPath, "hungry", "utf-8");
    }

    res.json({
      success: true,
      scannedPath: demoDir,
      resultTxtPath: resultTxtPath,
      message: "Generated 5 high-quality synth audio files for immediate demo testing in the AI Studio preview environment!"
    });
  });

  // --- FALLBACK 404 FOR ALL OTHER /api ROUTES ---
  app.all("/api/*", (req, res) => {
    console.warn(`[Express] 404 API Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.url}`,
      success: false
    });
  });

  // --- VITE DEV / PRODUCTION MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Dynamically locate the production index.html and assets directory even if process.cwd() is overridden
    let distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      // In packaged environment, server.cjs and index.html are compiled bundle neighbors
      distPath = currentDirname;
    }
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      distPath = path.join(currentDirname, "dist");
    }
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);

    // Clean up any dangling temporary files on startup
    const tmpFilesToClean = [
      path.join(process.cwd(), "progress.json.tmp"),
      path.join(process.cwd(), "labeled_output.csv.tmp"),
      path.join(process.cwd(), "labeled_output.json.tmp")
    ];
    tmpFilesToClean.forEach(tmpFile => {
      if (fs.existsSync(tmpFile)) {
        try {
          fs.unlinkSync(tmpFile);
          console.log(`[Startup Cleanup] Deleted orphaned temp file: ${tmpFile}`);
        } catch (err) {
          console.error(`[Startup Cleanup] Failed to delete temp file ${tmpFile}:`, err);
        }
      }
    });

    // Sanitize and rebuild export files (CSV, JSON) using latest schema rules on startup
    const progressPath = path.join(process.cwd(), "progress.json");
    if (fs.existsSync(progressPath)) {
      try {
        const rawMemory = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
        
        // Normalize keys and absolutePath attributes in progressMemory on startup to prevent mismatch, filtering out any test data
        const normalizedMemory: Record<string, any> = {};
        Object.entries(rawMemory).forEach(([key, val]) => {
          if (val && typeof val === "object") {
            const entry = val as any;
            
            const name = entry.name || "";
            const absPath = entry.absolutePath || "";
            const isTest = absPath.includes("/app/applet/") || name.includes("new_track_");
            
            if (isTest) {
              console.log(`[Startup Cleanup] Discarding test data: key=${key}, name=${name}, path=${absPath}`);
              return; // Filter out/skip test entries
            }

            const normalizedKey = key.startsWith("local-file:") || key.startsWith("blob:") || key.startsWith("[uploaded]")
              ? key
              : normalizeAbsolutePath(key);
            
            const rawAbsPath = entry.absolutePath || "";
            const normalizedAbs = rawAbsPath.startsWith("local-file:") || rawAbsPath.startsWith("blob:") || rawAbsPath.startsWith("[uploaded]")
              ? rawAbsPath
              : normalizeAbsolutePath(rawAbsPath);

            normalizedMemory[normalizedKey] = {
              ...entry,
              absolutePath: normalizedAbs
            };
          }
        });

        progressMemory = normalizedMemory;
        
        // Populate the in-memory CSV rows cache with the normalized startup entries
        csvRowsCache.clear();
        Object.entries(progressMemory).forEach(([key, val]) => {
          if (val && typeof val === "object") {
            csvRowsCache.set(key, formatRowToCsvLine(key, val));
          }
        });
        
        // Write normalized memory back to progress.json atomically
        const tmpFile = progressPath + ".tmp";
        fs.writeFileSync(tmpFile, JSON.stringify(progressMemory, null, 2), "utf-8");
        fs.renameSync(tmpFile, progressPath);

        rebuildCSVAndJSON();
        console.log(`[Startup] Successfully loaded, normalized progress.json, populated cache, and rebuilt result files (${Object.keys(progressMemory).length} entries).`);
      } catch (e) {
        console.error("[Startup] Failed to rebuild result files:", e);
      }
    }
  });
}

startServer();
