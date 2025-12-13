# GitHub Agent

## Overview
 The GitHub agent allows you to interact with your repositories directly from VS Code. You can search repositories, manage issues, read files, and trigger workflows.

## Features
- **Search Repositories**: Find repositories by name or topic.
- **Read Files**: View file contents without cloning.
- **Git Operations**: Stage files, commit changes, and push to remote directly from your workspace.
- **Pull Requests**: Create and merge PRs.
- **Issues**: Create, list, and comment on issues.

## Setup
1. **Get a Token**:
   - Go to [GitHub Developer Settings](https://github.com/settings/tokens).
   - Generate a **Personal Access Token (Classic)**.
   - Select scopes: `repo`, `user`, `read:org`.
2. **Connect**:
   - Click the **Connect** button in Flocca.
   - Enter your token when prompted.
   - *Note: If you are signed in to VS Code with GitHub, we may try to auto-connect.*

## Usage
- **Chat**: 
  - *"Clone the current repo and fix the bug in main.js"*
  - *"Commit these changes with message 'Fix typo' and push"*
  - *"Create a PR to merge develop into main with title 'Release v1.0'"*
- **Commands**: `Flocca: Search Repositories`
