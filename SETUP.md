# Trail Built — Setup Guide

Complete setup takes about 20 minutes and costs $0/month.

---

## Step 1: Get your Amazon Associate tag

1. Go to **affiliate-program.amazon.com** and sign up
2. Once approved, your Associate tag looks like: `yourname-20`
3. Find/replace `trailbuiltove-20` in all HTML files with your actual tag

---

## Step 2: Get a free Groq API key (for AI content)

1. Go to **console.groq.com** and create a free account
2. Click **API Keys → Create API Key**
3. Copy the key — you'll need it in Step 4

Groq's free tier allows ~14,400 requests/day with Llama 3.3 70B. More than enough.

---

## Step 3: Push to GitHub

```bash
cd overlanding-site
git init
git add .
git commit -m "Initial site"
git branch -M main
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOUR-USERNAME/overlanding-site.git
git push -u origin main
```

---

## Step 4: Add GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these two secrets:

| Name | Value |
|------|-------|
| `GROQ_API_KEY` | Your Groq API key from Step 2 |
| `AMAZON_ASSOCIATE_TAG` | Your Associate tag from Step 1 (e.g. `yourname-20`) |

---

## Step 5: Deploy to Netlify (free)

1. Go to **netlify.com** and sign up with your GitHub account
2. Click **Add new site → Import an existing project**
3. Connect GitHub and select your `overlanding-site` repo
4. Leave all build settings blank (it's a static site)
5. Click **Deploy site**

Your site will be live at a random Netlify URL (e.g. `amazing-trail-123.netlify.app`).

### Optional: Custom domain
1. Buy a domain at Namecheap (~$10/yr — search for `.com` availability)
2. In Netlify: **Domain settings → Add custom domain**
3. Update your DNS nameservers to Netlify's

---

## Step 6: Verify the automation

1. In your GitHub repo, go to **Actions → Weekly AI Content + Deploy**
2. Click **Run workflow** to test it manually
3. Watch it generate a new article and commit it automatically
4. Check your Netlify dashboard — it will auto-deploy within 1-2 minutes

After this, a new article is published **every Monday at 9am UTC** with zero manual work.

---

## How the automation works

```
Every Monday 9am UTC
    └── GitHub Actions runs weekly-content.yml
            └── scripts/generate-article.js runs
                    ├── Picks an uncovered topic from TOPIC_POOL
                    ├── Calls Groq API (free) to write ~1,500 word article
                    ├── Saves article as articles/SLUG.html
                    ├── Adds article card to index.html
                    └── Updates sitemap.xml
            └── Git commits + pushes to main
            └── Netlify auto-deploys (free CDN, global)
```

---

## Monetization checklist

- [ ] Amazon Associates approved and tag added to all files
- [ ] Google AdSense — apply once you have 20+ articles and real traffic
- [ ] Email list — add a Mailchimp or ConvertKit signup widget to build an audience
- [ ] Higher-commission programs — consider Avantlink (ARB, Warn direct), Impact.com (iKamper, Dometic)

---

## Generating articles manually

```bash
# Auto-pick a topic
GROQ_API_KEY=your-key node scripts/generate-article.js

# Specific topic
GROQ_API_KEY=your-key node scripts/generate-article.js --topic "best overlanding fridges"
```

---

## Adding topics

Edit the `TOPIC_POOL` array in `scripts/generate-article.js` to add your own topic ideas.
The script automatically skips topics already covered (checks existing filenames).
