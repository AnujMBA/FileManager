const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const manager = require("./fileManager"); // Ensure this matches your filename
require("colors");

// ==========================================
// 1. UI CONFIGURATION
// ==========================================

const rl = readline.createInterface({ input, output });

const UI = {
  // Wrapper for User Input
  ask: async (query, color = "white") => {
    return (await rl.question(` ${query[color]} `)).trim();
  },

  // Wrapper for Filename Input (Optional Extension)
  askFile: async (actionName) => {
    const name = await UI.ask(`${actionName} Filename:`, "yellow");
    return name ? name : null;
  },

  printBanner: () => {
    console.clear();
    console.log(
      `
   ╔════════════════════════════════════════╗
   ║          NODE FILE MANAGER PRO         ║
   ╚════════════════════════════════════════╝
        `.cyan.bold,
    );
  },

  printMenu: () => {
    const menu = {
      "📄 Files": ["create", "read", "append", "delete", "rename", "open"],
      "📁 Folders": ["mkdir", "rmdir", "list", "tree"],
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
  const file = await UI.askFile(actionName);
  if (file) await managerFn(file);
};

const COMMANDS = {
  // --- File Ops ---
  create: async () => {
    const name = await UI.askFile("New");
    if (name) {
      const content = await UI.ask("Enter Content:", "cyan");
      await manager.create(name, content);
    }
  },

  read: () => executeSimpleOp("Read", manager.read),
  delete: () => executeSimpleOp("Delete", manager.delete),
  zip: () => executeSimpleOp("Compress", manager.compress),
  info: () => executeSimpleOp("Info", manager.info),
  encrypt: () => executeSimpleOp("Lock", manager.encrypt),
  decrypt: () => executeSimpleOp("Unlock", manager.decrypt),
  open: () => executeSimpleOp("Open", manager.open),

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

  // --- Folder & Bulk Ops ---
  list: async () => await manager.list(),
  tree: async () => await manager.tree(),

  mkdir: async () => {
    const name = await UI.ask("Folder Name:", "yellow");
    if (name) await manager.create(name); // Overloaded create in manager or separate mkdir
  },

  rmdir: async () => {
    const name = await UI.ask("Folder to Delete:", "red");
    if (name) await manager.delete(name); // Manager delete handles both usually, or use manager.deleteDir if separated
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
