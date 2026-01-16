// server.js - Backend Job Scraper Service
// Install dependencies: npm install express puppeteer cors dotenv

const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store browser instance for reuse
let browser = null;

// Initialize browser
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
      ],
    });
  }
  return browser;
}

// Scrape LinkedIn Jobs
async function scrapeLinkedIn(keywords, location, page) {
  const browser = await getBrowser();
  const browserPage = await browser.newPage();

  try {
    // Set user agent to avoid detection
    await browserPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&start=${page * 25}`;

    await browserPage.goto(searchUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for job cards to load
    await browserPage.waitForSelector(".base-card", { timeout: 10000 });

    // Extract job data
    const jobs = await browserPage.evaluate(() => {
      const jobCards = document.querySelectorAll(".base-card");
      const results = [];

      jobCards.forEach((card, index) => {
        try {
          const titleEl = card.querySelector(".base-search-card__title");
          const companyEl = card.querySelector(".base-search-card__subtitle");
          const locationEl = card.querySelector(".job-search-card__location");
          const linkEl = card.querySelector("a.base-card__full-link");
          const dateEl = card.querySelector("time");

          if (titleEl && companyEl && linkEl) {
            results.push({
              id: `linkedin-${Date.now()}-${index}`,
              title: titleEl.textContent.trim(),
              company: companyEl.textContent.trim(),
              location: locationEl ? locationEl.textContent.trim() : "",
              jobUrl: linkEl.href,
              postedDate: dateEl ? dateEl.getAttribute("datetime") : "",
              source: "linkedin",
              status: "scraped",
            });
          }
        } catch (err) {
          console.error("Error parsing job card:", err);
        }
      });

      return results;
    });

    return jobs;
  } catch (error) {
    console.error("LinkedIn scraping error:", error);
    throw error;
  } finally {
    await browserPage.close();
  }
}

// Scrape Naukri.com Jobs
async function scrapeNaukri(keywords, location, page) {
  const browser = await getBrowser();
  const browserPage = await browser.newPage();

  try {
    await browserPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    const searchUrl = `https://www.naukri.com/${keywords.replace(/\s+/g, "-")}-jobs-in-${location.replace(/\s+/g, "-")}?page=${page + 1}`;

    await browserPage.goto(searchUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for job listings
    await browserPage.waitForSelector(
      ".srp-jobtuple-wrapper, article.jobTuple",
      { timeout: 10000 },
    );

    const jobs = await browserPage.evaluate(() => {
      const jobCards = document.querySelectorAll(
        ".srp-jobtuple-wrapper, article.jobTuple",
      );
      const results = [];

      jobCards.forEach((card, index) => {
        try {
          const titleEl = card.querySelector(".title, a.title");
          const companyEl = card.querySelector(".comp-name, .companyInfo a");
          const locationEl = card.querySelector(".location, .locWdth");
          const expEl = card.querySelector(".expwdth, .experience");
          const dateEl = card.querySelector(
            ".job-post-day, .jobTupleFooter span",
          );

          if (titleEl && companyEl) {
            results.push({
              id: `naukri-${Date.now()}-${index}`,
              title: titleEl.textContent.trim(),
              company: companyEl.textContent.trim(),
              location: locationEl ? locationEl.textContent.trim() : "",
              experience: expEl ? expEl.textContent.trim() : "",
              jobUrl: titleEl.href || card.querySelector("a")?.href || "",
              postedDate: dateEl ? dateEl.textContent.trim() : "",
              source: "naukri",
              status: "scraped",
            });
          }
        } catch (err) {
          console.error("Error parsing Naukri job card:", err);
        }
      });

      return results;
    });

    return jobs;
  } catch (error) {
    console.error("Naukri scraping error:", error);
    throw error;
  } finally {
    await browserPage.close();
  }
}

// Extract company career page
async function findCareerPage(companyName) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(companyName + " careers")}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 });

    const careerUrl = await page.evaluate(() => {
      const firstResult = document.querySelector("div.g a");
      return firstResult ? firstResult.href : null;
    });

    return careerUrl;
  } catch (error) {
    console.error("Career page search error:", error);
    return null;
  } finally {
    await page.close();
  }
}

// Find HR email (basic implementation)
async function findHREmail(careerPageUrl) {
  if (!careerPageUrl) return null;

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(careerPageUrl, {
      waitUntil: "networkidle2",
      timeout: 15000,
    });

    const email = await page.evaluate(() => {
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const bodyText = document.body.innerText;
      const emails = bodyText.match(emailRegex);

      if (emails && emails.length > 0) {
        // Prefer HR, careers, recruitment emails
        const hrEmail = emails.find((email) =>
          /hr|careers|recruitment|jobs|talent/i.test(email),
        );
        return hrEmail || emails[0];
      }
      return null;
    });

    return email;
  } catch (error) {
    console.error("Email search error:", error);
    return null;
  } finally {
    await page.close();
  }
}

// Main scraping endpoint
app.post("/api/scrape", async (req, res) => {
  const { keywords, location, sources, maxResults = 20 } = req.body;

  if (!keywords) {
    return res.status(400).json({ error: "Keywords are required" });
  }

  try {
    let allJobs = [];
    const resultsPerSource = Math.ceil(maxResults / sources.length);

    // Scrape from each source
    for (const source of sources) {
      try {
        let sourceJobs = [];

        if (source === "linkedin") {
          res.write(
            `data: ${JSON.stringify({ type: "progress", message: "Searching LinkedIn...", progress: 20 })}\n\n`,
          );
          sourceJobs = await scrapeLinkedIn(keywords, location || "India", 0);
        } else if (source === "naukri") {
          res.write(
            `data: ${JSON.stringify({ type: "progress", message: "Searching Naukri.com...", progress: 40 })}\n\n`,
          );
          sourceJobs = await scrapeNaukri(keywords, location || "India", 0);
        }

        allJobs = [...allJobs, ...sourceJobs.slice(0, resultsPerSource)];
      } catch (err) {
        console.error(`Error scraping ${source}:`, err);
      }
    }

    // Enrich with career pages and emails (async)
    res.write(
      `data: ${JSON.stringify({ type: "progress", message: "Finding career pages...", progress: 60 })}\n\n`,
    );

    for (let i = 0; i < Math.min(allJobs.length, 5); i++) {
      const job = allJobs[i];
      try {
        job.careerPageUrl = await findCareerPage(job.company);
        if (job.careerPageUrl) {
          job.hrEmail = await findHREmail(job.careerPageUrl);
        }
      } catch (err) {
        console.error("Error enriching job data:", err);
      }
    }

    res.write(
      `data: ${JSON.stringify({ type: "progress", message: "Complete!", progress: 100 })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ type: "complete", jobs: allJobs })}\n\n`,
    );
    res.end();
  } catch (error) {
    console.error("Scraping error:", error);
    res
      .status(500)
      .json({ error: "Failed to scrape jobs", details: error.message });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Cleanup on server shutdown
process.on("SIGINT", async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Job scraper service running on port ${PORT}`);
});
