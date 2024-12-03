# 🤖 Auto Slack Chrome Extension

> Export your Slack conversations with ease! 📥

This Chrome extension helps you save and organize your Slack messages. Perfect for keeping track of
important discussions, creating documentation, or archiving conversations.

## ✨ Features

- 🔄 Real-time message extraction
- 📱 Works with channels and DMs
- 👥 Preserves sender info and custom statuses
- 📅 Organizes messages by date
- 🔗 Keeps message permalinks
- 💾 Auto-saves progress
- 🏃‍♂️ Handles follow-up messages smartly

## 🚀 Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Build the extension:

```bash
pnpm build
```

3. Load in Chrome:
   - Open Chrome and go to `chrome://extensions`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `dist` directory

## 💻 Development

Watch mode for live updates:

```bash
pnpm watch
```

Other useful commands:

```bash
pnpm lint        # Check code style
pnpm lint:fix    # Fix code style
pnpm type-check  # Check types
pnpm format      # Format code
```

## 🎯 How to Use

1. Install the extension
2. Navigate to Slack in Chrome
3. Click the extension icon
4. Hit "Start Extraction" to begin
5. Use "Download Messages" to save your data

The extension will organize messages by:

- Organization
- Channel/DM
- Date

## 🏗️ Project Structure

```
src/
├── services/          # Core functionality
│   └── extraction/    # Message extraction services
├── background.ts      # Background script
├── content.ts         # Content script
├── popup.ts          # Extension UI
└── manifest.json     # Extension config
```

## 🛠️ Tech Stack

- TypeScript
- Chrome Extensions API
- Webpack
- ESLint + Prettier
- Husky + lint-staged

## 📝 Notes

- Messages are stored locally in Chrome
- Only works with Slack's web app
- Respects Slack's rate limits
- Handles connection drops gracefully
