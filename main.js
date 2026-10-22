const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#212121",
    title: "ProjectLog",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the system's default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(console.error);
    }

    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".pytest_cache",
  "target",
  "bin",
  "obj",
  ".gradle",
  "vendor",
]);

const RESOURCE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".xlsx",
  ".docx",
  ".pptx",
  ".zip",
  ".7z",
  ".rar",
  ".onnx",
  ".pt",
  ".pth",
  ".safetensors",
  ".tflite",
  ".model",
  ".db",
  ".sqlite",
  ".ipynb",
  ".py",
  ".js",
  ".ts",
  ".html",
  ".css",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
]);

function scanDirectory(root) {
  const treeLines = [path.basename(root) + path.sep];
  const resources = [];

  let totalFiles = 0;
  let entriesSeen = 0;
  let truncated = false;

  const MAX_ENTRIES = 500;
  const MAX_DEPTH = 5;
  const MAX_RESOURCES = 250;

  function walk(dir, depth, prefix) {
    if (depth > MAX_DEPTH || entriesSeen >= MAX_ENTRIES) {
      truncated = true;
      return;
    }

    let entries;

    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) =>
          a.isDirectory() === b.isDirectory()
            ? a.name.localeCompare(b.name)
            : a.isDirectory()
              ? -1
              : 1,
        );
    } catch {
      treeLines.push(prefix + "└── [unreadable folder]");
      return;
    }

    const visible = entries.filter(
      (entry) =>
        !(entry.isDirectory() && SKIP_DIRS.has(entry.name.toLowerCase())) &&
        !entry.isSymbolicLink(),
    );

    visible.forEach((entry, index) => {
      if (entriesSeen >= MAX_ENTRIES) {
        truncated = true;
        return;
      }

      entriesSeen++;

      const last = index === visible.length - 1;
      const mark = last ? "└── " : "├── ";
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        treeLines.push(prefix + mark + entry.name + path.sep);

        if (depth < MAX_DEPTH) {
          walk(full, depth + 1, prefix + (last ? "    " : "│   "));
        } else {
          truncated = true;
        }
      } else {
        totalFiles++;
        treeLines.push(prefix + mark + entry.name);

        if (
          resources.length < MAX_RESOURCES &&
          RESOURCE_EXTS.has(path.extname(entry.name).toLowerCase())
        ) {
          let stat = null;

          try {
            stat = fs.statSync(full);
          } catch {}

          resources.push({
            name: entry.name,
            path: full,
            ext: path.extname(entry.name).toLowerCase(),
            size: stat?.size || 0,
            modifiedAt: stat?.mtime?.toISOString() || null,
          });
        }
      }
    });
  }

  walk(root, 0, "");

  if (truncated) {
    treeLines.push("… scan limited (maximum 500 entries / depth 5)");
  }

  return {
    tree: treeLines.join("\n"),
    resources,
    totalFiles,
    truncated,
  };
}

app.whenReady().then(() => {
  // Hide the default application menu.
  Menu.setApplicationMenu(null);

  ipcMain.handle("projectlog:select-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });

    return result.canceled || !result.filePaths[0]
      ? null
      : { path: result.filePaths[0] };
  });

  ipcMain.handle("projectlog:scan-folder", async (_event, folderPath) => {
    try {
      if (typeof folderPath !== "string" || !folderPath.trim()) {
        return { error: "Choose a folder first." };
      }

      const root = path.resolve(folderPath.trim());
      const stat = await fs.promises.stat(root);

      if (!stat.isDirectory()) {
        return { error: "The selected path is not a folder." };
      }

      return scanDirectory(root);
    } catch (error) {
      return { error: error.message || "Unable to scan folder." };
    }
  });

  ipcMain.handle(
    "projectlog:export-pdf",
    async (event, html, suggestedName) => {
      if (typeof html !== "string" || html.length > 150 * 1024 * 1024) {
        throw new Error(
          "The report is too large to print safely. Export HTML instead.",
        );
      }

      const parent = BrowserWindow.fromWebContents(event.sender);

      const result = await dialog.showSaveDialog(parent, {
        title: "Export ProjectLog as PDF",
        defaultPath: path.join(
          app.getPath("documents"),
          path.basename(String(suggestedName || "ProjectLog.pdf")),
        ),
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const tempPath = path.join(
        os.tmpdir(),
        `projectlog-print-${process.pid}-${Date.now()}.html`,
      );

      let printWindow;

      try {
        await fs.promises.writeFile(tempPath, html, "utf8");

        printWindow = new BrowserWindow({
          show: false,
          width: 1000,
          height: 800,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        await printWindow.loadFile(tempPath);

        await printWindow.webContents.executeJavaScript(
          "Promise.all(Array.from(document.images).map(img => img.decode().catch(() => undefined)))",
        );

        const pdf = await printWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
          marginsType: 0,
          preferCSSPageSize: true,
        });

        await fs.promises.writeFile(result.filePath, pdf);

        return { saved: true, filePath: result.filePath };
      } finally {
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.destroy();
        }

        fs.promises.unlink(tempPath).catch(() => {});
      }
    },
  );

  createWindow();

  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
