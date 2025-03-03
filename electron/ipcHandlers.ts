// ipcHandlers.ts

import { ipcMain, shell } from "electron"
import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "crypto"
import { IIpcHandlerDeps } from "./main"

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  console.log("初始化 IPC 处理程序")

  // 积分处理程序 (Credits handlers)
  ipcMain.handle("set-initial-credits", async (_event, credits: number) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      // 以确保原子性的方式设置积分
      await mainWindow.webContents.executeJavaScript(
        `window.__CREDITS__ = ${credits}`

)
      mainWindow.webContents.send("credits-updated", credits)
      console.log(`初始积分已设置: ${credits}`)
    } catch (error) {
      console.error("设置初始积分时出错:", error)
      throw error
    }
  })

  ipcMain.handle("decrement-credits", async () => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      const currentCredits = await mainWindow.webContents.executeJavaScript(
        "window.__CREDITS__"
      )
      if (currentCredits > 0) {
        const newCredits = currentCredits - 1
        await mainWindow.webContents.executeJavaScript(
          `window.__CREDITS__ = ${newCredits}`
        )
        mainWindow.webContents.send("credits-updated", newCredits)
        console.log(`积分已减少: ${currentCredits} -> ${newCredits}`)
      }
    } catch (error) {
      console.error("减少积分时出错:", error)
    }
  })

  // 截图队列处理程序 (Screenshot queue handlers)
  ipcMain.handle("get-screenshot-queue", () => {
    return deps.getScreenshotQueue()
  })

  ipcMain.handle("get-extra-screenshot-queue", () => {
    return deps.getExtraScreenshotQueue()
  })

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    console.log(`删除截图: ${path}`)
    return deps.deleteScreenshot(path)
  })

  ipcMain.handle("get-image-preview", async (event, path: string) => {
    return deps.getImagePreview(path)
  })

  // 截图处理程序 (Screenshot processing handlers)
  ipcMain.handle("process-screenshots", async () => {
    console.log("开始处理截图队列")
    await deps.processingHelper?.processScreenshots()
  })

  // 窗口尺寸处理程序 (Window dimension handlers)
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        console.log(`更新内容尺寸: ${width}x${height}`)
        deps.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle(
    "set-window-dimensions",
    (event, width: number, height: number) => {
      console.log(`设置窗口尺寸: ${width}x${height}`)
      deps.setWindowDimensions(width, height)
    }
  )

  // 截图管理处理程序 (Screenshot management handlers)
  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = []
      const currentView = deps.getView()
      console.log(`获取截图预览 (当前视图: ${currentView})`)

      if (currentView === "queue") {
        const queue = deps.getScreenshotQueue()
        previews = await Promise.all(
          queue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      } else {
        const extraQueue = deps.getExtraScreenshotQueue()
        previews = await Promise.all(
          extraQueue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      }

      console.log(`已获取 ${previews.length} 张截图预览`)
      return previews
    } catch (error) {
      console.error("获取截图时出错:", error)
      throw error
    }
  })

// 截图触发处理程序 (Screenshot trigger handlers)
  ipcMain.handle("trigger-screenshot", async () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      try {
        const screenshotPath = await deps.takeScreenshot()
        const preview = await deps.getImagePreview(screenshotPath)
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
          preview
        })
        console.info("触发截图成功")
        return { success: true }
      } catch (error) {
        console.error("触发截图时出错:", error)
        return { error: "无法触发截图" }
      }
    }
    return { error: "主窗口不可用" }
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await deps.takeScreenshot()
      const preview = await deps.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("截图时出错:", error)
      return { error: "无法获取截图" }
    }
  })

  // 认证相关处理程序 (Auth related handlers)
  ipcMain.handle("get-pkce-verifier", () => {
    return randomBytes(32).toString("base64url")
  })

  ipcMain.handle("open-external-url", (event, url: string) => {
    shell.openExternal(url)
  })

  // 订阅处理程序 (Subscription handlers)
  ipcMain.handle("open-settings-portal", () => {
    shell.openExternal("https://www.interviewcoder.co/settings")
  })
  ipcMain.handle("open-subscription-portal", async (_event, authData) => {
    try {
      const url = "https://www.interviewcoder.co/checkout"
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error("打开结账页面时出错:", error)
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "无法打开结账页面"
      }
    }
  })

  // 窗口管理处理程序 (Window management handlers)
  ipcMain.handle("toggle-window", () => {
    try {
      deps.toggleMainWindow()
      return { success: true }
    } catch (error) {
      console.error("切换窗口时出错:", error)
      return { error: "无法切换窗口" }
    }
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      deps.clearQueues()
      return { success: true }
    } catch (error) {
      console.error("重置队列时出错:", error)
      return { error: "无法重置队列" }
    }
  })

  // 处理截图处理程序 (Process screenshot handlers)
  ipcMain.handle("trigger-process-screenshots", async () => {
    try {
      await deps.processingHelper?.processScreenshots()
      return { success: true }
    } catch (error) {
      console.error("处理截图时出错:", error)
      return { error: "无法处理截图" }
    }
  })

  // 重置处理程序 (Reset handlers)
  ipcMain.handle("trigger-reset", () => {
    try {
      // 首先取消任何正在进行的请求
      deps.processingHelper?.cancelOngoingRequests()

      // 立即清除所有队列
      deps.clearQueues()

      // 重置视图到队列
      deps.setView("queue")

      // 获取主窗口并发送重置事件
      const mainWindow = deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        // 按顺序发送重置事件
        mainWindow.webContents.send("reset-view")
        mainWindow.webContents.send("reset")
      }

      return { success: true }
    } catch (error) {
      console.error("触发重置时出错:", error)
      return { error: "无法触发重置" }
    }
  })

  // 窗口移动处理程序 (Window movement handlers)
  ipcMain.handle("trigger-move-left", () => {
    try {
      deps.moveWindowLeft()
      return { success: true }
    } catch (error) {
      console.error("向左移动窗口时出错:", error)
      return { error: "无法向左移动窗口" }
    }
  })

  ipcMain.handle("trigger-move-right", () => {
    try {
      deps.moveWindowRight()
      return { success: true }
    } catch (error) {
      console.error("向右移动窗口时出错:", error)
      return { error: "无法向右移动窗口" }
    }
  })

  ipcMain.handle("trigger-move-up", () => {
    try {
      deps.moveWindowUp()
      return { success: true }
    } catch (error) {
      console.error("向上移动窗口时出错:", error)
      return { error: "无法向上移动窗口" }
    }
  })

  ipcMain.handle("trigger-move-down", () => {
    try {
      deps.moveWindowDown()
      return { success: true }
    } catch (error) {
      console.error("向下移动窗口时出错:", error)
      return { error: "无法向下移动窗口" }
    }
  })
}
