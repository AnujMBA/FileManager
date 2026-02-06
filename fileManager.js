const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const os = require("os");
require("colors");

// ==========================================
// 1. CONFIGURATION & PRIVATE HELPERS
// ==========================================

const CONFIG = {
  baseDir: path.join(__dirname, "my_files"),
  backupDir: path.join(__dirname, "my_files", "backups"),
};

// Initialization: Create folders if missing
Object.values(CONFIG).forEach((dir) => {
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// Paths Helpers
const resolvePath = (filename) => path.join(CONFIG.baseDir, filename);
const resolveBackup = (filename) => path.join(CONFIG.backupDir, `${filename}.bak`);

// Console Helpers
const logSuccess = (msg) => console.log(`${msg}`.green.bold);
const formatBytes = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

// Error Handler Wrapper (HOC)
const withErrorHandling = (fn, operationName) => {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      const target = typeof operationName === 'function' ? operationName(...args) : 'operation';
      
      const errorMap = {
        'ENOENT': `Error: '${target}' not found!`,
        'EEXIST': `Error: '${target}' already exists!`,
        'ENOTEMPTY': `Error: Folder '${target}' is not empty!`
      };

      const msg = errorMap[error.code] || `Error (${target}): ${error.message}`;
      console.log(msg.red.bold);
    }
  };
};

// Internal: Create Backup
const ensureBackup = async (filename) => {
  try {
    const src = resolvePath(filename);
    const dest = resolveBackup(filename);
    await fs.access(src); // Check existence
    await fs.copyFile(src, dest);
    console.log(` (Backup created: ${filename}.bak)`.grey.italic);
  } catch (e) { /* Ignore if file doesn't exist */ }
};

// ==========================================
// 2. CORE FILE OPERATIONS
// ==========================================

const coreOps = {
  createFile: withErrorHandling(async (filename, content) => {
    const filePath = resolvePath(filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    logSuccess(`File created: ${filename}`);
  }, (f) => f),

  readFile: withErrorHandling(async (filename) => {
    const data = await fs.readFile(resolvePath(filename), "utf-8");
    console.log(`\nContent of '${filename}':`.yellow);
    console.log(data.cyan);
  }, (f) => f),

  deleteFile: withErrorHandling(async (filename) => {
    await fs.unlink(resolvePath(filename));
    logSuccess(`Deleted: ${filename}`);
  }, (f) => f),

  appendToFile: withErrorHandling(async (filename, content) => {
    await ensureBackup(filename);
    await fs.appendFile(resolvePath(filename), "\n" + content);
    logSuccess(`Appended to: ${filename}`);
  }, (f) => f),

  renameFile: withErrorHandling(async (oldName, newName) => {
    await fs.rename(resolvePath(oldName), resolvePath(newName));
    logSuccess(`Renamed '${oldName}' to '${newName}'`);
  }, (f) => f),

  copyFile: withErrorHandling(async (src, dest) => {
    await fs.copyFile(resolvePath(src), resolvePath(dest), fsSync.constants.COPYFILE_EXCL);
    logSuccess(`Copied '${src}' to '${dest}'`);
  }, (f) => f),
};

// ==========================================
// 3. FOLDER OPERATIONS
// ==========================================

const folderOps = {
  createFolder: withErrorHandling(async (name) => {
    await fs.mkdir(resolvePath(name), { recursive: true });
    logSuccess(`Folder created: ${name}`);
  }, (n) => n),

  deleteFolder: withErrorHandling(async (name) => {
    await fs.rm(resolvePath(name), { recursive: true, force: true });
    logSuccess(`Folder deleted: ${name}`);
  }, (n) => n),

  listFiles: withErrorHandling(async () => {
    const files = await fs.readdir(CONFIG.baseDir, { withFileTypes: true });
    console.log(`\nFiles in Directory:`.bgMagenta.white);
    
    if (files.length === 0) return console.log("   (Empty)".grey);

    files.forEach(f => {
      const [icon, color] = f.isDirectory() ? ["📁", "blue"] : ["📄", "green"];
      console.log(`   ${icon} ${f.name}`[color]);
    });
  }, () => 'directory'),
};

// ==========================================
// 4. ADVANCED TOOLS
// ==========================================

const advancedOps = {
  getFileInfo: withErrorHandling(async (filename) => {
    const stats = await fs.stat(resolvePath(filename));
    console.log(`\n ℹInfo: ${filename}`.cyan.bold);
    console.table({
      Size: `${(stats.size / 1024).toFixed(2)} KB`,
      Created: stats.birthtime.toLocaleString(),
      Modified: stats.mtime.toLocaleString(),
    });
  }, (f) => f),

  searchInFile: withErrorHandling(async (filename, keyword) => {
    const data = await fs.readFile(resolvePath(filename), "utf-8");
    const matches = data.split("\n")
      .map((line, i) => ({ line: line.trim(), idx: i + 1 }))
      .filter(m => m.line.includes(keyword));

    console.log(`\nSearch: "${keyword}" in '${filename}'`.cyan);
    if (!matches.length) return console.log("   No matches.".red);
    matches.forEach(m => console.log(`   Line ${m.idx}: `.yellow + m.line));
  }, (f) => f),

  replaceText: withErrorHandling(async (filename, oldTxt, newTxt) => {
    const filePath = resolvePath(filename);
    const data = await fs.readFile(filePath, "utf-8");
    if (!data.includes(oldTxt)) throw new Error(`Text '${oldTxt}' not found`);

    await ensureBackup(filename);
    await fs.writeFile(filePath, data.split(oldTxt).join(newTxt));
    logSuccess(`Replaced text in: ${filename}`);
  }, (f) => f),

  compressFile: withErrorHandling(async (filename) => {
    const src = fsSync.createReadStream(resolvePath(filename));
    const dest = fsSync.createWriteStream(resolvePath(`${filename}.gz`));
    await pipeline(src, zlib.createGzip(), dest);
    logSuccess(`Compressed: ${filename}.gz`);
  }, (f) => f),

  revertFile: withErrorHandling(async (filename) => {
    const original = resolvePath(filename);
    const backup = resolveBackup(filename);
    await fs.access(backup);
    await fs.copyFile(backup, original);
    logSuccess(`Reverted '${filename}' from backup!`);
  }, (f) => f),
};

// ==========================================
// 5. SYSTEM DIAGNOSTICS
// ==========================================

const getNetworkIPs = () => {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Handle Node v18+ family type (IPv4 string or 4 number)
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (isIPv4 && !net.internal) results.push(`${name}: ${net.address}`);
    }
  }
  return results.length ? results.join(" | ") : "Not Connected";
};

const systemOps = {
  getSystemInfo: () => {
    try {
      console.log(`\nADVANCED SYSTEM DIAGNOSTICS`.bgCyan.black.bold);

      // Memory Calculations
      const total = os.totalmem();
      const free = os.freemem();
      const percent = (((total - free) / total) * 100).toFixed(1);
      const ramColor = percent > 80 ? "red" : "green";

      // Uptime Formatter
      const uptimeSec = os.uptime();
      const uptime = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

      console.table({
        "OS": `${os.type()} ${os.release()}`,
        "CPU": `${os.cpus()[0].model} (${os.cpus().length} Cores)`,
        "Total RAM": formatBytes(total),
        "Free RAM": formatBytes(free),
        "RAM Usage": `${percent}%`[ramColor],
        "IP Address": getNetworkIPs().yellow.bold,
        "Uptime": uptime
      });
    } catch (e) {
      console.log("Error fetching system info".red);
    }
  },

  fetchApiData: withErrorHandling(async (filename, url) => {
    console.log(`Fetching ${url}...`.cyan);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fs.writeFile(resolvePath(filename), JSON.stringify(await res.json(), null, 2));
    logSuccess(`Data saved to: ${filename}`);
  }, (f) => f),
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  ...coreOps,
  ...folderOps,
  ...advancedOps,
  ...systemOps,
};