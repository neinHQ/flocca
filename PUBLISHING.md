# Publishing Flocca to VS Code Marketplace

This guide covers the steps to publish the **Flocca** extension for the first time.

## Prerequisites

1.  **Install vsce** (Visual Studio Code Extensions CLI):
    ```bash
    npm install -g @vscode/vsce
    ```

## Step 1: Create a Publisher

1.  Go to the [VS Code Marketplace Management Page](https://marketplace.visualstudio.com/manage).
2.  Log in with your Microsoft account.
3.  Click **"Create Publisher"**.
4.  **Name**: `Flocca` (display name).
5.  **ID**: `flocca` (Critical: This MUST match the `"publisher"` field in our `package.json`).

## Step 2: Generate a Personal Access Token (PAT)

1.  Go to [Azure DevOps](https://dev.azure.com/).
2.  Create a new Organization (if you don't have one). It's free and takes seconds.
3.  Go to your Organization settings (top right user icon -> **Personal Access Tokens**).
4.  Click **"New Token"**:
    *   **Name**: `Flocca Publisher`
    *   **Organization**: "All accessible organizations"
    *   **Scopes**: Scroll down to **Marketplace** and check **"Manage"**.
5.  **Copy the token**. You won't see it again!

## Step 3: Login via CLI

In your terminal (inside the `flocca` directory):

```bash
vsce login flocca
```

*   It will ask for your Personal Access Token. Paste the token you just copied.

## Step 4: Package & Test (Optional but Recommended)

Before publishing, you can create the `.vsix` file to verify everything looks right:

```bash
vsce package
```

This creates a `flocca-0.0.1.vsix` file. You can drag and drop this into VS Code to install and test locally.

## Step 5: Publish 🚀

When you are ready to go live:

```bash
vsce publish
```

*   This bumps the version (if specified) or uses the current version in `package.json`.
*   It uploads the package to the Marketplace.
*   Verification usually takes a few minutes.

## Future Updates

For future releases, simply update the version number and run:

```bash
npm version patch  # or minor/major
vsce publish
```
