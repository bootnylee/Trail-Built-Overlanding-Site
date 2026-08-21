#!/usr/bin/env node

/**
 * Stages a ready-to-paste weekly newsletter for human review in EmailOctopus.
 * This script intentionally makes no network requests and never creates or sends campaigns.
 */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = {
  siteName: "Trail Built",
  tagline: "Built for the road beyond the pavement.",
  domain: "trailbuiltoverland.com",
  fromName: "Trail Built",
  fromAddress: "hello@trailbuiltoverland.com",
  listName: "Trail Built newsletter list",
  palette: {
    page: "#1a1a1a",
    card: "#242424",
    header: "#121212",
    accent: "#d4751a",
    heading: "#f0ece4",
    body: "#d0cbc3",
    muted: "#a0998e",
    footer: "#121212",
  },
};

function fail(step, message) {
  throw new Error(`${step}: ${message}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripHtml(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function metaContent(html, expectedAttribute, expectedValue) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, expectedAttribute).toLowerCase() === expectedValue.toLowerCase()) {
      return attr(tag, "content");
    }
  }
  return "";
}

function canonicalUrl(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, "rel").toLowerCase() === "canonical") return attr(tag, "href");
  }
  return "";
}

function firstJsonLdObject(html) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      const candidate = objects.find((item) => item?.datePublished || item?.headline || item?.name);
      if (candidate) return candidate;
    } catch {
      // Ignore unrelated or invalid JSON-LD blocks and continue searching.
    }
  }
  return {};
}

function sentencesFrom(...sources) {
  const sentences = [];
  for (const source of sources) {
    const text = stripHtml(source);
    for (const sentence of text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []) {
      const normalized = sentence.replace(/\s+/g, " ").trim();
      if (normalized.length >= 35 && !sentences.includes(normalized)) sentences.push(normalized);
      if (sentences.length >= 3) return sentences.join(" ");
    }
  }
  return sentences.join(" ");
}

function excerptParagraphs(html) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((paragraph) => paragraph.length >= 70)
    .filter((paragraph) => !/unsubscribe|cookie|affiliate disclosure|table of contents/i.test(paragraph))
    .slice(0, 4);
}

function newsletterDate() {
  const candidate = process.env.NEWSLETTER_NOW ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) fail("DATE", "NEWSLETTER_NOW must use YYYY-MM-DD.");
  return candidate;
}

function ageInDays(publishedDate, today) {
  const published = Date.parse(`${publishedDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return Math.floor((current - published) / 86_400_000);
}

function testMode() {
  return process.env.NEWSLETTER_TEST_MODE === "true" && process.env.GITHUB_ACTIONS !== "true";
}

async function writeResult(result) {
  const destination = process.env.NEWSLETTER_RESULT_FILE;
  if (destination) await fs.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function renderHtml(article) {
  const { palette } = config;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(article.title)} | ${escapeHtml(config.siteName)}</title>
</head>
<body style="margin:0;padding:0;background:${palette.page};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${palette.page};margin:0;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${palette.card};border-radius:8px;overflow:hidden;">
        <tr><td align="center" style="background:${palette.header};border-bottom:3px solid ${palette.accent};padding:32px 28px;">
          <div style="margin:0;color:${palette.heading};font-size:27px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Trail <span style="color:${palette.accent};">Built</span></div>
          <div style="margin-top:7px;color:${palette.muted};font-size:13px;letter-spacing:.5px;">${escapeHtml(config.tagline)}</div>
        </td></tr>
        <tr><td>
          <img src="${escapeHtml(article.heroImage)}" alt="${escapeHtml(article.title)}" width="600" style="display:block;width:100%;height:auto;border:0;">
        </td></tr>
        <tr><td style="padding:32px 34px 18px;color:${palette.body};font-size:16px;line-height:1.7;">
          <div style="color:${palette.accent};font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;margin:0 0 12px;">New from Trail Built</div>
          <h1 style="margin:0 0 18px;color:${palette.heading};font-size:27px;line-height:1.25;">${escapeHtml(article.title)}</h1>
          <p style="margin:0;color:${palette.body};">${escapeHtml(article.excerpt)}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 10px;"><tr><td style="border-radius:6px;background:${palette.accent};">
            <a href="${escapeHtml(article.url)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:.2px;">Read the full guide</a>
          </td></tr></table>
        </td></tr>
        <tr><td align="center" style="background:${palette.footer};padding:24px 28px;color:${palette.muted};font-size:12px;line-height:1.55;">
          <p style="margin:0 0 8px;">{{SenderInfo}}</p>
          <p style="margin:0;"><a href="{{UnsubscribeURL}}" style="color:${palette.accent};text-decoration:none;">Unsubscribe</a> &nbsp;·&nbsp; <a href="https://trailbuiltoverland.com/about.html" style="color:${palette.accent};text-decoration:none;">About Trail Built</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
}

async function findNewestArticle() {
  const articlesDirectory = path.join(root, "articles");
  const entries = await fs.readdir(articlesDirectory, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const filePath = path.join(articlesDirectory, entry.name);
    const html = await fs.readFile(filePath, "utf8");
    const jsonLd = firstJsonLdObject(html);
    const publishedDate = jsonLd.datePublished || (html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) continue;

    const title = jsonLd.headline || jsonLd.name || metaContent(html, "property", "og:title") || "";
    const description = metaContent(html, "name", "description") || jsonLd.description || "";
    const articleUrl = canonicalUrl(html) || `https://${config.domain}/articles/${entry.name}`;
    const heroImage = metaContent(html, "property", "og:image") || jsonLd.image?.url || jsonLd.image || "";
    const excerpt = sentencesFrom(description, ...excerptParagraphs(html));
    if (!title || !articleUrl || !heroImage || !excerpt) {
      fail("ARTICLE_PARSE", `Required title, URL, image, or excerpt metadata is missing from articles/${entry.name}.`);
    }
    candidates.push({
      title: stripHtml(title),
      excerpt,
      url: articleUrl,
      heroImage,
      publishedDate,
      slug: entry.name.replace(/\.html$/i, ""),
      source: `articles/${entry.name}`,
    });
  }

  if (candidates.length === 0) fail("ARTICLE_DETECTION", "No dated static article pages were found in articles/.");
  candidates.sort((left, right) => right.publishedDate.localeCompare(left.publishedDate) || left.slug.localeCompare(right.slug));
  return candidates[0];
}

async function commitAndPush(htmlPath, metaPath, article) {
  if (process.env.NEWSLETTER_COMMIT !== "true") return "";
  const relativeHtml = path.relative(root, htmlPath);
  const relativeMeta = path.relative(root, metaPath);
  const commitMessage = `chore: stage weekly newsletter ${article.slug} ${article.publishedDate}`;
  try {
    await execFile("git", ["config", "user.name", "Trail Built Newsletter Bot"], { cwd: root });
    await execFile("git", ["config", "user.email", "bot@trailbuiltoverland.com"], { cwd: root });
    await execFile("git", ["add", "--", relativeHtml, relativeMeta], { cwd: root });
    await execFile("git", ["commit", "-m", commitMessage], { cwd: root });
  } catch (error) {
    fail("GIT_COMMIT", error.stderr?.trim() || error.message);
  }
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });
    await execFile("git", ["push", "origin", "HEAD:main"], { cwd: root });
    return stdout.trim();
  } catch (error) {
    fail("GIT_PUSH", error.stderr?.trim() || error.message);
  }
}

async function main() {
  const article = await findNewestArticle();
  const today = newsletterDate();
  const age = ageInDays(article.publishedDate, today);
  const outputDirectory = path.resolve(root, process.env.NEWSLETTER_OUTPUT_DIR ?? "newsletters");
  const stem = `${article.publishedDate}-${article.slug}`;
  const htmlPath = path.join(outputDirectory, `${stem}.html`);
  const metaPath = path.join(outputDirectory, `${stem}.meta.json`);

  if ((age < 0 || age > 8) && !testMode()) {
    console.log(`NO_NEW_ARTICLE: newest article ${article.slug} was published ${article.publishedDate} (${age} days old); no newsletter staged.`);
    await writeResult({ status: "no-op", reason: "stale", article });
    return;
  }
  if ((age < 0 || age > 8) && testMode()) {
    console.log(`TEST_MODE: bypassing freshness only for local validation; newest article is ${age} days old.`);
  }
  if (await fs.access(htmlPath).then(() => true).catch(() => false)) {
    console.log(`ALREADY_STAGED: ${path.relative(root, htmlPath)} already exists; no duplicate newsletter staged.`);
    await writeResult({ status: "no-op", reason: "already-staged", article, htmlPath: path.relative(root, htmlPath) });
    return;
  }

  const metadata = {
    suggestedSubject: `New this week: ${article.title}`,
    previewText: article.excerpt.slice(0, 160),
    fromName: config.fromName,
    fromAddress: config.fromAddress,
    listName: config.listName,
    articleUrl: article.url,
    publishedDate: article.publishedDate,
    articleTitle: article.title,
    articleSource: article.source,
    stagedAt: new Date().toISOString(),
    note: "Create and send this campaign manually in the EmailOctopus dashboard. This workflow never calls the EmailOctopus API.",
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(htmlPath, renderHtml(article), "utf8");
  await fs.writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const commitSha = await commitAndPush(htmlPath, metaPath, article);
  console.log(`NEWSLETTER_PREPARED: ${path.relative(root, htmlPath)}`);
  console.log(`SUBJECT: ${metadata.suggestedSubject}`);
  console.log(`CTA_URL: ${article.url}`);
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `newsletter_prepared=true\nnewsletter_html_path=${path.relative(root, htmlPath)}\nnewsletter_meta_path=${path.relative(root, metaPath)}\nnewsletter_commit_sha=${commitSha}\n`,
      "utf8",
    );
  }
  await writeResult({
    status: "prepared",
    article,
    htmlPath: path.relative(root, htmlPath),
    metaPath: path.relative(root, metaPath),
    ...metadata,
  });
}

main().catch((error) => {
  console.error(`NEWSLETTER_PREP_FAILED: ${error.message}`);
  process.exitCode = 1;
});
