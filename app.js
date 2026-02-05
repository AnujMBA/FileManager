const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const manager = require("./fileManager");
require("colors");

// --- 1. CONFIGURATION & SETUP ---
const rl = readline.createInterface({ input, output });

// Helper to print colorful titles
const printTitle = () =>
  console.log("\n--- Simple Node.js File Manager (Async) ---".rainbow.bold);

const MENU_ITEMS = [
  // File Operations
  { cmd: "create", desc: "New File", color: "green" },
  { cmd: "read", desc: "Read Content", color: "blue" },
  { cmd: "append", desc: "Add Data", color: "bgCyan" },
  { cmd: "delete", desc: "Delete File", color: "red" },
  { cmd: "rename", desc: "Rename File", color: "magenta" },

  // Folder Operations
  { cmd: "mkdir", desc: "New Folder", color: "yellow" },
  { cmd: "rmdir", desc: "Delete Folder", color: "red" },

  // Advanced Operations
  { cmd: "list", desc: "List All", color: "bgMagenta" },
  { cmd: "info", desc: "File Details", color: "cyan" },
  { cmd: "search", desc: "Find Text", color: "bgYellow" },
  { cmd: "copy", desc: "Copy File", color: "yellow" },
  { cmd: "move", desc: "Move File", color: "cyan" },

  // Editing Tools
  { cmd: "rewrite", desc: "Overwrite All", color: "bgRed" },
  { cmd: "replace", desc: "Find & Replace", color: "bgGreen" },
  { cmd: "zip", desc: "Compress", color: "bgBlue" },
  { cmd: "clear", desc: "Empty File", color: "red" },
  { cmd: "revert", desc: "Undo Change", color: "bgRed" },

  // Tools Section add karein
  { cmd: "fetch", desc: "Download JSON", color: "bgCyan" },
  { cmd: "os", desc: "System Info", color: "bgCyan" },
  { cmd: "stats", desc: "Count Words", color: "bgYellow" },

  // System
  { cmd: "exit", desc: "Close App", color: "grey" },
];

// Function to print the menu dynamically
const showMenu = () => {
  const menuString = MENU_ITEMS.map((item) => {
    const coloredCmd = item.cmd[item.color] || item.cmd.white;
    return `${coloredCmd}`;
  }).join(", ");

  console.log(`\nCommands: ${menuString}`);
};

// --- 2. HELPER FUNCTIONS ---

// Wrapper to make asking questions cleaner
const ask = async (query, color = "white") => {
  return await rl.question(query[color] + " ");
};

/// NEW: Smart File Name Asker (TXT or JSON)
const askFileName = async (promptMsg, defaultExt = "txt") => {
  // 1. Naam puchein
  const nameInput = await ask(promptMsg, "yellow");
  const name = nameInput.trim();

  // 2. Extension puchein (Default set karein)
  const extInput = await ask(
    `Extension (txt/json)? [Enter for .${defaultExt}]:`,
    "grey",
  );

  // Logic: Agar user ne kuch type nahi kiya to default use karein, nahi to user ka input
  let extension = extInput.trim().toLowerCase();

  if (extension === "") {
    extension = "." + defaultExt; // Default (e.g., .txt)
  } else if (!extension.startsWith(".")) {
    extension = "." + extension; // Agar user ne '.' nahi lagaya (e.g., "json")
  }
  if (name.toLowerCase().endsWith(extension)) {
    return name; // Agar user ne "test.txt" likha hai to wesa hi bhej do
  } else {
    return name + extension; // Agar "test" likha hai to "test.txt" bana do
  }
};

// --- 3. COMMAND HANDLERS (Logic Separation) ---

const handleFileOps = async (command) => {
  switch (command) {
    case "create":
      const cName = await askFileName("Enter File Name:");
      const cContent = await ask("Enter Content:", "yellow");
      await manager.createFile(cName, cContent);
      break;

    case "read":
      await manager.readFile(await askFileName("Enter file name to read:"));
      break;

    case "append":
      const aName = await askFileName("Enter file name to append to:");
      const aContent = await ask("Enter content to append:", "yellow");
      await manager.appendToFile(aName, aContent);
      break;

    case "delete":
    case "deleteperm": // Handling duplicate case logic
      await manager.deleteFile(
        await askFileName("Enter file name to delete:", "red"),
      );
      break;

    case "rename":
      const oldN = await askFileName("Enter current file name:", "magenta");
      const newN = await askFileName("Enter new file name:", "magenta");
      await manager.renameFile(oldN, newN);
      break;

    default:
      return false; // Return false if not handled
  }
  return true; // Return true if handled
};

const handleFolderOps = async (command) => {
  switch (command) {
    case "mkdir":
      await manager.createFolder(
        await ask("Enter folder name to create:", "yellow"),
      );
      break;
    case "rmdir":
      await manager.deleteFolder(
        await ask("Enter folder name to delete:", "red"),
      );
      break;
    case "list":
      await manager.listFiles();
      break;
    default:
      return false;
  }
  return true;
};

const handleAdvancedOps = async (command) => {
  switch (command) {
    case "info":
      await manager.getFileInfo(await askFileName(" File name:"));
      break;

    case "search":
      const sName = await askFileName("File to search:");
      const key = await ask("Keyword:");
      await manager.searchInFile(sName, key);
      break;

    case "copy":
      const copySrc = await askFileName("Source file name:");
      const copyDest = await askFileName("New (Copy) file name:");
      await manager.copyFile(copySrc, copyDest);
      break;

    case "move":
      const moveName = await askFileName("Enter file name to move:", "cyan");
      const destFolder = await ask("Enter destination folder name:", "yellow");
      await manager.moveFile(moveName, destFolder);
      break;

    case "fetch":
      const url = await ask("Enter API URL:", "cyan");
      // const nameInput = await ask("Save as (filename):", "yellow");
      // const jsonFileName = nameInput.trim() + ".json";
      saveName = await askFileName("Save as (filename):", "json");
      await manager.fetchApiData(saveName, url);
      break;

    case "stats":
      const statName = await askFileName("File to analyze:");
      await manager.countFileStats(statName);
      break;

    case "os":
      await manager.getSystemInfo();
      break;

    default:
      return false;
  }
  return true;
};

const handleEditOps = async (command) => {
  switch (command) {
    case "rewrite":
      const rwName = await askFileName("File name to overwrite:", "red");
      console.log("  WARNING: Old content will be deleted!".bgRed.white);
      if ((await ask("Are you sure? (y/n):", "yellow")).toLowerCase() === "y") {
        await manager.overwriteFile(
          rwName,
          await ask("Enter NEW content:", "green"),
        );
      } else {
        console.log("Operation Cancelled.".grey);
      }
      break;

    case "replace":
      const rName = await askFileName("File name to edit:", "cyan");
      const oldWord = await ask("Word to replace (Old):", "red");
      const newWord = await ask("New word:", "green");
      await manager.replaceText(rName, oldWord, newWord);
      break;

    case "revert":
      const revName = await askFileName("File name to revert (Undo):");
      await manager.revertFile(revName);
      break;

    case "zip":
      await manager.compressFile(
        await askFileName("File to compress:", "cyan"),
      );
      break;

    case "clear":
      const clName = await askFileName("File to empty:", "red");
      if ((await ask("Are you sure? (y/n):", "yellow")).toLowerCase() === "y") {
        await manager.clearFile(clName);
      }
      break;

    default:
      return false;
  }
  return true;
};

// --- 4. MAIN APP  ---

const startApp = async () => {
  printTitle();
  showMenu();

  while (true) {
    try {
      const input = await ask(
        "\nWhat would you like to do? (Type command):",
        "bgBlue",
      );
      const command = input.trim().toLowerCase();

      if (command === "exit") {
        console.log("Goodbye! 👋".random);
        rl.close();
        break;
      }

      // Try to handle command in specific groups
      // The 'await' ensures one finishes before checking next
      const handled =
        (await handleFolderOps(command)) ||
        (await handleFileOps(command)) ||
        (await handleAdvancedOps(command)) ||
        (await handleEditOps(command));

      if (!handled) {
        console.log(
          " Invalid command! Please type a valid command.".red.inverse,
        );
      }
    } catch (err) {
      console.log("Error in input: ".red, err);
    }
  }
};

// Start the application
startApp();
