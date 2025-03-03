import{globalShortcut, app}from "electron"
import {IShortcutsHelperDeps }from "./main"

// 快捷键助手类，用于管理全局快捷键
export class ShortcutsHelper {

private deps: IShortcutsHelperDeps

  constructor(deps: IShortcutsHelperDeps) {
    this.deps = deps
  }

  // 注册全局快捷键
  public registerGlobalShortcuts(): void {
    // 快捷键：CommandOrControl+H - 截图
    globalShortcut.register("CommandOrControl+H", async () => {
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        console.log("Taking screenshot...")
        try {
          const screenshotPath = await this.deps.takeScreenshot()
          const preview = await this.deps.getImagePreview(screenshotPath)
          mainWindow.webContents.send("screenshot-taken", {
            path: screenshotPath,
            preview
          })
        } catch (error) {
          console.error("Error capturing screenshot:", error)
        }
      }
    })

    // 快捷键：CommandOrControl+Enter - 处理截图队列
    globalShortcut.register("CommandOrControl+Enter", async () => {
      await this.deps.processingHelper?.processScreenshots()
    })

    // 快捷键：CommandOrControl+R - 取消请求并重置队列
    globalShortcut.register("CommandOrControl+R", () => {
      console.log(
        "Command + R pressed. Canceling requests and resetting queues..."
      )

      // 取消正在进行的API请求
      this.deps.processingHelper?.cancelOngoingRequests()

      // 清除所有截图队列
      this.deps.clearQueues()

      console.log("Cleared queues.")

      // 更新视图状态为'queue'
      this.deps.setView("queue")

      // 通知渲染进程切换视图到'queue'
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view")
        mainWindow.webContents.send("reset")
      }
    })

    // 窗口移动快捷键
    globalShortcut.register("CommandOrControl+Left", () => {
      console.log("Command/Ctrl + Left pressed. Moving window left.")
      this.deps.moveWindowLeft()
    })

    globalShortcut.register("CommandOrControl+Right", () => {
      console.log("Command/Ctrl + Right pressed. Moving window right.")
      this.deps.moveWindowRight()
    })

    globalShortcut.register("CommandOrControl+Down", () => {
      console.log("Command/Ctrl + down pressed. Moving window down.")
      this.deps.moveWindowDown()
    })

    globalShortcut.register("CommandOrControl+Up", () => {
      console.log("Command/Ctrl + Up pressed. Moving window Up.")
      this.deps.moveWindowUp()
    })

    // 快捷键：CommandOrControl+B - 切换主窗口显示/隐藏
    globalShortcut.register("CommandOrControl+B", () => {
      this.deps.toggleMainWindow()
    })

    // 应用退出时注销所有快捷键
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
    })
  }
}
