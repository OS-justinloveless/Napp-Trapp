# Cursor Mobile Access

Control Cursor IDE on your laptop from your mobile phone. This app provides a local server that runs on your laptop and a mobile-friendly interface accessible from your phone - available as both a web app and a native iOS app.

## Features

- **One-Scan Connection**: Just scan the QR code with your phone camera - opens the app and connects automatically!
- **Native iOS App**: Get the best experience with our SwiftUI-based iOS app
- **Project Management**: Browse, open, and create new Cursor projects
- **File Browser**: Navigate your file system and view/edit files
- **Code Viewer**: Syntax-highlighted code viewing with edit capabilities
- **Real-time Updates**: WebSocket connection for live file change notifications
- **Conversation History**: View your Cursor AI chat workspace sessions
- **💬 Send Messages from Mobile**: Continue Cursor AI conversations from your phone with real-time streaming responses
- **System Info**: Monitor your laptop's status and Cursor IDE state
- **Security**: Token-based authentication to protect your data

## Client Options

| Platform | Type | Location |
|----------|------|----------|
| All Mobile | Web App | `client/` |
| iOS | Native SwiftUI | `ios-client/` |

The web client automatically detects iOS devices and offers to open the native app for the best experience.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Your Phone    │◄───────►│   Your Laptop   │
│  (iOS App or    │  WiFi   │    (Server)     │
│   Web Browser)  │         │                 │
└─────────────────┘         └─────────────────┘
                                   │
                                   ▼
                           ┌─────────────────┐
                           │   Cursor IDE    │
                           └─────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Build the Client

```bash
cd client
npm run build
```

### 3. Start the Server

```bash
cd ../server
npm start
```

You'll see a QR code in your terminal:
```
╔═══════════════════════════════════════════════════════════════════╗
║              Cursor Mobile Access Server                           ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                    ║
║   Scan this QR code with your phone camera to connect:            ║
║                                                                    ║
║       ▄▄▄▄▄▄▄  ▄    ▄ ▄▄▄▄▄▄▄                                     ║
║       █ ▄▄▄ █ ▀█▄█▀▄  █ ▄▄▄ █                                     ║
║       █ ███ █ ▀▀ ▄▀▄▄ █ ███ █                                     ║
║       ▀▀▀▀▀▀▀ █ █▀▄▀█ ▀▀▀▀▀▀▀                                     ║
║        ...                                                         ║
║                                                                    ║
╠═══════════════════════════════════════════════════════════════════╣
║   Just point your phone camera at the QR code above!              ║
║   It will open the app and connect automatically.                 ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 4. Connect from Your Phone

**Scan QR Code (Recommended)**
1. Point your phone's camera at the QR code in the terminal
2. Tap the notification/link that appears
3. The app opens and connects automatically - done!

**Manual Entry (Fallback)**
1. Make sure your phone is on the same WiFi network as your laptop
2. Open your phone's browser
3. Navigate to `http://<your-laptop-ip>:3847`
4. Enter the auth token shown in the server output
5. Start controlling Cursor!

## Finding Your Laptop's IP Address

**macOS:**
```bash
ipconfig getifaddr en0
```

**Linux:**
```bash
hostname -I | awk '{print $1}'
```

**Windows:**
```bash
ipconfig | findstr /i "IPv4"
```

Or check the Settings page in the app after connecting - it shows all network interfaces.

## Configuration

Create a `.env` file in the server directory:

```env
# Port to run the server on (default: 3847)
PORT=3847

# Set a custom auth token (otherwise one is generated)
AUTH_TOKEN=your-custom-token-here
```

## Development

### Run in Development Mode

Start the server with auto-reload:
```bash
cd server
npm run dev
```

Start the client dev server (with hot reload):
```bash
cd client
npm run dev
```

The client dev server runs on port 5173 and proxies API requests to the server on port 3847.

## Project Structure

```
cursor-mobile-access/
├── server/                        # Node.js backend server
│   ├── src/
│   │   ├── index.js              # Main server entry point
│   │   ├── auth/
│   │   │   └── AuthManager.js    # Token authentication
│   │   ├── routes/
│   │   │   ├── index.js          # Route setup
│   │   │   ├── projects.js       # Project management API
│   │   │   ├── files.js          # File operations API
│   │   │   ├── conversations.js  # Chat history API
│   │   │   └── system.js         # System info API
│   │   ├── utils/
│   │   │   └── CursorWorkspace.js # Cursor integration
│   │   └── websocket/
│   │       └── index.js          # Real-time updates
│   └── package.json
│
├── client/                        # React web client
│   ├── src/
│   │   ├── main.jsx              # App entry point
│   │   ├── App.jsx               # Main app component
│   │   ├── context/
│   │   │   ├── AuthContext.jsx   # Authentication state
│   │   │   └── WebSocketContext.jsx # Real-time connection
│   │   ├── components/
│   │   │   ├── Layout.jsx        # App layout
│   │   │   └── iOSAppBanner.jsx  # iOS native app detection
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx     # Authentication
│   │   │   ├── ProjectsPage.jsx  # Project list
│   │   │   ├── ProjectDetailPage.jsx # Project details
│   │   │   ├── FileBrowserPage.jsx # File navigation
│   │   │   ├── FileViewerPage.jsx # Code viewer/editor
│   │   │   ├── ConversationsPage.jsx # Chat history
│   │   │   └── SettingsPage.jsx  # App settings
│   │   └── styles/
│   │       └── global.css        # Global styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── ios-client/                    # Native iOS app (SwiftUI)
│   └── CursorMobile/
│       ├── CursorMobile.xcodeproj
│       └── CursorMobile/
│           ├── CursorMobileApp.swift
│           ├── Models/           # Data models
│           ├── Services/         # API & WebSocket
│           └── Views/            # SwiftUI views
│
└── README.md
```

## API Reference

### Authentication

All API endpoints (except `/health`) require the `Authorization` header:
```
Authorization: Bearer <your-token>
```

### Endpoints

#### Projects
- `GET /api/projects` - List recent Cursor projects
- `GET /api/projects/:id` - Get project details
- `GET /api/projects/:id/tree` - Get project file tree
- `POST /api/projects` - Create new project
- `POST /api/projects/:id/open` - Open project in Cursor

#### Files
- `GET /api/files/read?filePath=...` - Read file content
- `POST /api/files/write` - Write file content
- `GET /api/files/list?dirPath=...` - List directory contents
- `POST /api/files/create` - Create new file
- `DELETE /api/files/delete?filePath=...` - Delete file

#### Conversations
- `GET /api/conversations` - List workspace sessions
- `GET /api/conversations/:id` - Get conversation details
- `GET /api/conversations/:id/messages` - Get messages
- `POST /api/conversations` - Create new conversation
- `POST /api/conversations/:id/messages` - Send message (returns SSE stream)

#### System
- `GET /api/system/info` - Get system information
- `GET /api/system/network` - Get network interfaces
- `GET /api/system/cursor-status` - Check if Cursor is running
- `POST /api/system/open-cursor` - Open path in Cursor
- `POST /api/system/exec` - Execute terminal command

### WebSocket

Connect to `ws://<server>:3847` and authenticate:
```json
{ "type": "auth", "token": "your-token" }
```

Watch for file changes:
```json
{ "type": "watch", "path": "/path/to/project" }
```

Receive change notifications:
```json
{
  "type": "fileChange",
  "event": "change",
  "path": "/path/to/file.js",
  "relativePath": "file.js",
  "timestamp": 1700000000000
}
```

## Security Notes

- The server only listens on your local network
- All API requests require authentication
- Dangerous terminal commands are blocked
- Tokens are stored securely in browser localStorage
- Consider using HTTPS in production environments

## Prerequisites

Before using the mobile chat feature, ensure `cursor-agent` CLI is installed and authenticated:

```bash
# Install cursor-agent (if not already installed)
curl https://cursor.com/install -fsS | bash

# Authenticate with your Cursor account
cursor-agent login
```

The chat feature uses `cursor-agent` to continue conversations with Cursor's AI, so authentication is required.

## Troubleshooting

### Can't connect from phone
1. Ensure both devices are on the same WiFi network
2. Check that no firewall is blocking port 3847
3. Try using the IP address from Settings > Network

### Projects not showing
- Cursor stores project history in different locations depending on your OS
- The app scans common Cursor storage paths automatically
- Recently opened projects in Cursor should appear

### File changes not detected
- Make sure WebSocket is connected (check Settings page)
- Large files or many rapid changes might be throttled

## iOS App

For iPhone and iPad users, we provide a native SwiftUI app that offers the best mobile experience.

### Building the iOS App

**From command line (no Xcode GUI needed):**
```bash
cd ios-client

# Build for simulator
make build

# Build and run on simulator
make run

# See all commands
make help
```

**From Xcode:**
1. Open `ios-client/CursorMobile/CursorMobile.xcodeproj` in Xcode
2. Select your development team
3. Build and run on your device

See `ios-client/README.md` for detailed iOS app documentation.

### iOS App Features

- Native SwiftUI interface optimized for iOS
- Built-in QR code scanner
- Deep linking support (`cursor-mobile://connect?...`)
- Real-time WebSocket updates
- Secure credential storage in Keychain

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - feel free to use this project for personal or commercial purposes.
