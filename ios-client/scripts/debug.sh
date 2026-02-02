#!/bin/bash
# iOS Simulator Debugging Utilities
# Provides commands for Cursor to interact with the iOS Simulator
#
# Usage: ./scripts/debug.sh <command> [options]
#
# Commands:
#   status          - Show simulator status and running apps
#   screenshot      - Capture a screenshot
#   logs            - Stream or capture device logs
#   crash-logs      - Get crash logs for the app
#   accessibility   - Dump accessibility hierarchy (UI structure)
#   record          - Start/stop screen recording
#   app-info        - Get info about the installed app
#   launch          - Launch the app
#   terminate       - Terminate the app
#   reinstall       - Reinstall the app (preserves data by default)
#   clean-reinstall - Clean reinstall (removes app data)
#   openurl         - Open a URL/deep link in the app
#   push            - Send a push notification
#   location        - Set device location
#   memory          - Get memory warnings / simulate memory pressure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
DERIVED_DATA="$IOS_CLIENT_DIR/build/DerivedData"
DEBUG_OUTPUT_DIR="$IOS_CLIENT_DIR/debug-output"
SCHEME="CursorMobile"
BUNDLE_ID="com.cursor.mobile"
CONFIGURATION="Debug"
APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION-iphonesimulator/$SCHEME.app"

# Ensure debug output directory exists
mkdir -p "$DEBUG_OUTPUT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Get the booted simulator UDID
get_booted_udid() {
    xcrun simctl list devices booted -j | python3 -c "
import sys, json
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for device in devices:
        if device.get('state') == 'Booted':
            print(device['udid'])
            sys.exit(0)
" 2>/dev/null
}

# Check if simulator is booted
check_simulator() {
    local udid=$(get_booted_udid)
    if [ -z "$udid" ]; then
        print_error "No simulator is currently booted"
        echo "Start a simulator with: make run (from ios-client directory)"
        exit 1
    fi
    echo "$udid"
}

# Command: status
cmd_status() {
    print_header "iOS Simulator Status"
    
    echo -e "\n${YELLOW}Booted Simulators:${NC}"
    xcrun simctl list devices booted
    
    local udid=$(get_booted_udid)
    if [ -n "$udid" ]; then
        echo -e "\n${YELLOW}Active Simulator UDID:${NC} $udid"
        
        echo -e "\n${YELLOW}Running Applications:${NC}"
        xcrun simctl spawn booted launchctl list | grep -E "UIKitApplication|application" || echo "No apps currently running"
        
        echo -e "\n${YELLOW}App Installation Status:${NC}"
        if xcrun simctl get_app_container booted "$BUNDLE_ID" &>/dev/null; then
            print_success "$BUNDLE_ID is installed"
            local container=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || echo "N/A")
            echo "Data container: $container"
        else
            print_warning "$BUNDLE_ID is NOT installed"
        fi
        
        echo -e "\n${YELLOW}Device Info:${NC}"
        xcrun simctl list devices booted -j | python3 -c "
import sys, json
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for device in devices:
        if device.get('state') == 'Booted':
            print(f\"Name: {device['name']}\")
            print(f\"Runtime: {runtime.split('.')[-1]}\")
            print(f\"UDID: {device['udid']}\")
"
    fi
}

# Command: screenshot
cmd_screenshot() {
    local udid=$(check_simulator)
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local filename="${1:-screenshot_$timestamp.png}"
    local filepath="$DEBUG_OUTPUT_DIR/$filename"
    
    print_header "Capturing Screenshot"
    
    xcrun simctl io booted screenshot "$filepath"
    
    print_success "Screenshot saved to: $filepath"
    echo ""
    echo "File path for Cursor to read: $filepath"
    
    # Also output file size and dimensions
    if command -v sips &>/dev/null; then
        local dimensions=$(sips -g pixelWidth -g pixelHeight "$filepath" 2>/dev/null | grep pixel | awk '{print $2}' | tr '\n' 'x' | sed 's/x$//')
        echo "Dimensions: $dimensions"
    fi
    local size=$(ls -lh "$filepath" | awk '{print $5}')
    echo "File size: $size"
}

# Command: logs
cmd_logs() {
    local mode="${1:-stream}"
    local duration="${2:-30}"
    
    print_header "Device Logs"
    
    case "$mode" in
        stream)
            echo "Streaming logs for $duration seconds... (Ctrl+C to stop early)"
            echo "Filtering for: $BUNDLE_ID"
            echo ""
            timeout "$duration" xcrun simctl spawn booted log stream \
                --level debug \
                --predicate "subsystem CONTAINS '$BUNDLE_ID' OR process CONTAINS 'CursorMobile'" \
                2>/dev/null || true
            ;;
        capture)
            local timestamp=$(date +%Y%m%d_%H%M%S)
            local filepath="$DEBUG_OUTPUT_DIR/logs_$timestamp.txt"
            
            echo "Capturing logs for $duration seconds..."
            timeout "$duration" xcrun simctl spawn booted log stream \
                --level debug \
                --predicate "subsystem CONTAINS '$BUNDLE_ID' OR process CONTAINS 'CursorMobile'" \
                > "$filepath" 2>/dev/null || true
            
            print_success "Logs saved to: $filepath"
            
            # Show last 50 lines
            echo -e "\n${YELLOW}Last 50 lines:${NC}"
            tail -50 "$filepath"
            ;;
        recent)
            echo "Showing recent log entries..."
            xcrun simctl spawn booted log show \
                --last 5m \
                --predicate "subsystem CONTAINS '$BUNDLE_ID' OR process CONTAINS 'CursorMobile'" \
                2>/dev/null | tail -100
            ;;
        all)
            echo "Streaming ALL device logs for $duration seconds..."
            timeout "$duration" xcrun simctl spawn booted log stream --level debug 2>/dev/null || true
            ;;
        *)
            echo "Usage: debug.sh logs [stream|capture|recent|all] [duration_seconds]"
            exit 1
            ;;
    esac
}

# Command: crash-logs
cmd_crash_logs() {
    print_header "Crash Logs"
    
    local udid=$(get_booted_udid)
    local crash_dir="$HOME/Library/Logs/DiagnosticReports"
    local sim_crash_dir="$HOME/Library/Logs/DiagnosticReports/Retired"
    
    echo "Searching for CursorMobile crash logs..."
    echo ""
    
    # Find recent crash logs
    local found=0
    for dir in "$crash_dir" "$sim_crash_dir"; do
        if [ -d "$dir" ]; then
            local crashes=$(find "$dir" -name "*CursorMobile*" -mtime -1 2>/dev/null | sort -r | head -5)
            if [ -n "$crashes" ]; then
                echo -e "${YELLOW}Recent crashes in $dir:${NC}"
                echo "$crashes"
                found=1
                
                # Show the most recent crash
                local latest=$(echo "$crashes" | head -1)
                if [ -n "$latest" ]; then
                    echo -e "\n${YELLOW}Latest crash report:${NC}"
                    head -100 "$latest"
                fi
            fi
        fi
    done
    
    if [ $found -eq 0 ]; then
        print_success "No recent crash logs found for CursorMobile"
    fi
}

# Command: accessibility (UI hierarchy)
cmd_accessibility() {
    local udid=$(check_simulator)
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local filepath="$DEBUG_OUTPUT_DIR/accessibility_$timestamp.txt"
    
    print_header "UI Accessibility Hierarchy"
    
    echo "Dumping accessibility tree..."
    echo "This shows all UI elements and their accessibility identifiers."
    echo ""
    
    # Use xcrun simctl to get UI hierarchy via accessibility
    # Note: This requires the app to be running
    xcrun simctl spawn booted log stream \
        --level debug \
        --predicate 'subsystem == "com.apple.UIKit" AND category == "Accessibility"' \
        --timeout 2 2>/dev/null | head -50 || true
    
    echo ""
    print_warning "For detailed UI hierarchy, use Xcode's Accessibility Inspector"
    echo "Or add accessibility identifiers to views for better debugging"
}

# Command: record
cmd_record() {
    local action="${1:-start}"
    local recording_file="$DEBUG_OUTPUT_DIR/recording.mp4"
    local pid_file="$DEBUG_OUTPUT_DIR/.recording_pid"
    
    case "$action" in
        start)
            print_header "Starting Screen Recording"
            
            if [ -f "$pid_file" ]; then
                print_warning "A recording may already be in progress"
                echo "Use 'debug.sh record stop' to stop it"
                exit 1
            fi
            
            local timestamp=$(date +%Y%m%d_%H%M%S)
            recording_file="$DEBUG_OUTPUT_DIR/recording_$timestamp.mp4"
            
            xcrun simctl io booted recordVideo "$recording_file" &
            echo $! > "$pid_file"
            echo "$recording_file" > "$DEBUG_OUTPUT_DIR/.recording_file"
            
            print_success "Recording started"
            echo "Output file: $recording_file"
            echo "Use 'debug.sh record stop' to stop recording"
            ;;
        stop)
            print_header "Stopping Screen Recording"
            
            if [ -f "$pid_file" ]; then
                local pid=$(cat "$pid_file")
                kill -INT "$pid" 2>/dev/null || true
                rm -f "$pid_file"
                
                if [ -f "$DEBUG_OUTPUT_DIR/.recording_file" ]; then
                    local file=$(cat "$DEBUG_OUTPUT_DIR/.recording_file")
                    rm -f "$DEBUG_OUTPUT_DIR/.recording_file"
                    
                    sleep 1  # Wait for file to be finalized
                    
                    if [ -f "$file" ]; then
                        print_success "Recording saved to: $file"
                        local size=$(ls -lh "$file" | awk '{print $5}')
                        echo "File size: $size"
                    fi
                fi
            else
                print_warning "No recording in progress"
            fi
            ;;
        *)
            echo "Usage: debug.sh record [start|stop]"
            exit 1
            ;;
    esac
}

# Command: app-info
cmd_app_info() {
    local udid=$(check_simulator)
    
    print_header "App Information"
    
    if ! xcrun simctl get_app_container booted "$BUNDLE_ID" &>/dev/null; then
        print_error "App is not installed"
        exit 1
    fi
    
    echo -e "${YELLOW}Bundle ID:${NC} $BUNDLE_ID"
    
    local app_container=$(xcrun simctl get_app_container booted "$BUNDLE_ID" app 2>/dev/null || echo "N/A")
    local data_container=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || echo "N/A")
    
    echo -e "${YELLOW}App Container:${NC} $app_container"
    echo -e "${YELLOW}Data Container:${NC} $data_container"
    
    if [ -d "$data_container" ]; then
        echo -e "\n${YELLOW}Data Container Contents:${NC}"
        ls -la "$data_container/" 2>/dev/null || true
        
        echo -e "\n${YELLOW}Documents Folder:${NC}"
        ls -la "$data_container/Documents/" 2>/dev/null || echo "Empty or not accessible"
        
        echo -e "\n${YELLOW}UserDefaults:${NC}"
        local prefs_file="$data_container/Library/Preferences/$BUNDLE_ID.plist"
        if [ -f "$prefs_file" ]; then
            plutil -p "$prefs_file" 2>/dev/null | head -50 || echo "Could not read preferences"
        else
            echo "No preferences file found"
        fi
    fi
}

# Command: launch
cmd_launch() {
    local udid=$(check_simulator)
    
    print_header "Launching App"
    
    if ! xcrun simctl get_app_container booted "$BUNDLE_ID" &>/dev/null; then
        print_error "App is not installed. Run 'make run' first."
        exit 1
    fi
    
    xcrun simctl launch booted "$BUNDLE_ID"
    print_success "App launched"
}

# Command: terminate
cmd_terminate() {
    local udid=$(check_simulator)
    
    print_header "Terminating App"
    
    xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
    print_success "App terminated"
}

# Command: reinstall
cmd_reinstall() {
    local udid=$(check_simulator)
    
    print_header "Reinstalling App (preserving data)"
    
    if [ ! -d "$APP_PATH" ]; then
        print_error "App not found at $APP_PATH"
        echo "Build first with: make build"
        exit 1
    fi
    
    # Terminate if running
    xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
    
    # Reinstall
    xcrun simctl install booted "$APP_PATH"
    print_success "App reinstalled"
    
    # Relaunch
    xcrun simctl launch booted "$BUNDLE_ID"
    print_success "App relaunched"
}

# Command: clean-reinstall
cmd_clean_reinstall() {
    local udid=$(check_simulator)
    
    print_header "Clean Reinstall (removing all data)"
    
    if [ ! -d "$APP_PATH" ]; then
        print_error "App not found at $APP_PATH"
        echo "Build first with: make build"
        exit 1
    fi
    
    # Terminate and uninstall
    xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl uninstall booted "$BUNDLE_ID" 2>/dev/null || true
    print_success "App uninstalled"
    
    # Reinstall
    xcrun simctl install booted "$APP_PATH"
    print_success "App reinstalled (clean)"
    
    # Launch
    xcrun simctl launch booted "$BUNDLE_ID"
    print_success "App launched"
}

# Command: openurl
cmd_openurl() {
    local url="$1"
    
    if [ -z "$url" ]; then
        echo "Usage: debug.sh openurl <url>"
        echo "Example: debug.sh openurl 'cursormobile://project/123'"
        exit 1
    fi
    
    local udid=$(check_simulator)
    
    print_header "Opening URL"
    
    xcrun simctl openurl booted "$url"
    print_success "Opened URL: $url"
}

# Command: push
cmd_push() {
    local payload_file="$1"
    
    print_header "Sending Push Notification"
    
    local udid=$(check_simulator)
    
    if [ -z "$payload_file" ]; then
        # Create a sample push notification
        local sample_file="$DEBUG_OUTPUT_DIR/sample_push.json"
        cat > "$sample_file" << 'EOF'
{
    "aps": {
        "alert": {
            "title": "Debug Notification",
            "body": "This is a test notification from Cursor debugging"
        },
        "sound": "default",
        "badge": 1
    }
}
EOF
        payload_file="$sample_file"
        echo "Using sample notification payload"
    fi
    
    xcrun simctl push booted "$BUNDLE_ID" "$payload_file"
    print_success "Push notification sent"
}

# Command: location
cmd_location() {
    local lat="$1"
    local lon="$2"
    
    if [ -z "$lat" ] || [ -z "$lon" ]; then
        echo "Usage: debug.sh location <latitude> <longitude>"
        echo "Example: debug.sh location 37.7749 -122.4194  # San Francisco"
        echo ""
        echo "Preset locations:"
        echo "  debug.sh location sf       # San Francisco"
        echo "  debug.sh location nyc      # New York City"
        echo "  debug.sh location london   # London"
        exit 1
    fi
    
    # Handle presets
    case "$lat" in
        sf|sanfrancisco)
            lat="37.7749"
            lon="-122.4194"
            ;;
        nyc|newyork)
            lat="40.7128"
            lon="-74.0060"
            ;;
        london)
            lat="51.5074"
            lon="-0.1278"
            ;;
    esac
    
    local udid=$(check_simulator)
    
    print_header "Setting Device Location"
    
    xcrun simctl location booted set "$lat,$lon"
    print_success "Location set to: $lat, $lon"
}

# Command: memory (simulate memory pressure)
cmd_memory() {
    local level="${1:-warn}"
    
    print_header "Memory Pressure Simulation"
    
    local udid=$(check_simulator)
    
    case "$level" in
        warn|warning)
            echo "Sending memory warning..."
            xcrun simctl spawn booted notifyutil -p com.apple.system.lowmemory
            print_success "Memory warning sent"
            ;;
        critical)
            echo "Simulating critical memory pressure..."
            xcrun simctl spawn booted memory_pressure -l critical 2>/dev/null || \
                print_warning "memory_pressure command not available"
            ;;
        *)
            echo "Usage: debug.sh memory [warn|critical]"
            exit 1
            ;;
    esac
}

# Command: help
cmd_help() {
    echo "iOS Simulator Debugging Utilities"
    echo ""
    echo "Usage: ./scripts/debug.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  status              Show simulator status and running apps"
    echo "  screenshot [name]   Capture a screenshot"
    echo "  logs [mode] [sec]   Stream/capture device logs"
    echo "                      Modes: stream, capture, recent, all"
    echo "  crash-logs          Get crash logs for the app"
    echo "  accessibility       Dump accessibility hierarchy"
    echo "  record [start|stop] Screen recording"
    echo "  app-info            Get info about the installed app"
    echo "  launch              Launch the app"
    echo "  terminate           Terminate the app"
    echo "  reinstall           Reinstall app (preserves data)"
    echo "  clean-reinstall     Clean reinstall (removes data)"
    echo "  openurl <url>       Open a URL/deep link"
    echo "  push [payload.json] Send a push notification"
    echo "  location <lat> <lon> Set device location"
    echo "  memory [warn|critical] Simulate memory pressure"
    echo "  help                Show this help"
    echo ""
    echo "Output Directory: $DEBUG_OUTPUT_DIR"
    echo ""
    echo "Examples:"
    echo "  ./scripts/debug.sh status"
    echo "  ./scripts/debug.sh screenshot"
    echo "  ./scripts/debug.sh logs stream 60"
    echo "  ./scripts/debug.sh logs capture 30"
    echo "  ./scripts/debug.sh record start"
    echo "  ./scripts/debug.sh record stop"
    echo "  ./scripts/debug.sh openurl 'cursormobile://project/123'"
}

# Main command dispatcher
case "${1:-help}" in
    status)
        cmd_status
        ;;
    screenshot)
        cmd_screenshot "$2"
        ;;
    logs)
        cmd_logs "$2" "$3"
        ;;
    crash-logs|crashlogs|crash)
        cmd_crash_logs
        ;;
    accessibility|a11y|ui)
        cmd_accessibility
        ;;
    record)
        cmd_record "$2"
        ;;
    app-info|appinfo|info)
        cmd_app_info
        ;;
    launch)
        cmd_launch
        ;;
    terminate|kill)
        cmd_terminate
        ;;
    reinstall)
        cmd_reinstall
        ;;
    clean-reinstall|cleanreinstall|clean)
        cmd_clean_reinstall
        ;;
    openurl|url)
        cmd_openurl "$2"
        ;;
    push)
        cmd_push "$2"
        ;;
    location|loc)
        cmd_location "$2" "$3"
        ;;
    memory|mem)
        cmd_memory "$2"
        ;;
    help|-h|--help)
        cmd_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Run './scripts/debug.sh help' for usage"
        exit 1
        ;;
esac
