# Napp Trapp iOS App - Makefile
# Build and run the iOS app from the command line

PROJECT_DIR = CursorMobile
PROJECT = $(PROJECT_DIR)/CursorMobile.xcodeproj
SCHEME = CursorMobile
CONFIGURATION = Debug
DERIVED_DATA = build/DerivedData

# Default simulator (can override with: make run SIMULATOR="iPhone 16")
SIMULATOR ?= iPhone 16
SIMULATOR_OS ?= 18.5

# Build destinations
SIMULATOR_DEST = platform=iOS Simulator,name=$(SIMULATOR),OS=$(SIMULATOR_OS)
DEVICE_DEST = generic/platform=iOS

.PHONY: all build build-release run clean install list-simulators list-devices help debug status screenshot logs crash-logs reinstall

# Default target
all: build

# Build for simulator (debug)
build:
	@echo "Building $(SCHEME) for iOS Simulator..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIGURATION) \
		-destination '$(SIMULATOR_DEST)' \
		-derivedDataPath $(DERIVED_DATA) \
		build

# Build for simulator (release)
build-release:
	@echo "Building $(SCHEME) for iOS Simulator (Release)..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration Release \
		-destination '$(SIMULATOR_DEST)' \
		-derivedDataPath $(DERIVED_DATA) \
		build

# Build for device (requires signing)
build-device:
	@echo "Building $(SCHEME) for iOS Device..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIGURATION) \
		-destination '$(DEVICE_DEST)' \
		-derivedDataPath $(DERIVED_DATA) \
		-allowProvisioningUpdates \
		build

# Build and run on simulator
run: build
	@echo "Launching $(SIMULATOR) simulator..."
	xcrun simctl boot "$(SIMULATOR)" 2>/dev/null || true
	open -a Simulator
	@echo "Installing app on simulator..."
	xcrun simctl install "$(SIMULATOR)" "$(DERIVED_DATA)/Build/Products/$(CONFIGURATION)-iphonesimulator/$(SCHEME).app"
	@echo "Launching app..."
	xcrun simctl launch "$(SIMULATOR)" com.cursor.mobile

# Run on already-booted simulator (faster)
run-fast:
	@echo "Installing and launching on booted simulator..."
	xcrun simctl install booted "$(DERIVED_DATA)/Build/Products/$(CONFIGURATION)-iphonesimulator/$(SCHEME).app"
	xcrun simctl launch booted com.cursor.mobile

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration $(CONFIGURATION) \
		clean
	rm -rf $(DERIVED_DATA)
	rm -rf build

# List available simulators
list-simulators:
	@echo "Available iOS Simulators:"
	@xcrun simctl list devices available | grep -E "iPhone|iPad"

# List connected devices
list-devices:
	@echo "Connected iOS Devices:"
	@xcrun xctrace list devices 2>/dev/null | grep -v "Simulator" | head -20

# Show build settings
show-settings:
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-showBuildSettings

# Run tests
test:
	@echo "Running tests..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-destination '$(SIMULATOR_DEST)' \
		-derivedDataPath $(DERIVED_DATA) \
		test

# Archive for distribution
archive:
	@echo "Creating archive..."
	xcodebuild \
		-project $(PROJECT) \
		-scheme $(SCHEME) \
		-configuration Release \
		-destination '$(DEVICE_DEST)' \
		-archivePath build/$(SCHEME).xcarchive \
		-allowProvisioningUpdates \
		archive

# ==========================================
# Debugging Commands
# ==========================================

# Show simulator status
status:
	@./scripts/debug.sh status

# Take a screenshot
screenshot:
	@./scripts/debug.sh screenshot

# Stream logs (30 seconds)
logs:
	@./scripts/debug.sh logs stream 30

# Capture logs to file (60 seconds)
logs-capture:
	@./scripts/debug.sh logs capture 60

# Check crash logs
crash-logs:
	@./scripts/debug.sh crash-logs

# Get app info
app-info:
	@./scripts/debug.sh app-info

# Reinstall app (preserves data)
reinstall: build
	@./scripts/debug.sh reinstall

# Clean reinstall (removes data)
clean-reinstall: build
	@./scripts/debug.sh clean-reinstall

# Build, reinstall, and screenshot (full debug cycle)
debug: build reinstall screenshot

# ==========================================
# Help
# ==========================================

# Help
help:
	@echo "Napp Trapp iOS App - Build Commands"
	@echo ""
	@echo "Usage: make [target] [SIMULATOR='iPhone Name'] [SIMULATOR_OS='18.5']"
	@echo ""
	@echo "Build Targets:"
	@echo "  build            Build for simulator (debug)"
	@echo "  build-release    Build for simulator (release)"
	@echo "  build-device     Build for physical device"
	@echo "  run              Build and run on simulator"
	@echo "  run-fast         Run on already-booted simulator"
	@echo "  clean            Clean build artifacts"
	@echo "  test             Run unit tests"
	@echo "  archive          Create release archive"
	@echo ""
	@echo "Debug Targets:"
	@echo "  status           Show simulator and app status"
	@echo "  screenshot       Capture simulator screenshot"
	@echo "  logs             Stream app logs (30 seconds)"
	@echo "  logs-capture     Capture logs to file (60 seconds)"
	@echo "  crash-logs       Show crash logs for the app"
	@echo "  app-info         Show app container and data info"
	@echo "  reinstall        Build and reinstall app"
	@echo "  clean-reinstall  Build and clean reinstall (clears data)"
	@echo "  debug            Full debug cycle: build, reinstall, screenshot"
	@echo ""
	@echo "Info Targets:"
	@echo "  list-simulators  Show available simulators"
	@echo "  list-devices     Show connected devices"
	@echo "  show-settings    Show Xcode build settings"
	@echo "  help             Show this help"
	@echo ""
	@echo "Examples:"
	@echo "  make build"
	@echo "  make run SIMULATOR='iPhone 16' SIMULATOR_OS='18.5'"
	@echo "  make debug         # Build, install, and screenshot"
	@echo "  make logs          # Stream app logs"
	@echo "  make clean && make build"
