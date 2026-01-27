# Cursor Mobile - iOS App

A native SwiftUI iOS client for Cursor Mobile Access. Control your Cursor IDE on your laptop directly from your iPhone or iPad.

## Features

- **Native iOS Experience**: Built entirely with SwiftUI for iOS 17+
- **QR Code Scanning**: Instantly connect by scanning the QR code from your terminal
- **Deep Linking**: Open the app directly from the web client
- **Project Management**: Browse, open, and create Cursor projects
- **File Browser**: Navigate your file system with native iOS gestures
- **Code Viewer/Editor**: View and edit files with syntax highlighting
- **Conversation History**: Browse your Cursor AI chat sessions
- **Real-time Updates**: WebSocket connection for live file change notifications
- **System Monitoring**: View system status and Cursor IDE state

## Requirements

- iOS 17.0 or later
- iPhone or iPad
- Xcode 15.0 or later (for building)
- Your laptop running the Cursor Mobile Access server

## Installation

### Command Line Build (Recommended)

Build and run entirely from the terminal using the included Makefile:

```bash
cd ios-client

# Build for simulator
make build

# Build and run on simulator
make run

# Run on a specific simulator
make run SIMULATOR="iPhone 15 Pro"

# List available simulators
make list-simulators

# Clean and rebuild
make clean && make build

# See all available commands
make help
```

### Using Build Scripts

Alternatively, use the shell scripts in `scripts/`:

```bash
# Build for simulator (debug)
./scripts/build.sh debug simulator

# Build for simulator (release)
./scripts/build.sh release simulator

# Build and run on simulator
./scripts/run.sh "iPhone 16"

# Install on physical device (requires ios-deploy)
./scripts/install-device.sh
```

### Raw xcodebuild Commands

If you prefer direct xcodebuild commands:

```bash
# Build for simulator
xcodebuild \
  -project CursorMobile/CursorMobile.xcodeproj \
  -scheme CursorMobile \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  build

# Build for device
xcodebuild \
  -project CursorMobile/CursorMobile.xcodeproj \
  -scheme CursorMobile \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates \
  build
```

### From Xcode

1. Open `CursorMobile/CursorMobile.xcodeproj` in Xcode
2. Select your development team in Signing & Capabilities
3. Select your iOS device or simulator
4. Build and run (⌘R)

### From App Store

*Coming soon*

## Build System

The project includes multiple ways to build from the command line:

| Method | Command | Description |
|--------|---------|-------------|
| Make | `make build` | Build for simulator |
| Make | `make run` | Build and run on simulator |
| Make | `make build-device` | Build for physical device |
| Script | `./scripts/build.sh` | Flexible build script |
| Script | `./scripts/run.sh` | Build and run script |
| xcodebuild | See above | Direct Xcode CLI |

### Prerequisites for Command Line Build

- **Xcode**: Full Xcode installation (not just Command Line Tools)
- **Xcode Command Line Tools**: `xcode-select --install`
- **For device deployment**: `brew install ios-deploy` (optional)
- **For prettier output**: `brew install xcpretty` (optional)

## Project Structure

```
ios-client/
├── Makefile                      # Command line build system
├── scripts/
│   ├── build.sh                 # Build script
│   ├── run.sh                   # Run on simulator script
│   └── install-device.sh        # Install on device script
│
└── CursorMobile/
├── CursorMobileApp.swift     # App entry point with deep link handling
├── ContentView.swift          # Root view controller
├── Info.plist                # App configuration & permissions
│
├── Models/
│   ├── Project.swift         # Project data model
│   ├── FileItem.swift        # File/directory model
│   ├── Conversation.swift    # Chat conversation model
│   └── SystemInfo.swift      # System information models
│
├── Services/
│   ├── AuthManager.swift     # Authentication state management
│   ├── APIService.swift      # REST API client
│   └── WebSocketManager.swift # WebSocket connection manager
│
├── Views/
│   ├── MainTabView.swift     # Main tab navigation
│   │
│   ├── Auth/
│   │   ├── LoginView.swift   # Login screen with QR scanner
│   │   └── QRScannerView.swift # QR code scanner
│   │
│   ├── Projects/
│   │   ├── ProjectsView.swift    # Project list
│   │   └── ProjectDetailView.swift # Project file tree
│   │
│   ├── Files/
│   │   ├── FileBrowserView.swift # File system browser
│   │   └── FileViewerSheet.swift # File viewer/editor
│   │
│   ├── Conversations/
│   │   └── ConversationsView.swift # Chat history
│   │
│   ├── Settings/
│   │   └── SettingsView.swift    # App settings & system info
│   │
│   └── Components/
│       └── CommonViews.swift     # Reusable UI components
│
└── Assets.xcassets/
    ├── AppIcon.appiconset/   # App icons
    └── AccentColor.colorset/ # Theme colors
```

## How to Connect

### Option 1: QR Code (Recommended)

1. Start the server on your laptop: `cd server && npm start`
2. Open the iOS app
3. Tap "Scan QR Code"
4. Point your camera at the QR code in your terminal
5. Connected!

### Option 2: Manual Entry

1. Start the server on your laptop
2. Note the IP address and auth token from the terminal
3. Open the iOS app
4. Enter the server URL (e.g., `http://192.168.1.100:3847`)
5. Enter the auth token
6. Tap "Connect"

### Option 3: Deep Link from Web

1. Open the web client on your iOS device
2. You'll see a banner offering to open the native app
3. Tap "Open App" to launch the iOS app with credentials

## Deep Linking

The app supports two URL schemes:

### Custom URL Scheme

```
cursor-mobile://connect?server=192.168.1.100:3847&token=YOUR_TOKEN
```

### Web URL (Universal Links)

When configured with your domain, the app can handle:
```
https://your-server:3847/?token=YOUR_TOKEN
```

## Permissions

The app requests the following permissions:

- **Camera**: Required for QR code scanning
- **Local Network**: Required to connect to the server on your local network

## API Compatibility

The iOS app is fully compatible with the Cursor Mobile Access server API:

- `GET /api/projects` - List projects
- `GET /api/projects/:id/tree` - Get project file tree
- `POST /api/projects/:id/open` - Open project in Cursor
- `GET /api/files/list` - List directory contents
- `GET /api/files/read` - Read file content
- `POST /api/files/write` - Write file content
- `GET /api/conversations` - List chat sessions
- `GET /api/system/info` - System information
- `WebSocket` - Real-time file changes

## Customization

### Accent Color

Edit `Assets.xcassets/AccentColor.colorset/Contents.json` to change the app's theme color.

### Bundle Identifier

Change `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project settings to your own bundle ID.

## Development

### Adding New Features

1. Create model in `Models/` if needed
2. Add API method in `Services/APIService.swift`
3. Create view in appropriate `Views/` subfolder
4. Add navigation in `MainTabView.swift` or relevant parent view

### Testing

The app includes SwiftUI previews for most views. Use Xcode's Canvas (⌥⌘Enter) to preview views during development.

## Troubleshooting

### Can't connect to server

1. Ensure both devices are on the same WiFi network
2. Check that the server is running
3. Verify the IP address is correct
4. Check your firewall settings

### QR Scanner not working

1. Make sure camera permission is granted
2. Ensure adequate lighting
3. Hold the phone steady

### WebSocket disconnects

The app automatically attempts to reconnect every 3 seconds. Check your network stability if disconnections persist.

## License

MIT License - feel free to use and modify for your needs.
