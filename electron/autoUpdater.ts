import{autoUpdater}from"electron-updater"
import {BrowserWindow, ipcMain, app }from "electron"
import log from "electron-log"


export function initAutoUpdater() {
  console.log("Initializing auto-updater...") // 初始化自动更新器

  // Skip update checks in development
  // 在开发模式下跳过更新检查
  if (!app.isPackaged) {
    console.log("Skipping auto-updater in development mode") // 在开发模式下跳过自动更新
    return
  }

  if (!process.env.GH_TOKEN) {
    console.error("GH_TOKEN environment variable is not set") // GitHub令牌环境变量未设置
    return
  }

  // Configure auto updater
  // 配置自动更新器
  autoUpdater.autoDownload = true // 自动下载更新
  autoUpdater.autoInstallOnAppQuit = true // 应用退出时自动安装更新
  autoUpdater.allowDowngrade = true // 允许降级
  autoUpdater.allowPrerelease = true // 允许预发布版本

  // Enable more verbose logging
  // 启用更详细的日志记录
  autoUpdater.logger = log
  log.transports.file.level = "debug"
  console.log(
    "Auto-updater logger configured with level:", // 自动更新器日志级别已配置为
    log.transports.file.level
)

// Log all update events
// 记录所有更新事件
autoUpdater.on("checking-for-update", () => {
    console.log("Checking for updates...") // 正在检查更新
  })

  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info) // 有可用更新
    // Notify renderer process about available update
    // 通知渲染进程有可用更新
    BrowserWindow.getAllWindows().forEach((window) => {
      console.log("Sending update-available to window") // 发送"更新可用"消息到窗口
      window.webContents.send("update-available", info)
    })
  })

  autoUpdater.on("update-not-available", (info) => {
    console.log("Update not available:", info) // 没有可用更新
  })

  autoUpdater.on("download-progress", (progressObj) => {
    console.log("Download progress:", progressObj) // 下载进度
  })

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded:", info) // 更新已下载
    // Notify renderer process that update is ready to install
    // 通知渲染进程更新已准备好安装
    BrowserWindow.getAllWindows().forEach((window) => {
      console.log("Sending update-downloaded to window") // 发送"更新已下载"消息到窗口
      window.webContents.send("update-downloaded", info)
    })
  })

  autoUpdater.on("error", (err) => {
    console.error("Auto updater error:", err) // 自动更新器错误
  })

  // Check for updates immediately
  // 立即检查更新
  console.log("Checking for updates...")
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      console.log("Update check result:", result) // 更新检查结果
    })
    .catch((err) => {
      console.error("Error checking for updates:", err) // 检查更新时出错
    })

  // Set up update checking interval (every 1 hour)
  // 设置更新检查间隔（每1小时）
  setInterval(() => {
    console.log("Checking for updates (interval)...") // 定时检查更新
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        console.log("Update check result (interval):", result) // 定时更新检查结果
      })
      .catch((err) => {
        console.error("Error checking for updates (interval):", err) // 定时检查更新时出错
      })
  }, 60 * 60 * 1000)

  // Handle IPC messages from renderer
  // 处理来自渲染进程的IPC消息
  ipcMain.handle("start-update", async () => {
    console.log("Start update requested") // 请求开始更新
    try {
      await autoUpdater.downloadUpdate()
      console.log("Update download completed") // 更新下载完成
      return { success: true }
    } catch (error) {
      console.error("Failed to start update:", error) // 开始更新失败
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("install-update", () => {
    console.log("Install update requested") // 请求安装更新
    autoUpdater.quitAndInstall()
  })
}
