#!/bin/bash
# Build script for Cursor Mobile iOS App
# Usage: ./scripts/build.sh [debug|release] [simulator|device]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")/CursorMobile"
PROJECT="$PROJECT_DIR/CursorMobile.xcodeproj"
SCHEME="CursorMobile"
DERIVED_DATA="$(dirname "$SCRIPT_DIR")/build/DerivedData"

# Parse arguments
CONFIGURATION="${1:-Debug}"
TARGET="${2:-simulator}"
SIMULATOR_NAME="${3:-iPhone 16}"

# Normalize configuration
case "$CONFIGURATION" in
    debug|Debug)
        CONFIGURATION="Debug"
        ;;
    release|Release)
        CONFIGURATION="Release"
        ;;
    *)
        echo "Unknown configuration: $CONFIGURATION"
        echo "Usage: $0 [debug|release] [simulator|device] [simulator-name]"
        exit 1
        ;;
esac

echo "================================================"
echo "Building Cursor Mobile iOS App"
echo "Configuration: $CONFIGURATION"
echo "Target: $TARGET"
echo "================================================"

if [ "$TARGET" == "simulator" ]; then
    DESTINATION="platform=iOS Simulator,name=$SIMULATOR_NAME"
    echo "Simulator: $SIMULATOR_NAME"
else
    DESTINATION="generic/platform=iOS"
    echo "Building for physical device"
fi

echo ""
echo "Starting build..."
echo ""

xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA" \
    build \
    | xcpretty 2>/dev/null || xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA" \
    build

echo ""
echo "================================================"
echo "Build completed successfully!"
echo "================================================"

if [ "$TARGET" == "simulator" ]; then
    APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION-iphonesimulator/$SCHEME.app"
    echo "App location: $APP_PATH"
fi
