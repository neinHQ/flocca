# Slack Agent

## Overview
Send and receive messages from Slack channels directly in your editor.

## Features
- **Send Messages**: Post to channels.
- **Read History**: key channels.

## Setup
1. **Create an App**:
   - Go to [Slack API](https://api.slack.com/apps).
   - Create a new App.
   - Add `chat:write`, `channels:read` scopes.
   - Install to Workspace.
2. **Get Token**:
   - Copy the **Bot User OAuth Token** (`xoxb-...`).
3. **Connect**:
   - Click **Connect** in Flocca.
   - Paste the token.

## Usage
- Chat: *"Send a message to #general saying Hello"*
