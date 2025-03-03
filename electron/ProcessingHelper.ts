// ProcessingHelper.ts
import fs from "node:fs"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import axios from "axios"
import { app } from "electron"
import { BrowserWindow } from "electron"

// 判断是否为开发环境
const isDev = !app.isPackaged
// 设置API基础URL
const API_BASE_URL = isDev

? "http://localhost:3000"
  : "https://www.interviewcoder.co"

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper

  // 用于API请求的AbortControllers
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
  }

  // 等待应用初始化完成
  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 总共5秒

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  // 获取用户积分
  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 0

    try {
      await this.waitForInitialization(mainWindow)
      const credits = await mainWindow.webContents.executeJavaScript(
        "window.__CREDITS__"
      )

      if (
        typeof credits !== "number" ||
        credits === undefined ||
        credits === null
      ) {
        console.warn("Credits not properly initialized")
        return 0
      }

      return credits
    } catch (error) {
      console.error("Error getting credits:", error)
      return 0
    }
  }

  // 获取编程语言设置
  private async getLanguage(): Promise<string> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return "python"

    try {
      await this.waitForInitialization(mainWindow)
      const language = await mainWindow.webContents.executeJavaScript(
        "window.__LANGUAGE__"
      )

      if (
        typeof language !== "string" ||
        language === undefined ||
        language === null
      ) {
        console.warn("Language not properly initialized")
        return "python"
      }

      return language
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  // 处理截图的主方法
  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // 检查是否有足够的积分
    const credits = await this.getCredits()
    console.log(`当前可用积分: ${credits}`)
    if (credits < 1) {
      console.log("积分不足，无法处理截图")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS)
      return
    }

    const view = this.deps.getView()
    console.log("开始处理视图中的截图:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      try {
        // 初始化AbortController
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          screenshotQueue.map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64")
          }))
        )

        const result = await this.processScreenshotsHelper(screenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key out of credits")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS
            )
          } else if (result.error?.includes("OpenAI API key not found")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              "OpenAI API key not found in environment variables. Please set the OPEN_AI_API_KEY environment variable."
            )
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          // 发生错误时重置视图到队列
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        // 处理成功后设置视图为solutions
        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        // 发生错误时重置视图到队列
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // 当视图为solutions时处理额外的截图
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)
      if (extraScreenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      // 初始化AbortController
      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        const screenshots = await Promise.all(
          [
            ...this.screenshotHelper.getScreenshotQueue(),
            ...extraScreenshotQueue
          ].map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64")
          }))
        )
        console.log(
          "Combined screenshots for processing:",
          screenshots.map((s) => s.path)
        )

        const result = await this.processExtraScreenshotsHelper(
          screenshots,
          signal
        )

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          )
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          )
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  // 处理截图的辅助方法
  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    const MAX_RETRIES = 0
    let retryCount = 0

    while (retryCount <= MAX_RETRIES) {
      try {
        const imageDataList = screenshots.map((screenshot) => screenshot.data)
        const mainWindow = this.deps.getMainWindow()
        const language = await this.getLanguage()
        let problemInfo

        // 第一个API调用 - 提取问题信息
        try {
          const extractResponse = await axios.post(
            `${API_BASE_URL}/api/extract`,
            { imageDataList, language },
            {
              signal,
              timeout: 300000,
              validateStatus: function (status) {
                return status < 500
              },
              maxRedirects: 5,
              headers: {
                "Content-Type": "application/json"
              }
            }
          )

          problemInfo = extractResponse.data

          // 将问题信息存储在AppState中
          this.deps.setProblemInfo(problemInfo)

          // 发送第一个成功事件
          if (mainWindow) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
              problemInfo
            )

            // 提取成功后生成解决方案
            const solutionsResult = await this.generateSolutionsHelper(signal)
            if (solutionsResult.success) {
              // 在转换到解决方案视图前清除任何现有的额外截图
              this.screenshotHelper.clearExtraScreenshotQueue()
              mainWindow.webContents.send(
                this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
                solutionsResult.data
              )
              return { success: true, data: solutionsResult.data }
            } else {
              throw new Error(
                solutionsResult.error || "Failed to generate solutions"
              )
            }
          }
        } catch (error: any) {
          // 如果请求被取消，不重试
          if (axios.isCancel(error)) {
            return {
              success: false,
              error: "Processing was canceled by the user."
            }
          }

          console.error("API Error Details:", {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            code: error.code
          })

          // 处理API特定错误
          if (
            error.response?.data?.error &&
            typeof error.response.data.error === "string"
          ) {
            if (error.response.data.error.includes("Operation timed out")) {
              throw new Error(
                "Operation timed out after 1 minute. Please try again."
              )
            }
            if (error.response.data.error.includes("API Key out of credits")) {
              throw new Error(error.response.data.error)
            }
            throw new Error(error.response.data.error)
          }

          // 如果到达这里，是未知错误
          throw new Error(error.message || "Server error. Please try again.")
        }
      } catch (error: any) {
        // 记录完整错误以进行调试
        console.error("Processing error details:", {
          message: error.message,
          code: error.code,
          response: error.response?.data,
          retryCount
        })

        // 如果是取消或重试次数用尽，返回错误
        if (axios.isCancel(error) || retryCount >= MAX_RETRIES) {
          return { success: false, error: error.message }
        }

        // 增加重试计数并继续
        retryCount++
      }
    }

    // 如果到达这里，所有重试都失败了
    return {
      success: false,
      error: "Failed to process after multiple attempts. Please try again."
    }
  }

  // 生成解决方案的辅助方法
  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/generate`,
        { ...problemInfo, language },
        {
          signal,
          timeout: 300000,
          validateStatus: function (status) {
            return status < 500
          },
          maxRedirects: 5,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )

      return { success: true, data: response.data }
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow()

      // 处理超时错误（504和axios超时）
      if (error.code === "ECONNABORTED" || error.response?.status === 504) {
        // 取消正在进行的API请求
        this.cancelOngoingRequests()
        // 清除两个截图队列
        this.deps.clearQueues()
        // 更新视图状态为队列
        this.deps.setView("queue")
        // 通知渲染器切换视图
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reset-view")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Request timed out. The server took too long to respond. Please try again."
          )
        }
        return {
          success: false,
          error: "Request timed out. Please try again."
        }
      }

if (error.response?.data?.error?.includes("API Key out of credits")) {
        console.log("API积分不足")
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS
          )
        }
        return { success: false, error: error.response.data.error }
      }

      if (
        error.response?.data?.error?.includes(
          "Please close this window and re-enter a valid Open AI API key."
        )
      ) {
        console.log("OpenAI API密钥无效")
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_INVALID
          )
        }
        return { success: false, error: error.response.data.error }
      }

      return { success: false, error: error.message }
    }
  }

  // 处理额外截图的辅助方法
  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data)
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()
      console.log(`准备调试，编程语言: ${language}`)

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      console.log("发送调试请求到API...")
      const response = await axios.post(
        `${API_BASE_URL}/api/debug`,
        { imageDataList, problemInfo, language },
        {
          signal,
          timeout: 300000,
          validateStatus: function (status) {
            return status < 500
          },
          maxRedirects: 5,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
      console.log("调试API请求成功")

      return { success: true, data: response.data }
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow()

      // 首先处理请求取消的情况
      if (axios.isCancel(error)) {
        console.log("用户取消了调试请求")
        return {
          success: false,
          error: "Processing was canceled by the user."
        }
      }

      if (error.response?.data?.error?.includes("Operation timed out")) {
        console.log("调试操作超时")
        // 取消正在进行的API请求
        this.cancelOngoingRequests()
        // 清除两个截图队列
        this.deps.clearQueues()
        // 更新视图状态为队列
        this.deps.setView("queue")
        // 通知渲染器切换视图
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reset-view")
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Operation timed out after 1 minute. Please try again."
          )
        }
        return {
          success: false,
          error: "Operation timed out after 1 minute. Please try again."
        }
      }

      if (error.response?.data?.error?.includes("API Key out of credits")) {
        console.log("调试时API积分不足")
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS
          )
        }
        return { success: false, error: error.response.data.error }
      }

      if (
        error.response?.data?.error?.includes(
          "Please close this window and re-enter a valid Open AI API key."
        )
      ) {
        console.log("调试时OpenAI API密钥无效")
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_INVALID
          )
        }
        return { success: false, error: error.response.data.error }
      }

      console.error("调试过程中发生错误:", error.message)
      return { success: false, error: error.message }
    }
  }

  // 取消所有正在进行的请求
  public cancelOngoingRequests(): void {
    let wasCancelled = false
    console.log("开始取消正在进行的请求...")

    if (this.currentProcessingAbortController) {
      console.log("取消主处理请求")
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      console.log("取消额外处理请求")
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    // 重置hasDebugged标志
    this.deps.setHasDebugged(false)

    // 清除任何待处理的状态
    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      // 发送明确信息表示处理已被取消
      console.log("通知用户界面处理已取消")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
