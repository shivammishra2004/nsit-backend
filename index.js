const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const tesseract = require("node-tesseract-ocr");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration constants
const CONFIG = {
    tesseract: {
        lang: "nsitocr",
        oem: 1,
        psm: 8,
        tessedit_char_whitelist: "0123456789",
    },
    browser: {
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
        viewport: null,
        screen: { width: 1920, height: 1080 },
    },
    paths: {
        baseUrl: "https://www.imsnsit.org/imsnsit/",
    },
};

// Core functionality
const initializeBrowser = async () => {
    const browser = await chromium.launch({ headless: false});
    const context = await browser.newContext({
        userAgent: CONFIG.browser.userAgent,
        viewport: CONFIG.browser.viewport,
        screen: CONFIG.browser.screen,
    });
    return { browser, context };
};

const handleCaptcha = async (frame) => {
    const captchaElement = await frame.waitForSelector("#captchaimg");
    const captchaBuffer = await captchaElement.screenshot({
        type: "jpeg",
        encoding: "base64",
    });
    try {
        const text = await tesseract.recognize(
            Buffer.from(captchaBuffer, "base64"),
            CONFIG.tesseract
        );
        let detectedText = text.trim().replace(/[^0-9]/g, "");
        console.log(`Detected Captcha: ${detectedText}`);
        return detectedText;
    } catch (error) {
        console.error("Captcha processing error:", error.message);
        return null;
    }
};

const grabFrame = async (page, wanted) => {
    // Wait for the frame element and access the frame
    const frameHandle = await page.waitForSelector(`frame[name=${wanted}]`);
    const frame = await frameHandle.contentFrame();
    if (!frame) {
        throw new Error("Banner frame not found");
    }
    console.log(`Found ${wanted} frame`);
    return frame; // Return the frame for further actions
};

const checkError = async (frame) => {
    const errorMessages = {
        "You are not authorised to use this Login": {
            success: false,
            message: "User ID is not valid",
            error: "INVALID_USER_ID"
        },
        "Your password does not match.": {
            success: false,
            message: "Password is not valid",
            error: "INVALID_PASSWORD"
        },
        "Invalid Security Number": null // null indicates captcha error
    };

    for (const [errorText, response] of Object.entries(errorMessages)) {
        const errorLocator = frame.locator(".plum_field", { hasText: errorText });
        if (await errorLocator.count() > 0) {
            console.log(`Error found: ${errorText}`);
            return response;
        }
    }
    return { success: true }; // No errors found
};

const loginToPortal = async (frame, userId, password) => {
    try {
        const attemptLogin = async () => {
            await frame.fill("#uid", userId);
            await frame.fill("#pwd", password);
            const captchaText = await handleCaptcha(frame);
            await frame.fill("#cap", captchaText);
            await frame.click("#login");
            await frame.waitForTimeout(100);

            const errorResult = await checkError(frame);
            if (!errorResult.success) {
                return errorResult;
            }
            if (errorResult.success) {
                return {
                    success: true,
                    message: "Login successful",
                    captchaText
                };
            }
            return null; // Captcha error, try again
        };

        // First attempt
        let result = await attemptLogin();
        if (result) return result;

        // Second attempt
        result = await attemptLogin();
        if (result) {
            return result.success ? 
                { ...result, message: "Login successful after second attempt" } : 
                result;
        }

        return {
            success: false,
            message: "Login failed after multiple attempts",
            error: "MULTIPLE_ATTEMPTS_FAILED"
        };

    } catch (error) {
        return {
            success: false,
            message: "An error occurred during login",
            error: error.message
        };
    }
};
const navigateToAttendance = async (page) => {
    // await page.waitForTimeout(100);

    // Access the frame using frameLocator
    const topFrame = page.frameLocator('frameset[name="fset1"] frame[name="top"]');
    // Wait for the frame's content to be attached
    await topFrame.locator("html").waitFor({ state: "attached" });
    await topFrame.locator('a:text("Expand All")').click();
    // await page.waitForTimeout(100);
    await topFrame.locator('a:has-text("MyAttendance")').click();
    console.log('Clicked "MyAttendance" link');
};

const extractAttendanceData = async (frame, year, sem) => {
    try {
        // Select dropdowns and submit form
        await frame.selectOption("#year", year || "2023-24");
        await frame.selectOption("#sem", sem || "2");
        await frame.click('input[name="submit"]');
        await frame.waitForTimeout(500); // Wait for data to load

        // Get target table
        const targetTable = frame.locator(
            "table.plum_fieldbig:nth-last-of-type(2)"
        );

        // Extract headers and statistics in parallel
        const [headers, overallStats] = await Promise.all([
            targetTable
                .locator("tr.plum_head")
                .filter({ hasText: "Days" })
                .first()
                .locator("td")
                .allInnerTexts(),

            Promise.all([
                targetTable
                    .locator("tr.plum_head")
                    .filter({ hasText: "Overall Class" })
                    .locator("td")
                    .allInnerTexts(),
                targetTable
                    .locator("tr.plum_head")
                    .filter({ hasText: /Overall.*Absent/ })
                    .locator("td")
                    .allInnerTexts(),
                targetTable
                    .locator("tr.plum_head")
                    .filter({ hasText: /Overall.*Present/ })
                    .locator("td")
                    .allInnerTexts(),
                targetTable
                    .locator("tr.plum_head")
                    .filter({ hasText: "Overall (%)" })
                    .locator("td, th")
                    .allInnerTexts(),
            ]),
        ]);

        return {
            headers,
            overallStats: {
                overallClass: overallStats[0],
                overallAbsent: overallStats[1],
                overallPresent: overallStats[2],
                overallPercentage: overallStats[3],
            },
        };
    } catch (error) {
        console.error("Error extracting attendance data:", error);
        throw error;
    }
};

// Main execution
const scrapeAttendance = async (userId, password, year, semester) => {
    let browser, context, page;
    try {
        ({ browser, context } = await initializeBrowser());
        page = await context.newPage();

        await page.goto(CONFIG.paths.baseUrl, { waitUntil: "networkidle" });
        await page.click('a[href="student.htm"]');

        let bannerFrame = await grabFrame(page, "banner");

        const loginResult = await loginToPortal(bannerFrame, userId, password);
        console.log(loginResult);
        if (!loginResult.success) {
            await browser.close();
            return loginResult; // Return the error response from loginToPortal
        }
        await page.waitForLoadState("networkidle");
        bannerFrame = await grabFrame(page, "banner");

        // Locate the link with specific inner text within the banner frame
        const linkHandle = await bannerFrame.waitForSelector(
            'a:text("My Activities")',
            { timeout: 5000 } // Add timeout for better error handling
        ).catch(() => null);
        if (!linkHandle) {
            await browser.close();
            return {
                success: false,
                message: "Unable to find My Activities link",
                error: "NAVIGATION_ERROR"
            };
        }
        // Click the link
        await linkHandle.click();
        console.log('clicked my activities');
        await page.waitForTimeout(250);
        await navigateToAttendance(page);
        await page.waitForTimeout(250);
        const frame = await grabFrame(page, "data");
        // const data = await extractAttendanceData(frame,'2024-25','4');
        const data = await extractAttendanceData(frame, year, semester);

        await browser.close();
        return {
            success: true,
            message: "Attendance data retrieved successfully",
            data: data
        };
    } catch (error) {
        if (browser) await browser.close();
        return {
            success: false,
            message: "Failed to retrieve attendance data",
            error: error.message
        };
    }
};

// API Endpoints
app.post("/attendance", async (req, res) => {
    try {
        // Extract the data from the request body
        const { userId, password, year, semester } = req.body;

        // Check if all required fields are present
        if (!userId || !password || !year || !semester) {
            return res.status(400).json({
                success: false,
                message: "Missing required parameters",
                error: "INVALID_PARAMETERS"
            });
        }

        // Use the data (e.g., pass it to a scraping function)
        const result = await scrapeAttendance(userId, password, year, semester);
        
        if (result.success) {
            res.status(200).json(result);
        } else {
            res.status(400).json(result);
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error while fetching attendance",
            error: error.message
        });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "healthy" });
});

const PORT = process.env.PORT;

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
module.exports = app;
