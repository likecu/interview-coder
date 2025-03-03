import{app, BrowserWindow, screen, shell, ipcMain}from "electron"
import path from "path"
import {initializeIpcHandlers}from "./ipcHandlers"
import {ProcessingHelper}from "./ProcessingHelper"
import {ScreenshotHelper}from "./ScreenshotHelper"
import {ShortcutsHelper}from "./shortcuts"
import {initAutoUpdater}from "./autoUpdater"
import * as dotenv from "dotenv"

// 常量
const isDev = !app.isPackaged

// 应用程序状态
const state = {

// 窗口管理属性
  mainWindow: null as BrowserWindow | null,
  isWindowVisible: false,
  windowPosition: null as { x: number; y: number } | null,
  windowSize: null as { width: number; height: number } | null,
  screenWidth: 0,
  screenHeight: 0,
  step: 0,
  currentX: 0,
  currentY: 0,

  // 应用程序辅助工具
  screenshotHelper: null as ScreenshotHelper | null, // 截图助手
  shortcutsHelper: null as ShortcutsHelper | null,   // 快捷键助手
  processingHelper: null as ProcessingHelper | null, // 处理助手

  // 视图和状态管理
  view: "queue" as "queue" | "solutions" | "debug",
  problemInfo: null as any,
  hasDebugged: false,

  // 处理事件常量
  PROCESSING_EVENTS: {
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",
    OUT_OF_CREDITS: "out-of-credits",
    API_KEY_INVALID: "processing-api-key-invalid",
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const
}

// 为辅助类添加接口定义
export interface IProcessingHelperDeps {
  getScreenshotHelper: () => ScreenshotHelper | null
  getMainWindow: () => BrowserWindow | null
  getView: () => "queue" | "solutions" | "debug"
  setView: (view: "queue" | "solutions" | "debug") => void
  getProblemInfo: () => any
  setProblemInfo: (info: any) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  clearQueues: () => void
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  setHasDebugged: (value: boolean) => void
  getHasDebugged: () => boolean
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
}

export interface IShortcutsHelperDeps {
  getMainWindow: () => BrowserWindow | null
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  isVisible: () => boolean
  toggleMainWindow: () => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

export interface IIpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null
  setWindowDimensions: (width: number, height: number) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
  takeScreenshot: () => Promise<string>
  getView: () => "queue" | "solutions" | "debug"
  toggleMainWindow: () => void
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

// 初始化辅助工具
function initializeHelpers() {
  state.screenshotHelper = new ScreenshotHelper(state.view)
  state.processingHelper = new ProcessingHelper({
    getScreenshotHelper,
    getMainWindow,
    getView,
    setView,
    getProblemInfo,
    setProblemInfo,
    getScreenshotQueue,
    getExtraScreenshotQueue,
    clearQueues,
    takeScreenshot,
    getImagePreview,
    deleteScreenshot,
    setHasDebugged,
    getHasDebugged,
    PROCESSING_EVENTS: state.PROCESSING_EVENTS
  } as IProcessingHelperDeps)
  state.shortcutsHelper = new ShortcutsHelper({
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.isWindowVisible,
    toggleMainWindow,
    moveWindowLeft: () =>
      moveWindowHorizontal((x) =>
        Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
      ),
    moveWindowRight: () =>
      moveWindowHorizontal((x) =>
        Math.min(
          state.screenWidth - (state.windowSize?.width || 0) / 2,
          x + state.step
        )
      ),
    moveWindowUp: () => moveWindowVertical((y) => y - state.step),
    moveWindowDown: () => moveWindowVertical((y) => y + state.step)
  } as IShortcutsHelperDeps)
}

  // 授权回调处理程序
// 处理授权回调
async function handleAuthCallback(url: string, win: BrowserWindow | null) {
  try {
    console.log("收到授权回调:", url)
    const urlObj = new URL(url)
    const code = urlObj.searchParams.get("code")

    if (!code) {
      console.error("回调URL中缺少code参数")
      return
    }

    if (win) {
      // 将代码发送到渲染器进行PKCE交换
      win.webContents.send("auth-callback", { code })
    }
  } catch (error) {
    console.error("处理授权回调时出错:", error)
  }
}

// 注册interview-coder协议
if (process.platform === "darwin") {
  app.setAsDefaultProtocolClient("interview-coder")
} else {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1] || "")
  ])
}

// 处理协议
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1])
  ])
}

// 强制单实例锁定
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on("second-instance", (event, commandLine) => {
    // 有人尝试运行第二个实例，我们应该聚焦我们的窗口
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()

      // Windows平台的协议处理程序
      // argv: 第二个实例的(命令行/深层链接)参数数组
      if (process.platform === "win32") {
        // 仅保留命令行/深层链接参数
        const deeplinkingUrl = commandLine.pop()
        if (deeplinkingUrl) {
          handleAuthCallback(deeplinkingUrl, state.mainWindow)
        }
      }
    }
  })
}

async function handleAuthCallback(url: string, win: BrowserWindow | null) {
  try {
    console.log("收到授权回调:", url)
    const urlObj = new URL(url)
    const code = urlObj.searchParams.get("code")

    if (!code) {
      console.error("回调URL中缺少code参数")
      return
    }

    if (win) {
      // 将代码发送到渲染器进行PKCE交换
      win.webContents.send("auth-callback", { code })
    }
  } catch (error) {
    console.error("处理授权回调时出错:", error)
  }
}

// 窗口管理函数
async function createWindow(): Promise<void> {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workAreaSize
  state.screenWidth = workArea.width
  state.screenHeight = workArea.height
  state.step = 60 // 移动步长
  state.currentY = 50

  const windowSettings: Electron.BrowserWindowConstructorOptions = {
    height: 600,

    x: state.currentX,
    y: 50,
    alwaysOnTop: true, // 窗口始终置顶
    webPreferences: {
      nodeIntegration: false, // 出于安全考虑禁用Node集成
      contextIsolation: true, // 启用上下文隔离
      preload: isDev
        ? path.join(__dirname, "../dist-electron/preload.js")
        : path.join(__dirname, "preload.js"),
      scrollBounce: true // 启用滚动回弹效果
    },
    show: true,
    frame: false, // 无边框窗口
    transparent: true, // 透明背景
    fullscreenable: false, // 禁止全屏
    hasShadow: false, // 禁用窗口阴影
    backgroundColor: "#00000000", // 完全透明背景
    focusable: true,
    skipTaskbar: true, // 在任务栏中隐藏
    type: "panel", // 面板类型窗口
    paintWhenInitiallyHidden: true,
    titleBarStyle: "hidden", // 隐藏标题栏
    enableLargerThanScreen: true, // 允许窗口大于屏幕
    movable: true // 允许移动
  }

  state.mainWindow = new BrowserWindow(windowSettings)

  // 为窗口事件添加更详细的日志记录
  state.mainWindow.webContents.on("did-finish-load", () => {
    console.log("窗口加载完成")
  })
  state.mainWindow.webContents.on(
    "did-fail-load",
    async (event, errorCode, errorDescription) => {
      console.error("窗口加载失败:", errorCode, errorDescription)
      if (isDev) {
        // 在开发模式下，短暂延迟后重试加载
        console.log("尝试重新加载开发服务器...")
        setTimeout(() => {
          state.mainWindow?.loadURL("http://localhost:54321").catch((error) => {
            console.error("重试加载开发服务器失败:", error)
          })
        }, 1000)
      }
    }
  )

  if (isDev) {
    // 在开发环境中，从开发服务器加载
    state.mainWindow.loadURL("http://localhost:54321").catch((error) => {
      console.error("加载开发服务器失败:", error)
    })
  } else {
    // 在生产环境中，从构建的文件加载
    console.log(
      "加载生产构建:",
      path.join(__dirname, "../dist/index.html")
    )
    state.mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  // 配置窗口行为
  state.mainWindow.webContents.setZoomFactor(1)
  if (isDev) {
    state.mainWindow.webContents.openDevTools()
  }
  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log("尝试打开URL:", url)
    if (url.includes("google.com") || url.includes("supabase.co")) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "allow" }
  })

  // 增强的屏幕捕获防护
  state.mainWindow.setContentProtection(true) // 防止窗口内容被屏幕捕获工具捕获

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  })
  state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)

  // 额外的屏幕捕获防护设置
  if (process.platform === "darwin") {
    // 防止窗口在截图中被捕获
    state.mainWindow.setHiddenInMissionControl(true)
    state.mainWindow.setWindowButtonVisibility(false)
    state.mainWindow.setBackgroundColor("#00000000")

    // 防止窗口包含在窗口切换器中
    state.mainWindow.setSkipTaskbar(true)

    // 禁用窗口阴影
    state.mainWindow.setHasShadow(false)
  }

  // 防止窗口被屏幕录制捕获
  state.mainWindow.webContents.setBackgroundThrottling(false)
  state.mainWindow.webContents.setFrameRate(60)

  // 设置窗口监听器
  state.mainWindow.on("move", handleWindowMove)
  state.mainWindow.on("resize", handleWindowResize)
  state.mainWindow.on("closed", handleWindowClosed)

  // 初始化窗口状态
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.windowSize = { width: bounds.width, height: bounds.height }
  state.currentX = bounds.x
  state.currentY = bounds.y
  state.isWindowVisible = true
}

function handleWindowMove(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.currentX = bounds.x
  state.currentY = bounds.y
}

function handleWindowResize(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowSize = { width: bounds.width, height: bounds.height }
}

function handleWindowClosed(): void {
  state.mainWindow = null
  state.isWindowVisible = false
  state.windowPosition = null
  state.windowSize = null
}

// 窗口可见性函数
function hideMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    const bounds = state.mainWindow.getBounds()
    state.windowPosition = { x: bounds.x, y: bounds.y }
    state.windowSize = { width: bounds.width, height: bounds.height }
    state.mainWindow.setIgnoreMouseEvents(true, { forward: true })
    state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)
state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    state.mainWindow.setOpacity(0)
    state.mainWindow.hide()
    state.isWindowVisible = false
  }
}

function showMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    if (state.windowPosition && state.windowSize) {
      state.mainWindow.setBounds({
        ...state.windowPosition,
        ...state.windowSize
      })
    }
    state.mainWindow.setIgnoreMouseEvents(false)
    state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)
    state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    state.mainWindow.setContentProtection(true)
    state.mainWindow.setOpacity(0)
    state.mainWindow.showInactive()
    state.mainWindow.setOpacity(1)
    state.isWindowVisible = true
  }
}

function toggleMainWindow(): void {
  state.isWindowVisible ? hideMainWindow() : showMainWindow()
}

// 窗口移动函数
function moveWindowHorizontal(updateFn: (x: number) => number): void {
  if (!state.mainWindow) return
  state.currentX = updateFn(state.currentX)
  state.mainWindow.setPosition(
    Math.round(state.currentX),
    Math.round(state.currentY)

)
}

function moveWindowVertical(updateFn: (y: number) => number): void {
  if (!state.mainWindow) return

  const newY = updateFn(state.currentY)
  // 允许窗口在任一方向超出屏幕2/3
  const maxUpLimit = (-(state.windowSize?.height || 0) * 2) / 3
  const maxDownLimit =
    state.screenHeight + ((state.windowSize?.height || 0) * 2) / 3

  // 记录当前状态和限制
  console.log({
    newY,
    maxUpLimit,
    maxDownLimit,
    screenHeight: state.screenHeight,
    windowHeight: state.windowSize?.height,
    currentY: state.currentY
  })

  // 仅在界限内更新
  if (newY >= maxUpLimit && newY <= maxDownLimit) {
    state.currentY = newY
    state.mainWindow.setPosition(
      Math.round(state.currentX),
      Math.round(state.currentY)
    )
  }
}

// 窗口尺寸函数
function setWindowDimensions(width: number, height: number): void {
  if (!state.mainWindow?.isDestroyed()) {
    const [currentX, currentY] = state.mainWindow.getPosition()
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    const maxWidth = Math.floor(workArea.width * 0.5)

    state.mainWindow.setBounds({
      x: Math.min(currentX, workArea.width - maxWidth),
      y: currentY,
      width: Math.min(width + 32, maxWidth),
      height: Math.ceil(height)
    })
  }
}

// 环境设置
function loadEnvVariables() {
  if (isDev) {
    console.log("正在从以下位置加载环境变量:", path.join(process.cwd(), ".env"))
    dotenv.config({ path: path.join(process.cwd(), ".env") })
  } else {
    console.log(
      "正在从以下位置加载环境变量:",
      path.join(process.resourcesPath, ".env")
    )
    dotenv.config({ path: path.join(process.resourcesPath, ".env") })
  }
  console.log("已加载环境变量:", {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ? "存在" : "缺失",
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY
      ? "exists"
      : "missing"
  })
}

// 初始化应用程序
async function initializeApp() {
  try {
    loadEnvVariables()
    initializeHelpers()
    initializeIpcHandlers({
      getMainWindow,
      setWindowDimensions,
      getScreenshotQueue,
      getExtraScreenshotQueue,
      deleteScreenshot,
      getImagePreview,
      processingHelper: state.processingHelper,
      PROCESSING_EVENTS: state.PROCESSING_EVENTS,
      takeScreenshot,
      getView,
      toggleMainWindow,
      clearQueues,
      setView,
      moveWindowLeft: () =>
        moveWindowHorizontal((x) =>
          Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
        ),
      moveWindowRight: () =>
        moveWindowHorizontal((x) =>
          Math.min(
            state.screenWidth - (state.windowSize?.width || 0) / 2,
            x + state.step
          )
        ),
      moveWindowUp: () => moveWindowVertical((y) => y - state.step),
      moveWindowDown: () => moveWindowVertical((y) => y + state.step)
    })
    await createWindow()
    state.shortcutsHelper?.registerGlobalShortcuts()

    // 初始化自动更新器，无论环境如何
    initAutoUpdater()
    console.log(
      "自动更新器已在",
      isDev ? "开发" : "生产",
      "模式下初始化"
    )
  } catch (error) {
    console.error("初始化应用程序失败:", error)
    app.quit()
  }
}

// 在开发环境中处理身份验证回调
app.on("open-url", (event, url) => {
  console.log("收到open-url事件:", url)
  event.preventDefault()
  if (url.startsWith("interview-coder://")) {
    handleAuthCallback(url, state.mainWindow)
  }
})

// 在生产环境中处理身份验证回调(Windows/Linux)
app.on("second-instance", (event, commandLine) => {
  console.log("收到second-instance事件:", commandLine)
  const url = commandLine.find((arg) => arg.startsWith("interview-coder://"))
  if (url) {
    handleAuthCallback(url, state.mainWindow)
  }

  // 聚焦或创建主窗口
  if (!state.mainWindow) {
    createWindow()
  } else {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
  }
})

// 防止应用程序的多个实例
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
      state.mainWindow = null
    }
  })
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 状态获取/设置函数
function getMainWindow(): BrowserWindow | null {
  return state.mainWindow
}

function getView(): "queue" | "solutions" | "debug" {
  return state.view
}

function setView(view: "queue" | "solutions" | "debug"): void {
  state.view = view
  state.screenshotHelper?.setView(view)
}

function getScreenshotHelper(): ScreenshotHelper | null {
  return state.screenshotHelper
}

function getProblemInfo(): any {
  return state.problemInfo
}

function setProblemInfo(problemInfo: any): void {
  state.problemInfo = problemInfo
}

function getScreenshotQueue(): string[] {
  return state.screenshotHelper?.getScreenshotQueue() || []
}

function getExtraScreenshotQueue(): string[] {
  return state.screenshotHelper?.getExtraScreenshotQueue() || []
}

function clearQueues(): void {
  state.screenshotHelper?.clearQueues()
  state.problemInfo = null
  setView("queue")
}

async function takeScreenshot(): Promise<string> {
  if (!state.mainWindow) throw new Error("没有可用的主窗口")
  return (
    state.screenshotHelper?.takeScreenshot(
      () => hideMainWindow(),
      () => showMainWindow()
    ) || ""
  )
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || ""
}

async function deleteScreenshot(
  path: string
): Promise<{ success: boolean; error?: string }> {
  return (
    state.screenshotHelper?.deleteScreenshot(path) || {
      success: false,
      error: "截图助手未初始化"
    }
  )
}

function setHasDebugged(value: boolean): void {
  state.hasDebugged = value
}

function getHasDebugged(): boolean {
  return state.hasDebugged
}

// 导出状态和函数供其他模块使用
export {
  state,
  createWindow,
  hideMainWindow,
  showMainWindow,
  toggleMainWindow,
  setWindowDimensions,
  moveWindowHorizontal,
  moveWindowVertical,
  handleAuthCallback,
  getMainWindow,
  getView,
  setView,
  getScreenshotHelper,
  getProblemInfo,
  setProblemInfo,
  getScreenshotQueue,
  getExtraScreenshotQueue,
  clearQueues,
  takeScreenshot,
  getImagePreview,
  deleteScreenshot,
  setHasDebugged,
  getHasDebugged
}

app.whenReady().then(initializeApp)
