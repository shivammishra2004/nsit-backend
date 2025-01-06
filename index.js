const express = require("express");
const cors = require("cors");
const playwright = require("playwright-aws-lambda");
const tesseract = require("node-tesseract-ocr");
const path = require("path");

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
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
        viewport: null,
        screen: { width: 1920, height: 1080 },
    },
    paths: {
        baseUrl: "https://www.imsnsit.org/imsnsit/",
    }
};

// Scraping functionality
async function scrapeAttendance(userId, password, year, semester) {
    let browser, context, page;

    try {
        // Initialize browser
        // const browser = process.env.NODE_ENV === "production"
        // ? await playwright.launchChromium()
        // : await require("playwright").chromium.launch({ headless: false });

        const browser = process.env.NODE_ENV === "production"
        ? await playwright.launchChromium()
        : await require("playwright").chromium.launch({ headless: true });
        context = await browser.newContext({
            userAgent: CONFIG.browser.userAgent,
            viewport: CONFIG.browser.viewport,
            screen: CONFIG.browser.screen,
        });
        page = await context.newPage();

        // Navigate to login page
        await page.goto(CONFIG.paths.baseUrl, { waitUntil: "networkidle" });
        await page.click('a[href="student.htm"]');

        // Get banner frame
        const bannerFrame = await grabFrame(page, "banner");
        
        // Handle login with proper frame interaction
        await bannerFrame.locator("#uid").fill(userId);
        await bannerFrame.locator("#pwd").fill(password);

        // Handle captcha
        const captchaElement = await bannerFrame.locator("#captchaimg");
        const captchaBuffer = await captchaElement.screenshot({
            type: 'jpeg',
            encoding: 'base64'
        });

        // Process with tesseract directly from buffer
        const text = await tesseract.recognize(
            Buffer.from(captchaBuffer, 'base64'),
            CONFIG.tesseract
        );
        const processedCaptcha =text.trim().replace(/[^0-9]/g, "");
        
        await bannerFrame.locator("#cap").fill(processedCaptcha);
        await bannerFrame.locator("#login").click();
        
        await page.waitForTimeout(1000);

        // Check for invalid login
        const errorLocator = bannerFrame.locator('.plum_field', { hasText: 'Invalid Security Number' });
        if (await errorLocator.count() > 0) {
            throw new Error('Invalid credentials or captcha');
            process.exit(1);
        }

        // Wait for My Activities link and click
        const activitiesLink = await bannerFrame.locator('a:has-text("My Activities")');
        await activitiesLink.click();

        await page.waitForTimeout(500);

        // Navigate to attendance
        await navigateToAttendance(page);
        await page.waitForTimeout(250);

        // Get data frame and extract attendance
        const dataFrame = await grabFrame(page, "data");
        const data = await extractAttendanceData(dataFrame,year,semester);
        
        await browser.close();
        return data;

    } catch (error) {
        if (browser) await browser.close();
        throw error;
    }
}

// Helper function to grab frames
async function grabFrame(page, wanted) {
    const frameHandle = await page.waitForSelector(`frame[name=${wanted}]`);
    const frame = await frameHandle.contentFrame();
    if (!frame) {
        throw new Error(`${wanted} frame not found`);
    }
    return frame;
}

// Navigation helper
async function navigateToAttendance(page) {
    const topFrame = page.frameLocator('frameset[name="fset1"] frame[name="top"]');
    await topFrame.locator("html").waitFor({ state: "attached" });
    await topFrame.locator('a:text("Expand All")').click();
    await page.waitForTimeout(100);
    await topFrame.locator('a:has-text("MyAttendance")').click();
}

async function extractAttendanceData(frame,year,semester) {
    try {
        await frame.locator('#year').selectOption(year);
        await frame.locator('#sem').selectOption(semester);
        await frame.locator('input[name="submit"]').click();
        await frame.waitForTimeout(500);

        const targetTable = frame.locator('table.plum_fieldbig:nth-last-of-type(2)');
        
        // Extract headers and statistics in parallel
        const [headers, overallStats] = await Promise.all([
            targetTable
                .locator('tr.plum_head')
                .filter({ hasText: 'Days' })
                .first()
                .locator('td')
                .allInnerTexts(),
            
            Promise.all([
                targetTable.locator('tr.plum_head').filter({ hasText: 'Overall Class' }).locator('td').allInnerTexts(),
                targetTable.locator('tr.plum_head').filter({ hasText: /Overall.*Absent/ }).locator('td').allInnerTexts(),
                targetTable.locator('tr.plum_head').filter({ hasText: /Overall.*Present/ }).locator('td').allInnerTexts(),
                targetTable.locator('tr.plum_head').filter({ hasText: 'Overall (%)' }).locator('td, th').allInnerTexts()
            ])
        ]);

        return {
            headers,
            overallStats: {
                overallClass: overallStats[0],
                overallAbsent: overallStats[1],
                overallPresent: overallStats[2],
                overallPercentage: overallStats[3]
            }
        };
    } catch (error) {
        throw new Error(`Error extracting attendance data: ${error.message}`);
    }
}

// API Endpoints
app.post("/attendance", async (req, res) => {
    try {
        // Extract the data from the request body
        const { userId, password, year, semester } = req.body;

        // Check if all required fields are present
        if (!userId || !password || !year || !semester) {
            return res.status(400).json({ 
                success: false, 
                error: "User ID, password, year, and semester are required" 
            });
        }

        // Use the data (e.g., pass it to a scraping function)
        const attendanceData = await scrapeAttendance(userId, password, year, semester);

        // Send the data back to the frontend
        res.json({ success: true, data: attendanceData });
    } catch (error) {
        // Handle errors and send a failure response
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "healthy" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
module.exports = app;