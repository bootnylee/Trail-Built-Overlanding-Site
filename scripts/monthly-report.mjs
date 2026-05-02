#!/usr/bin/env node
/**
 * Trail Built Overlanding — Monthly Report Generator
 * Mirrors the SilkierStrands monthly reporting pattern.
 *
 * Pulls data from EmailOctopus API and generates a Markdown report
 * saved to reports/YYYY-MM-report.md
 *
 * Required environment variables (set as GitHub Secrets):
 *   EMAILOCTOPUS_API_KEY       - EmailOctopus API key
 *   EMAILOCTOPUS_LIST_ID       - Mailing list ID
 *   EMAILOCTOPUS_AUTOMATION_ID - Welcome automation ID
 *
 * Usage:
 *   node scripts/monthly-report.mjs
 *   node scripts/monthly-report.mjs --month 2025-04  (override month)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY = process.env.EMAILOCTOPUS_API_KEY || "";
const LIST_ID = process.env.EMAILOCTOPUS_LIST_ID || "";
const AUTOMATION_ID = process.env.EMAILOCTOPUS_AUTOMATION_ID || "";
const BASE_URL = "https://emailoctopus.com/api/1.6";
const SITE_URL = "https://trailbuiltoverland.com";

// Determine report month (default: previous month)
const args = process.argv.slice(2);
const monthArg = args.find((a) => a.startsWith("--month="))?.split("=")[1];
const now = new Date();
const reportDate = monthArg
  ? new Date(`${monthArg}-01`)
  : new Date(now.getFullYear(), now.getMonth() - 1, 1);
const REPORT_MONTH = reportDate.toISOString().slice(0, 7); // YYYY-MM
const REPORT_MONTH_LABEL = reportDate.toLocaleString("en-US", {
  month: "long",
  year: "numeric",
});

// ── API helpers ───────────────────────────────────────────────────────────────
async function eoGet(path, params = {}) {
  if (!API_KEY) {
    console.warn("⚠️  EMAILOCTOPUS_API_KEY not set — using mock data");
    return null;
  }
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`EO API error ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`EO API fetch error: ${err.message}`);
    return null;
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────
async function getListStats() {
  const data = await eoGet(`/lists/${LIST_ID}`);
  if (!data) {
    return { total: "N/A", subscribed: "N/A", unsubscribed: "N/A", pending: "N/A" };
  }
  return {
    total: (data.counts?.subscribed || 0) + (data.counts?.unsubscribed || 0),
    subscribed: data.counts?.subscribed || 0,
    unsubscribed: data.counts?.unsubscribed || 0,
    pending: data.counts?.pending || 0,
  };
}

async function getNewSubscribersThisMonth() {
  // EmailOctopus doesn't expose a direct "new this month" count via API,
  // so we approximate by fetching recent contacts and filtering by date.
  const data = await eoGet(`/lists/${LIST_ID}/contacts`, {
    limit: 100,
    status: "SUBSCRIBED",
  });
  if (!data?.data) return "N/A";

  const monthStart = new Date(`${REPORT_MONTH}-01`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

  const newThisMonth = data.data.filter((c) => {
    const created = new Date(c.created_at);
    return created >= monthStart && created <= monthEnd;
  });
  return newThisMonth.length;
}

async function getAutomationStats() {
  if (!AUTOMATION_ID) return null;
  const data = await eoGet(`/automations/${AUTOMATION_ID}`);
  if (!data) return null;
  return data;
}

async function getAutomationEmailStats() {
  if (!AUTOMATION_ID) return [];
  const data = await eoGet(`/automations/${AUTOMATION_ID}/emails`);
  if (!data?.data) return [];

  return data.data.map((email) => {
    const sent = email.statistics?.sends || 0;
    const opens = email.statistics?.unique_opens || 0;
    const clicks = email.statistics?.unique_clicks || 0;
    const openRate = sent > 0 ? ((opens / sent) * 100).toFixed(1) : "0.0";
    const clickRate = sent > 0 ? ((clicks / sent) * 100).toFixed(1) : "0.0";
    return {
      name: email.name || email.subject || "Unnamed Email",
      subject: email.subject || "",
      sent,
      opens,
      clicks,
      openRate,
      clickRate,
    };
  });
}

// ── Report generator ──────────────────────────────────────────────────────────
function generateReport(listStats, newSubs, automationEmails) {
  const generated = new Date().toISOString().slice(0, 10);

  // Find top performer by open rate
  const validEmails = automationEmails.filter((e) => e.sent > 0);
  const topEmail = validEmails.sort(
    (a, b) => parseFloat(b.openRate) - parseFloat(a.openRate)
  )[0];

  // Calculate automation averages
  const avgOpenRate =
    validEmails.length > 0
      ? (
          validEmails.reduce((sum, e) => sum + parseFloat(e.openRate), 0) /
          validEmails.length
        ).toFixed(1)
      : "N/A";
  const avgClickRate =
    validEmails.length > 0
      ? (
          validEmails.reduce((sum, e) => sum + parseFloat(e.clickRate), 0) /
          validEmails.length
        ).toFixed(1)
      : "N/A";

  // Build email stats table
  const emailTable =
    automationEmails.length > 0
      ? `| Email | Sent | Opens | Clicks | Open Rate | Click Rate |
|---|---|---|---|---|---|
${automationEmails
  .map(
    (e) =>
      `| ${e.name.slice(0, 40)} | ${e.sent} | ${e.opens} | ${e.clicks} | ${e.openRate}% | ${e.clickRate}% |`
  )
  .join("\n")}`
      : "_No automation email data available. Ensure EMAILOCTOPUS_AUTOMATION_ID is set._";

  // Recommendations
  const recommendations = [];
  if (parseFloat(avgOpenRate) < 25) {
    recommendations.push(
      "**Open rate below 25%** — Consider A/B testing subject lines. The generic fallback email typically underperforms segmented emails by 30–40%."
    );
  }
  if (parseFloat(avgClickRate) < 3) {
    recommendations.push(
      "**Click rate below 3%** — Add more specific product links with prices and ratings. Emails with 3+ product links typically see 2× click rates."
    );
  }
  if (typeof newSubs === "number" && newSubs < 10) {
    recommendations.push(
      "**Fewer than 10 new subscribers this month** — Consider promoting the quiz on social media. Quiz-driven signups convert at 3× the rate of generic newsletter CTAs."
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "All key metrics are within healthy ranges. Continue the current content and email cadence."
    );
  }

  return `# Trail Built Overlanding — Monthly Report
## ${REPORT_MONTH_LABEL}

_Generated: ${generated} | Site: [trailbuiltoverland.com](${SITE_URL})_

---

## List Overview

| Metric | Value |
|---|---|
| **Total Contacts** | ${listStats.total} |
| **Active Subscribers** | ${listStats.subscribed} |
| **Unsubscribed** | ${listStats.unsubscribed} |
| **Pending Confirmation** | ${listStats.pending} |
| **New This Month** | ${newSubs} |

---

## Welcome Automation Performance

**Automation averages:** ${avgOpenRate}% open rate / ${avgClickRate}% click rate

${emailTable}

${
  topEmail
    ? `### Top Performer
**${topEmail.name}** achieved the highest open rate this month at **${topEmail.openRate}%** (${topEmail.opens} opens from ${topEmail.sent} sends).`
    : ""
}

---

## Segmentation Health

The welcome automation segments subscribers by vehicle type (Truck, SUV/4x4, Jeep, Van) based on quiz responses. Subscribers who arrive via the homepage newsletter form receive the generic fallback email.

To improve segmentation rates:
1. Promote the quiz link prominently on the homepage and in social posts
2. Add the quiz CTA to the end of each article
3. Consider a pop-up trigger after 60 seconds on article pages

---

## Recommendations

${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}

---

## Action Items for Next Month

- [ ] Publish 4 new articles (Monday weekly cadence)
- [ ] Run \`node scripts/seo-audit.mjs\` after each new article
- [ ] Run \`node scripts/generate-sitemap.mjs\` and verify sitemap.xml
- [ ] Run \`python3 scripts/validate-products.py --live\` to check for broken Amazon links
- [ ] Review top-performing email and apply subject line learnings to next campaign
- [ ] Check Google Search Console for new keyword opportunities

---

## Resources

- [EmailOctopus Dashboard](https://dashboard.emailoctopus.com)
- [Google Search Console](https://search.google.com/search-console)
- [Netlify Dashboard](https://app.netlify.com)
- [GitHub Repository](https://github.com/bootnylee/Trail-Built-Overlanding-Site)
- [Setup Guide](${SITE_URL}/docs/emailoctopus-setup.md)
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 Trail Built Overlanding — Monthly Report Generator`);
  console.log(`   Report month: ${REPORT_MONTH_LABEL} (${REPORT_MONTH})\n`);

  // Fetch data
  console.log("Fetching list stats...");
  const listStats = await getListStats();

  console.log("Fetching new subscriber count...");
  const newSubs = await getNewSubscribersThisMonth();

  console.log("Fetching automation email stats...");
  const automationEmails = await getAutomationEmailStats();

  console.log(
    `  List: ${listStats.subscribed} active subscribers, ${newSubs} new this month`
  );
  console.log(`  Automation emails: ${automationEmails.length} found\n`);

  // Generate report
  const report = generateReport(listStats, newSubs, automationEmails);

  // Save to reports/ directory
  const reportsDir = join(REPO_ROOT, "reports");
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = join(reportsDir, `${REPORT_MONTH}-report.md`);
  writeFileSync(reportPath, report, "utf8");

  console.log(`✅ Report saved to: reports/${REPORT_MONTH}-report.md`);
  console.log(`\nReport preview:\n`);
  console.log(report.slice(0, 500) + "...\n");
}

main().catch((err) => {
  console.error("Report generation failed:", err);
  process.exit(1);
});
