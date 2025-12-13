## Requirements

FLOCCA — PRODUCT REQUIREMENTS DOCUMENT (PRD v1.0)

Project Name: flocca
Platform: VS Code Extension + MCP Client
Distribution: VS Code Marketplace
Business Model: Free 1-day trial → $5.99/mo subscription

1. 🎯 Product Purpose

flocca provides a unified AI-powered development workflow that integrates Jira, GitHub, Zephyr, Pytest, Playwright, Confluence, and Databases directly into the IDE through the Model Context Protocol (MCP).
It enables developers to:

Build features based on Jira + Confluence requirements

Run tests (pytest, Playwright)

Query databases

Open PRs

Sync results back to Jira/Zephyr

Automate workflows visually

2. 💸 Pricing & Subscription Requirements
Free Tier (Trial)

24 hours of full-feature usage

After time expires: read-only mode + upgrade modal

Paid Tier

$5.99/month subscription via Stripe

Activated inside VS Code

Billing Requirements

In-IDE modal for billing

Subscription status check on startup

Billing portal access

Feature gating when unsubscribed

3. 🧩 Core Integrations (MVP)
Cloud MCP Servers

Jira (Atlassian MCP server)

Confluence (Atlassian MCP server)

GitHub (Official MCP server)

Zephyr Scale (community or custom MCP server)

Local MCP Servers

Pytest MCP server

Playwright MCP server

Database SQL MCP server (Postgres)

Local Codebase MCP server (read + patch)

4. 🧱 MCP Client Requirements (VS Code Extension)
flocca must:

Read mcp.json

Connect to multiple remote & local MCP servers

Auto-discover tools

Surface tools to Cursor/Copilot

Provide tool-selection UI

Provide chat interface

Provide test explorer integration

Log events for debugging

Supported Protocols

SSE (remote)

stdio (local MCP servers)

5. 📚 Individual Provider Requirements
5.1 Jira Provider

OAuth 2.1 + PKCE authentication

List projects

Fetch issues

Fetch acceptance criteria

Create issues

Update issues

Sync PR links

Tools:

jira.getIssue
jira.search
jira.createIssue
jira.updateIssue

5.2 Confluence Provider

OAuth with Jira

Search pages

Retrieve page content

Extract structured text

Tools:

confluence.getPage
confluence.search

5.3 GitHub Provider

OAuth login

Search repositories

Create branches

Commit files

Open pull requests

Tools:

github.createBranch
github.commitPatch
github.openPR
github.searchRepos

5.4 Pytest MCP Server (Local)

Run tests on directory or file

Parse JSON output

Send structured diagnostics

Tools:

pytest.runAll
pytest.runFile
pytest.getReport

5.5 Playwright MCP Server (Local)

List tests

Run tests

Return HTML/JSON reports

Provide file paths

Tools:

playwright.runAll
playwright.runTest
playwright.getReport

5.6 Database MCP Server (Local)

Read-only by default

Support schema introspection

Sample rows

Validate queries

Tools:

db.getSchema
db.sampleRows
db.query

5.7 Codebase Provider

Read file

Write patches

Search codebase

List files

Tools:

code.readFile
code.applyPatch
code.search
code.listFiles

6. 🧠 AI Workflow Requirements

These were missing in Toolchain.

6.1 Feature-from-Jira Workflow

AI must be able to:

Read Jira story

Read Confluence docs

Inspect codebase

Inspect DB schema

Generate code

Generate pytest tests

Generate Playwright tests

Run tests

Open PR

Update Jira

6.2 Multi-step Automatic Workflows

Examples:

Run pytest → Create Jira bug → Post summary to Confluence

Run Playwright → Upload results to Zephyr

Generate test fixtures from database

7. 🧪 VS Code Test Explorer Integration

pytest results → show in Test Explorer

Playwright results → show in Test Explorer

Diagnostics → Problems panel

Clickable to jump to failure line

8. 🔐 Security Requirements

Local storage of OAuth tokens via OS keychain

Warnings before destructive SQL queries

HTTPS mandatory for remote MCP

9. 📝 Workflow Builder Requirements

(Missing in your Toolchain spec but essential to MVP)

Drag-and-drop workflow blocks

MCP tool chaining

Save workflows as JSON in .vscode/

Run workflows from chat or button

Display execution log

10. 📦 Developer Experience Requirements

flocca sidebar

flocca chat panel

flocca status bar indicators

Error logs

Diagnostics display

Connection health indicator

11. 🚀 Release Requirements

Publish to VS Code Marketplace

Auto-update via VS Code

macOS + Linux support at launch

Windows support later