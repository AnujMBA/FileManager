const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const manager = require("./fileManager");
require("colors");

// ==========================================
// 1. UI & INPUT HELPERS
// ==========================================

const rl = readline.createInterface({ input, output });

const UI = {
    printTitle: () => {
        console.clear();
        console.log("\n File Manager Pro".rainbow.bold);
        console.log("----------------------------------".grey);
    },

    printMenu: () => {
        const categories = {
            "File Ops": ["create", "read", "append", "delete", "rename"],
            "Folder Ops": ["mkdir", "rmdir", "list"],
            "Tools": ["search", "copy", "move", "zip", "fetch"],
            "System": ["info", "stats", "os", "exit"]
        };

        Object.entries(categories).forEach(([category, cmds]) => {
            const cmdString = cmds.map(c => c.green).join(", ");
            console.log(` ${category.bold.white}: ${cmdString}`);
        });
        console.log("----------------------------------".grey);
    },

    ask: async (query, color = "white") => {
        return (await rl.question(query[color] + " ")).trim();
    },

    // Smart Filename asker (Extension handle karta hai)
    askFileName: async (promptMsg, defaultExt = "txt") => {
        const name = await UI.ask(promptMsg, "yellow");
        if (!name) return null; 

        const hasExt = name.includes(".");
        return hasExt ? name : `${name}.${defaultExt}`;
    }
};

// ==========================================
// 2. COMMAND HANDLERS (The Brain)
// ==========================================

const COMMANDS = {
    // --- File Operations ---
    create: async () => {
        const name = await UI.askFileName("  File Name:");
        const content = await UI.ask("   Content:", "cyan");
        if (name) await manager.createFile(name, content);
    },
    
    read: async () => {
        const name = await UI.askFileName("  Read File:");
        if (name) await manager.readFile(name);
    },
    
    append: async () => {
        const name = await UI.askFileName("  Append to File:");
        const content = await UI.ask("  New Content:", "cyan");
        if (name) await manager.appendToFile(name, content);
    },
    
    delete: async () => {
        const name = await UI.askFileName("   Delete File:", "red");
        if (name) await manager.deleteFile(name);
    },

    rename: async () => {
        const oldName = await UI.askFileName("   Old Name:");
        const newName = await UI.askFileName("  New Name:");
        if (oldName && newName) await manager.renameFile(oldName, newName);
    },

    // --- Folder Operations ---
    mkdir: async () => {
        const name = await UI.ask("  Folder Name:", "yellow");
        if (name) await manager.createFolder(name);
    },

    rmdir: async () => {
        const name = await UI.ask("   Folder Name to Delete:", "red");
        if (name) await manager.deleteFolder(name);
    },

    list: async () => await manager.listFiles(),

    // --- Advanced Tools ---
    search: async () => {
        const name = await UI.askFileName("🔍  Search in File:");
        const keyword = await UI.ask("🔑  Keyword:");
        if (name && keyword) await manager.searchInFile(name, keyword);
    },

    copy: async () => {
        const src = await UI.askFileName("Source File:");
        const dest = await UI.askFileName("Destination File:");
        if (src && dest) await manager.copyFile(src, dest);
    },

    move: async () => {
        const file = await UI.askFileName("Move File:");
        const folder = await UI.ask("To Folder:", "yellow");
        if (file && folder) await manager.moveFile(file, folder);
    },
    
    fetch: async () => {
        const url = await UI.ask("🌐  API URL:", "cyan");
        const name = await UI.askFileName("💾  Save as (e.g., data.json):", "json");
        if (url && name) await manager.fetchApiData(name, url);
    },

    zip: async () => {
        const name = await UI.askFileName("📦  Compress File:");
        if (name) await manager.compressFile(name);
    },

    // --- System & Info ---
    info: async () => {
        const name = await UI.askFileName("ℹ️   File Name:");
        if (name) await manager.getFileInfo(name);
    },

    stats: async () => {
        const name = await UI.askFileName("📊  Analyze File:");
        if (name) await manager.countFileStats(name);
    },

    os: async () => await manager.getSystemInfo(),

    // --- Editing (Extra) ---
    replace: async () => {
        const name = await UI.askFileName("  Edit File:");
        const oldTxt = await UI.ask("  Old Text:");
        const newTxt = await UI.ask("  New Text:");
        if (name) await manager.replaceText(name, oldTxt, newTxt);
    },
    
    revert: async () => {
        const name = await UI.askFileName("  Revert File:");
        if (name) await manager.revertFile(name);
    },
    
    clear: async () => {
        const name = await UI.askFileName("  Empty File:");
        if (name) await manager.clearFile(name);
    }
};

// ==========================================
// 3. MAIN LOOP
// ==========================================

const startApp = async () => {
    UI.printTitle();
    UI.printMenu();

    while (true) {
        try {
            const input = await UI.ask("\n  Command:", "bgBlue");
            const command = input.toLowerCase();

            if (command === "exit") {
                console.log("\n  Bye Bye! Happy Coding!".rainbow);
                rl.close();
                break;
            }

            const action = COMMANDS[command];

            if (action) {
                await action(); 
            } else {
                console.log("   Invalid Command. Try 'list' or 'help'".red);
            }

        } catch (error) {
            console.log("   Unexpected Error:".red, error.message);
        }
    }
};

// Start the engine!
startApp();