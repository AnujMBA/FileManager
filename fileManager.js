const fs = require("fs").promises; // Async FS
const fsSync = require("fs"); // Sync FS (for streams/constants)
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const os = require('os');
require("colors");

// --- CONFIGURATION & HELPERS ---

const dirPath = path.join(__dirname, "my_files");
const backupDir = path.join(dirPath, 'backups');

// Ensure directory exists on startup
if (!fsSync.existsSync(dirPath)) {
  fsSync.mkdirSync(dirPath);
}

// Helper: Get full path
const getFilePath = (filename) => path.join(dirPath, filename);


const createBackup = async (filename) => {
    try {
        const originalPath = getFilePath(filename);
        const backupPath = path.join(backupDir, filename + '.bak'); // e.g., story.txt.bak

        // Check karein file hai ya nahi (New file create karte waqt backup nahi chahiye)
        try {
            await fs.access(originalPath);
            await fs.copyFile(originalPath, backupPath);

            console.log(`(Backup saved to: backups/${filename}.bak)`.grey);
        } catch (err) {
        }
    } catch (error) {
        console.log(` Warning: Could not create backup for '${filename}'`.yellow);
    }
};

// Helper: Standardized Error Handler
const handleError = (error, operation, targetName) => {
  if (error.code === "ENOENT") {
    console.log(` Error: '${targetName}' not found!`.red.bold);
  } else if (error.code === "EEXIST") {
    console.log(` Error: '${targetName}' already exists!`.red.bold);
  } else if (error.code === "ENOTEMPTY") {
    console.log(` Error: Folder '${targetName}' is not empty!`.red.bold);
  } else {
    console.log(` Error ${operation}: ${error.message}`.red);
  }
};

// Helper: Success Logger
const logSuccess = (msg) => console.log(msg.green.bold);

// ==========================================
// 1. CORE FILE OPERATIONS (Create, Read, Delete)
// ==========================================

const createFile = async (filename, content) => {
  const filePath = getFilePath(filename);
  const folderPath = path.dirname(filePath);

  try {
    // Auto-create directories if they don't exist
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(filePath, content);
    logSuccess(` Success: File created at '${filename}'!`);
  } catch (error) {
    handleError(error, "creating file", filename);
  }
};

const readFile = async (filename) => {
  try {
    const data = await fs.readFile(getFilePath(filename), "utf-8");
    console.log(`\ Content of '${filename}':`.yellow);
    console.log(data.cyan);
  } catch (error) {
    handleError(error, "reading file", filename);
  }
};

const deleteFile = async (filename) => {
  try {
    await fs.unlink(getFilePath(filename));
    console.log(` Success: '${filename}' deleted successfully.`.magenta);
  } catch (error) {
    handleError(error, "deleting file", filename);
  }
};

const appendToFile = async (filename, content) => {
  try {

    await createBackup(filename);

    await fs.appendFile(getFilePath(filename), "\n" + content);
    console.log(` Success: Content appended to '${filename}'!`.blue.bold);
  } catch (error) {
    handleError(error, "appending file", filename);
  }
};

const renameFile = async (oldName, newName) => {
  try {
    await fs.rename(getFilePath(oldName), getFilePath(newName));
    logSuccess(` Success: '${oldName}' renamed to '${newName}'!`);
  } catch (error) {
    handleError(error, "renaming file", oldName);
  }
};

// ==========================================
// 2. FOLDER OPERATIONS
// ==========================================

const createFolder = async (folderName) => {
  try {
    await fs.mkdir(getFilePath(folderName), { recursive: true });
    logSuccess(` Success: Folder '${folderName}' created!`);
  } catch (error) {
    handleError(error, "creating folder", folderName);
  }
};

const deleteFolder = async (folderName) => {
  try {
    // recursive: true allows deleting folders with files inside
    await fs.rm(getFilePath(folderName), { recursive: true, force: true });
    console.log(` Success: Folder '${folderName}' deleted!`.magenta);
  } catch (error) {
    handleError(error, "deleting folder", folderName);
  }
};

// ==========================================
// 3. ADVANCED OPERATIONS (Copy, Move, Info, List)
// ==========================================

const getFileInfo = async (filename) => {
  try {
    const stats = await fs.stat(getFilePath(filename));
    console.log(`\n --- File Information: ${filename} ---`.cyan.bold);
    console.log(` Size: ${(stats.size / 1024).toFixed(2)} KB`.yellow);
    console.log(` Created: ${stats.birthtime.toLocaleString()}`.green);
    console.log(` Modified: ${stats.mtime.toLocaleString()}`.blue);
    console.log(` Permissions: ${stats.mode}`.grey);
  } catch (error) {
    handleError(error, "getting info", filename);
  }
};

const listFiles = async () => {
  try {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    console.log(`\n Files in Directory:`.bgMagenta.white);

    if (files.length === 0) {
      console.log("Empty Directory!".grey);
      return;
    }

    files.forEach((file) => {
      const icon = file.isDirectory() ? " [DIR] " : "📄 [FILE]";
      const color = file.isDirectory() ? "blue" : "green";
      console.log(`${icon} ${file.name}`[color].bold);
    });
  } catch (error) {
    handleError(error, "listing files", "Directory");
  }
};

const copyFile = async (sourceName, destName) => {
  try {
    await fs.copyFile(
      getFilePath(sourceName),
      getFilePath(destName),
      fsSync.constants.COPYFILE_EXCL, // Don't overwrite existing
    );
    logSuccess(` Success: Copied '${sourceName}' to '${destName}'`);
  } catch (error) {
    handleError(error, "copying file", destName);
  }
};

const moveFile = async (filename, destinationFolder) => {
  try {
    const oldPath = getFilePath(filename);
    const newPath = path.join(
      dirPath,
      destinationFolder,
      path.basename(filename),
    );

    await fs.rename(oldPath, newPath);
    logSuccess(`Success: Moved '${filename}' to '${destinationFolder}/'`);
  } catch (error) {
    // Rename implies moving, so checking source existence
    handleError(error, "moving file", filename);
  }
};

const searchInFile = async (filename, keyword) => {
  try {
    const data = await fs.readFile(getFilePath(filename), "utf-8");
    const lines = data.split("\n");
    let foundCount = 0;

    console.log(`\n Searching for "${keyword}" in '${filename}'...`.cyan);
    console.log("-".repeat(40).grey);

    lines.forEach((line, index) => {
      if (line.includes(keyword)) {
        foundCount++;
        console.log(`Line ${index + 1}: `.yellow.bold + line.trim());
      }
    });

    console.log("-".repeat(40).grey);

    if (foundCount === 0) console.log(` No matches found.`.red);
    else logSuccess(` Total matches found: ${foundCount}`);
  } catch (error) {
    handleError(error, "searching file", filename);
  }
};

// ==========================================
// 4. EDITING & TOOLS (Replace, Clear, Zip)
// ==========================================

const replaceText = async (filename, oldText, newText) => {
  try {
    const filePath = getFilePath(filename);
    const data = await fs.readFile(filePath, "utf-8");

    if (!data.includes(oldText)) {
      console.log(` Error: Text '${oldText}' not found!`.red);
      return;
    }

    await createBackup(filename);
    
    const newData = data.split(oldText).join(newText);
    await fs.writeFile(filePath, newData);
    logSuccess(` Success: Replaced '${oldText}' with '${newText}'`);
  } catch (error) {
    handleError(error, "replacing text", filename);
  }
};

const overwriteFile = async (filename, newContent) => {
  try {
    const filePath = getFilePath(filename);
    await fs.access(filePath); // Ensure file exists first

    await createBackup(filename);

    await fs.writeFile(filePath, newContent);
    logSuccess(` Success: File '${filename}' rewritten!`);
  } catch (error) {
    handleError(error, "overwriting file", filename);
  }
};

const clearFile = async (filename) => {
  try {
    await fs.writeFile(getFilePath(filename), "");
    console.log(` Success: '${filename}' cleared!`.magenta.bold);
  } catch (error) {
    handleError(error, "clearing file", filename);
  }
};

const compressFile = async (filename) => {
  try {
    const sourcePath = getFilePath(filename);
    const destPath = getFilePath(filename + ".gz");

    const sourceStream = fsSync.createReadStream(sourcePath);
    const destStream = fsSync.createWriteStream(destPath);
    const gzip = zlib.createGzip();

    await pipeline(sourceStream, gzip, destStream);
    logSuccess(` Success: Compressed to '${filename}.gz'`);
  } catch (error) {
    handleError(error, "compressing file", filename);
  }
};

const countFileStats = async (filename) => {
    try {
        const data = await fs.readFile(getFilePath(filename), 'utf-8');
        
        const lines = data.split('\n').length;
        const words = data.split(/\s+/).filter(word => word !== '').length;
        const chars = data.length;

        console.log(`\n --- Analysis of '${filename}' ---`.bgYellow.black);
        console.log(` Lines: ${lines}`.cyan.bold);
        console.log(`  Words: ${words}`.green.bold);
        console.log(` Characters: ${chars}`.blue);
        
    } catch (error) {
        handleError(error, "analyzing file", filename);
    }
};

const getSystemInfo = async () => {
    try {
        console.log(`\n --- System Information ---`.bgCyan.black);
        console.log(` OS: ${os.type()} ${os.release()} (${os.arch()})`.green);
        console.log(` Total RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`.yellow);
        console.log(` Free RAM: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`.yellow);
        console.log(` CPU: ${os.cpus()[0].model}`.magenta);
        console.log(` Home Dir: ${os.homedir()}`.grey);
        console.log(`⏱  Uptime: ${(os.uptime() / 3600).toFixed(2)} Hours`.cyan);
    } catch (error) {
        console.log(` Error fetching system info: ${error.message}`.red);
    }
};


// 20. API से डेटा लाना और सेव करना (Fetch API)
const fetchApiData = async (filename, url) => {
    try {
        console.log(`\n Connecting to: ${url}...`.cyan);
        
        // Step 1: Internet se data mangwayein
        const response = await fetch(url);

        // Check karein agar request fail hui (e.g. 404 Not Found)
        if (!response.ok) {
            throw new Error(`HTTP Error! Status: ${response.status}`);
        }

        // Step 2: Data ko JSON me convert karein
        const data = await response.json();

        // Step 3: JSON ko sunder (pretty) text me badlein
        // null, 2 ka matlab hai 2 spaces ka indentation (safai se dikhega)
        const content = JSON.stringify(data, null, 2);

        // Step 4: File me save karein
        const filePath = getFilePath(filename);
        await fs.writeFile(filePath, content);
        
        logSuccess(` Success: API data saved to '${filename}'`);
        
    } catch (error) {
        handleError(error, "fetching API data", url);
    }
};


const revertFile = async (filename) => {
    const originalPath = getFilePath(filename);
    const backupPath = path.join(backupDir, filename + '.bak');

    try {
        // Check karein backup hai ya nahi
        await fs.access(backupPath);

        // Backup ko wapis original jagah copy karein (Restore)
        await fs.copyFile(backupPath, originalPath);
        
        console.log(`⏮  Success: '${filename}' reverted to last saved version!`.cyan.bold);
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(` Error: No backup found for '${filename}'. (You haven't edited it yet)`.red);
        } else {
            console.log(` Error reverting file: ${error.message}`.red);
        }
    }
};


module.exports = {
  createFile,
  readFile,
  deleteFile,
  appendToFile,
  renameFile,
  createFolder,
  deleteFolder,
  listFiles,
  getFileInfo,
  copyFile,
  moveFile,
  searchInFile,
  replaceText,
  overwriteFile,
  clearFile,
  compressFile,
  countFileStats,
  getSystemInfo,
  fetchApiData,
  revertFile
};
