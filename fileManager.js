const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs/promises');
const { createReadStream, createWriteStream, constants, existsSync, mkdirSync } = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const os = require('os');
require('colors');

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================

const CONFIG = {
    baseDir: path.join(__dirname, "my_files"),
    backupDir: path.join(__dirname, "my_files", "backups"),
    crypto: {
        algorithm: 'aes-256-ctr',
        // In production, use a secure env variable, not a hardcoded string
        key: crypto.createHash('sha256').update(String('mySuperSecretPassword')).digest('base64').substr(0, 32)
    }
};

// Ensure directories exist on boot
[CONFIG.baseDir, CONFIG.backupDir].forEach(dir => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// ==========================================
// 2. INTERNAL UTILITIES
// ==========================================

const utils = {
    resolve: (filename) => path.join(CONFIG.baseDir, filename),
    resolveBackup: (filename) => path.join(CONFIG.backupDir, `${filename}.bak`),
    
    formatBytes: (bytes) => {
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${['B', 'KB', 'MB', 'GB'][i]}`;
    }
};

const logger = {
    info: (msg) => console.log(msg.cyan),
    success: (msg) => console.log(`✔ ${msg}`.green.bold),
    warn: (msg) => console.log(`⚠ ${msg}`.yellow),
    error: (msg) => console.log(`✖ ${msg}`.red.bold),
    header: (msg) => console.log(`\n${msg}`.bgCyan.black.bold),
    table: (data) => console.table(data),
    treeItem: (indent, branch, icon, name) => console.log(`${indent}${branch}${icon} ${name}`.grey)
};

/**
 * Higher-Order Function for standardized error handling
 */
const safeExecute = (fn, contextDescription) => {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            const desc = typeof contextDescription === 'function' ? contextDescription(...args) : contextDescription;
            
            const errorMap = {
                'ENOENT': `Target not found`,
                'EEXIST': `Target already exists`,
                'ENOTEMPTY': `Directory is not empty`
            };
            
            const specificError = errorMap[error.code] || error.message;
            logger.error(`Operation failed [${desc}]: ${specificError}`);
        }
    };
};

// ==========================================
// 3. FILE OPERATIONS
// ==========================================

const FileOps = {
    create: safeExecute(async (filename, content = '') => {
        const filePath = utils.resolve(filename);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        logger.success(`Created: ${filename}`);
    }, 'Create File'),

    read: safeExecute(async (filename) => {
        const content = await fs.readFile(utils.resolve(filename), 'utf-8');
        logger.info(`\nContent of '${filename}':`);
        console.log(content.white);
    }, 'Read File'),

    delete: safeExecute(async (filename) => {
        await fs.unlink(utils.resolve(filename));
        logger.success(`Deleted: ${filename}`);
    }, 'Delete File'),

    append: safeExecute(async (filename, content) => {
        await AdvancedOps.backup(filename); // Internal call to backup
        await fs.appendFile(utils.resolve(filename), `\n${content}`);
        logger.success(`Appended to: ${filename}`);
    }, 'Append File'),

    rename: safeExecute(async (oldName, newName) => {
        await fs.rename(utils.resolve(oldName), utils.resolve(newName));
        logger.success(`Renamed: ${oldName} -> ${newName}`);
    }, 'Rename File'),

    copy: safeExecute(async (src, dest) => {
        await fs.copyFile(utils.resolve(src), utils.resolve(dest), constants.COPYFILE_EXCL);
        logger.success(`Copied: ${src} -> ${dest}`);
    }, 'Copy File'),

    open: (filename) => {
        const filePath = utils.resolve(filename);
        const command = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
        exec(`${command} "" "${filePath}"`, (err) => {
            if (err) logger.error("Could not open file in OS editor.");
            else logger.success("Opened in external editor.");
        });
    }
};

// ==========================================
// 4. DIRECTORY OPERATIONS
// ==========================================

// Helper for tree recursion
const _printTreeRecursive = async (currentPath, indent) => {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const [index, item] of items.entries()) {
        const isLast = index === items.length - 1;
        const branch = isLast ? "└── " : "├── ";
        const icon = item.isDirectory() ? "📁" : "📄";
        
        logger.treeItem(indent, branch, icon, item.name);
        
        if (item.isDirectory()) {
            await _printTreeRecursive(
                path.join(currentPath, item.name), 
                indent + (isLast ? "    " : "│   ")
            );
        }
    }
};

const DirOps = {
    create: safeExecute(async (name) => {
        await fs.mkdir(utils.resolve(name), { recursive: true });
        logger.success(`Directory created: ${name}`);
    }, 'MkDir'),

    delete: safeExecute(async (name) => {
        await fs.rm(utils.resolve(name), { recursive: true, force: true });
        logger.success(`Directory deleted: ${name}`);
    }, 'RmDir'),

    list: safeExecute(async () => {
        const files = await fs.readdir(CONFIG.baseDir, { withFileTypes: true });
        logger.header(`Files in ${CONFIG.baseDir}:`);
        
        if (files.length === 0) return console.log("   (Empty)".grey);

        files.forEach(f => {
            const icon = f.isDirectory() ? "📁" : "📄";
            console.log(`   ${icon} ${f.name}`[f.isDirectory() ? 'blue' : 'green']);
        });
    }, 'List Files'),

    tree: safeExecute(async () => {
        logger.header("Directory Tree:");
        await _printTreeRecursive(CONFIG.baseDir, "");
    }, 'Tree View'),

    deleteByPattern: safeExecute(async (pattern) => {
        const files = await fs.readdir(CONFIG.baseDir);
        const targets = files.filter(f => f.includes(pattern));

        if (!targets.length) return logger.warn(`No files match '${pattern}'`);

        logger.info(`Found ${targets.length} files matching '${pattern}'. Deleting...`);
        
        // Execute logic directly here instead of returning lists to main
        await Promise.all(targets.map(async file => {
            await fs.unlink(utils.resolve(file));
            console.log(`   🗑  ${file}`.grey);
        }));
        
        logger.success("Bulk delete complete.");
    }, 'Bulk Delete')
};

// ==========================================
// 5. ADVANCED & SECURITY
// ==========================================

const AdvancedOps = {
    info: safeExecute(async (filename) => {
        const stats = await fs.stat(utils.resolve(filename));
        logger.header(`Stats: ${filename}`);
        logger.table({
            Size: utils.formatBytes(stats.size),
            Created: stats.birthtime.toLocaleString(),
            Modified: stats.mtime.toLocaleString()
        });
    }, 'File Info'),

    backup: async (filename) => {
        try {
            const src = utils.resolve(filename);
            const dest = utils.resolveBackup(filename);
            await fs.access(src);
            await fs.copyFile(src, dest);
            // Silent success for backups to reduce noise
        } catch (e) { /* Ignore backup errors */ }
    },

    search: safeExecute(async (filename, keyword) => {
        const data = await fs.readFile(utils.resolve(filename), 'utf-8');
        const matches = data.split('\n')
            .map((line, i) => ({ line: line.trim(), lineNum: i + 1 }))
            .filter(item => item.line.includes(keyword));

        logger.header(`Search results for "${keyword}":`);
        if (!matches.length) return logger.warn("No matches found.");
        
        matches.forEach(m => console.log(`   Line ${m.lineNum}: `.yellow + m.line));
    }, 'Search'),

    compress: safeExecute(async (filename) => {
        const source = createReadStream(utils.resolve(filename));
        const destination = createWriteStream(utils.resolve(`${filename}.gz`));
        await pipeline(source, zlib.createGzip(), destination);
        logger.success(`Compressed: ${filename}.gz`);
    }, 'Compress'),

    // SECURITY: Fixed IV reuse vulnerability
    encrypt: safeExecute(async (filename) => {
        const filePath = utils.resolve(filename);
        
        // 1. Generate unique IV for THIS file
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(CONFIG.crypto.algorithm, CONFIG.crypto.key, iv);
        
        const input = await fs.readFile(filePath);
        const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
        
        // 2. Prepend IV to the file so we can read it during decryption
        const outputBuffer = Buffer.concat([iv, encrypted]);
        
        await fs.writeFile(`${filePath}.enc`, outputBuffer);
        await fs.unlink(filePath); // Delete original
        
        logger.success(`Locked & Encrypted: ${filename}.enc`);
    }, 'Encrypt'),

    decrypt: safeExecute(async (filename) => {
        if (!filename.endsWith('.enc')) throw new Error("File must end in .enc");
        const filePath = utils.resolve(filename);
        const fileData = await fs.readFile(filePath);

        // 1. Extract IV (first 16 bytes)
        const iv = fileData.slice(0, 16);
        const encryptedText = fileData.slice(16);

        // 2. Create decipher using the extracted IV
        const decipher = crypto.createDecipheriv(CONFIG.crypto.algorithm, CONFIG.crypto.key, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);

        const originalName = filePath.replace('.enc', '');
        await fs.writeFile(originalName, decrypted);
        await fs.unlink(filePath); // Delete encrypted version

        logger.success(`Unlocked: ${path.basename(originalName)}`);
    }, 'Decrypt')
};

// ==========================================
// 6. SYSTEM DIAGNOSTICS
// ==========================================

const SystemOps = {
    stats: () => {
        try {
            logger.header("SYSTEM DIAGNOSTICS");
            const total = os.totalmem();
            const free = os.freemem();
            const usedPercent = (((total - free) / total) * 100).toFixed(1);

            // Get IP Logic
            const nets = os.networkInterfaces();
            const ip = Object.values(nets)
                .flat()
                .find(n => n.family === 'IPv4' && !n.internal)?.address || "Offline";

            logger.table({
                "OS": `${os.type()} ${os.release()}`,
                "CPU": `${os.cpus()[0].model}`,
                "Memory": `${utils.formatBytes(free)} free / ${utils.formatBytes(total)} total`,
                "Usage": `${usedPercent}%`,
                "IP": ip
            });
        } catch (e) {
            logger.error("Failed to fetch system stats");
        }
    },

    fetchRemote: safeExecute(async (filename, url) => {
        logger.info(`Fetching ${url}...`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        await fs.writeFile(utils.resolve(filename), JSON.stringify(data, null, 2));
        logger.success(`Saved API data to ${filename}`);
    }, 'Fetch API')
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    ...FileOps,
    ...DirOps,
    ...AdvancedOps,
    ...SystemOps
};