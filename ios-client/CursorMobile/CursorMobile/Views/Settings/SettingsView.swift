import SwiftUI

// MARK: - App Icon Model

enum AppIconOption: String, CaseIterable, Identifiable {
    case forest = "AppIconForest"
    case desert = "AppIconDesert"
    case mono = "AppIconMono"
    case night = "AppIconNight"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .forest: return "Forest"
        case .desert: return "Desert"
        case .mono: return "Mono"
        case .night: return "Night"
        }
    }
    
    var iconName: String? {
        switch self {
        case .forest: return "AppIconForest"
        case .desert: return "AppIconDesert"
        case .mono: return "AppIconMono"
        case .night: return "AppIconNight"
        }
    }
    
    var previewImageName: String {
        switch self {
        case .forest: return "IconPreviewForest"
        case .desert: return "IconPreviewDesert"
        case .mono: return "IconPreviewMono"
        case .night: return "IconPreviewNight"
        }
    }
    
    /// Maps to the corresponding app theme
    var theme: AppTheme {
        switch self {
        case .forest: return .forest
        case .desert: return .desert
        case .mono: return .mono
        case .night: return .night
        }
    }
    
    /// Creates icon option from theme
    static func from(theme: AppTheme) -> AppIconOption {
        switch theme {
        case .forest: return .forest
        case .desert: return .desert
        case .mono: return .mono
        case .night: return .night
        case .light: return .night // Light uses night icon as closest match
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @EnvironmentObject var themeManager: ThemeManager
    @StateObject private var chatSettings = ChatSettingsManager.shared
    
    @State private var systemInfo: SystemInfo?
    @State private var networkInfo: [NetworkInterface] = []
    @State private var cursorStatus: CursorStatus?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showLogoutConfirmation = false
    
    // App Icon states (now derived from theme)
    private var currentAppIcon: AppIconOption {
        AppIconOption.from(theme: themeManager.currentTheme)
    }
    @State private var showIconChangeAlert = false
    
    // iOS Build states
    @State private var isBuilding = false
    @State private var buildError: String?
    @State private var buildSuccess: String?
    @State private var showDevicePicker = false
    @State private var availableDevices: [iOSDevice] = []
    @State private var selectedDevice: iOSDevice?
    @State private var cleanBuild = false
    @State private var loadingDevices = false
    @State private var deviceUnavailable = false  // Track if saved device was not found
    
    // UserDefaults key for persisting selected device
    private static let savedDeviceKey = "napp-trapp-selected-device"
    
    // Server restart states
    @State private var isRestarting = false
    @State private var restartError: String?
    @State private var showRestartConfirmation = false
    
    var body: some View {
        List {
            // Connection Status Section
            Section {
                HStack {
                    Label("Server", systemImage: "server.rack")
                    Spacer()
                    Text(authManager.serverUrl ?? "Unknown")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                HStack {
                    Label("WebSocket", systemImage: webSocketManager.isConnected ? "wifi" : "wifi.slash")
                    Spacer()
                    HStack(spacing: 4) {
                        Circle()
                            .fill(webSocketManager.isConnected ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(webSocketManager.isConnected ? "Connected" : "Disconnected")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } header: {
                Text("Connection")
            }
            
            // Server Management Section
            Section {
                Button {
                    showRestartConfirmation = true
                } label: {
                    HStack {
                        if isRestarting {
                            ProgressView()
                                .controlSize(.small)
                            Text("Restarting...")
                                .padding(.leading, 8)
                        } else {
                            Label("Restart Server", systemImage: "arrow.clockwise.circle")
                        }
                        Spacer()
                    }
                }
                .disabled(isRestarting)
                
                if let error = restartError {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } header: {
                Text("Server")
            } footer: {
                Text("Restart the server process. The app will disconnect and automatically reconnect.")
            }
            
            // Cursor Status Section
            if let status = cursorStatus {
                Section {
                    HStack {
                        Label("Status", systemImage: status.isRunning ? "checkmark.circle.fill" : "xmark.circle.fill")
                        Spacer()
                        Text(status.isRunning ? "Running" : "Not Running")
                            .font(.caption)
                            .foregroundColor(status.isRunning ? .green : .secondary)
                    }
                    
                    if let version = status.version {
                        HStack {
                            Label("Version", systemImage: "info.circle")
                            Spacer()
                            Text(version)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Cursor IDE")
                }
            }
            
            // System Info Section
            if let info = systemInfo {
                Section {
                    HStack {
                        Label("Hostname", systemImage: "desktopcomputer")
                        Spacer()
                        Text(info.hostname)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Label("Platform", systemImage: "cpu")
                        Spacer()
                        Text("\(info.platformName) (\(info.arch))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Label("User", systemImage: "person.fill")
                        Spacer()
                        Text(info.username)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Label("CPUs", systemImage: "cpu")
                        Spacer()
                        Text("\(info.cpus) cores")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Label("Memory", systemImage: "memorychip")
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("\(info.memory.formattedUsed) / \(info.memory.formattedTotal)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            ProgressView(value: info.memory.usagePercentage, total: 100)
                                .frame(width: 80)
                        }
                    }
                    
                    HStack {
                        Label("Uptime", systemImage: "clock")
                        Spacer()
                        Text(info.formattedUptime)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("System")
                }
            }
            
            // Network Section
            if !networkInfo.isEmpty {
                Section {
                    ForEach(networkInfo) { interface in
                        HStack {
                            Label(interface.name, systemImage: "network")
                            Spacer()
                            Text(interface.address)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Network Interfaces")
                }
            }
            
            // Recent File Changes
            if !webSocketManager.fileChanges.isEmpty {
                Section {
                    ForEach(webSocketManager.fileChanges.prefix(5)) { change in
                        HStack {
                            Image(systemName: changeIcon(for: change.event))
                                .foregroundColor(changeColor(for: change.event))
                            
                            VStack(alignment: .leading) {
                                Text(change.relativePath)
                                    .font(.caption)
                                    .lineLimit(1)
                                
                                Text(formatTime(change.timestamp))
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Recent File Changes")
                }
            }
            
            // Account Section
            Section {
                Button(role: .destructive) {
                    showLogoutConfirmation = true
                } label: {
                    Label("Disconnect", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } header: {
                Text("Account")
            }
            
            // Editor Section
            Section {
                NavigationLink {
                    SyntaxSettingsView()
                } label: {
                    HStack {
                        Label("Syntax Highlighting", systemImage: "paintbrush")
                        Spacer()
                        Text(SyntaxHighlightManager.shared.syntaxHighlightingEnabled ? "On" : "Off")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } header: {
                Text("Editor")
            }
            
            // Chat Defaults Section
            Section {
                // Default Model picker
                HStack {
                    Label("Default Model", systemImage: "cpu")
                    Spacer()
                    if chatSettings.isLoadingModels {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Menu {
                            Button {
                                chatSettings.defaultModelId = nil
                            } label: {
                                HStack {
                                    Text("System Default")
                                    if chatSettings.defaultModelId == nil {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            
                            Divider()
                            
                            ForEach(chatSettings.cachedModels) { model in
                                Button {
                                    chatSettings.defaultModelId = model.id
                                } label: {
                                    HStack {
                                        Text(model.name)
                                        if chatSettings.defaultModelId == model.id {
                                            Image(systemName: "checkmark")
                                        }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(chatSettings.defaultModelDisplayName)
                                    .font(.subheadline)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.caption2)
                            }
                            .foregroundColor(.primary)
                        }
                    }
                }
                
                // Default Mode picker
                HStack {
                    Label("Default Mode", systemImage: "person.fill.questionmark")
                    Spacer()
                    Menu {
                        ForEach(ChatMode.allCases) { mode in
                            Button {
                                chatSettings.defaultMode = mode
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(mode.displayName)
                                        Text(mode.description)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    if chatSettings.defaultMode == mode {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(chatSettings.defaultMode.displayName)
                                .font(.subheadline)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption2)
                        }
                        .foregroundColor(.primary)
                    }
                }
                
                // Permission Mode picker
                HStack {
                    Label("Permissions", systemImage: "shield")
                    Spacer()
                    Menu {
                        ForEach(PermissionMode.allCases) { permission in
                            Button {
                                chatSettings.defaultPermissionMode = permission
                            } label: {
                                HStack {
                                    Image(systemName: permission.icon)
                                    VStack(alignment: .leading) {
                                        Text(permission.displayName)
                                        Text(permission.description)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    if chatSettings.defaultPermissionMode == permission {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: chatSettings.defaultPermissionMode.icon)
                                .font(.caption)
                            Text(chatSettings.defaultPermissionMode.displayName)
                                .font(.subheadline)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption2)
                        }
                        .foregroundColor(.primary)
                    }
                }
                
                // Chat View Style picker
                HStack {
                    Label("Chat Design", systemImage: "text.bubble")
                    Spacer()
                    Menu {
                        ForEach(ChatViewStyle.allCases) { style in
                            Button {
                                chatSettings.chatViewStyle = style
                            } label: {
                                HStack {
                                    Image(systemName: style.icon)
                                    VStack(alignment: .leading) {
                                        Text(style.displayName)
                                        Text(style.description)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    if chatSettings.chatViewStyle == style {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: chatSettings.chatViewStyle.icon)
                                .font(.caption)
                            Text(chatSettings.chatViewStyle.displayName)
                                .font(.subheadline)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption2)
                        }
                        .foregroundColor(.primary)
                    }
                }
            } header: {
                Text("Chat Defaults")
            } footer: {
                Text("These settings apply to all new chats. Terminal design shows CLI-style output with tool calls and diffs.")
            }
            
            // Appearance / Theme Section
            Section {
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: 16) {
                    ForEach(AppIconOption.allCases) { option in
                        ThemeButton(
                            option: option,
                            isSelected: themeManager.currentTheme == option.theme,
                            onSelect: {
                                selectTheme(option.theme)
                            }
                        )
                    }
                }
                .padding(.vertical, 8)
            } header: {
                Text("Appearance")
            } footer: {
                Text("Choose your color theme. This changes the app colors and icon on your home screen.")
            }
            
            // Cache Section
            Section {
                Button {
                    CacheManager.shared.clearAll()
                } label: {
                    Label("Clear Cache", systemImage: "trash")
                }
            } header: {
                Text("Storage")
            } footer: {
                Text("Cached data allows the app to load content faster. Clearing the cache will require fresh data to be fetched from the server.")
            }
            
            // Diagnostics Section
            Section {
                NavigationLink {
                    LogViewerView()
                } label: {
                    HStack {
                        Label("Logs", systemImage: "doc.text.magnifyingglass")
                        Spacer()
                        Text("View app & server logs")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } header: {
                Text("Diagnostics")
            } footer: {
                Text("View logs to help debug issues with chats and other features.")
            }
            
            // App Info
            Section {
                HStack {
                    Label("Version", systemImage: "info.circle")
                    Spacer()
                    Text("1.0.0")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } header: {
                Text("App")
            }
            
            // Developer Tools Section
            Section {
                // Device picker
                Button {
                    loadDevices()
                    showDevicePicker = true
                } label: {
                    HStack {
                        Label("Target Device", systemImage: selectedDevice?.isPhysicalDevice == true ? "iphone" : "ipad.and.iphone")
                        Spacer()
                        if loadingDevices {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            VStack(alignment: .trailing) {
                                Text(selectedDevice?.name ?? "iPhone 16")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                if let device = selectedDevice {
                                    Text(device.isPhysicalDevice ? "Physical Device" : "Simulator")
                                        .font(.caption2)
                                        .foregroundColor(device.isPhysicalDevice ? .orange : .blue)
                                }
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .foregroundColor(.primary)
                
                // Device unavailable warning
                if deviceUnavailable, let device = selectedDevice {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Device Unavailable")
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.orange)
                            Text("\(device.name) is no longer available. Please select a different device.")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                
                // Clean build toggle
                Toggle(isOn: $cleanBuild) {
                    Label("Clean Build", systemImage: "trash")
                }
                
                // Build and Run button
                Button {
                    buildAndRunApp()
                } label: {
                    HStack {
                        if isBuilding {
                            ProgressView()
                                .controlSize(.small)
                            Text("Building...")
                                .padding(.leading, 8)
                        } else {
                            Label("Build & Run", systemImage: "hammer.fill")
                        }
                        Spacer()
                    }
                }
                .disabled(isBuilding || deviceUnavailable)
                
                // Build status messages
                if let success = buildSuccess {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text(success)
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
                
                if let error = buildError {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.red)
                            Text("Build Failed")
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.red)
                        }
                        Text(error)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(5)
                    }
                }
            } header: {
                Text("Developer Tools")
            } footer: {
                if selectedDevice?.isPhysicalDevice == true {
                    Text("Rebuild and reinstall the app on your physical device. Make sure your device is unlocked and trusted.")
                } else {
                    Text("Rebuild and reinstall the app on the simulator. The app will restart automatically.")
                }
            }
        }
        .navigationTitle("Settings")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    loadData()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .confirmationDialog(
            "Disconnect from server?",
            isPresented: $showLogoutConfirmation,
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                authManager.logout()
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Restart Server?",
            isPresented: $showRestartConfirmation,
            titleVisibility: .visible
        ) {
            Button("Restart", role: .destructive) {
                restartServer()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will restart the server. You'll be briefly disconnected.")
        }
        .sheet(isPresented: $showDevicePicker) {
            NavigationStack {
                List {
                    if loadingDevices {
                        HStack {
                            Spacer()
                            ProgressView("Loading devices...")
                            Spacer()
                        }
                    } else if availableDevices.isEmpty {
                        Text("No devices available")
                            .foregroundColor(.secondary)
                    } else {
                        // Physical devices section
                        let physicalDevices = availableDevices.filter { $0.isPhysicalDevice }
                        if !physicalDevices.isEmpty {
                            Section {
                                ForEach(physicalDevices) { device in
                                    DeviceRow(
                                        device: device,
                                        isSelected: selectedDevice?.udid == device.udid,
                                        onSelect: {
                                            selectedDevice = device
                                            saveSelectedDevice(device)
                                            deviceUnavailable = false
                                            showDevicePicker = false
                                        }
                                    )
                                }
                            } header: {
                                Label("Physical Devices", systemImage: "iphone")
                            }
                        }
                        
                        // Simulators section
                        let simulators = availableDevices.filter { !$0.isPhysicalDevice }
                        if !simulators.isEmpty {
                            Section {
                                ForEach(simulators) { device in
                                    DeviceRow(
                                        device: device,
                                        isSelected: selectedDevice?.udid == device.udid,
                                        onSelect: {
                                            selectedDevice = device
                                            saveSelectedDevice(device)
                                            deviceUnavailable = false
                                            showDevicePicker = false
                                        }
                                    )
                                }
                            } header: {
                                Label("Simulators", systemImage: "ipad.and.iphone")
                            }
                        }
                    }
                }
                .navigationTitle("Select Device")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button {
                            loadDevices()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") {
                            showDevicePicker = false
                        }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .onAppear {
            // Load saved device first (no network call needed)
            loadSavedDevice()
            loadData()
        }
        .alert("Icon Changed", isPresented: $showIconChangeAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Your app icon has been updated!")
        }
    }
    
    private func selectTheme(_ theme: AppTheme) {
        withAnimation(.easeInOut(duration: 0.3)) {
            themeManager.currentTheme = theme
        }
    }
    
    private func loadDevices() {
        loadingDevices = true
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    loadingDevices = false
                }
                return
            }
            
            do {
                let devices = try await api.getIOSDevices()
                await MainActor.run {
                    availableDevices = devices
                    
                    // Try to validate/restore the selected device
                    if let selected = selectedDevice {
                        // Check if the selected device is still available
                        if let matchingDevice = devices.first(where: { $0.udid == selected.udid }) {
                            // Update the device info (state may have changed)
                            selectedDevice = matchingDevice
                            deviceUnavailable = false
                        } else {
                            // Device is no longer available
                            deviceUnavailable = true
                        }
                    } else {
                        // No device selected, try to select a connected physical device first
                        if let physicalDevice = devices.first(where: { $0.isPhysicalDevice }) {
                            selectedDevice = physicalDevice
                            saveSelectedDevice(physicalDevice)
                        } else if let simulator = devices.first(where: { $0.isBooted }) {
                            selectedDevice = simulator
                            saveSelectedDevice(simulator)
                        } else if let firstDevice = devices.first {
                            selectedDevice = firstDevice
                            saveSelectedDevice(firstDevice)
                        }
                    }
                    loadingDevices = false
                }
            } catch {
                print("Failed to load devices: \(error)")
                await MainActor.run {
                    loadingDevices = false
                }
            }
        }
    }
    
    /// Save the selected device to UserDefaults
    private func saveSelectedDevice(_ device: iOSDevice) {
        do {
            let data = try JSONEncoder().encode(device)
            UserDefaults.standard.set(data, forKey: Self.savedDeviceKey)
        } catch {
            print("Failed to save selected device: \(error)")
        }
    }
    
    /// Load the previously selected device from UserDefaults
    private func loadSavedDevice() {
        guard let data = UserDefaults.standard.data(forKey: Self.savedDeviceKey) else {
            return
        }
        
        do {
            let device = try JSONDecoder().decode(iOSDevice.self, from: data)
            selectedDevice = device
        } catch {
            print("Failed to load saved device: \(error)")
            // Clear invalid data
            UserDefaults.standard.removeObject(forKey: Self.savedDeviceKey)
        }
    }
    
    private func buildAndRunApp() {
        isBuilding = true
        buildError = nil
        buildSuccess = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    buildError = "Not authenticated"
                    isBuilding = false
                }
                return
            }
            
            let deviceName = selectedDevice?.name ?? "iPhone 16"
            let deviceId = selectedDevice?.udid
            let isPhysical = selectedDevice?.isPhysicalDevice ?? false
            
            do {
                let response = try await api.buildAndRuniOSApp(
                    configuration: "Debug",
                    deviceName: deviceName,
                    deviceId: deviceId,
                    isPhysicalDevice: isPhysical,
                    clean: cleanBuild
                )
                
                await MainActor.run {
                    if response.success {
                        buildSuccess = response.message ?? "Build successful!"
                    } else {
                        let errorMessage = response.error ?? response.details ?? "Unknown build error"
                        buildError = errorMessage
                        
                        // Check if the error is related to device unavailability
                        if isDeviceUnavailableError(errorMessage) {
                            deviceUnavailable = true
                        }
                    }
                    isBuilding = false
                }
            } catch {
                await MainActor.run {
                    let errorMessage = error.localizedDescription
                    buildError = errorMessage
                    
                    // Check if the error is related to device unavailability
                    if isDeviceUnavailableError(errorMessage) {
                        deviceUnavailable = true
                    }
                    isBuilding = false
                }
            }
        }
    }
    
    /// Check if the error message indicates the device is unavailable
    private func isDeviceUnavailableError(_ error: String) -> Bool {
        let lowercasedError = error.lowercased()
        let deviceUnavailablePatterns = [
            "device not found",
            "device unavailable",
            "simulator not found",
            "no matching destination",
            "unable to find a destination",
            "no device matching",
            "device is not available",
            "could not find a device",
            "invalid device",
            "unknown device"
        ]
        
        return deviceUnavailablePatterns.contains { lowercasedError.contains($0) }
    }
    
    private func restartServer() {
        isRestarting = true
        restartError = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    restartError = "Not authenticated"
                    isRestarting = false
                }
                return
            }
            
            do {
                let response = try await api.restartServer()
                await MainActor.run {
                    if response.success {
                        // Server will restart - we'll be disconnected shortly
                        isRestarting = false
                    } else {
                        restartError = response.message ?? "Failed to restart"
                        isRestarting = false
                    }
                }
            } catch {
                await MainActor.run {
                    restartError = error.localizedDescription
                    isRestarting = false
                }
            }
        }
    }
    
    private func loadData() {
        isLoading = true
        
        Task {
            guard let api = authManager.createAPIService() else {
                isLoading = false
                return
            }
            
            do {
                async let system = api.getSystemInfo()
                async let network = api.getNetworkInfo()
                async let cursor = api.getCursorStatus()
                
                systemInfo = try await system
                networkInfo = try await network
                cursorStatus = try await cursor
            } catch {
                self.error = error.localizedDescription
            }
            
            // Also load models for chat settings
            await chatSettings.fetchModels(using: api)
            
            isLoading = false
        }
    }
    
    private func changeIcon(for event: String) -> String {
        switch event {
        case "add":
            return "plus.circle.fill"
        case "unlink":
            return "minus.circle.fill"
        case "change":
            return "pencil.circle.fill"
        default:
            return "circle.fill"
        }
    }
    
    private func changeColor(for event: String) -> Color {
        switch event {
        case "add":
            return .green
        case "unlink":
            return .red
        case "change":
            return .orange
        default:
            return .secondary
        }
    }
    
    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Theme Button Component

private struct ThemeButton: View {
    let option: AppIconOption
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 8) {
                ZStack {
                    // Theme color preview background
                    RoundedRectangle(cornerRadius: 14)
                        .fill(option.theme.backgroundColor)
                        .frame(width: 64, height: 64)
                    
                    // Accent color indicator
                    Circle()
                        .fill(option.theme.accentColor)
                        .frame(width: 24, height: 24)
                    
                    // Selection indicator
                    if isSelected {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(option.theme.accentColor, lineWidth: 3)
                            .frame(width: 64, height: 64)
                    } else {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                            .frame(width: 64, height: 64)
                    }
                }
                
                Text(option.displayName)
                    .font(.caption2)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundColor(isSelected ? option.theme.accentColor : .secondary)
                    .lineLimit(1)
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundColor(option.theme.accentColor)
                } else {
                    Image(systemName: "circle")
                        .font(.caption)
                        .foregroundColor(.secondary.opacity(0.5))
                }
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Device Row Component

private struct DeviceRow: View {
    let device: iOSDevice
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack {
                Image(systemName: device.isPhysicalDevice ? "iphone" : "iphone.gen3")
                    .foregroundColor(device.isPhysicalDevice ? .orange : .blue)
                    .frame(width: 24)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(device.name)
                        .foregroundColor(.primary)
                    HStack(spacing: 4) {
                        Text("iOS \(device.iosVersion)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        if device.isPhysicalDevice {
                            Text("•")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(device.connectionType?.capitalized ?? "Connected")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Spacer()
                
                if device.isBooted || device.isPhysicalDevice {
                    Text(device.isPhysicalDevice ? "Connected" : "Booted")
                        .font(.caption)
                        .foregroundColor(.green)
                }
                
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundColor(.accentColor)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(AuthManager())
            .environmentObject(WebSocketManager())
            .environmentObject(ThemeManager.shared)
    }
}
