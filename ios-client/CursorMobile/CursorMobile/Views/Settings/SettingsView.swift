import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    @State private var systemInfo: SystemInfo?
    @State private var networkInfo: [NetworkInterface] = []
    @State private var cursorStatus: CursorStatus?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showLogoutConfirmation = false
    
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
        .onAppear {
            loadData()
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

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(AuthManager())
            .environmentObject(WebSocketManager())
    }
}
