# Adding New Files to Xcode Project

The following files need to be added to the Xcode project manually:

## Steps to Add Files

1. Open `ios-client/CursorMobile/CursorMobile.xcodeproj` in Xcode
2. In the Project Navigator (left sidebar), right-click on the appropriate folder
3. Select "Add Files to 'CursorMobile'..."
4. Navigate to the file and select it
5. Make sure "Copy items if needed" is **unchecked** (files are already in place)
6. Make sure "Add to targets: CursorMobile" is **checked**
7. Click "Add"

## Files to Add

### Models Folder
Add to: `CursorMobile/Models/`
- `Terminal.swift`

### Views/Terminals Folder (NEW)
First, create the folder in Xcode:
1. Right-click on `Views` folder
2. Select "New Group"
3. Name it "Terminals"

Then add to: `CursorMobile/Views/Terminals/`
- `TerminalListView.swift`
- `TerminalView.swift`
- `SwiftTermWrapper.swift`

### Modified Files (Already in Project)
These files were modified but are already in the Xcode project:
- `Services/APIService.swift` ✓
- `Services/WebSocketManager.swift` ✓
- `Views/Projects/ProjectDetailView.swift` ✓

## Quick Method (Drag & Drop)

Alternatively, you can drag files from Finder directly into Xcode:

1. Open Finder and navigate to:
   - `ios-client/CursorMobile/CursorMobile/Models/`
   - `ios-client/CursorMobile/CursorMobile/Views/Terminals/`

2. Drag the new files into the corresponding folders in Xcode's Project Navigator

3. In the dialog that appears:
   - **Uncheck** "Copy items if needed"
   - **Check** "Add to targets: CursorMobile"
   - Click "Finish"

## Verification

After adding the files, verify they appear in the Project Navigator with the correct folder structure:

```
CursorMobile
├── Models
│   ├── Conversation.swift
│   ├── FileItem.swift
│   ├── Project.swift
│   ├── SystemInfo.swift
│   └── Terminal.swift          ← NEW
├── Services
│   ├── APIService.swift
│   └── WebSocketManager.swift
└── Views
    ├── Auth
    ├── Components
    ├── Conversations
    ├── Files
    ├── Projects
    ├── Settings
    ├── Terminals               ← NEW FOLDER
    │   ├── TerminalListView.swift
    │   ├── TerminalView.swift
    │   └── SwiftTermWrapper.swift
    └── MainTabView.swift
```

## Build and Run

Once all files are added:

1. Add SwiftTerm package dependency (see TERMINAL_IMPLEMENTATION.md)
2. Build the project (⌘B)
3. Fix any build errors if they appear
4. Run on simulator or device (⌘R)

## Troubleshooting

**"No such file" build error:**
- File wasn't added to the build target
- Right-click file → Show File Inspector → check "Target Membership"

**"Duplicate symbol" error:**
- File was added twice
- Remove duplicate from Project Navigator

**Import errors:**
- Files need to be in the same target
- Check Target Membership for all files
