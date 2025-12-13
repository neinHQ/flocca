EPIC 1 — FLOCca VS Code Extension Core (MCP Client)
Feature Group 1.1 — Extension Initialization & Configuration
REQ 1.1.1 — Create VS Code Extension Boilerplate

Description:
Initialize the base VS Code extension with activation events, sidebar registration, and basic project structure.

AC:

Extension runs in debug mode

Sidebar placeholder appears in Activity Bar

REQ 1.1.2 — Implement mcp.json Workspace Reader

Description:
Read .vscode/mcp.json and parse MCP server configs.

AC:

Extension loads mcp.json on startup

Logs MCP config keys and endpoints

Errors shown if config missing or invalid

REQ 1.1.3 — Establish MCP Client Core (SSE + stdio)

Description:
Implement connection manager for remote (SSE) and local (stdio) MCP servers.

AC:

Can connect to at least one remote SSE MCP server

Can connect to at least one local MCP server via stdio

Connection status shown in logs

REQ 1.1.4 — Implement Tool Discovery Protocol

Description:
List all tools available from all connected MCP servers.

AC:

Tools appear in tool registry

Updated dynamically on connection/disconnection

🟦 EPIC 2 — Cloud Integrations (GitHub + Jira + Confluence)
Feature Group 2.1 — GitHub MCP Integration
REQ 2.1.1 — Add GitHub MCP Server Config

Description:
Add default config for https://api.githubcopilot.com/mcp/.

AC:

GitHub server appears in tool list

Tools register without errors

REQ 2.1.2 — Implement GitHub OAuth UI

Description:
Create GitHub OAuth button & flow inside extension.

AC:

User can authenticate

Refresh token stored securely via OS keychain

REQ 2.1.3 — Execute Basic GitHub Tool (Search Repos)

Description:
Enable execution of one GitHub MCP tool through UI.

AC:

User runs e.g. github_search_repos("vscode")

Results shown in chat panel

Feature Group 2.2 — Jira MCP Integration
REQ 2.2.1 — Add Atlassian (Jira) MCP Config

Description:
Add config for https://mcp.atlassian.com/v1/sse.

AC:

Tools populate after auth

No auth = no tool access

REQ 2.2.2 — Implement Jira OAuth 2.1 + PKCE

Description:
Full browser-based OAuth flow with token persistence.

AC:

User connects Jira account

Jira projects list successfully loads

REQ 2.2.3 — Execute Jira Tool (List Issues)

Description:
Enable execution of jira.search or similar.

AC:

User can type “show my open issues”

Issues appear in chat panel

Feature Group 2.3 — Confluence MCP Integration
REQ 2.3.1 — Enable Confluence MCP Tools via Jira Auth

Description:
Confluence uses same token as Jira; load Confluence tools.

AC:

Confluence pages searchable

User can fetch page content in chat

🟦 EPIC 3 — Local Execution Integrations (Pytest, Playwright, Database)
Feature Group 3.1 — Pytest MCP Server
REQ 3.1.1 — Build Local Pytest MCP Server

Description:
Create Python MCP server exposing:
pytest_run_directory
pytest_run_file

AC:

Server launches via stdio

Running tests returns structured JSON

REQ 3.1.2 — Integrate Pytest Tools into VS Code

Description:
Connect extension to Pytest MCP server.

AC:

User can run “Run pytest on current file”

Results appear in chat

Feature Group 3.2 — Playwright MCP Server
REQ 3.2.1 — Build Local Playwright MCP Server

Description:
Wrap npx playwright test in MCP tool.

AC:

runAll + runTest methods work

Returns JSON + path to generated HTML report

REQ 3.2.2 — Connect Playwright MCP to Chat

Description:
Enable invoking Playwright tools from VS Code chat.

AC:

User can run all Playwright tests

Results appear in chat

Feature Group 3.3 — Database MCP Server (Postgres)
REQ 3.3.1 — Implement SQL Read-Only MCP Server

Description:
Expose:
db.getSchema
db.sampleRows
db.query (read-only)

AC:

Schema introspection returns table metadata

Running forbidden queries triggers modal confirmation

REQ 3.3.2 — Add Database Configuration UI

Description:
VS Code settings page for DB URL + credentials.

AC:

User can enter connection string

Validate connection button works

🟦 EPIC 4 — Core VS Code UI (Chat, Panels, Explorer)
Feature Group 4.1 — Chat Panel
REQ 4.1.1 — Build Chat UI Skeleton

AC:

Input box + scrollable messages

Tool picker dropdown

REQ 4.1.2 — Enable Natural Language → MCP Execution

AC:

User types “Run pytest”

The extension calls pytest MCP tool

Feature Group 4.2 — Tool Picker UI
REQ 4.2.1 — Dynamic Tool Picker Component

AC:

Lists tools from all MCP servers

Allows enabling/disabling per session

Feature Group 4.3 — Test Explorer Integration
REQ 4.3.1 — Map Pytest Results → Test Explorer

AC:

Pytest tests appear as nodes

Failures show diagnostic lines

REQ 4.3.2 — Map Playwright Results → Test Explorer

AC:

Each browser test shows as test node

Failure clicking opens file

🟦 EPIC 5 — Workflow Automation (AI + Custom Workflows)
Feature Group 5.1 — Multi-step Workflow Engine
REQ 5.1.1 — JSON Workflow Schema Implementation

AC:

Steps stored as JSON in .vscode/flocca/workflows

REQ 5.1.2 — Workflow Executor

AC:

Execute steps sequentially

Logs results to chat

Feature Group 5.2 — Visual Workflow Builder
REQ 5.2.1 — Drag-and-Drop Workflow UI

AC:

Add step

Delete step

Reorder step

REQ 5.2.2 — Save Workflow

AC:

Stored to disk as workflow.json

🟦 EPIC 6 — Feature Coding Workflow (Jira → Code → Tests → PR)
Feature Group 6.1 — Codebase Provider
REQ 6.1.1 — Implement Code Reader Tool

AC:

Tools: code.readFile, code.listFiles

REQ 6.1.2 — Implement Patch Applier

AC:

Atomic patch application

Show diff preview in modal

Feature Group 6.2 — AI-Assisted Feature Builder
REQ 6.2.1 — Pull Jira + Confluence Requirements

AC:

AI receives acceptance criteria + documentation context

REQ 6.2.2 — Execute “Generate Feature” Command

AC:

AI generates code patch

AI generates pytest tests

AI generates Playwright tests

REQ 6.2.3 — Automated PR Creation

AC:

GitHub branch created

Commit applied

PR opened

Linked to Jira ticket

🟦 EPIC 7 — Authentication & Security
Feature Group 7.1 — Token Storage
REQ 7.1.1 — Secure Local Storage via OS Keychain

AC:

Jira, GitHub tokens encrypted

Auto-refresh tokens supported

Feature Group 7.2 — SQL Safety Checks
REQ 7.2.1 — Write Query Confirmation Modal

AC:

Any write query requires explicit confirmation

EPIC 8 — Subscription & Licensing System (FINAL, WITH PRICES & TIERS)

Goal: Implement flocca’s subscription system, including a 24-hour trial, tier-specific feature gating, Stripe checkout, subscription syncing, and UI-level price display.

Feature Group 8.0 — Subscription Tiers & Pricing (NEW)

Define all subscription tiers and their exact amounts.
These will be referenced throughout the onboarding flow, paywall screens, upgrade modals, and the Stripe checkout configuration.

Subscription Tier Definitions
1. Free Tier (Trial Only)

Duration: 24 hours of active usage

Price: $0

Access:

All features unlocked temporarily

After trial → reverts to Locked Mode (cannot use MCP tools)

Goal: onboarding + activation

2. Individual Pro (Default Paid Plan)

Price: $5.99 per month

Billing: Stripe monthly subscription

Access:

Unlimited MCP tool usage

All integrations (GitHub, Jira, Confluence, Zephyr)

Database access (read-only)

Test runners (Pytest, Playwright)

Workflow automation

Code patching + PR creation

3. Teams / Pro for Teams

(Not fully implemented in MVP, but required in subscription model)

Price: $10–$25 per user per month (future)

Access:

Everything in Individual

Shared workflow libraries

Team-wide config

Admin console

4. Enterprise

Price: Custom — starting at ~$5,000+ / year

Access:

SSO/SAML

Private MCP hosting

Audit logs

Dedicated support

Custom workflows

Where Subscription Amounts Must Live in the Product
Pricing must be displayed in:

Paywall Modal

“Upgrade to flocca Pro for $5.99/month.”

Settings → Subscription Tab

Status: Active / Expired

Plan: Pro ($5.99/mo)

Button: Manage Billing (Stripe portal)

Upgrade Banner (post-trial)

“Your trial has ended. Continue unlimited access for $5.99/mo.”

Stripe Checkout

Product ID must match the $5.99/mo plan in Stripe Dashboard.

Landing Pages / Documentation (Future)

Pricing page

Comparison tables

You now have explicit amounts tied to product surfaces.

Feature Group 8.1 — Trial System (With Explicit Pricing Context)
REQ 8.1.1 — 24-Hour Usage Counter

Description:
Track the trial duration and transition users to paywall when trial ends.

Acceptance Criteria (AC):

Trial ends at exactly 24 hours active usage

Post-trial modal displays:

Your flocca trial has expired  
Continue unlimited access for $5.99/month  
[ Upgrade Now ]


System sets user tier → Free (Expired Trial)

All premium features blocked

Upgrade button visible in sidebar

Feature Group 8.2 — Subscription Enforcement & Paywall (WITH PRICES)
REQ 8.2.1 — Paywall Modal

Description:
Display subscription pricing + messaging when user attempts to access premium functionality without an active subscription.

Paywall Modal Content:

🔒 Your flocca trial has ended  
Unlock full access for only $5.99/month.

• Unlimited Jira/GitHub automation  
• Complete workflow builder  
• AI feature generation  
• Test automation (Pytest, Playwright)  
• Database tools  

[ Upgrade Now ]   [ Cancel ]


Acceptance Criteria:

Modal shows correct $5.99/month price

Modal triggers Stripe Checkout

Modal cannot be bypassed for premium actions

Only free-tier features remain active

Feature Group 8.3 — Stripe Billing (WITH PRICES)
REQ 8.3.1 — Stripe Checkout Integration

Description:
Allow users to purchase the Individual Pro plan for $5.99/mo directly inside the extension.

Requirements:

Stripe product: “flocca Pro Monthly – $5.99”

Billing mode: Subscription

Payment method: Credit/Debit/Apple Pay/Google Pay

Checkout URL dynamically created via Stripe SDK

Webhook endpoint to notify extension of subscription changes

Acceptance Criteria:

Successful subscription immediately unlocks Pro tier

Subscription plan name & price displayed in Settings

Canceling subscription (via Stripe portal) → downgrades at end of billing cycle

Feature Group 8.4 — Subscription Tier Engine (NEW)

A centralized module controlling what features are unlocked for each tier.

REQ 8.4.1 — Tier Evaluation System

Input: user subscription status

Output: boolean flags for features

isPro
isFreeTier
hasTrial
hasExpiredTrial
isEnterprise

REQ 8.4.2 — Feature Gating Matrix
Feature	Free Trial	Free (Expired)	Pro ($5.99/mo)	Teams	Enterprise
MCP Tool Execution	✓	✗	✓	✓	✓
Jira/GitHub Integration	✓	✗	✓	✓	✓
Code Patching	✓	✗	✓	✓	✓
Workflow Builder	✓	✗	✓	✓	✓
Database Queries	✓	✗	✓	✓	✓
Test Runner Integration	✓	✗	✓	✓	✓
Team Features	✗	✗	✗	✓	✓
SSO / Audit Logs	✗	✗	✗	✗	✓
Feature Group 8.5 — Subscription State Sync (Expanded)
REQ 8.5.1 — Real-Time Subscription Sync

Must validate:

Active → Pro

Past due → Grace period messaging

Canceled → Downgrade

Trial Ended → Lock

Sync triggered:

At startup

When user opens subscription tab

After any MCP tool is executed

FULL EPIC 8 SUMMARY (Final + With Pricing + Tiers)
FREE TRIAL (24h)

Unlimited access

Auto-expire

Prompt upgrade ($5.99/mo)

INDIVIDUAL PRO ($5.99/mo)

Unlocks all features for solo developers.

TEAMS (Future Tier)

$10–$25/user/mo – collaboration + workflows.

ENTERPRISE (Future Tier)

Custom pricing starting $5k/yr.

Billing & Enforcement

Stripe Checkout
Stripe Billing Portal
Real-time subscription sync
Paywall modal
Feature gating engine

UPGRADE FLOW — “Upgrade Now” Button Behavior (FULL FLOW)

This applies to:

The Paywall Modal

The Post-Trial Banner

The Subscription tab in Settings

When a user clicks “Upgrade Now”, the sequence below must occur.

💳 STEP 1 — User Clicks “Upgrade Now”

Trigger points:

Trial expired modal

Banner: “Continue unlimited access for $5.99/mo”

Sidebar: Subscription tab

User tries to run a paid feature without subscription

UI reaction:

Redirecting you to secure checkout…


Dev Requirement:
Open Stripe Checkout in a VS Code WebView (preferred).
Fallback to default browser if WebView fails.

🌐 STEP 2 — Stripe Checkout Opens

Stripe Checkout is pre-configured with:

Product: flocca Pro – $5.99/month

Billing cycle: monthly

Mode: subscription

Customer email: (optional) captured from Stripe

Metadata: VS Code user identifier (hashed)

Checkout page contains:

Price ($5.99/month)

Features unlocked

Payment form

🔔 STEP 3 — Stripe Processes Payment

When the user completes payment:

Stripe emits:

checkout.session.completed

customer.subscription.created

Your backend receives the webhook.

🧩 STEP 4 — Backend Creates/Updates User Subscription

Each user must have a unique, anonymous, persistent user ID generated by the flocca extension.

Identification Rules:

On first install, generate a flocca_user_id (UUID v4)

Store in VS Code global storage

Pass this ID to Stripe as metadata

Backend stores:

{
  flocca_user_id: "uuid",
  subscription_status: "active",
  current_period_end: <timestamp>,
  stripe_customer_id: "...",
}

This is how you identify paid users.
🔄 STEP 5 — Extension Polls Subscription Status

Once checkout completes:

The extension opens a “Completing your upgrade…” screen.

It performs:

A /subscription/status?user_id=xxx request

Polls every 3 seconds until status = active

Retry up to 30 seconds.

🎉 STEP 6 — flocca Unlocks Pro Features

When backend returns:

{ plan: "pro", status: "active" }


The extension:

Immediately unlocks:

All MCP tools

Feature generation

Workflow builder

Test runners

Database access

Jira/GitHub automation

UI changes:

Paywall modal disappears

Status bar displays: flocca Pro ✓

Settings → Subscription: “Active – $5.99/mo”

Chat panel greets user:

You're now on flocca Pro! All features unlocked.

🔁 STEP 7 — Subscription Persistence

Subscription status is stored locally in globalState

Validated daily or on each restricted action

If backend reports expired/canceled → user downgraded immediately

Downgrade UI:
Your flocca Pro subscription has ended.
Upgrade to regain full access.
[ Upgrade Now ]

📌 SUMMARY — FULL UPGRADE FLOW
Step	Description	User sees
1	Click “Upgrade Now”	Loading message
2	Stripe Checkout opens	Payment form
3	Payment completed	Redirect message
4	flocca identifies user via UUID	(hidden)
5	Poll subscription status	“Completing upgrade…”
6	Activate Pro tier	“flocca Pro ✓ Activated”
7	Persist + refresh	Features unlocked
🧩 HOW WE IDENTIFY A PAID USER

Critical for enforcement.

Step 1 — Generate flocca_user_id on install
uuid = crypto.randomUUID()

Step 2 — Store in VS Code global storage

Never exposed to UI.

Step 3 — Send ID to Stripe checkout as metadata
metadata: { flocca_user_id: uuid }

Step 4 — Backend ties Stripe subscription → user_id

When webhook fires, store:

user_id → subscription_status

Step 5 — Extension queries backend
GET /subscription/status?user_id=uuid


If status = active, the user is Pro.

This is the same architecture used by GitHub Copilot, Cursor, Raycast, and Warp.

🟦 EPIC 9 — Telemetry & Logging (Rewritten & Expanded)
🎯 Epic Goal

Collect anonymized usage data and error logs to improve product quality, understand user behavior, and support trial → paid conversion decisions.

Feature Group 9.1 — Core Usage Metrics
REQ 9.1.1 — Anonymous Core Usage Logging

Description:
Implement anonymized tracking of key usage events inside flocca.

Events to Log:

MCP tool invocation

tool name

server type (GitHub/Jira/local)

Workflow executions

count

workflow ID / name

Test runner executions (pytest/playwright)

Database queries executed

Feature generation attempts

Activation events

Trial started / trial ended

Non-negotiable Privacy Rules:

No source code

No file contents

No Jira ticket contents

No identifiable user info

AC:

Logs transmitted with anonymized user_id

No PII captured

Developers can opt-out in settings

Feature Group 9.2 — Error Reporting
REQ 9.2.1 — Anonymous Error Reporter

Description:
Capture extension exceptions, MCP server failures, test runner errors, and UI crashes in anonymized form.

Errors to Capture:

Failed MCP calls

Failed test executions

OAuth failures

Database access errors

VS Code panel rendering failures

Reporting Requirements:

Stack trace (sanitized)

Error type

Timestamp

Anonymized user_id

Settings Toggle:

Enable anonymous error reporting [ ON/OFF ]


AC:

Error reports contain no sensitive information

Toggle effectively disables all telemetry

Reports only sent on network availability

🟩 EPIC 9 SUMMARY (Final Developer Version)
REQ 9.1.1 — Usage metrics

Log MCP tool usage

Log workflow executions

Track test runs

Log trial start/end

Fully anonymous

Opt-out toggle

REQ 9.1.2 — Error reporting

Capture extension + MCP errors

Strip sensitive data

Send anonymized report

Opt-out toggle in settings



❌ Currently Mocked / Missing
### 1. Teams & Sharing Logic
- [x] Create `Team`, `TeamMember`, `InviteCode` Schema
- [x] Implement `/teams` routes (Create, Join, Invite)
- [x] Update Vault to support Shared Connections
- [x] Update `status` endpoint to aggregate shared items
Billing works: Users can buy the "Teams" plan.
Database Missing: There is NO Team table or Member relation in schema.prisma.
Result: "Shared Vault" and "Collaborative Workflows" are impossible right now. The backend treats everyone as an isolated user.

### 2. User Authentication
- [x] Update Schema (Email/Password)
- [x] Implement `/auth/register` (Account Claiming)
- [x] Implement `/auth/login`
- [x] Verify Claiming Flow (Anonymous -> Registered)
- [x] Verify AWS Proxy with live credentials <!-- id: 3326 -->
- [x] Integrate with VS Code Extension (Auth, Teams, AWS) <!-- id: 3327 -->
    - [x] Auth Commands (Login/Register)
    - [x] Teams Commands (Create/Join/Invite)
    - [x] AWS Proxy Support in Server
- [ ] Manual Verification (User Action Required)
- [x] Add `githubId`/`gitlabId` to Schema
- [X] Verify Schema (via script)

### 3. Telemetry
- [x] Install `posthog-node`
- [x] Update `TelemetryService` with PostHog Client
- [x] Configure with API Key

### 4. AWS Proxy
- [x] Install `aws4`
- [x] Implement SigV4 Signing in `proxy.js`


- Reduce the content of github and bitbucket in the server resgistry so that when they connected, the button is still well aligned and not cut off wrongly with the check mark at the top and the connected text at the bottom. 
- Write documentation for the server registry.
- Write documentation for every agents and how to use them. Including how to set them up and where to get the credentials from their providers.
- Put an information icon next to each agent in the server registry to show the documentation.
- Make sure the documentation is easy to read and understand.
- Make sure the documentation is easy to navigate.
- Make sure the documentation is easy to update.
- Make sure the documentation is easy to maintain.
- Make sure the documentation is translated to all the languages with the largest number of vscode downloads. including:
- English (default)
- Chinese (Simplified & Traditional)
- Japanese
- Korean
- French
- German
- Spanish
- Portuguese
- Russian
- Italian
- Polish
- Turkish

Now implement this on the website.