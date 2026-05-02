# Trail Built Overlanding — EmailOctopus Setup Guide

## Overview

This guide covers the complete EmailOctopus configuration for trailbuiltoverland.com, including the segmented welcome automation, DNS records, sender verification, and monthly reporting.

---

## Step 1: Create the Mailing List

1. Log in to EmailOctopus → **Lists → New List**
2. Name: `Trail Built Overlanding Subscribers`
3. Add a custom field:
   - **Label:** Vehicle Type
   - **Tag:** `VehicleType`
   - **Type:** Text
4. Save the list and note the **List ID** from the URL.

---

## Step 2: Create the Embed Form

1. Go to **Forms → New Form → Embedded Form**
2. Fields: Email (required), First Name (optional)
3. Hidden field: `VehicleType` (pre-populated by the quiz via URL param)
4. Success message: "You're in! Check your inbox for your personalized gear list."
5. Copy the **Form ID** from the embed code (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
6. Replace `REPLACE_WITH_YOUR_FORM_ID` in `index.html` (line ~481) with this ID.

---

## Step 3: DNS Records for Email Deliverability

Add these records to your domain DNS (Cloudflare, Namecheap, etc.) before activating any automation:

| Type | Name | Value |
|---|---|---|
| TXT | `@` | `v=spf1 include:emailoctopus.com ~all` |
| CNAME | `eo._domainkey` | Provided by EmailOctopus under Account → Senders → Domain Verification |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@trailbuiltoverland.com` |

DNS propagation takes 24–48 hours. Verify all records in EmailOctopus under **Account → Senders → Domain Verification** before sending.

---

## Step 4: Verify Sender

1. Go to **Account → Senders → Add Sender**
2. From Name: `Trail Built`
3. From Email: `hello@trailbuiltoverland.com`
4. Reply-To: `hello@trailbuiltoverland.com`
5. Complete domain verification (requires DNS records above).

---

## Step 5: Create the 5 Welcome Emails

Create each email under **Campaigns → Templates** before building the automation. See the email copy below.

---

## Step 6: Build the Segmented Automation

Go to **Automations → New Automation → When a contact is added to a list**.

**Automation structure:**

```
Trigger: Contact added to "Trail Built Overlanding Subscribers"
  ↓
[5-minute delay — allows confirmation email to arrive first]
  ↓
Condition: VehicleType = "truck"
  Yes → Send "Truck Builder Welcome" → Exit
  No  ↓
Condition: VehicleType = "suv"
  Yes → Send "SUV/4x4 Overlander Welcome" → Exit
  No  ↓
Condition: VehicleType = "jeep"
  Yes → Send "Jeep Overlander Welcome" → Exit
  No  ↓
Condition: VehicleType = "van"
  Yes → Send "Van Lifer Welcome" → Exit
  No  ↓
Send "Welcome to Trail Built" (generic fallback) → Exit
```

**Notes:**
- The quiz pre-populates `VehicleType` via the form hidden field
- Homepage newsletter signup sends without a VehicleType → receives the generic fallback
- Condition matching is case-insensitive in EmailOctopus

---

## Step 7: API Key for Monthly Reporting

1. Go to **Integrations & API → API Keys → Create API Key**
2. Name: `Trail Built Monthly Report`
3. Copy the key and add it as a GitHub secret: `EMAILOCTOPUS_API_KEY`
4. Also add: `EMAILOCTOPUS_LIST_ID` (from the list URL) and `EMAILOCTOPUS_AUTOMATION_ID` (from the automation URL)

---

## Updating Sender on Existing Automation Emails

If you need to update the sender after the automation is built, use the EmailOctopus internal API from the browser console (while logged in):

```javascript
// Step 1: Get automation steps
const automationId = "YOUR_AUTOMATION_ID";
const r = await fetch(`/json/journeys/${automationId}/steps`);
const d = await r.json();
const emailSteps = d.data.filter(s => s.stepType === 301);
console.log(emailSteps.map(s => ({ name: s.name, emailId: s.emailId })));

// Step 2: Update each email sender
const csrf = document.querySelector('meta[name="csrf-token"]').content;
for (const step of emailSteps) {
  const r = await fetch(`/json/journeys/email/${step.emailId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": csrf },
    body: JSON.stringify({
      fromName: "Trail Built",
      fromEmailAddress: "hello@trailbuiltoverland.com",
      replyToEmailAddress: "hello@trailbuiltoverland.com"
    })
  });
  console.log(step.name, (await r.json()).fromEmailAddress);
}
```

---

## Monthly Reporting

The `scripts/monthly-report.mjs` script runs automatically on the 1st of each month via GitHub Actions. It:
1. Pulls automation stats from the EmailOctopus API
2. Generates a Markdown report in `reports/YYYY-MM-report.md`
3. Commits the report to the repository

To run manually: `node scripts/monthly-report.mjs`

Required GitHub Secrets:
- `EMAILOCTOPUS_API_KEY`
- `EMAILOCTOPUS_LIST_ID`
- `EMAILOCTOPUS_AUTOMATION_ID`

---

## Welcome Email Copy

See the 5 email templates below.
