const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const manager = require("./fileManager"); // Ensure this matches your filename
require("colors");

const connectDB = require("./config/db");
// Connect to MongoDB
connectDB();

// ==========================================
// 1. UI CONFIGURATION
// ==========================================

const rl = readline.createInterface({ input, output });

const UI = {
  ask: async (query, color = "white") => {
    return (await rl.question(` ${query[color]} `)).trim();
  },

  askFile: async (actionName) => {
    const name = await UI.ask(`${actionName} Filename:`, "yellow");
    return name || null;
  },

  printBanner: () => {
    console.clear();
    console.log(
      `
   ╔════════════════════════════════════════╗
   ║          FILE MANAGER                  ║
   ╚════════════════════════════════════════╝
        `.cyan.bold,
    );
  },

  printMenu: () => {
    const menu = {
      "📄 Files": ["create", "read", "append", "delete", "rename", "open"],
      "📁 Folders": ["mkdir", "rmdir", "list", "tree"],
      "☁️  Database": ["sync-db","save-db", "list-db","read-db", "verify-db", "clean-db", "full-restore"],
      "🛠  Tools": ["search", "copy", "zip", "fetch", "bulk-del"],
      "🔐 Secure": ["encrypt", "decrypt"],
      "💻 System": ["stats", "exit"],
    };

    Object.entries(menu).forEach(([category, cmds]) => {
      console.log(` ${category.bold.white}`);
      console.log(` └─ ${cmds.join(" | ").grey}`);
    });
    console.log("──────────────────────────────────────────".grey);
  },
};

// ==========================================
// 2. LOGIC HANDLERS
// ==========================================

// Helper to reduce repetitive "Ask filename -> Call function" code
const executeSimpleOp = async (actionName, managerFn) => {
  if (typeof managerFn !== "function") {
    console.log(
      `Error: Function for '${actionName}' is missing in fileManager.js`.red,
    );
    return;
  }
  const file = await UI.askFile(actionName);
  if (file) await managerFn(file);
};

const COMMANDS = {
  // --- File Ops ---
  create: async () => {
    const name = await UI.askFile("New");
    if (name) {
      const content = await UI.ask("Enter Content:", "cyan");
      await manager.createFile(name, content);
    }
  },

  read: () => executeSimpleOp("Read", manager.read),
  delete: () => executeSimpleOp("Delete", manager.delete),
  zip: () => executeSimpleOp("Compress", manager.compress),
  info: () => executeSimpleOp("Info", manager.info),
  encrypt: () => executeSimpleOp("Lock", manager.encrypt),
  decrypt: () => executeSimpleOp("Unlock", manager.decrypt),
  open: async () => {
    await executeSimpleOp("Open", manager.open);
  },

  append: async () => {
    const name = await UI.askFile("Target");
    if (name) {
      const content = await UI.ask("Text to Append:", "cyan");
      await manager.append(name, content);
    }
  },

  rename: async () => {
    const oldName = await UI.askFile("Current");
    if (oldName) {
      const newName = await UI.ask("New Filename:", "yellow");
      if (newName) await manager.rename(oldName, newName);
    }
  },

  copy: async () => {
    const src = await UI.askFile("Source");
    if (src) {
      const dest = await UI.ask("Destination Filename:", "yellow");
      await manager.copy(src, dest);
    }
  },

  search: async () => {
    const name = await UI.askFile("Search in");
    if (name) {
      const keyword = await UI.ask("Keyword:", "magenta");
      await manager.search(name, keyword);
    }
  },

  // --- Database Ops ---

  "sync-db": async () => {
    console.log("Starting Full Directory Sync (Folders & Files)...".yellow);
    await manager.syncToDB(); 
  },

  "save-db": async () => {
    const name = await UI.askFile("File to update in DB");
    if (name) await manager.saveToDB(name);
  },

  "list-db": async () => {
    await manager.listDBFiles();
  },

  "read-db": async () => {
    const input = await UI.ask("Enter Filename OR DB_ID to read:", "cyan");
    if (input) await manager.readFromDB(input);
  },

  "verify-db": async () => {
    const id = await UI.ask("Enter DB_ID to verify link:", "cyan");
    if (id) await manager.restoreFromDB(id);
  },

  "clean-db": async () => {
  const confirm = await UI.ask("Are you sure you want to delete missing files from DB? (yes/no):", "bgRed");
  if (confirm.toLowerCase() === "yes") {
    await manager.cleanDB();
  } else {
    console.log("Cleanup Cancelled.".green);
  }
},

"full-restore": async () => {
    const id = await UI.ask("Enter File ID or Name to Restore:", "cyan");
    if (id) await manager.fullRestore(id);
  },

  // --- Folder & Bulk Ops ---
  list: async () => await manager.list(),
  tree: async () => await manager.tree(),

  mkdir: async () => {
    const name = await UI.ask("Folder Name:", "yellow");
    if (name) await manager.createDir(name);
  },

  rmdir: async () => {
    const name = await UI.ask("Folder to Delete:", "red");
    if (name) await manager.delete(name);
  },

  "bulk-del": async () => {
    const pattern = await UI.ask(
      "Delete files containing (e.g., .tmp):",
      "red",
    );
    if (pattern) {
      const confirm = await UI.ask(
        `Type 'yes' to delete all files matching '${pattern}':`,
        "bgRed",
      );
      if (confirm.toLowerCase() === "yes") {
        await manager.deleteByPattern(pattern);
      } else {
        console.log("Operation Cancelled.".green);
      }
    }
  },

  // --- Network & System ---
  fetch: async () => {
    const url = await UI.ask("API URL:", "cyan");
    const name = await UI.askFile("Save JSON as");
    if (url && name) await manager.fetchRemote(name, url);
  },

  stats: async () => await manager.stats(),
};

// ==========================================
// 3. MAIN LOOP
// ==========================================

const startApp = async () => {
  UI.printBanner();
  UI.printMenu();

  const recursiveAsk = async () => {
    try {
      const input = await UI.ask("cmd >", "green");
      const command = input.trim().toLowerCase();

      if (command === "exit" || command === "quit") {
        console.log("\nGoodbye\n".rainbow);
        rl.close();
        process.exit(0);
      }

      if (COMMANDS[command]) {
        console.log(""); // Spacing
        await COMMANDS[command]();
        console.log(""); // Spacing
      } else if (command !== "") {
        console.log(`Unknown command. Try 'list' or 'help'.`.red);
      }

      // Loop back
      recursiveAsk();
    } catch (error) {
      console.log("Critical UI Error:".bgRed, error.message);
      recursiveAsk(); // Try to recover
    }
  };

  recursiveAsk();
};

startApp();
