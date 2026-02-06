const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const { existsSync, mkdirSync, createReadStream, createWriteStream, constants } = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const os = require("os");
const mongoose = require("mongoose");
require("colors");

// MongoDB Model Imports
const FileModel = require("./models/FileModel");
const FolderModel = require("./models/FolderModel");

// ==========================================
// 1. CONFIGURATION
// ==========================================

const CONFIG = {
  baseDir: path.join(__dirname, "my_files"),
  backupDir: path.join(__dirname, "my_files", "backups"),
  // Mock User ID because Schema requires an 'owner'
  ownerId: new mongoose.Types.ObjectId("64c9e1234567890123456789"), 
  crypto: {
    algorithm: "aes-256-ctr",
    key: crypto.createHash("sha256").update("mySuperSecretPassword").digest("base64").substr(0, 32),
  },
};

// Ensure directories exist
[CONFIG.baseDir, CONFIG.backupDir].forEach((dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// ==========================================
// 2. LOGGING & UTILITIES
// ==========================================

const logger = {
  info: (msg) => console.log(msg.cyan),
  success: (msg) => console.log(`${msg}`.green.bold),
  warn: (msg) => console.log(`${msg}`.yellow),
  error: (msg) => console.log(`${msg}`.red.bold),
  header: (msg) => console.log(`\n${msg}`.bgCyan.black.bold),
  table: (data) => console.table(data),
};

const utils = {
  resolve: (filename) => path.join(CONFIG.baseDir, filename),
  resolveBackup: (filename) => path.join(CONFIG.backupDir, `${filename}.bak`),

  formatBytes: (bytes) => {
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${["B", "KB", "MB", "GB"][i]}`;
  },

  getFileIcon: (filename) => {
    const ext = path.extname(filename).toLowerCase();
    const icons = {
      ".json": "{}", ".js": "🚀", ".txt": "📄", ".md": "📝",
      ".bak": "💾", ".enc": "🔒", ".zip": "📦", ".gz": "📦",
    };
    return icons[ext] || "📄";
  },

  ensureBackup: async (filename) => {
    try {
      const src = utils.resolve(filename);
      const dest = utils.resolveBackup(filename);
      await fs.access(src);
      await fs.copyFile(src, dest);
    } catch (e) { /* Ignore */ }
  },
};

/**
 * HOC: Error Handling Wrapper
 */
const safeExecute = (fn, contextDescription) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const desc = typeof contextDescription === "function" ? contextDescription(...args) : contextDescription;
      logger.error(`Failed [${desc}]: ${error.message}`);
    }
  };
};

// ==========================================
// 3. CORE HELPERS (Tree View)
// ==========================================

const _recursiveTree = async (currentPath, indent) => {
  try {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    items.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });

    for (const [index, item] of items.entries()) {
      if (item.name === 'backups') continue; // Hide backup folder from tree
      const isLast = index === items.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const icon = item.isDirectory() ? "📁 " : utils.getFileIcon(item.name);
      console.log(`${indent}${branch}${icon}${item.name}`.grey);
      if (item.isDirectory()) {
        await _recursiveTree(path.join(currentPath, item.name), indent + (isLast ? "    " : "│   "));
      }
    }
  } catch (e) { /* Ignore */ }
};

// ==========================================
// 4. OPERATIONS (DB + DISK SYNCED)
// ==========================================

const FileOps = {
  createFile: safeExecute(async (filename, content = "") => {
    // 1. Write to Disk
    const filePath = utils.resolve(filename);
    await fs.writeFile(filePath, content);
    
    // 2. Create DB Entry
    const stats = await fs.stat(filePath);
    
    // [FIX] Correctly assigning the variable 'newFile'
    const newFile = await FileModel.create({
      filename: filename,
      owner: CONFIG.ownerId,
      storageKey: filePath,
      size: stats.size,
      extension: path.extname(filename),
      mimetype: 'text/plain' 
    });

    logger.success(`✔ Created & Synced to DB: ${filename} (ID: ${newFile._id})`);
  }, "Create File"),

  read: safeExecute(async (filename) => {
    const content = await fs.readFile(utils.resolve(filename), "utf-8");
    logger.info(`\nContent of '${filename}':`);
    console.log(content.white);
  }, "Read File"),

  delete: safeExecute(async (filename) => {
    // 1. Delete from Disk
    await fs.unlink(utils.resolve(filename));

    // 2. Delete from DB
    const result = await FileModel.findOneAndDelete({ 
      filename: filename, 
      owner: CONFIG.ownerId 
    });

    if (result) logger.success(`✔ Deleted from Disk & DB: ${filename}`);
    else logger.warn(`⚠ Deleted from Disk, but file was not found in DB.`);
  }, "Delete File"),

  append: safeExecute(async (filename, content) => {
    await utils.ensureBackup(filename);
    const filePath = utils.resolve(filename);
    
    // 1. Append to Disk
    await fs.appendFile(filePath, `\n${content}`);
    
    // 2. Update DB Size
    const stats = await fs.stat(filePath);
    await FileModel.findOneAndUpdate(
      { filename: filename, owner: CONFIG.ownerId },
      { size: stats.size },
      { new: true }
    );

    logger.success(`✔ Appended & DB Updated: ${filename}`);
  }, "Append File"),

  rename: safeExecute(async (oldName, newName) => {
    const oldPath = utils.resolve(oldName);
    const newPath = utils.resolve(newName);
    
    // 1. Rename on Disk
    await fs.rename(oldPath, newPath);
    
    // 2. Update DB
    const updateResult = await FileModel.findOneAndUpdate(
      { filename: oldName, owner: CONFIG.ownerId },
      { 
        filename: newName, 
        storageKey: newPath,
        extension: path.extname(newName)
      },
      { new: true }
    );

    if(updateResult) logger.success(`✔ Renamed: ${oldName} -> ${newName}`);
    else logger.warn(`⚠ Renamed on Disk, but DB entry missing.`);
  }, "Rename File"),

  copy: safeExecute(async (src, dest) => {
    // 1. Copy on Disk
    await fs.copyFile(utils.resolve(src), utils.resolve(dest), constants.COPYFILE_EXCL);

    // 2. Create new DB Entry
    const stats = await fs.stat(utils.resolve(dest));
    await FileModel.create({
      filename: dest,
      owner: CONFIG.ownerId,
      storageKey: utils.resolve(dest),
      size: stats.size,
      extension: path.extname(dest),
      mimetype: 'application/octet-stream'
    });
    
    logger.success(`✔ Copied & Synced: ${src} -> ${dest}`);
  }, "Copy File"),

  open: async (filename) => {
    const filePath = utils.resolve(filename);
    try { await fs.access(filePath); } catch (e) { return logger.error(`File missing: ${filename}`); }

    const statsBefore = await fs.stat(filePath);
    logger.info(`Opening ${filename}... (Waiting for save)`.yellow);

    await new Promise((resolve) => {
        const cmd = process.platform === "win32" ? "notepad" : process.platform === "darwin" ? "open" : "nano";
        const args = process.platform === "darwin" ? ["-W", "-e", filePath] : [filePath];
        const child = spawn(cmd, args, { stdio: "inherit" });
        child.on("exit", resolve);
        child.on("error", resolve);
    });

    const statsAfter = await fs.stat(filePath);
    if (statsAfter.mtimeMs > statsBefore.mtimeMs) {
      await FileModel.findOneAndUpdate(
        { filename: filename, owner: CONFIG.ownerId },
        { size: statsAfter.size },
        { new: true }
      );
      logger.success(`✔ Saved & DB Updated: ${filename}`);
    } else {
      logger.warn("No changes detected.");
    }
  },
};

const DirOps = {
  createDir: safeExecute(async (name) => {
    await fs.mkdir(utils.resolve(name), { recursive: true });
    logger.success(`Dir Created: ${name}`);
  }, "MkDir"),

  delete: safeExecute(async (name) => {
    await fs.rm(utils.resolve(name), { recursive: true, force: true });
    logger.success(`Dir Deleted: ${name}`);
  }, "RmDir"),

  list: safeExecute(async () => {
    const files = await fs.readdir(CONFIG.baseDir, { withFileTypes: true });
    logger.header(`Files in ${CONFIG.baseDir}:`);
    if (!files.length) return console.log("   (Empty)".grey);
    files.forEach((f) =>
      console.log(`   ${f.isDirectory() ? "📁" : "📄"} ${f.name}`[f.isDirectory() ? "blue" : "green"])
    );
  }, "List Files"),

  tree: safeExecute(async () => {
    logger.header("Directory Tree:");
    await _recursiveTree(CONFIG.baseDir, "");
  }, "Tree View"),

  deleteByPattern: safeExecute(async (pattern) => {
    const files = await fs.readdir(CONFIG.baseDir);
    const targets = files.filter((f) => f.includes(pattern));
    if (!targets.length) return logger.warn("No match found.");

    await Promise.all(targets.map((f) => fs.unlink(utils.resolve(f))));
    
    // Also remove from DB
    await FileModel.deleteMany({ 
      filename: { $in: targets }, 
      owner: CONFIG.ownerId 
    });

    logger.success(`Deleted ${targets.length} files from Disk & DB.`);
  }, "Bulk Delete"),
};

const AdvancedOps = {
  info: safeExecute(async (filename) => {
    const stats = await fs.stat(utils.resolve(filename));
    logger.table({
      Size: utils.formatBytes(stats.size),
      Created: stats.birthtime.toLocaleString(),
    });
  }, "File Info"),

  backup: async (filename) => {
    await utils.ensureBackup(filename);
    logger.success(`Backup created: ${filename}.bak`);
  },

  search: safeExecute(async (filename, keyword) => {
    const data = await fs.readFile(utils.resolve(filename), "utf-8");
    const matches = data.split("\n").map((l, i) => ({ line: l.trim(), num: i + 1 })).filter((x) => x.line.includes(keyword));
    if (!matches.length) return logger.warn("No match.");
    matches.forEach((m) => console.log(`   Ln ${m.num}: ${m.line}`.yellow));
  }, "Search"),

  compress: safeExecute(async (filename) => {
    await pipeline(createReadStream(utils.resolve(filename)), zlib.createGzip(), createWriteStream(utils.resolve(`${filename}.gz`)));
    logger.success(`Compressed: ${filename}.gz`);
  }, "Compress"),

  encrypt: safeExecute(async (filename) => {
    const filePath = utils.resolve(filename);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CONFIG.crypto.algorithm, CONFIG.crypto.key, iv);
    const input = await fs.readFile(filePath);
    const encrypted = Buffer.concat([iv, cipher.update(input), cipher.final()]);
    await fs.writeFile(`${filePath}.enc`, encrypted);
    await fs.unlink(filePath);
    logger.success(`Encrypted: ${filename}.enc`);
  }, "Encrypt"),

  decrypt: safeExecute(async (filename) => {
    if (!filename.endsWith(".enc")) throw new Error("File must be .enc");
    const filePath = utils.resolve(filename);
    const data = await fs.readFile(filePath);
    const iv = data.slice(0, 16);
    const decipher = crypto.createDecipheriv(CONFIG.crypto.algorithm, CONFIG.crypto.key, iv);
    const decrypted = Buffer.concat([decipher.update(data.slice(16)), decipher.final()]);
    const originalName = filePath.replace(".enc", "");
    await fs.writeFile(originalName, decrypted);
    await fs.unlink(filePath);
    logger.success(`Decrypted: ${path.basename(originalName)}`);
  }, "Decrypt"),
};

const SystemOps = {
  stats: () => {
    const total = os.totalmem(), free = os.freemem();
    logger.table({
      OS: `${os.type()} ${os.release()}`,
      Memory: `${utils.formatBytes(free)} / ${utils.formatBytes(total)}`,
      Usage: `${(((total - free) / total) * 100).toFixed(1)}%`,
    });
  },
  fetchRemote: safeExecute(async (filename, url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    await fs.writeFile(utils.resolve(filename), JSON.stringify(await res.json(), null, 2));
    logger.success(`Fetched: ${filename}`);
  }, "Fetch API"),
};

// ==========================================
// 5. DATABASE OPERATIONS (DB HELPER)
// ==========================================

const dbHelper = {
  ensureFolderDoc: async (folderName, parentId) => {
    let folder = await FolderModel.findOne({ name: folderName, owner: CONFIG.ownerId, parentFolder: parentId });
    if (!folder) {
      folder = await FolderModel.create({ name: folderName, owner: CONFIG.ownerId, parentFolder: parentId });
    }
    return folder._id;
  },

  getMimeType: (filename) => {
    const ext = path.extname(filename).toLowerCase();
    const map = { '.txt': 'text/plain', '.js': 'application/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
    return map[ext] || 'application/octet-stream';
  }
};

const dbOps = {
  // Manual Save (if needed)
  saveToDB: safeExecute(async (filename, parentFolderId = null) => {
    const filePath = utils.resolve(filename); 

    let fileContent;
    try {
        fileContent = await fs.readFile(filePath); 
    } catch(e) {
        throw new Error("File disk par nahi mili, isliye backup nahi ho sakta.");
    }

    const stats = await fs.stat(filePath);
    const nameOnly = path.basename(filename);

    const existing = await FileModel.findOne({ filename: nameOnly, owner: CONFIG.ownerId, parentFolder: parentFolderId });

    if (existing) {
      existing.size = stats.size;
      existing.storageKey = filePath; 
      existing.fileData = fileContent;
      await existing.save();
      logger.info(`Updated Metadata: ${nameOnly}`);
    } else {
      await FileModel.create({
        owner: CONFIG.ownerId,
        parentFolder: parentFolderId,
        filename: nameOnly,
        storageKey: filePath, 
        extension: path.extname(nameOnly),
        size: stats.size,
        mimetype: dbHelper.getMimeType(nameOnly),
        fileData: fileContent,
        isEncrypted: nameOnly.endsWith('.enc')
      });
      logger.success(`Saved Metadata: ${nameOnly} (Size: ${utils.formatBytes(stats.size)})`);
    }
  }, "Saving Metadata"),

  // Full Directory Sync
  syncToDB: safeExecute(async (currentPath = CONFIG.baseDir, parentFolderId = null) => {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    logger.info(`Syncing directory: ${path.basename(currentPath)}...`);

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        if (item.name === 'backups') continue;
        const folderId = await dbHelper.ensureFolderDoc(item.name, parentFolderId);
        await dbOps.syncToDB(fullPath, folderId);
      } else {
        const stats = await fs.stat(fullPath);
        await FileModel.findOneAndUpdate(
          { filename: item.name, owner: CONFIG.ownerId, parentFolder: parentFolderId },
          {
            storageKey: fullPath,
            size: stats.size,
            extension: path.extname(item.name),
            mimetype: dbHelper.getMimeType(item.name),
            owner: CONFIG.ownerId,
            parentFolder: parentFolderId
          },
          { upsert: true, new: true }
        );
        process.stdout.write('.');
      }
    }
    console.log(""); // New line
  }, "Full Sync"),

  listDBFiles: safeExecute(async () => {
    const files = await FileModel.find({ owner: CONFIG.ownerId }).populate('parentFolder').sort({ parentFolder: 1, filename: 1 });
    logger.header(`Database Index (${files.length} files):`);
    if (files.length === 0) return logger.warn("Database is empty.");
    console.log(`ID \t\t\t| Type \t| Size \t| Path`);
    console.log("-".repeat(80));
    files.forEach(f => {
      const folderName = f.parentFolder ? f.parentFolder.name + "/" : "";
      console.log(`${f._id.toString().substring(0, 10)}... \t| ${f.extension || '?'} \t| ${utils.formatBytes(f.size)} \t| ${folderName}${f.filename}`.cyan);
    });
  }, "List DB Index"),

  readFromDB: safeExecute(async (identifier) => {
    let query = mongoose.Types.ObjectId.isValid(identifier) ? { _id: identifier } : { filename: identifier, owner: CONFIG.ownerId };
    const fileDoc = await FileModel.findOne(query);

    if (!fileDoc) throw new Error(`Database mein ye file ('${identifier}') nahi mili.`);
    if (!fileDoc.storageKey) throw new Error("Database corrupt hai: File ka path missing hai.");

    try {
      const content = await fs.readFile(fileDoc.storageKey, 'utf-8');
      logger.header(`\nContent of '${fileDoc.filename}':`);
      console.log(content.white);
      console.log("\n(Read complete via Database Reference)".grey);
    } catch (err) {
      logger.error(`BROKEN LINK: Database mein entry hai, par disk par file nahi mili!`);
    }
  }, "Read via DB"),

  restoreFromDB: safeExecute(async (fileId) => {
    const fileDoc = await FileModel.findById(fileId);
    if (!fileDoc) throw new Error("File ID not found.");
    try {
      await fs.access(fileDoc.storageKey);
      logger.success("File integrity verified.");
    } catch (e) {
      logger.error("BROKEN LINK: File missing from Disk!");
    }
  }, "Verify Link"),

  fullRestore: safeExecute(async (identifier) => {
    
    let query = mongoose.Types.ObjectId.isValid(identifier) 
        ? { _id: identifier } 
        : { filename: identifier, owner: CONFIG.ownerId };

    const fileDoc = await FileModel.findOne(query).select('+fileData');

    if (!fileDoc) throw new Error("File Database mein nahi mili.");
    
    if (!fileDoc.fileData) {
        throw new Error("Is file ka Metadata hai, par Content (Backup) nahi hai.");
    }

    const restorePath = fileDoc.storageKey || utils.resolve(fileDoc.filename);
    
    await fs.writeFile(restorePath, fileDoc.fileData);

    logger.success(`♻ RECOVERY SUCCESSFUL!`);
    console.log(`   File restored at: ${restorePath}`.green);
  }, "Restoring from Cloud"),


  cleanDB: safeExecute(async () => {
    logger.info("Scanning for broken links (Files missing from Disk)...");
    
    // 1. Saari files fetch karo
    const allFiles = await FileModel.find({ owner: CONFIG.ownerId });
    
    if (allFiles.length === 0) return logger.warn("Database already empty.");

    let deletedCount = 0;
    const total = allFiles.length;

    console.log(`Checking ${total} records...`.yellow);

    for (const file of allFiles) {
      try {
        await fs.access(file.storageKey);
      } catch (e) {
        await FileModel.findByIdAndDelete(file._id);
        console.log(`Deleted Orphan Entry: ${file.filename}`.red);
        deletedCount++;
      }
    }

    console.log("-".repeat(40).grey);
    if (deletedCount > 0) {
      logger.success(`Cleanup Complete! Removed ${deletedCount} broken links.`);
    } else {
      logger.success("Database is healthy! No broken links found.");
    }
  }, "Database Cleanup"),
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  ...FileOps,
  ...DirOps,
  ...AdvancedOps,
  ...SystemOps,
  ...dbOps,
};