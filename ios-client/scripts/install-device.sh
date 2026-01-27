#!/bin/bash
# Install and run on a physical iOS device
# Requires: ios-deploy (brew install ios-deploy)
# Usage: ./scripts/install-device.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
DERIVED_DATA="$IOS_CLIENT_DIR/build/DerivedData"
SCHEME="CursorMobile"
CONFIGURATION="Debug"

APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION-iphoneos/$SCHEME.app"

echo "================================================"
echo "Installing Cursor Mobile on iOS Device"
echo "================================================"

# Check if ios-deploy is installed
if ! command -v ios-deploy &> /dev/null; then
    echo "ios-deploy is not installed."
    echo "Install it with: brew install ios-deploy"
    echo ""
    echo "Alternatively, you can use Xcode's command line:"
    echo "  xcodebuild -project CursorMobile/CursorMobile.xcodeproj \\"
    echo "    -scheme CursorMobile -destination 'generic/platform=iOS' \\"
    echo "    -allowProvisioningUpdates build"
    exit 1
fi

# Check if app exists, build if not
if [ ! -d "$APP_PATH" ]; then
    echo "App not found. Building for device first..."
    
    xcodebuild \
        -project "$IOS_CLIENT_DIR/CursorMobile/CursorMobile.xcodeproj" \
        -scheme "$SCHEME" \
        -configuration "$CONFIGURATION" \
        -destination "generic/platform=iOS" \
        -derivedDataPath "$DERIVED_DATA" \
        -allowProvisioningUpdates \
        build
fi

echo "Installing and launching on connected device..."
ios-deploy --bundle "$APP_PATH" --debug

echo ""
echo "================================================"
echo "App installed and running on device"
echo "================================================"
