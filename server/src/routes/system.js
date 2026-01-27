import { Router } from 'express';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Get system info
router.get('/info', async (req, res) => {
  try {
    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      uptime: os.uptime(),
      homeDir: os.homedir(),
      username: os.userInfo().username
    });
  } catch (error) {
    console.error('Error fetching system info:', error);
    res.status(500).json({ error: 'Failed to fetch system info' });
  }
});

// Get network interfaces for connection info
router.get('/network', async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const [name, nets] of Object.entries(interfaces)) {
      for (const net of nets) {
        // Skip internal and non-IPv4 addresses
        if (!net.internal && net.family === 'IPv4') {
          addresses.push({
            name,
            address: net.address,
            netmask: net.netmask
          });
        }
      }
    }
    
    res.json({ addresses });
  } catch (error) {
    console.error('Error fetching network info:', error);
    res.status(500).json({ error: 'Failed to fetch network info' });
  }
});

// Check if Cursor is running
router.get('/cursor-status', async (req, res) => {
  try {
    let isRunning = false;
    let version = null;
    
    switch (os.platform()) {
      case 'darwin':
        try {
          const { stdout } = await execAsync('pgrep -x "Cursor" || pgrep -x "cursor"');
          isRunning = stdout.trim().length > 0;
        } catch (e) {
          isRunning = false;
        }
        break;
        
      case 'win32':
        try {
          const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Cursor.exe" /NH');
          isRunning = stdout.includes('Cursor.exe');
        } catch (e) {
          isRunning = false;
        }
        break;
        
      case 'linux':
        try {
          const { stdout } = await execAsync('pgrep -x cursor || pgrep -f "cursor --"');
          isRunning = stdout.trim().length > 0;
        } catch (e) {
          isRunning = false;
        }
        break;
    }
    
    res.json({
      isRunning,
      version,
      platform: os.platform()
    });
  } catch (error) {
    console.error('Error checking Cursor status:', error);
    res.status(500).json({ error: 'Failed to check Cursor status' });
  }
});

// Open Cursor with a specific path
router.post('/open-cursor', async (req, res) => {
  try {
    const { path: projectPath } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    let command;
    
    switch (os.platform()) {
      case 'darwin':
        command = `open -a Cursor "${projectPath}"`;
        break;
      case 'win32':
        command = `start "" "Cursor" "${projectPath}"`;
        break;
      case 'linux':
        command = `cursor "${projectPath}" &`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported platform' });
    }
    
    await execAsync(command);
    
    res.json({
      success: true,
      message: `Opening ${projectPath} in Cursor`
    });
  } catch (error) {
    console.error('Error opening Cursor:', error);
    res.status(500).json({ error: 'Failed to open Cursor' });
  }
});

// Build and run iOS app via Xcode
router.post('/ios-build-run', async (req, res) => {
  try {
    const { 
      configuration = 'Debug',
      deviceName = 'iPhone 16',
      deviceId = null,
      isPhysicalDevice = false,
      clean = false 
    } = req.body;
    
    // Only works on macOS
    if (os.platform() !== 'darwin') {
      return res.status(400).json({ 
        success: false, 
        error: 'iOS build only available on macOS' 
      });
    }
    
    const iosClientDir = process.env.IOS_CLIENT_DIR || 
      `${os.homedir()}/Code/Mobile-cursor/ios-client`;
    const projectDir = `${iosClientDir}/CursorMobile`;
    const project = `${projectDir}/CursorMobile.xcodeproj`;
    const scheme = 'CursorMobile';
    // Bundle ID from Xcode project - can be overridden via environment variable
    const bundleId = process.env.IOS_BUNDLE_ID || 'com.lovelesslabstx';
    const derivedData = `${iosClientDir}/build/DerivedData`;
    
    console.log(`[iOS Build] Starting build and run`);
    console.log(`[iOS Build] Configuration: ${configuration}`);
    console.log(`[iOS Build] Device: ${deviceName} (physical: ${isPhysicalDevice})`);
    console.log(`[iOS Build] Device ID: ${deviceId || 'auto'}`);
    console.log(`[iOS Build] Project: ${project}`);
    
    // Step 1: Stop any running instance of the app
    console.log('[iOS Build] Step 1: Stopping any running instances...');
    if (isPhysicalDevice && deviceId) {
      // For physical devices, we can't easily terminate - the new install will replace it
      console.log('[iOS Build] Physical device - skipping terminate (install will replace)');
    } else {
      try {
        await execAsync(`xcrun simctl terminate "${deviceName}" "${bundleId}" 2>/dev/null || true`);
      } catch (e) {
        // Ignore errors - app might not be running
      }
    }
    
    // Step 2: Build the app
    console.log('[iOS Build] Step 2: Building app...');
    let destination;
    if (isPhysicalDevice) {
      if (deviceId) {
        destination = `platform=iOS,id=${deviceId}`;
      } else {
        destination = `generic/platform=iOS`;
      }
    } else {
      destination = `platform=iOS Simulator,name=${deviceName}`;
    }
    
    const cleanFlag = clean ? 'clean build' : 'build';
    
    const buildCommand = `xcodebuild \
      -project "${project}" \
      -scheme "${scheme}" \
      -configuration "${configuration}" \
      -destination "${destination}" \
      -derivedDataPath "${derivedData}" \
      -allowProvisioningUpdates \
      ${cleanFlag} 2>&1`;
    
    let buildOutput;
    try {
      const { stdout, stderr } = await execAsync(buildCommand, {
        timeout: 300000, // 5 minute timeout for build
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for build output
      });
      buildOutput = stdout + stderr;
    } catch (buildError) {
      console.error('[iOS Build] Build failed:', buildError.message);
      
      // Extract useful error info from xcodebuild output
      const errorOutput = buildError.stdout || buildError.stderr || buildError.message;
      const errorLines = errorOutput.split('\n')
        .filter(line => line.includes('error:') || line.includes('Error:'))
        .slice(0, 10)
        .join('\n');
      
      return res.status(500).json({
        success: false,
        step: 'build',
        error: 'Build failed',
        details: errorLines || buildError.message
      });
    }
    
    // Check if build succeeded
    if (!buildOutput.includes('BUILD SUCCEEDED')) {
      console.error('[iOS Build] Build did not succeed');
      return res.status(500).json({
        success: false,
        step: 'build',
        error: 'Build did not complete successfully',
        details: buildOutput.split('\n').slice(-20).join('\n')
      });
    }
    
    console.log('[iOS Build] Build succeeded!');
    
    if (isPhysicalDevice) {
      // Physical device flow
      console.log('[iOS Build] Step 3: Installing on physical device...');
      
      const appPath = `${derivedData}/Build/Products/${configuration}-iphoneos/${scheme}.app`;
      
      // Try using devicectl (Xcode 15+) first, fall back to ios-deploy
      let installSuccess = false;
      
      if (deviceId) {
        // Try devicectl first (Xcode 15+)
        try {
          console.log('[iOS Build] Trying devicectl for install...');
          await execAsync(`xcrun devicectl device install app --device ${deviceId} "${appPath}"`, {
            timeout: 120000
          });
          installSuccess = true;
          console.log('[iOS Build] devicectl install succeeded');
        } catch (devicectlError) {
          console.log('[iOS Build] devicectl failed, trying ios-deploy...');
          
          // Try ios-deploy as fallback
          try {
            await execAsync(`ios-deploy --id ${deviceId} --bundle "${appPath}" --noninteractive`, {
              timeout: 120000
            });
            installSuccess = true;
            console.log('[iOS Build] ios-deploy install succeeded');
          } catch (iosDeployError) {
            console.log('[iOS Build] ios-deploy also failed');
          }
        }
      }
      
      if (!installSuccess) {
        // Last resort: try xcodebuild with install action
        try {
          console.log('[iOS Build] Trying xcodebuild install...');
          const installCommand = `xcodebuild \
            -project "${project}" \
            -scheme "${scheme}" \
            -configuration "${configuration}" \
            -destination "${destination}" \
            -derivedDataPath "${derivedData}" \
            -allowProvisioningUpdates \
            build install 2>&1`;
          
          await execAsync(installCommand, {
            timeout: 180000,
            maxBuffer: 10 * 1024 * 1024
          });
          installSuccess = true;
        } catch (xcodebuildInstallError) {
          console.error('[iOS Build] All install methods failed');
          return res.status(500).json({
            success: false,
            step: 'install',
            error: 'Failed to install app on device',
            details: 'Make sure the device is unlocked, trusted, and has a valid provisioning profile. You may need to install ios-deploy: brew install ios-deploy'
          });
        }
      }
      
      // Step 4: Launch the app on physical device
      console.log('[iOS Build] Step 4: Launching app on device...');
      try {
        if (deviceId) {
          // Try devicectl launch
          await execAsync(`xcrun devicectl device process launch --device ${deviceId} "${bundleId}"`, {
            timeout: 30000
          });
        }
      } catch (launchError) {
        // Launch failure is non-fatal - app might still be launching
        console.log('[iOS Build] Launch command failed, but app may have started:', launchError.message);
      }
      
      console.log('[iOS Build] Successfully built and installed on physical device!');
      
      res.json({
        success: true,
        message: `App built and installed on ${deviceName}`,
        configuration,
        deviceName,
        isPhysicalDevice: true
      });
      
    } else {
      // Simulator flow (existing code)
      console.log('[iOS Build] Step 3: Booting simulator...');
      try {
        await execAsync(`xcrun simctl boot "${deviceName}" 2>/dev/null || true`);
      } catch (e) {
        // Simulator might already be booted
      }
      
      // Open Simulator app
      try {
        await execAsync('open -a Simulator');
      } catch (e) {
        // Ignore
      }
      
      // Give simulator time to fully boot
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 4: Install the app
      console.log('[iOS Build] Step 4: Installing app...');
      const appPath = `${derivedData}/Build/Products/${configuration}-iphonesimulator/${scheme}.app`;
      
      try {
        await execAsync(`xcrun simctl install "${deviceName}" "${appPath}"`, {
          timeout: 60000
        });
      } catch (installError) {
        console.error('[iOS Build] Install failed:', installError.message);
        return res.status(500).json({
          success: false,
          step: 'install',
          error: 'Failed to install app on simulator',
          details: installError.message
        });
      }
      
      // Step 5: Launch the app
      console.log('[iOS Build] Step 5: Launching app...');
      try {
        await execAsync(`xcrun simctl launch "${deviceName}" "${bundleId}"`, {
          timeout: 30000
        });
      } catch (launchError) {
        console.error('[iOS Build] Launch failed:', launchError.message);
        return res.status(500).json({
          success: false,
          step: 'launch',
          error: 'Failed to launch app',
          details: launchError.message
        });
      }
      
      console.log('[iOS Build] Successfully built and launched app!');
      
      res.json({
        success: true,
        message: `App built and running on ${deviceName}`,
        configuration,
        deviceName,
        isPhysicalDevice: false
      });
    }
    
  } catch (error) {
    console.error('[iOS Build] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: 'Unexpected error during iOS build',
      details: error.message
    });
  }
});

// Get iOS devices (both simulators and physical devices)
router.get('/ios-devices', async (req, res) => {
  try {
    // Only works on macOS
    if (os.platform() !== 'darwin') {
      return res.status(400).json({ 
        success: false, 
        error: 'iOS devices only available on macOS' 
      });
    }
    
    const devices = [];
    
    // Get simulators
    try {
      const { stdout } = await execAsync('xcrun simctl list devices available -j', {
        timeout: 30000
      });
      
      const data = JSON.parse(stdout);
      
      // Parse the devices structure
      for (const [runtime, simDevices] of Object.entries(data.devices)) {
        if (runtime.includes('iOS')) {
          const iosVersion = runtime.replace(/.*iOS[- ]/, '').replace(/-/g, '.');
          for (const device of simDevices) {
            devices.push({
              name: device.name,
              udid: device.udid,
              state: device.state,
              iosVersion,
              isBooted: device.state === 'Booted',
              isPhysicalDevice: false,
              deviceType: 'simulator'
            });
          }
        }
      }
    } catch (simError) {
      console.error('[iOS Devices] Error listing simulators:', simError.message);
    }
    
    // Get physical devices using devicectl (Xcode 15+)
    try {
      const { stdout } = await execAsync('xcrun devicectl list devices -j 2>/dev/null', {
        timeout: 30000
      });
      
      const data = JSON.parse(stdout);
      
      if (data.result && data.result.devices) {
        for (const device of data.result.devices) {
          // Only include iOS devices (not macOS, watchOS, etc.)
          if (device.deviceProperties?.osType === 'iOS' || 
              device.hardwareProperties?.platform === 'iOS') {
            devices.push({
              name: device.deviceProperties?.name || device.hardwareProperties?.deviceType || 'Unknown Device',
              udid: device.hardwareProperties?.udid || device.identifier,
              state: device.connectionProperties?.transportType || 'connected',
              iosVersion: device.deviceProperties?.osVersionNumber || 'Unknown',
              isBooted: true, // Physical devices are always "on" when connected
              isPhysicalDevice: true,
              deviceType: 'physical',
              connectionType: device.connectionProperties?.transportType || 'unknown'
            });
          }
        }
      }
    } catch (devicectlError) {
      // devicectl might not be available (pre-Xcode 15), try xctrace
      console.log('[iOS Devices] devicectl not available, trying xctrace...');
      
      try {
        const { stdout } = await execAsync('xcrun xctrace list devices 2>/dev/null', {
          timeout: 30000
        });
        
        // Parse xctrace output - format is "Device Name (iOS Version) (UDID)"
        const lines = stdout.split('\n');
        let inDevicesSection = false;
        
        for (const line of lines) {
          if (line.includes('== Devices ==')) {
            inDevicesSection = true;
            continue;
          }
          if (line.includes('== Simulators ==')) {
            inDevicesSection = false;
            continue;
          }
          
          if (inDevicesSection && line.trim()) {
            // Parse line like: "John's iPhone (17.0) (00008030-001234567890802E)"
            const match = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\(([A-F0-9-]+)\)/i);
            if (match) {
              devices.push({
                name: match[1].trim(),
                udid: match[3],
                state: 'connected',
                iosVersion: match[2],
                isBooted: true,
                isPhysicalDevice: true,
                deviceType: 'physical',
                connectionType: 'unknown'
              });
            }
          }
        }
      } catch (xctraceError) {
        console.log('[iOS Devices] xctrace also failed:', xctraceError.message);
      }
    }
    
    res.json({
      success: true,
      devices
    });
    
  } catch (error) {
    console.error('[iOS Devices] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list devices',
      details: error.message
    });
  }
});

// Legacy endpoint for backward compatibility
router.get('/ios-simulators', async (req, res) => {
  try {
    // Only works on macOS
    if (os.platform() !== 'darwin') {
      return res.status(400).json({ 
        success: false, 
        error: 'iOS simulators only available on macOS' 
      });
    }
    
    const { stdout } = await execAsync('xcrun simctl list devices available -j', {
      timeout: 30000
    });
    
    const data = JSON.parse(stdout);
    const simulators = [];
    
    // Parse the devices structure
    for (const [runtime, devices] of Object.entries(data.devices)) {
      if (runtime.includes('iOS')) {
        const iosVersion = runtime.replace(/.*iOS[- ]/, '').replace(/-/g, '.');
        for (const device of devices) {
          simulators.push({
            name: device.name,
            udid: device.udid,
            state: device.state,
            iosVersion,
            isBooted: device.state === 'Booted'
          });
        }
      }
    }
    
    res.json({
      success: true,
      simulators
    });
    
  } catch (error) {
    console.error('[iOS Simulators] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list simulators',
      details: error.message
    });
  }
});

// Execute a terminal command (with safety checks)
router.post('/exec', async (req, res) => {
  try {
    const { command, cwd } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Safety: block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+[\/~]/,
      /sudo/,
      /mkfs/,
      /dd\s+if=/,
      />\s*\/dev\//,
      /chmod\s+777/
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return res.status(403).json({ error: 'Command blocked for safety' });
      }
    }
    
    const options = {
      cwd: cwd || os.homedir(),
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 // 1MB max output
    };
    
    const { stdout, stderr } = await execAsync(command, options);
    
    res.json({
      success: true,
      stdout,
      stderr
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    });
  }
});

export { router as systemRoutes };
