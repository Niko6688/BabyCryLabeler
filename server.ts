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

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Middleware for parsing JSON and URL encoded bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Helper: Recursive directory scanner
  function scanDirectory(dir: string, baseDir: string = dir): Array<{ name: string; path: string; size: number; relativePath: string }> {
    let results: Array<{ name: string; path: string; size: number; relativePath: string }> = [];
    if (!fs.existsSync(dir)) {
      return results;
    }
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
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

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: `Directory not found: ${directoryPath}` });
    }

    const files = scanDirectory(targetPath);
    res.json({
      scannedPath: targetPath,
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

  // --- API ROUTE: Save Label / Update CSV and progress.json ---
  app.post("/api/save-label", (req, res) => {
    const { filePath, label, labelTime } = req.body;
    if (!filePath || !label) {
      return res.status(400).json({ error: "Missing filePath or label" });
    }

    const cleanedPath = (filePath.startsWith("local-file://") || filePath.startsWith("blob:")) 
      ? filePath 
      : path.resolve(filePath);
    
    const fileName = (filePath.startsWith("local-file://") || filePath.startsWith("blob:"))
      ? path.basename(filePath.replace("local-file://", ""))
      : path.basename(cleanedPath);

    const timeString = labelTime || new Date().toISOString().replace("T", " ").substring(0, 19);

    // 1. Update progress.json
    const progressPath = path.join(process.cwd(), "progress.json");
    let progressData: Record<string, { label: string; time: string }> = {};
    if (fs.existsSync(progressPath)) {
      try {
        progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      } catch (err) {
        // ignore and overwrite on error
      }
    }
    progressData[cleanedPath] = { label, time: timeString };
    fs.writeFileSync(progressPath, JSON.stringify(progressData, null, 2), "utf-8");

    // 2. Update labeled_output.csv
    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    let csvRows: Array<{ fileName: string; alarmMessage: string; label: string; time: string; path: string }> = [];

    if (fs.existsSync(csvPath)) {
      try {
        let content = fs.readFileSync(csvPath, "utf-8");
        // Remove UTF-8 BOM if present during parsing
        if (content.startsWith("\uFEFF")) {
          content = content.substring(1);
        }
        const lines = content.split("\n").filter(line => line.trim() !== "");
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const parts = line.split(",");
          if (parts.length >= 4) {
            // Check if it's the old 4-column CSV format or the new 5-column format
            if (parts.length === 4) {
              const fileNm = parts[0];
              const lbl = parts[1];
              const t = parts[2];
              const p = parts.slice(3).join(",");
              csvRows.push({
                fileName: fileNm,
                alarmMessage: `宝宝哭了 ${lbl}`,
                label: lbl,
                time: t,
                path: p
              });
            } else {
              const fileNm = parts[0];
              const msg = parts[1];
              const lbl = parts[2];
              const t = parts[3];
              const p = parts.slice(4).join(",");
              csvRows.push({
                fileName: fileNm,
                alarmMessage: msg,
                label: lbl,
                time: t,
                path: p
              });
            }
          }
        }
      } catch (err) {
        // ignore and rewrite if file is corrupted
      }
    }

    // Replace or append row
    const alarmMessage = `宝宝哭了 ${label}`;
    const existingIndex = csvRows.findIndex(r => r.path === cleanedPath);
    const row = { fileName, alarmMessage, label, time: timeString, path: cleanedPath };
    if (existingIndex !== -1) {
      csvRows[existingIndex] = row;
    } else {
      csvRows.push(row);
    }

    // Build fresh clean CSV with enhanced columns matching the exact app notifications
    // Note: We prepend the UTF-8 BOM (\uFEFF) to make it load Chinese flawlessly in Microsoft Excel on Windows
    const headers = "\uFEFF文件名,报警消息,标签,标注时间,文件路径";
    const body = csvRows.map(r => `${r.fileName},${r.alarmMessage},${r.label},${r.time},${r.path}`).join("\n");
    fs.writeFileSync(csvPath, headers + "\n" + body + "\n", "utf-8");

    // Also write labeled_output.json for dual-format export
    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    fs.writeFileSync(jsonPath, JSON.stringify(csvRows, null, 2), "utf-8");

    res.json({ success: true, progress: progressData });
  });

  // --- API ROUTE: Get Raw CSV Content ---
  app.get("/api/download-csv", (req, res) => {
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
    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    
    // If labeled_output.json doesn't exist but CSV or progress.json does, dynamically build/repair on the fly!
    if (!fs.existsSync(jsonPath)) {
      const csvPath = path.join(process.cwd(), "labeled_output.csv");
      const progressPath = path.join(process.cwd(), "progress.json");
      let data: Array<{ fileName: string; alarmMessage: string; label: string; time: string; path: string }> = [];

      if (fs.existsSync(csvPath)) {
        try {
          const content = fs.readFileSync(csvPath, "utf-8");
          const lines = content.split("\n").filter(line => line.trim() !== "");
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(",");
            if (parts.length >= 4) {
              if (parts.length === 4) {
                const fN = parts[0];
                const lbl = parts[1];
                const t = parts[2];
                const p = parts.slice(3).join(",");
                data.push({
                  fileName: fN,
                  alarmMessage: `宝宝哭了 ${lbl}`,
                  label: lbl,
                  time: t,
                  path: p
                });
              } else {
                const fN = parts[0];
                const msg = parts[1];
                const lbl = parts[2];
                const t = parts[3];
                const p = parts.slice(4).join(",");
                data.push({
                  fileName: fN,
                  alarmMessage: msg,
                  label: lbl,
                  time: t,
                  path: p
                });
              }
            }
          }
        } catch (e) {
          // ignore
        }
      } else if (fs.existsSync(progressPath)) {
        try {
          const progressData = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
          data = Object.entries(progressData).map(([filePath, info]: [string, any]) => {
            const fileName = path.basename(filePath);
            return {
              fileName,
              alarmMessage: `宝宝哭了 ${info.label}`,
              label: info.label,
              time: info.time,
              path: filePath
            };
          });
        } catch (e) {
          // ignore
        }
      }
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
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

    const resolvedFilePath = path.resolve(filePath);
    if (!fs.existsSync(resolvedFilePath)) {
      return res.json({ exists: false, content: "" });
    }

    try {
      const content = fs.readFileSync(resolvedFilePath, "utf-8").trim();
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
    const resolvedFilePath = path.resolve(filePath);
    if (fs.existsSync(resolvedFilePath)) {
      try {
        fs.writeFileSync(resolvedFilePath, "", "utf-8");
        return res.json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: "Failed to clear result file" });
      }
    }
    res.json({ success: false, message: "File not found" });
  });

  // --- API ROUTE: Stream Local Audio ---
  app.get("/api/stream", (req, res) => {
    const { filePath } = req.query;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).send("Parameter 'filePath' is required");
    }

    const cleanedPath = path.resolve(filePath);
    if (!fs.existsSync(cleanedPath)) {
      return res.status(404).send(`Audio file not found: ${filePath}`);
    }

    const stats = fs.statSync(cleanedPath);
    const range = req.headers.range;

    // Standard HTTP audio content headers
    const ext = path.extname(cleanedPath).toLowerCase();
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
      const file = fs.createReadStream(cleanedPath, { start, end });
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
      fs.createReadStream(cleanedPath).pipe(res);
    }
  });

  // --- API ROUTE: Reset / Clear Labeling Files ---
  app.post("/api/reset-all", (req, res) => {
    const csvPath = path.join(process.cwd(), "labeled_output.csv");
    const progressPath = path.join(process.cwd(), "progress.json");
    const jsonPath = path.join(process.cwd(), "labeled_output.json");
    try {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
      if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath);
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      res.json({ success: true });
    } catch (e) {
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
    playbackStatus.filePath = filePath || null;
    playbackStatus.fileName = fileName || null;
    playbackStatus.isPlaying = !!isPlaying;
    playbackStatus.isWaitingInterval = !!isWaitingInterval;
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
