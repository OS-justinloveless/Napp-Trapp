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
}

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    @State private var systemInfo: SystemInfo?
    @State private var networkInfo: [NetworkInterface] = []
    @State private var cursorStatus: CursorStatus?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showLogoutConfirmation = false
    
    // App Icon states
    @State private var currentAppIcon: AppIconOption = .forest
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
            
            // App Icon Section
            Section {
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: 16) {
                    ForEach(AppIconOption.allCases) { option in
                        AppIconButton(
                            option: option,
                            isSelected: currentAppIcon == option,
                            onSelect: {
                                changeAppIcon(to: option)
                            }
                        )
                    }
                }
                .padding(.vertical, 8)
            } header: {
                Text("App Icon")
            } footer: {
                Text("Choose your preferred app icon. The icon will change on your home screen.")
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
                .disabled(isBuilding)
                
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
            loadData()
            detectCurrentAppIcon()
        }
        .alert("Icon Changed", isPresented: $showIconChangeAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Your app icon has been updated!")
        }
    }
    
    private func detectCurrentAppIcon() {
        if let iconName = UIApplication.shared.alternateIconName {
            currentAppIcon = AppIconOption.allCases.first { $0.iconName == iconName } ?? .forest
        } else {
            currentAppIcon = .forest
        }
    }
    
    private func changeAppIcon(to option: AppIconOption) {
        guard UIApplication.shared.supportsAlternateIcons else { return }
        
        UIApplication.shared.setAlternateIconName(option.iconName) { error in
            if let error = error {
                print("Error changing app icon: \(error.localizedDescription)")
            } else {
                DispatchQueue.main.async {
                    currentAppIcon = option
                }
            }
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
                    // If no device is selected, try to select a connected physical device first
                    if selectedDevice == nil {
                        if let physicalDevice = devices.first(where: { $0.isPhysicalDevice }) {
                            selectedDevice = physicalDevice
                        } else if let simulator = devices.first(where: { $0.isBooted }) {
                            selectedDevice = simulator
                        } else {
                            selectedDevice = devices.first
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
                        buildError = response.error ?? response.details ?? "Unknown build error"
                    }
                    isBuilding = false
                }
            } catch {
                await MainActor.run {
                    buildError = error.localizedDescription
                    isBuilding = false
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

// MARK: - App Icon Button Component

private struct AppIconButton: View {
    let option: AppIconOption
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 8) {
                ZStack {
                    // Actual icon image from asset catalog
                    Image(option.previewImageName)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    
                    // Selection indicator
                    if isSelected {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.accentColor, lineWidth: 3)
                            .frame(width: 64, height: 64)
                    }
                }
                
                Text(option.displayName)
                    .font(.caption2)
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .lineLimit(1)
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundColor(.accentColor)
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
    }
}
