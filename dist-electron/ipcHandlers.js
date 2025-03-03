"use strict";
// ipcHandlers.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeIpcHandlers = initializeIpcHandlers;
const electron_1 = require("electron");
const crypto_1 = require("crypto");
function initializeIpcHandlers(deps) {
    console.log("Initializing IPC handlers");
    // Credits handlers
    electron_1.ipcMain.handle("set-initial-credits", async (_event, credits) => {
        const mainWindow = deps.getMainWindow();
        if (!mainWindow)
            return;
        try {
            // Set the credits in a way that ensures atomicity
            await mainWindow.webContents.executeJavaScript(`window.__CREDITS__ = ${credits}`);
            mainWindow.webContents.send("credits-updated", credits);
        }
        catch (error) {
            console.error("Error setting initial credits:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("decrement-credits", async () => {
        const mainWindow = deps.getMainWindow();
        if (!mainWindow)
            return;
        try {
            const currentCredits = await mainWindow.webContents.executeJavaScript("window.__CREDITS__");
            if (currentCredits > 0) {
                const newCredits = currentCredits - 1;
                await mainWindow.webContents.executeJavaScript(`window.__CREDITS__ = ${newCredits}`);
                mainWindow.webContents.send("credits-updated", newCredits);
            }
        }
        catch (error) {
            console.error("Error decrementing credits:", error);
        }
    });
    // Screenshot queue handlers
    electron_1.ipcMain.handle("get-screenshot-queue", () => {
        return deps.getScreenshotQueue();
    });
    electron_1.ipcMain.handle("get-extra-screenshot-queue", () => {
        return deps.getExtraScreenshotQueue();
    });
    electron_1.ipcMain.handle("delete-screenshot", async (event, path) => {
        return deps.deleteScreenshot(path);
    });
    electron_1.ipcMain.handle("get-image-preview", async (event, path) => {
        return deps.getImagePreview(path);
    });
    // Screenshot processing handlers
    electron_1.ipcMain.handle("process-screenshots", async () => {
        await deps.processingHelper?.processScreenshots();
    });
    // Window dimension handlers
    electron_1.ipcMain.handle("update-content-dimensions", async (event, { width, height }) => {
        if (width && height) {
            deps.setWindowDimensions(width, height);
        }
    });
    electron_1.ipcMain.handle("set-window-dimensions", (event, width, height) => {
        deps.setWindowDimensions(width, height);
    });
    // Screenshot management handlers
    electron_1.ipcMain.handle("get-screenshots", async () => {
        try {
            let previews = [];
            const currentView = deps.getView();
            if (currentView === "queue") {
                const queue = deps.getScreenshotQueue();
                previews = await Promise.all(queue.map(async (path) => ({
                    path,
                    preview: await deps.getImagePreview(path)
                })));
            }
            else {
                const extraQueue = deps.getExtraScreenshotQueue();
                previews = await Promise.all(extraQueue.map(async (path) => ({
                    path,
                    preview: await deps.getImagePreview(path)
                })));
            }
            return previews;
        }
        catch (error) {
            console.error("Error getting screenshots:", error);
            throw error;
        }
    });
    // Screenshot trigger handlers
    electron_1.ipcMain.handle("trigger-screenshot", async () => {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
            try {
                const screenshotPath = await deps.takeScreenshot();
                const preview = await deps.getImagePreview(screenshotPath);
                mainWindow.webContents.send("screenshot-taken", {
                    path: screenshotPath,
                    preview
                });
                return { success: true };
            }
            catch (error) {
                console.error("Error triggering screenshot:", error);
                return { error: "Failed to trigger screenshot" };
            }
        }
        return { error: "No main window available" };
    });
    electron_1.ipcMain.handle("take-screenshot", async () => {
        try {
            const screenshotPath = await deps.takeScreenshot();
            const preview = await deps.getImagePreview(screenshotPath);
            return { path: screenshotPath, preview };
        }
        catch (error) {
            console.error("Error taking screenshot:", error);
            return { error: "Failed to take screenshot" };
        }
    });
    // Auth related handlers
    electron_1.ipcMain.handle("get-pkce-verifier", () => {
        return (0, crypto_1.randomBytes)(32).toString("base64url");
    });
    electron_1.ipcMain.handle("open-external-url", (event, url) => {
        electron_1.shell.openExternal(url);
    });
    // Subscription handlers
    electron_1.ipcMain.handle("open-settings-portal", () => {
        electron_1.shell.openExternal("https://www.interviewcoder.co/settings");
    });
    electron_1.ipcMain.handle("open-subscription-portal", async (_event, authData) => {
        try {
            const url = "https://www.interviewcoder.co/checkout";
            await electron_1.shell.openExternal(url);
            return { success: true };
        }
        catch (error) {
            console.error("Error opening checkout page:", error);
            return {
                success: false,
                error: error instanceof Error
                    ? error.message
                    : "Failed to open checkout page"
            };
        }
    });
    // Window management handlers
    electron_1.ipcMain.handle("toggle-window", () => {
        try {
            deps.toggleMainWindow();
            return { success: true };
        }
        catch (error) {
            console.error("Error toggling window:", error);
            return { error: "Failed to toggle window" };
        }
    });
    electron_1.ipcMain.handle("reset-queues", async () => {
        try {
            deps.clearQueues();
            return { success: true };
        }
        catch (error) {
            console.error("Error resetting queues:", error);
            return { error: "Failed to reset queues" };
        }
    });
    // Process screenshot handlers
    electron_1.ipcMain.handle("trigger-process-screenshots", async () => {
        try {
            await deps.processingHelper?.processScreenshots();
            return { success: true };
        }
        catch (error) {
            console.error("Error processing screenshots:", error);
            return { error: "Failed to process screenshots" };
        }
    });
    // Reset handlers
    electron_1.ipcMain.handle("trigger-reset", () => {
        try {
            // First cancel any ongoing requests
            deps.processingHelper?.cancelOngoingRequests();
            // Clear all queues immediately
            deps.clearQueues();
            // Reset view to queue
            deps.setView("queue");
            // Get main window and send reset events
            const mainWindow = deps.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                // Send reset events in sequence
                mainWindow.webContents.send("reset-view");
                mainWindow.webContents.send("reset");
            }
            return { success: true };
        }
        catch (error) {
            console.error("Error triggering reset:", error);
            return { error: "Failed to trigger reset" };
        }
    });
    // Window movement handlers
    electron_1.ipcMain.handle("trigger-move-left", () => {
        try {
            deps.moveWindowLeft();
            return { success: true };
        }
        catch (error) {
            console.error("Error moving window left:", error);
            return { error: "Failed to move window left" };
        }
    });
    electron_1.ipcMain.handle("trigger-move-right", () => {
        try {
            deps.moveWindowRight();
            return { success: true };
        }
        catch (error) {
            console.error("Error moving window right:", error);
            return { error: "Failed to move window right" };
        }
    });
    electron_1.ipcMain.handle("trigger-move-up", () => {
        try {
            deps.moveWindowUp();
            return { success: true };
        }
        catch (error) {
            console.error("Error moving window up:", error);
            return { error: "Failed to move window up" };
        }
    });
    electron_1.ipcMain.handle("trigger-move-down", () => {
        try {
            deps.moveWindowDown();
            return { success: true };
        }
        catch (error) {
            console.error("Error moving window down:", error);
            return { error: "Failed to move window down" };
        }
    });
}
