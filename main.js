const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");

let mainWindow = null;
let updateWindow = null;
let pendingUpdateVersion = null;
function sendUpdateState(state) {
  for (const win of [updateWindow, mainWindow]) if (win && !win.isDestroyed()) win.webContents.send("projectlog:update-state", state);
}
function showUpdateWindow(state = {}) {
  if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.show(); sendUpdateState(state); return; }
  updateWindow = new BrowserWindow({width:470,height:440,minWidth:430,minHeight:400,resizable:false,parent:mainWindow&&!mainWindow.isDestroyed()?mainWindow:undefined,modal:!!(mainWindow&&!mainWindow.isDestroyed()),show:false,backgroundColor:"#101318",title:"ProjectLog Update",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  updateWindow.setMenuBarVisibility(false);
  updateWindow.loadFile(path.join(__dirname,"update.html"));
  updateWindow.once("ready-to-show",()=>{updateWindow.show();sendUpdateState(state);});
  updateWindow.on("closed",()=>{updateWindow=null;});
}
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
      webviewTag: true,
    },
  });

  // Open external links in the system's default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(console.error);
    }

    return { action: "deny" };
  });

  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
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
  ipcMain.handle("projectlog:update-action", async (_event, action) => {
    if (action === "download") {
      if (!pendingUpdateVersion) throw new Error("No update is available to download.");
      try { sendUpdateState({status:"downloading",version:pendingUpdateVersion,percent:0}); await autoUpdater.downloadUpdate(); return {success:true}; }
      catch (error) { sendUpdateState({status:"error",message:error.message||"Download failed."}); throw error; }
    }
    if (action === "install") { autoUpdater.quitAndInstall(false,true); return {success:true}; }
    if (action === "later") { if(updateWindow&&!updateWindow.isDestroyed()) updateWindow.close(); return {success:true}; }
    throw new Error("Unsupported update action.");
  });

  ipcMain.handle("projectlog:local-ai-request", async (_event, payload) => {
    if (!payload || !["ollama", "lmstudio"].includes(payload.provider)) throw new Error("Unsupported local AI provider.");
    if (typeof payload.endpoint !== "string" || typeof payload.model !== "string" || !Array.isArray(payload.messages)) throw new Error("Invalid local AI request.");
    const endpoint = new URL(payload.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol) || !["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) throw new Error("Only a localhost model endpoint is allowed.");
    const messages = payload.messages.slice(-24).map(m => ({ role: String(m.role || "user"), content: String(m.content || ""), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_name ? { tool_name: m.tool_name } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) }));
    const tools = Array.isArray(payload.tools) ? payload.tools.slice(0, 20) : [];
    let url, body;
    if (payload.provider === "ollama") {
      url = new URL("/api/chat", endpoint).toString();
      body = { model: payload.model, messages, tools, stream: false };
    } else {
      url = new URL("/v1/chat/completions", endpoint).toString();
      body = { model: payload.model, messages, tools, tool_choice: "auto", stream: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error(`Local model API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
      let data; try { data = JSON.parse(text); } catch { throw new Error("The local model server returned invalid JSON."); }
      if (payload.provider === "ollama") return { provider: "ollama", message: data.message || {} };
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The local model request timed out after 3 minutes.");
      throw new Error(error.message || "Could not connect to the local model server.");
    } finally { clearTimeout(timer); }
  });

  ipcMain.handle("projectlog:check-for-updates", async () => {
    if (!app.isPackaged || process.platform !== "win32") {
      return { status: "unsupported", message: "Update checks are available in the installed Windows version, not in development mode." };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      const latest = result?.updateInfo?.version;
      const current = app.getVersion();
      if (latest && latest !== current) {
        return { status: "available", message: `Installed version ${current}. Release version ${latest} is available. The updater will ask before downloading.` };
      }
      return { status: "current", message: `ProjectLog ${current} is installed. If a newer release exists, the updater will prompt you.` };
    } catch (error) {
      return { status: "error", message: error?.message || "Could not reach GitHub Releases." };
    }
  });
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

  // User-approved, themed updater with live download progress.
  if (app.isPackaged && process.platform === "win32") {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("update-available", (info) => {
      pendingUpdateVersion = info.version;
      showUpdateWindow({status:"available",version:info.version});
      sendUpdateState({status:"available",version:info.version});
    });
    autoUpdater.on("update-not-available", () => sendUpdateState({status:"current",version:app.getVersion()}));
    autoUpdater.on("download-progress", (progress) => sendUpdateState({
      status:"downloading",version:pendingUpdateVersion,percent:progress.percent,
      speed:`${(progress.bytesPerSecond/1048576).toFixed(2)} MB/s`,
      transferred:`${(progress.transferred/1048576).toFixed(1)} MB`,
      total:`${(progress.total/1048576).toFixed(1)} MB`,
      bytesPerSecond:`${(progress.bytesPerSecond/1048576).toFixed(2)} MB/s`
    }));
    autoUpdater.on("update-downloaded", (info) => {
      sendUpdateState({status:"downloaded",version:info.version,percent:100});
      showUpdateWindow({status:"downloaded",version:info.version,percent:100});
    });
    autoUpdater.on("error", (error) => {
      console.error("ProjectLog updater error:",error);
      sendUpdateState({status:"error",message:error?.message||"Update service error."});
    });
    setTimeout(()=>autoUpdater.checkForUpdates().catch(error=>console.error("ProjectLog update check failed:",error)),5000);
  }
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
