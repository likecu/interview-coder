"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingHelper = void 0;
// ProcessingHelper.ts
const node_fs_1 = __importDefault(require("node:fs"));
const axios_1 = __importDefault(require("axios"));
const electron_1 = require("electron");
const isDev = !electron_1.app.isPackaged;
const API_BASE_URL = isDev
    ? "http://localhost:3000"
    : "https://www.interviewcoder.co";
class ProcessingHelper {
constructor(deps) {
        // AbortControllers for API requests
        this.currentProcessingAbortController = null;
        this.currentExtraProcessingAbortController = null;
        this.deps = deps;
        this.screenshotHelper = deps.getScreenshotHelper();
    }
    async waitForInitialization(mainWindow) {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        while (attempts < maxAttempts) {
            const isInitialized = await mainWindow.webContents.executeJavaScript("window.__IS_INITIALIZED__");
            if (isInitialized)
                return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }
        throw new Error("应用程序在 5 秒后未能初始化");
    }
    async getCredits() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return 0;
        try {
            await this.waitForInitialization(mainWindow);
            const credits = await mainWindow.webContents.executeJavaScript("window.__CREDITS__");
            if (typeof credits !== "number" ||
                credits === undefined ||
                credits === null) {
                console.warn("Credits not properly initialized");
                return 0;
            }
            return credits;
        }
        catch (error) {
            console.error("Error getting credits:", error);
            return 0;
        }
    }
    async getLanguage() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return "python";
        try {
            await this.waitForInitialization(mainWindow);
            const language = await mainWindow.webContents.executeJavaScript("window.__LANGUAGE__");
            if (typeof language !== "string" ||
                language === undefined ||
                language === null) {
                console.warn("Language not properly initialized");
                return "python";
            }
            return language;
        }
        catch (error) {
            console.error("Error getting language:", error);
            return "python";
        }
    }
    async processScreenshots() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return;

        const view = this.deps.getView();
        console.log("Processing screenshots in view:", view);
        if (view === "queue") {
            // 当前视图是队列视图，处理主队列中的截图
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
            const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
            console.log("Processing main queue screenshots:", screenshotQueue);
            if (screenshotQueue.length === 0) {
                // 没有截图可处理
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            try {
                // 初始化AbortController用于取消请求
                this.currentProcessingAbortController = new AbortController();
                const { signal } = this.currentProcessingAbortController;
                // 将所有截图转换为base64格式
                const screenshots = await Promise.all(screenshotQueue.map(async (path) => ({
                    path,
                    preview: await this.screenshotHelper.getImagePreview(path),
                    data: node_fs_1.default.readFileSync(path).toString("base64")
                })));
                // 处理截图并获取结果
                const result = await this.processScreenshotsHelper(screenshots, signal);
                if (!result.success) {
                    console.log("Processing failed:", result.error);
                    console.log("Resetting view to queue due to error");
                    this.deps.setView("queue");
                    return;
                }
                // 处理成功后，切换到解决方案视图
                console.log("Setting view to solutions after successful processing");
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, result.data);
                this.deps.setView("solutions");
            }
            catch (error) {
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error);
                console.error("Processing error:", error);
                if (axios_1.default.isCancel(error)) {
                    // 用户取消了处理
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, "Processing was canceled by the user.");
                }
                else {
                    // 其他错误
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message || "Server error. Please try again.");
                }
                // 发生错误时重置回队列视图
                console.log("Resetting view to queue due to error");
                this.deps.setView("queue");
            }
            finally {
                this.currentProcessingAbortController = null;
            }
        }
        else {
            // 当前视图是解决方案视图，处理额外的截图（用于调试）
            const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue();
            console.log("Processing extra queue screenshots:", extraScreenshotQueue);
            if (extraScreenshotQueue.length === 0) {
                // 没有额外的截图可处理
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START);
            // 初始化AbortController用于取消请求
            this.currentExtraProcessingAbortController = new AbortController();
            const { signal } = this.currentExtraProcessingAbortController;
            try {
                // 合并主队列和额外队列的截图
                const screenshots = await Promise.all([
                    ...this.screenshotHelper.getScreenshotQueue(),
                    ...extraScreenshotQueue
                ].map(async (path) => ({
                    path,
                    preview: await this.screenshotHelper.getImagePreview(path),
                    data: node_fs_1.default.readFileSync(path).toString("base64")
                })));
            console.log("合并后的截图处理列表:", screenshots.map((s) => s.path));                // 处理额外的截图
                const result = await this.processExtraScreenshotsHelper(screenshots, signal);
                if (result.success) {
                    // 调试成功
                    this.deps.setHasDebugged(true);
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, result.data);
                }
                else {
                    // 调试失败
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, result.error);
                }
            }
            catch (error) {
                if (axios_1.default.isCancel(error)) {
                    // 用户取消了处理
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "Extra processing was canceled by the user.");
                }
                else {
                    // 其他错误
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, error.message);
                }
            }
            finally {
                this.currentExtraProcessingAbortController = null;
            }
        }
    }
    async processScreenshotsHelper(screenshots, signal) {
        // 处理截图的辅助方法
        const MAX_RETRIES = 0; // 最大重试次数
        let retryCount = 0;
        while (retryCount <= MAX_RETRIES) {
            try {
                // 提取所有截图的base64数据
                const imageDataList = screenshots.map((screenshot) => screenshot.data);
                const mainWindow = this.deps.getMainWindow();
                const language = await this.getLanguage();
                let problemInfo;
                // 第一个API调用 - 提取问题信息
                try {
                    const extractResponse = await axios_1.default.post(`${API_BASE_URL}/api/extract`, { imageDataList, language }, {
                        signal, // 用于取消请求的信号
                        timeout: 300000, // 5分钟超时
                        validateStatus: function (status) {
                            return status < 500; // 只有5xx错误才会抛出异常
                        },
                        maxRedirects: 5,
                        headers: {
                            "Content-Type": "application/json"
                        }
                    });
                    problemInfo = extractResponse.data;
                    // 将问题信息存储在AppState中
                    this.deps.setProblemInfo(problemInfo);
                    // 发送第一个成功事件
if (mainWindow) {
                        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
                        // 提取成功后生成解决方案
                        const solutionsResult = await this.generateSolutionsHelper(signal);
                        if (solutionsResult.success) {
                            // 在切换到解决方案视图之前清除所有现有的额外截图
                            this.screenshotHelper.clearExtraScreenshotQueue();
                            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionsResult.data);
                            return { success: true, data: solutionsResult.data };
                        }
                        else {
                            throw new Error(solutionsResult.error || "生成解决方案失败");
                        }
                    }
                }
                catch (error) {
                    // 如果请求被取消，不进行重试
                    if (axios_1.default.isCancel(error)) {
                        return {
                            success: false,
                            error: "处理已被用户取消。"
                        };
                    }
                    console.error("API错误详情:", {
                        status: error.response?.status,
                        data: error.response?.data,
                        message: error.message,
                        code: error.code
                    });
                    // 处理API特定错误
                    if (error.response?.data?.error &&
                        typeof error.response.data.error === "string") {
                        if (error.response.data.error.includes("Operation timed out")) {
                            throw new Error("操作在1分钟后超时。请重试。");
                        }
                        if (error.response.data.error.includes("API Key out of credits")) {
                            throw new Error(error.response.data.error);
                        }
                        throw new Error(error.response.data.error);
                    }
                    // 如果我们到达这里，它是一个未知错误
                    throw new Error(error.message || "服务器错误。请重试。");
                }
            }
            catch (error) {
                // Log the full error for debugging
                console.error("Processing error details:", {
                    message: error.message,
                    code: error.code,
                    response: error.response?.data,
                    retryCount
                });
                // If it's a cancellation or we've exhausted retries, return the error
                if (axios_1.default.isCancel(error) || retryCount >= MAX_RETRIES) {
                    return { success: false, error: error.message };
                }
                // Increment retry count and continue
                retryCount++;
            }
        }
        // If we get here, all retries failed
return {
            success: false,
            error: "多次尝试处理失败。请再试一次。"
        };
    }
    async generateSolutionsHelper(signal) {
        // 生成解决方案的辅助方法
        try {
            const problemInfo = this.deps.getProblemInfo();
            const language = await this.getLanguage();
if (!problemInfo) {
                throw new Error("没有可用的问题信息");
            }
            // 调用API生成解决方案
            const response = await axios_1.default.post(`${API_BASE_URL}/api/generate`, { ...problemInfo, language }, {
                signal, // 用于取消请求的信号
                timeout: 300000, // 5分钟超时
                validateStatus: function (status) {
                    return status < 500; // 只有5xx错误才会抛出异常
                },
                maxRedirects: 5,
                headers: {
                    "Content-Type": "application/json"
                }
            });
            return { success: true, data: response.data };
        }
        catch (error) {
            const mainWindow = this.deps.getMainWindow();
            // Handle timeout errors (both 504 and axios timeout)
            if (error.code === "ECONNABORTED" || error.response?.status === 504) {
                // Cancel ongoing API requests
                this.cancelOngoingRequests();
                // Clear both screenshot queues
                this.deps.clearQueues();
                // Update view state to queue
                this.deps.setView("queue");
                // Notify renderer to switch view
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("reset-view");
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, "Request timed out. The server took too long to respond. Please try again.");
                }
                return {
                    success: false,
                    error: "Request timed out. Please try again."
                };
            }
            if (error.response?.data?.error?.includes("API Key out of credits")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS);
                }
                return { success: false, error: error.response.data.error };
            }
            if (error.response?.data?.error?.includes("Please close this window and re-enter a valid Open AI API key.")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
                }
                return { success: false, error: error.response.data.error };
            }
            return { success: false, error: error.message };
        }
    }
    async processExtraScreenshotsHelper(screenshots, signal) {
        // 处理额外截图的辅助方法（用于调试）
        try {
            const imageDataList = screenshots.map((screenshot) => screenshot.data);
            const problemInfo = this.deps.getProblemInfo();
            const language = await this.getLanguage();
            if (!problemInfo) {
                throw new Error("没有可用的问题信息");
            }
            // 调用调试API
            const response = await axios_1.default.post(`${API_BASE_URL}/api/debug`, { imageDataList, problemInfo, language }, {
                signal, // 用于取消请求的信号
                timeout: 300000, // 5分钟超时
                validateStatus: function (status) {
                    return status < 500; // 只有5xx错误才会抛出异常
                },
                maxRedirects: 5,
                headers: {
                    "Content-Type": "application/json"
                }
            });
            return { success: true, data: response.data };
        }
        catch (error) {
            const mainWindow = this.deps.getMainWindow();
            // Handle cancellation first
            if (axios_1.default.isCancel(error)) {
                return {
                    success: false,
                    error: "Processing was canceled by the user."
                };
            }
            if (error.response?.data?.error?.includes("Operation timed out")) {
                // Cancel ongoing API requests
                this.cancelOngoingRequests();
                // Clear both screenshot queues
                this.deps.clearQueues();
                // Update view state to queue
                this.deps.setView("queue");
                // Notify renderer to switch view
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("reset-view");
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "Operation timed out after 1 minute. Please try again.");
                }
                return {
                    success: false,
                    error: "Operation timed out after 1 minute. Please try again."
                };
            }
            if (error.response?.data?.error?.includes("API Key out of credits")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS);
                }
                return { success: false, error: error.response.data.error };
            }
            if (error.response?.data?.error?.includes("Please close this window and re-enter a valid Open AI API key.")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
                }
                return { success: false, error: error.response.data.error };
            }
            return { success: false, error: error.message };
        }
    }
    cancelOngoingRequests() {
        // 取消所有正在进行的请求
        let wasCancelled = false;
        if (this.currentProcessingAbortController) {
            // 取消主处理请求
            this.currentProcessingAbortController.abort();
            this.currentProcessingAbortController = null;
            wasCancelled = true;
        }
        if (this.currentExtraProcessingAbortController) {
            // 取消额外处理请求
            this.currentExtraProcessingAbortController.abort();
            this.currentExtraProcessingAbortController = null;
            wasCancelled = true;
        }
        // Reset hasDebugged flag
        this.deps.setHasDebugged(false);
        // Clear any pending state
        this.deps.setProblemInfo(null);
        const mainWindow = this.deps.getMainWindow();
        if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
            // Send a clear message that processing was cancelled
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        }
    }
}
exports.ProcessingHelper = ProcessingHelper;
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingHelper = void 0;
// ProcessingHelper.ts
const node_fs_1 = __importDefault(require("node:fs"));
const axios_1 = __importDefault(require("axios"));
const electron_1 = require("electron");
const isDev = !electron_1.app.isPackaged;
const API_BASE_URL = isDev
    ? "http://localhost:3000"
    : "https://www.interviewcoder.co";
class ProcessingHelper {
    constructor(deps) {
        // AbortControllers for API requests
        this.currentProcessingAbortController = null;
        this.currentExtraProcessingAbortController = null;
        this.deps = deps;
        this.screenshotHelper = deps.getScreenshotHelper();
    }
    async waitForInitialization(mainWindow) {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        while (attempts < maxAttempts) {
            const isInitialized = await mainWindow.webContents.executeJavaScript("window.__IS_INITIALIZED__");
            if (isInitialized)
                return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }
throw new Error("应用程序在 5 秒后未能初始化");
    }
    async getCredits() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return 0;
        try {
            await this.waitForInitialization(mainWindow);
            const credits = await mainWindow.webContents.executeJavaScript("window.__CREDITS__");
            if (typeof credits !== "number" ||
                credits === undefined ||
                credits === null) {
                console.warn("Credits not properly initialized");
                return 0;
            }
            return credits;
        }
        catch (error) {
            console.error("Error getting credits:", error);
            return 0;
        }
    }
    async getLanguage() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return "python";
        try {
            await this.waitForInitialization(mainWindow);
            const language = await mainWindow.webContents.executeJavaScript("window.__LANGUAGE__");
            if (typeof language !== "string" ||
                language === undefined ||
                language === null) {
                console.warn("Language not properly initialized");
                return "python";
            }
            return language;
        }
        catch (error) {
            console.error("Error getting language:", error);
            return "python";
        }
    }
    async processScreenshots() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return;

        const view = this.deps.getView();
        console.log("Processing screenshots in view:", view);
        if (view === "queue") {
            // 当前视图是队列视图，处理主队列中的截图
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
            const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
            console.log("Processing main queue screenshots:", screenshotQueue);
            if (screenshotQueue.length === 0) {
                // 没有截图可处理
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            try {
                // 初始化AbortController用于取消请求
                this.currentProcessingAbortController = new AbortController();
                const { signal } = this.currentProcessingAbortController;
                // 将所有截图转换为base64格式
                const screenshots = await Promise.all(screenshotQueue.map(async (path) => ({
                    path,
                    preview: await this.screenshotHelper.getImagePreview(path),
                    data: node_fs_1.default.readFileSync(path).toString("base64")
                })));
                // 处理截图并获取结果
                const result = await this.processScreenshotsHelper(screenshots, signal);
                if (!result.success) {
                    console.log("Processing failed:", result.error);
                    console.log("Resetting view to queue due to error");
                    this.deps.setView("queue");
                    return;
                }
                // 处理成功后，切换到解决方案视图
                console.log("Setting view to solutions after successful processing");
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, result.data);
                this.deps.setView("solutions");
            }
            catch (error) {
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error);
                console.error("Processing error:", error);
                if (axios_1.default.isCancel(error)) {
                    // 用户取消了处理
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, "Processing was canceled by the user.");
                }
                else {
                    // 其他错误
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message || "Server error. Please try again.");
                }
                // 发生错误时重置回队列视图
                console.log("Resetting view to queue due to error");
                this.deps.setView("queue");
            }
            finally {
                this.currentProcessingAbortController = null;
            }
        }
        else {
            // 当前视图是解决方案视图，处理额外的截图（用于调试）
            const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue();
            console.log("Processing extra queue screenshots:", extraScreenshotQueue);
            if (extraScreenshotQueue.length === 0) {
                // 没有额外的截图可处理
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START);
            // 初始化AbortController用于取消请求
            this.currentExtraProcessingAbortController = new AbortController();
            const { signal } = this.currentExtraProcessingAbortController;
            try {
                // 合并主队列和额外队列的截图
                const screenshots = await Promise.all([
                    ...this.screenshotHelper.getScreenshotQueue(),
                    ...extraScreenshotQueue
                ].map(async (path) => ({
                    path,
                    preview: await this.screenshotHelper.getImagePreview(path),
                    data: node_fs_1.default.readFileSync(path).toString("base64")
                })));
            console.log("合并后的截图处理列表:", screenshots.map((s) => s.path));                // 处理额外的截图
                const result = await this.processExtraScreenshotsHelper(screenshots, signal);
                if (result.success) {
                    // 调试成功
                    this.deps.setHasDebugged(true);
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, result.data);
                }
                else {
                    // 调试失败
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, result.error);
                }
            }
            catch (error) {
                if (axios_1.default.isCancel(error)) {
                    // 用户取消了处理
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "Extra processing was canceled by the user.");
                }
                else {
                    // 其他错误
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, error.message);
                }
            }
            finally {
                this.currentExtraProcessingAbortController = null;
            }
        }
    }
    async processScreenshotsHelper(screenshots, signal) {
        // 处理截图的辅助方法
        const MAX_RETRIES = 0; // 最大重试次数
        let retryCount = 0;
        while (retryCount <= MAX_RETRIES) {
            try {
                // 提取所有截图的base64数据
                const imageDataList = screenshots.map((screenshot) => screenshot.data);
                const mainWindow = this.deps.getMainWindow();
                const language = await this.getLanguage();
                let problemInfo;
                // 第一个API调用 - 提取问题信息
                try {
                    const extractResponse = await axios_1.default.post(`${API_BASE_URL}/api/extract`, { imageDataList, language }, {
                        signal, // 用于取消请求的信号
                        timeout: 300000, // 5分钟超时
                        validateStatus: function (status) {
                            return status < 500; // 只有5xx错误才会抛出异常
                        },
                        maxRedirects: 5,
                        headers: {
                            "Content-Type": "application/json"
                        }
                    });
                    problemInfo = extractResponse.data;
                    // 将问题信息存储在AppState中
                    this.deps.setProblemInfo(problemInfo);
                    // 发送第一个成功事件
                    if (mainWindow) {
                        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
                        // 提取成功后生成解决方案
                        const solutionsResult = await this.generateSolutionsHelper(signal);
                        if (solutionsResult.success) {
                            // 在切换到解决方案视图之前清除所有现有的额外截图
                            this.screenshotHelper.clearExtraScreenshotQueue();
                            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, solutionsResult.data);
                            return { success: true, data: solutionsResult.data };
                        }
                        else {
                            throw new Error(solutionsResult.error || "Failed to generate solutions");
                        }
                    }
                }
                catch (error) {
                    // 如果请求被取消，不进行重试
                    if (axios_1.default.isCancel(error)) {
                        return {
                            success: false,
                            error: "Processing was canceled by the user."
                        };
                    }
                    console.error("API Error Details:", {
                        status: error.response?.status,
                        data: error.response?.data,
                        message: error.message,
                        code: error.code
                    });
                    // Handle API-specific errors
                    if (error.response?.data?.error &&
                        typeof error.response.data.error === "string") {
                        if (error.response.data.error.includes("Operation timed out")) {
                            throw new Error("Operation timed out after 1 minute. Please try again.");
                        }
                        if (error.response.data.error.includes("API Key out of credits")) {
                            throw new Error(error.response.data.error);
                        }
                        throw new Error(error.response.data.error);
                    }
                    // If we get here, it's an unknown error
                    throw new Error(error.message || "Server error. Please try again.");
                }
            }
            catch (error) {
                // Log the full error for debugging
                console.error("Processing error details:", {
                    message: error.message,
                    code: error.code,
                    response: error.response?.data,
                    retryCount
                });
                // If it's a cancellation or we've exhausted retries, return the error
                if (axios_1.default.isCancel(error) || retryCount >= MAX_RETRIES) {
                    return { success: false, error: error.message };
                }
                // Increment retry count and continue
                retryCount++;
            }
        }
        // If we get here, all retries failed
        return {
            success: false,
            error: "多次尝试处理失败。请再试一次。"
        };
    }
    async generateSolutionsHelper(signal) {
        // 生成解决方案的辅助方法
        try {
            const problemInfo = this.deps.getProblemInfo();
            const language = await this.getLanguage();
            if (!problemInfo) {
                throw new Error("No problem info available");
            }
            // 调用API生成解决方案
            const response = await axios_1.default.post(`${API_BASE_URL}/api/generate`, { ...problemInfo, language }, {
                signal, // 用于取消请求的信号
                timeout: 300000, // 5分钟超时
                validateStatus: function (status) {
                    return status < 500; // 只有5xx错误才会抛出异常
                },
                maxRedirects: 5,
                headers: {
                    "Content-Type": "application/json"
                }
            });
            return { success: true, data: response.data };
        }
        catch (error) {
            const mainWindow = this.deps.getMainWindow();
            // Handle timeout errors (both 504 and axios timeout)
            if (error.code === "ECONNABORTED" || error.response?.status === 504) {
                // Cancel ongoing API requests
                this.cancelOngoingRequests();
                // Clear both screenshot queues
                this.deps.clearQueues();
                // Update view state to queue
                this.deps.setView("queue");
                // Notify renderer to switch view
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("reset-view");
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, "Request timed out. The server took too long to respond. Please try again.");
                }
                return {
                    success: false,
                    error: "Request timed out. Please try again."
                };
            }
            if (error.response?.data?.error?.includes("API Key out of credits")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS);
                }
                return { success: false, error: error.response.data.error };
            }
            if (error.response?.data?.error?.includes("Please close this window and re-enter a valid Open AI API key.")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
                }
                return { success: false, error: error.response.data.error };
            }
            return { success: false, error: error.message };
        }
    }
    async processExtraScreenshotsHelper(screenshots, signal) {
        // 处理额外截图的辅助方法（用于调试）
        try {
            const imageDataList = screenshots.map((screenshot) => screenshot.data);
            const problemInfo = this.deps.getProblemInfo();
            const language = await this.getLanguage();
            if (!problemInfo) {
                throw new Error("No problem info available");
            }
            // 调用调试API
            const response = await axios_1.default.post(`${API_BASE_URL}/api/debug`, { imageDataList, problemInfo, language }, {
                signal, // 用于取消请求的信号
                timeout: 300000, // 5分钟超时
                validateStatus: function (status) {
                    return status < 500; // 只有5xx错误才会抛出异常
                },
                maxRedirects: 5,
                headers: {
                    "Content-Type": "application/json"
                }
            });
            return { success: true, data: response.data };
        }
        catch (error) {
            const mainWindow = this.deps.getMainWindow();
            // Handle cancellation first
            if (axios_1.default.isCancel(error)) {
                return {
                    success: false,
                    error: "Processing was canceled by the user."
                };
            }
            if (error.response?.data?.error?.includes("Operation timed out")) {
                // Cancel ongoing API requests
                this.cancelOngoingRequests();
                // Clear both screenshot queues
                this.deps.clearQueues();
                // Update view state to queue
                this.deps.setView("queue");
                // Notify renderer to switch view
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("reset-view");
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, "Operation timed out after 1 minute. Please try again.");
                }
                return {
                    success: false,
                    error: "Operation timed out after 1 minute. Please try again."
                };
            }
            if (error.response?.data?.error?.includes("API Key out of credits")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.OUT_OF_CREDITS);
                }
                return { success: false, error: error.response.data.error };
            }
            if (error.response?.data?.error?.includes("Please close this window and re-enter a valid Open AI API key.")) {
                if (mainWindow) {
                    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
                }
                return { success: false, error: error.response.data.error };
            }
            return { success: false, error: error.message };
        }
    }
    cancelOngoingRequests() {
        // 取消所有正在进行的请求
        let wasCancelled = false;
        if (this.currentProcessingAbortController) {
            // 取消主处理请求
            this.currentProcessingAbortController.abort();
            this.currentProcessingAbortController = null;
            wasCancelled = true;
        }
        if (this.currentExtraProcessingAbortController) {
            // 取消额外处理请求
            this.currentExtraProcessingAbortController.abort();
            this.currentExtraProcessingAbortController = null;
            wasCancelled = true;
        }
        // Reset hasDebugged flag
        this.deps.setHasDebugged(false);
        // Clear any pending state
        this.deps.setProblemInfo(null);
        const mainWindow = this.deps.getMainWindow();
        if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
            // Send a clear message that processing was cancelled
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        }
    }
}
exports.ProcessingHelper = ProcessingHelper;
