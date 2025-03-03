console.log ("Preload script starting...") // 预加载脚本开始执行
import { contextBridge, ipcRenderer } from "electron"
const { shell } = require("electron")

// 暴露给渲染进程的Electron API类型定义
interface ElectronAPI {
  openSubscriptionPortal: (authData: {
    id: string
    email: string
  }) => Promise<{ success: boolean; error?: string }>
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  clearStore: () => Promise<{ success: boolean; error?: string }>
  getScreenshots: () => Promise<{
    success: boolean
    previews?: Array<{ path: string; preview: string }> | null
    error?: string
  }>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  openExternal: (url: string) => void
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>
  triggerReset: () => Promise<{ success: boolean; error?: string }>
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>
  onSubscriptionUpdated: (callback: () => void) => () => void
  onSubscriptionPortalClosed: (callback: () => void) => () => void
  startUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  decrementCredits: () => Promise<void>
  onCreditsUpdated: (callback: (credits: number) => void) => () => void
  onOutOfCredits: (callback: () => void) => () => void
  getPlatform: () => string
}

export const PROCESSING_EVENTS = {
  // 全局状态
  UNAUTHORIZED: "procesing-unauthorized", // 未授权
  NO_SCREENSHOTS: "processing-no-screenshots", // 没有截图
  OUT_OF_CREDITS: "out-of-credits", // 积分不足

  // 生成初始解决方案的状态
  INITIAL_START: "initial-start", // 初始开始
  PROBLEM_EXTRACTED: "problem-extracted", // 问题提取完成
  SOLUTION_SUCCESS: "solution-success", // 解决方案成功
  INITIAL_SOLUTION_ERROR: "solution-error", // 初始解决方案错误
  RESET: "reset", // 重置

  // 处理调试的状态
  DEBUG_START: "debug-start", // 调试开始
  DEBUG_SUCCESS: "debug-success", // 调试成功
  DEBUG_ERROR: "debug-error" // 调试错误
} as const

// 文件顶部
console.log("Preload script is running") // 预加载脚本正在运行

const electronAPI = {
  // 打开订阅门户
  openSubscriptionPortal: async (authData: { id: string; email: string }) => {
    return ipcRenderer.invoke("open-subscription-portal", authData)
  },
  // 打开设置门户
  openSettingsPortal: () => ipcRenderer.invoke("open-settings-portal"),
  // 更新内容尺寸
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  // 清除存储
  clearStore: () => ipcRenderer.invoke("clear-store"),
  // 获取截图
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  // 删除截图
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),
  // 切换主窗口
  toggleMainWindow: async () => {
    console.log("toggleMainWindow called from preload")
    try {
      const result = await ipcRenderer.invoke("toggle-window")
      console.log("toggle-window result:", result)
      return result
    } catch (error) {
      console.error("Error in toggleMainWindow:", error)
      throw error
    }
  },
  // 事件监听器
  // 截图完成时的回调
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  // 重置视图时的回调
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  // 解决方案开始时的回调
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  // 调试开始时的回调
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },
  // 调试成功时的回调
  onDebugSuccess: (callback: (data: any) => void) => {
    ipcRenderer.on("debug-success", (_event, data) => callback(data))
    return () => {
      ipcRenderer.removeListener("debug-success", (_event, data) =>
        callback(data)

)
    }
  },
  // 调试错误时的回调
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  // 解决方案错误时的回调
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  // 处理没有截图时的回调
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },
  // 积分不足时的回调
  onOutOfCredits: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    }
  },
  // 问题提取完成时的回调
  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  // 解决方案成功时的回调
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  // 未授权时的回调
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  // 打开外部链接
  openExternal: (url: string) => shell.openExternal(url),
  // 触发截图
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),
  // 触发处理截图
  triggerProcessScreenshots: () =>
    ipcRenderer.invoke("trigger-process-screenshots"),
  // 触发重置
  triggerReset: () => ipcRenderer.invoke("trigger-reset"),
  // 向左移动
  triggerMoveLeft: () => ipcRenderer.invoke("trigger-move-left"),
  // 向右移动
  triggerMoveRight: () => ipcRenderer.invoke("trigger-move-right"),
  // 向上移动
  triggerMoveUp: () => ipcRenderer.invoke("trigger-move-up"),
  // 向下移动
  triggerMoveDown: () => ipcRenderer.invoke("trigger-move-down"),
  // 订阅更新时的回调
  onSubscriptionUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-updated", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-updated", subscription)
    }
  },
  // 订阅门户关闭时的回调
  onSubscriptionPortalClosed: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-portal-closed", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-portal-closed", subscription)
    }
  },
  // 重置时的回调
  onReset: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.RESET, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.RESET, subscription)
    }
  },
  // 开始更新
  startUpdate: () => ipcRenderer.invoke("start-update"),
  // 安装更新
  installUpdate: () => ipcRenderer.invoke("install-update"),
  // 更新可用时的回调
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  // 更新下载完成时的回调
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  // 减少积分
  decrementCredits: () => ipcRenderer.invoke("decrement-credits"),
  // 积分更新时的回调
  onCreditsUpdated: (callback: (credits: number) => void) => {
    const subscription = (_event: any, credits: number) => callback(credits)
    ipcRenderer.on("credits-updated", subscription)
    return () => {
      ipcRenderer.removeListener("credits-updated", subscription)
    }
  },
  // 获取平台信息
  getPlatform: () => process.platform
} as ElectronAPI

// 暴露API前的日志
console.log(
  "About to expose electronAPI with methods:",
  Object.keys(electronAPI)
)

// 暴露API到渲染进程
contextBridge.exposeInMainWorld("electronAPI", electronAPI)

console.log("electronAPI exposed to window") // electronAPI已暴露给窗口

// 添加焦点恢复处理程序
ipcRenderer.on("restore-focus", () => {
  // 尝试将焦点设置回活动元素
  const activeElement = document.activeElement as HTMLElement
  if (activeElement && typeof activeElement.focus === "function") {
    activeElement.focus()
  }
})

// 暴露受保护的方法，允许渲染进程使用ipcRenderer而不暴露整个对象
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    on: (channel: string, func: (...args: any[]) => void) => {
      if (channel === "auth-callback") {
        ipcRenderer.on(channel, (event, ...args) => func(...args))
      }
    },
    removeListener: (channel: string, func: (...args: any[]) => void) => {
      if (channel === "auth-callback") {
        ipcRenderer.removeListener(channel, (event, ...args) => func(...args))
      }
    }
  }
})
