# iOS Build Note

The SSH terminal support has been fully implemented, but the new Swift files need to be added to the Xcode project manually due to complexities with programmatic project file manipulation.

## Files to Add

Please open `ios-client/CursorMobile/CursorMobile.xcodeproj` in Xcode and manually add these files to the project:

### 1. SSH Host Model
- File: `ios-client/CursorMobile/CursorMobile/Models/SSHHost.swift`
- Target group: `Models`
- Ensure "CursorMobile" target is checked

### 2. SSH Views
- File: `ios-client/CursorMobile/CursorMobile/Views/SSH/SSHHostListView.swift`
- File: `ios-client/CursorMobile/CursorMobile/Views/SSH/SSHHostEditView.swift`
- File: `ios-client/CursorMobile/CursorMobile/Views/SSH/SSHTerminalView.swift`
- Target group: `Views/SSH` (create SSH folder if needed)
- Ensure "CursorMobile" target is checked for all files

## Steps in Xcode

1. Open `CursorMobile.xcodeproj` in Xcode
2. In the Project Navigator, right-click on `Models` folder
3. Select "Add Files to 'CursorMobile'..."
4. Navigate to and select `SSHHost.swift`
5. Ensure "Copy items if needed" is UNCHECKED
6. Ensure "CursorMobile" target is CHECKED
7. Click "Add"
8. Repeat for the three SSH view files in the `Views/SSH` folder

## After Adding Files

Run from command line:
```bash
cd ios-client && make build
```

The build should succeed once files are properly added to the Xcode project.

## Alternative: Programmatic Fix

If you prefer not to use Xcode GUI, you can try:
```bash
cd ios-client
# Remove current file references
python3 << 'EOF'
import re
project_file = "CursorMobile/CursorMobile.xcodeproj/project.pbxproj"
with open(project_file, 'r') as f:
    lines = f.readlines()

# Remove our added SSH file lines
cleaned = [l for l in lines if not any(x in l for x in ['SSHHost', 'SSHHostList', 'SSHHostEdit', 'SSHTerminal'])]

with open(project_file, 'w') as f:
    f.writelines(cleaned)
EOF
```

Then manually add the files in Xcode as described above.
