#!/bin/bash
# Run script for Cursor Mobile iOS App on Simulator
# Usage: ./scripts/run.sh [simulator-name]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
DERIVED_DATA="$IOS_CLIENT_DIR/build/DerivedData"
SCHEME="CursorMobile"
BUNDLE_ID="com.cursor.mobile"

SIMULATOR_NAME="${1:-iPhone 16}"
CONFIGURATION="Debug"

APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION-iphonesimulator/$SCHEME.app"

echo "================================================"
echo "Running Cursor Mobile on iOS Simulator"
echo "Simulator: $SIMULATOR_NAME"
echo "================================================"

# Check if app exists, build if not
if [ ! -d "$APP_PATH" ]; then
    echo "App not found. Building first..."
    "$SCRIPT_DIR/build.sh" debug simulator "$SIMULATOR_NAME"
fi

# Boot simulator if needed
echo "Booting simulator..."
xcrun simctl boot "$SIMULATOR_NAME" 2>/dev/null || true

# Open Simulator app
open -a Simulator

# Wait for simulator to be ready
echo "Waiting for simulator to be ready..."
sleep 2

# Install app
echo "Installing app..."
xcrun simctl install "$SIMULATOR_NAME" "$APP_PATH"

# Launch app
echo "Launching app..."
xcrun simctl launch "$SIMULATOR_NAME" "$BUNDLE_ID"

echo ""
echo "================================================"
echo "App is now running on $SIMULATOR_NAME"
echo "================================================"
