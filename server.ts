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
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Helper to prevent path traversal / directory escaping
  function getSafePath(inputPath: string): string | null {
    if (!inputPath) return null;
    const resolved = path.resolve(inputPath);
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
    const progressPath = path.join(process.cwd(), "progress.json");
    if (fs.existsSync(progressPath)) {
      try {
        const content = fs.readFileSync(progressPath, "utf-8");
        return res.json(JSON.parse(content));
      } catch (err) {
        return res.status(500).json({ error: "Failed to parse progress.json" });
      }
    }
    return res.json({});
  });

  const escapeCsv = (str: string) => {
    if (str === null || str === undefined) return "";
    const s = String(str);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rebuildResultFiles = (progressData: Record<string, any>) => {
    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    const jsonPath = path.join(process.cwd(), "labeled_output.json");

    const rows = Object.values(progressData)
      .filter(item => item && item.name && item.name.trim() !== "")
      .map(item => {
        return {
          name: item.name || "",
          rel: item.rel || "",
          absolutePath: item.absolutePath || "",
          tags: item.tags || item.label || "",
          playCount: typeof item.playCount === 'number' ? item.playCount : 0,
          lastPlayedAt: item.lastPlayedAt || ""
        };
      });

    const headers = "name,rel,absolutePath,tags,playCount,lastPlayedAt";
    const body = rows.map(r => {
      return [
        escapeCsv(r.name),
        escapeCsv(r.rel),
        escapeCsv(r.absolutePath),
        escapeCsv(r.tags),
        r.playCount,
        escapeCsv(r.lastPlayedAt)
      ].join(",");
    }).join("\n");

    fs.writeFileSync(csvPath, "\uFEFF" + headers + "\n" + body + "\n", "utf-8");

    // Calculate root folder dynamically across 3 environments:
    // 1. Path scanning mode: Extract root via absolutePath.slice(0, -rel.length)
    // 2. Electron drag-and-drop: Extract root via finding the longest common parent directory
    // 3. Web browser drag-and-drop: root = ""
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
          // Fallback: directory name of absolutePath
          const lastSlash = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
          if (lastSlash > 0) {
            return abs.slice(0, lastSlash);
          }
          return abs;
        }
      });

      // Find the robust longest common parent directory path segments
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

    // Map tags to string arrays in JSON
    const jsonItems = rows.map(r => {
      let tagsArray: string[] = [];
      if (r.tags) {
        if (Array.isArray(r.tags)) {
          tagsArray = r.tags.map((t: any) => String(t).trim()).filter(Boolean);
        } else {
          tagsArray = String(r.tags)
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);
        }
      }
      return {
        name: r.name,
        rel: r.rel,
        absolutePath: r.absolutePath,
        tags: tagsArray,
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

    fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), "utf-8");
  };

  const getUnifiedKey = (filePath: string, fileName?: string): string => {
    if (!filePath) return "";
    if (filePath.startsWith("local-file://") || filePath.startsWith("blob:")) {
      const name = fileName || path.basename(filePath.replace("local-file://", ""));
      return `${UPLOADED_PREFIX}${name}`;
    }
    const cleanedPath = getSafePath(filePath) || path.resolve(filePath);
    return cleanedPath;
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

    const progressPath = path.join(process.cwd(), "progress.json");
    let progressData: Record<string, any> = {};
    if (fs.existsSync(progressPath)) {
      try {
        progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore
      }
    }

    const currentEntry = progressData[key] || {};
    
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

    progressData[key] = {
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

    fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2), "utf-8");
    rebuildResultFiles(progressData);

    return progressData;
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

    const timeString = labelTime || new Date().toISOString().replace("T", " ").substring(0, 19);

    // 1. Update progress.json
    const progressPath = path.join(process.cwd(), "progress.json");
    let progressData: Record<string, any> = {};
    if (fs.existsSync(progressPath)) {
      try {
        progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore and overwrite on error
      }
    }

    const currentEntry = progressData[key] || {};
    
    // MERGE logic: preserve existing playCount and lastPlayedAt
    progressData[key] = {
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
    
    fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2), "utf-8");

    // 2. Rebuild CSV and JSON outputs
    rebuildResultFiles(progressData);

    res.json({ success: true, progress: progressData });
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
    const progressPath = path.join(process.cwd(), "progress.json");
    let progressData: Record<string, any> = {};
    if (fs.existsSync(progressPath)) {
      try {
        progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore
      }
    }
    rebuildResultFiles(progressData);

    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    if (!fs.existsSync(csvPath)) {
      return res.status(404).send("labeled_output.csv not found.");
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=labeled_output.csv");
    res.sendFile(csvPath);
  });

  // --- API ROUTE: Get Raw JSON Content ---
  app.get("/api/download-json", (req, res) => {
    const progressPath = path.join(process.cwd(), "progress.json");
    let progressData: Record<string, any> = {};
    if (fs.existsSync(progressPath)) {
      try {
        progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore
      }
    }
    rebuildResultFiles(progressData);

    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).send("labeled_output.json not found.");
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=labeled_output.json");
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
      // Read current progress before resetting for debugging
      let progress: Record<string, any> = {};
      if (fs.existsSync(progressFilePath)) {
        try {
          progress = JSON.parse(fs.readFileSync(progressFilePath, "utf-8"));
        } catch (err) {
          progress = {};
        }
      }

      // 重置前
      console.log('BEFORE reset:', JSON.stringify(progress));

      // 在重置前先保存 key 列表
      const beforeKeys = Object.keys(progress);

      // 执行清空
      Object.keys(progress).forEach(k => delete progress[k]);
      fs.writeFileSync(progressFilePath, '{}', 'utf-8');

      // 重置后立刻读取文件确认
      const verify = fs.readFileSync(progressFilePath, 'utf-8');
      console.log('AFTER reset, file content:', verify);
      console.log('AFTER reset, memory:', JSON.stringify(progress));

      // Clear the rate-limiting map
      for (const k of Object.keys(lastPlayIncrementTimes)) {
        delete lastPlayIncrementTimes[k];
      }

      // 2. Reset labeled_output.csv to headers only (with UTF-8 BOM)
      const headers = "\uFEFFname,rel,absolutePath,tags,playCount,lastPlayedAt\n";
      fs.writeFileSync(csvPath, headers, "utf-8");

      // 3. Reset labeled_output.json to the target empty template
      const emptyTemplate = {
        exportedAt: "",
        root: "",
        count: 0,
        items: []
      };
      fs.writeFileSync(jsonPath, JSON.stringify(emptyTemplate, null, 2), "utf-8");

      res.json({ 
        success: true,
        beforeKeys: beforeKeys,    // 重置前的所有 key
        afterContent: verify,      // 重置后文件内容
        afterMemoryKeys: Object.keys(progress)  // 重置后内存的 key
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
  });
}

startServer();
