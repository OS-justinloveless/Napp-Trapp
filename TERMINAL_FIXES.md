# Terminal Issues Fixed

## Issues Identified

### 1. Terminal Creation Failure - `posix_spawnp failed`

**Problem:** The iOS app was sending terminal creation requests, but they were failing with `posix_spawnp failed` error.

**Root Cause:** The default shell logic was using `bash` instead of the full path `/bin/bash`. On Unix systems, `node-pty` requires the full absolute path to the shell executable.

**Fix Applied:**
- Updated `TerminalManager.createTerminal()` to use full shell paths
- Added intelligent shell detection that checks for shell existence:
  1. First tries `process.env.SHELL` (e.g., `/bin/zsh`)
  2. Falls back to common shells: `/bin/zsh`, `/bin/bash`, `/usr/bin/bash`
  3. Validates shell exists before spawning
- Added logging to show which shell and cwd are being used

**Code Change:**
```javascript
const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }
  
  const shellEnv = process.env.SHELL;
  if (shellEnv && fs.existsSync(shellEnv)) {
    return shellEnv;  // e.g., /bin/zsh
  }
  
  // Fallback to common shells
  const commonShells = ['/bin/zsh', '/bin/bash', '/usr/bin/bash'];
  for (const shell of commonShells) {
    if (fs.existsSync(shell)) {
      return shell;
    }
  }
  
  return '/bin/bash';
};
```

### 2. Existing Terminals Not Showing

**Problem:** The iOS app shows "No Terminals" even though there are 3 open terminals in Cursor for the same project.

**Root Cause:** The `TerminalManager` only tracks terminals that IT creates in memory. It doesn't discover or list existing Cursor terminal sessions that are running in the Cursor IDE.

**Why This Happens:**
- Cursor's terminals run in separate processes managed by the Cursor IDE
- The mobile server's `TerminalManager` is a separate instance that only knows about terminals it spawned
- There's no shared state between Cursor's terminal system and the mobile server's terminal system

**Current Behavior:**
- ✅ Mobile server can create NEW terminals
- ✅ Mobile server can manage terminals IT created
- ❌ Mobile server CANNOT see Cursor IDE's terminals
- ❌ Mobile server CANNOT interact with Cursor IDE's terminals

**Solution Options:**

#### Option A: Independent Terminal System (Current Implementation)
- Keep them separate - mobile app has its own terminals
- Pros: Simple, no coupling with Cursor internals
- Cons: Can't see/control IDE terminals

#### Option B: Discover Cursor Terminals (Future Enhancement)
- Parse Cursor's terminal files from `~/.cursor/projects/{hash}/terminals/`
- Read terminal metadata and output
- Pros: Can view IDE terminal output
- Cons: Read-only, can't send input (no PTY access)

#### Option C: Connect to Cursor's PTY Sessions (Complex)
- Find Cursor's PTY master file descriptors
- Connect to existing PTY sessions
- Pros: Full read/write access
- Cons: Very complex, requires low-level PTY manipulation

**Recommendation:** 
For now, keep Option A (independent system). The mobile terminals are fully functional and serve the use case of running commands from the mobile device. If you need to view IDE terminal output, we can implement Option B as a read-only feature.

## Testing

The terminal creation fix can be tested by:

1. Restart the server (already running at port 3847)
2. In the iOS app, navigate to a project
3. Tap the "Terminals" tab
4. Tap "+" to create a new terminal
5. Terminal should be created successfully with proper shell

The terminal should now work and you'll be able to:
- See the newly created terminal in the list
- Type commands
- See output in real-time
- Use special keys (Ctrl+C, arrows, etc.)

## Files Modified

- `server/src/utils/TerminalManager.js` - Fixed shell path resolution

## Next Steps

If you want to see Cursor IDE terminals in the mobile app:
1. We can add a "Cursor Terminals" section that shows read-only terminal output
2. Parse the terminal files from `~/.cursor/projects/{projectHash}/terminals/`
3. Display them separately from "Mobile Terminals"

This would give you visibility into both:
- **Cursor Terminals** (read-only, from IDE)
- **Mobile Terminals** (full control, created from app)
