# File Operations Feature

## Overview
Added comprehensive file management capabilities to the iOS app, including delete, rename, and move operations.

## Changes Made

### Server-Side (`server/src/routes/files.js`)

#### New Endpoints

1. **POST /api/files/rename**
   - Renames a file or directory in place
   - Request body: `{ oldPath: string, newName: string }`
   - Response: `{ success: boolean, oldPath: string, newPath: string }`
   - Validates that newName doesn't contain path separators
   - Checks for conflicts before renaming

2. **POST /api/files/move**
   - Moves a file or directory to a new location
   - Request body: `{ sourcePath: string, destinationPath: string }`
   - Response: `{ success: boolean, sourcePath: string, destinationPath: string }`
   - Validates source and destination paths
   - Checks for conflicts before moving

3. **DELETE /api/files/delete** (already existed, no changes)
   - Deletes a file
   - Query param: `filePath`
   - Response: `{ success: boolean, deleted: string }`

### iOS Client Changes

#### Models (`Models/FileItem.swift`)

Added new response types:
- `RenameFileRequest` / `RenameFileResponse`
- `MoveFileRequest` / `MoveFileResponse`

#### API Service (`Services/APIService.swift`)

Added new methods:
- `renameFile(oldPath:newName:)` - Rename a file or directory
- `moveFile(sourcePath:destinationPath:)` - Move a file or directory

#### UI (`Views/Files/FileBrowserView.swift`)

**New Features:**

1. **Context Menu on Files and Directories**
   - Long-press on any file or directory to show actions
   - Actions available:
     - **Rename**: Change the name of the file/directory
     - **Move**: Move the file/directory to another directory
     - **Delete**: Delete the file/directory

2. **Rename Sheet**
   - Modal sheet that allows editing the name
   - Pre-filled with current name
   - Validates that new name is not empty
   - Shows confirmation button with loading state

3. **Move Sheet**
   - Modal sheet that lists all available directories
   - Select destination directory
   - Prevents moving into itself
   - Shows confirmation button with loading state

4. **Delete Confirmation**
   - Alert dialog before deletion
   - Shows item name
   - Warning that action cannot be undone
   - Destructive button styling

## User Experience

### How to Delete a File
1. Navigate to the file in the file browser
2. Long-press on the file
3. Tap "Delete" from the context menu
4. Confirm in the alert dialog

### How to Rename a File
1. Navigate to the file in the file browser
2. Long-press on the file
3. Tap "Rename" from the context menu
4. Edit the name in the text field
5. Tap "Rename" to confirm

### How to Move a File
1. Navigate to the file in the file browser
2. Long-press on the file
3. Tap "Move" from the context menu
4. Select a destination directory from the list
5. Tap "Move" to confirm

## Error Handling

All operations include proper error handling:
- Network errors are displayed to the user
- Conflict errors (file already exists) are shown
- File not found errors are handled
- Permission errors are displayed

## Testing Checklist

- [ ] Delete a file
- [ ] Delete a directory (Note: server only supports file deletion via unlink)
- [ ] Rename a file
- [ ] Rename a directory
- [ ] Move a file to another directory
- [ ] Move a directory to another location
- [ ] Try to rename with invalid characters (/)
- [ ] Try to move to a location where name conflicts
- [ ] Try to delete a non-existent file
- [ ] Verify error messages display correctly
- [ ] Test cancel actions on all sheets/alerts
- [ ] Test loading states during operations

## Known Limitations

1. **Directory Deletion**: The server's delete endpoint uses `fs.unlink()` which only works for files. To support directory deletion, the server would need to use `fs.rm()` with `{ recursive: true }` option.

2. **Move UI**: Currently shows only directories in the current folder. Could be enhanced to:
   - Navigate through the directory tree
   - Show a breadcrumb path
   - Allow moving to parent directories

3. **Batch Operations**: Currently only supports single file operations. Could be enhanced to support:
   - Multi-select
   - Batch delete
   - Batch move

## Future Enhancements

1. Add support for directory deletion in the server
2. Add "Duplicate" operation
3. Add "New Folder" operation
4. Add file/directory properties sheet
5. Add undo/redo support
6. Add move to trash instead of permanent delete
7. Add breadcrumb navigation in move sheet
8. Add search/filter in move sheet for large directory trees
9. Add swipe actions as alternative to context menu
10. Add keyboard shortcuts for iPad

## Notes for Server Restart

Remember that you need to restart the server for the new endpoints to be available:
```bash
cd server
npm start
```
