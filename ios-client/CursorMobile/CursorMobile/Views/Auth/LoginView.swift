import SwiftUI
import AVFoundation

struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var savedHostsManager = SavedHostsManager.shared
    @State private var serverUrl = ""
    @State private var token = ""
    @State private var isConnecting = false
    @State private var showScanner = false
    @State private var connectingHostId: UUID? = nil
    @State private var showSetupGuide = false
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 32) {
                    // Header
                    VStack(spacing: 12) {
                        Image(systemName: "laptopcomputer.and.iphone")
                            .font(.system(size: 60))
                            .foregroundColor(.accentColor)
                        
                        Text("Napp Trapp")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        
                        Text("Control your Cursor IDE from your iPhone")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 40)
                    
                    // Setup Guide - Show prominently when no saved hosts
                    if !savedHostsManager.hasSavedHosts {
                        VStack(spacing: 16) {
                            Text("First time setup?")
                                .font(.headline)
                            
                            Button {
                                showSetupGuide = true
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "book.pages")
                                        .font(.title2)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Server Setup Guide")
                                            .font(.headline)
                                        Text("Step-by-step instructions to get started")
                                            .font(.caption)
                                            .opacity(0.8)
                                    }
                                    
                                    Spacer()
                                    
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .opacity(0.6)
                                }
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(Color.accentColor.opacity(0.15))
                                .foregroundColor(.accentColor)
                                .cornerRadius(12)
                            }
                        }
                        .padding(.horizontal)
                        
                        // Divider
                        HStack {
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(height: 1)
                            
                            Text("OR")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(height: 1)
                        }
                        .padding(.horizontal)
                    }
                    
                    // Saved Hosts Section (if any exist)
                    if savedHostsManager.hasSavedHosts {
                        VStack(spacing: 12) {
                            Text("Previous Hosts")
                                .font(.headline)
                            
                            VStack(spacing: 8) {
                                ForEach(savedHostsManager.savedHosts) { host in
                                    SavedHostRow(
                                        host: host,
                                        isConnecting: connectingHostId == host.id,
                                        onConnect: {
                                            connectToSavedHost(host)
                                        },
                                        onDelete: {
                                            savedHostsManager.removeHost(host)
                                        }
                                    )
                                }
                            }
                        }
                        .padding(.horizontal)
                        
                        // Divider
                        HStack {
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(height: 1)
                            
                            Text("OR")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Rectangle()
                                .fill(Color.secondary.opacity(0.3))
                                .frame(height: 1)
                        }
                        .padding(.horizontal)
                    }
                    
                    // QR Code Scanner Button
                    VStack(spacing: 12) {
                        Button {
                            showScanner = true
                        } label: {
                            Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.accentColor)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }
                        
                        Text("Scan the QR code shown in your terminal")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    
                    // Divider
                    HStack {
                        Rectangle()
                            .fill(Color.secondary.opacity(0.3))
                            .frame(height: 1)
                        
                        Text("OR")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        Rectangle()
                            .fill(Color.secondary.opacity(0.3))
                            .frame(height: 1)
                    }
                    .padding(.horizontal)
                    
                    // Manual Entry Form
                    VStack(spacing: 16) {
                        Text("Manual Connection")
                            .font(.headline)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Server Address")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            TextField("http://192.168.1.100:3847", text: $serverUrl)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .keyboardType(.URL)
                        }
                        
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Auth Token")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            SecureField("Enter your token", text: $token)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                        }
                        
                        Button {
                            connect()
                        } label: {
                            Group {
                                if isConnecting {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Text("Connect")
                                }
                            }
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(canConnect ? Color.accentColor : Color.gray)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(!canConnect || isConnecting)
                    }
                    .padding(.horizontal)
                    
                    // Error Message
                    if let error = authManager.error {
                        Text(error)
                            .font(.callout)
                            .foregroundColor(.red)
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.red.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal)
                    }
                    
                    // Setup Guide Button - Show at bottom only when there are saved hosts
                    // (When no saved hosts, it's shown at the top)
                    if savedHostsManager.hasSavedHosts {
                        VStack(spacing: 16) {
                            Text("First time setup?")
                                .font(.headline)
                            
                            Button {
                                showSetupGuide = true
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "book.pages")
                                        .font(.title2)
                                    
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Server Setup Guide")
                                            .font(.headline)
                                        Text("Step-by-step instructions to get started")
                                            .font(.caption)
                                            .opacity(0.8)
                                    }
                                    
                                    Spacer()
                                    
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .opacity(0.6)
                                }
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(Color.accentColor.opacity(0.15))
                                .foregroundColor(.accentColor)
                                .cornerRadius(12)
                            }
                        }
                        .padding(.horizontal)
                    }
                    
                    Spacer(minLength: 40)
                }
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showScanner) {
                QRScannerView { result in
                    handleQRCode(result)
                    showScanner = false
                }
            }
            .sheet(isPresented: $showSetupGuide) {
                ServerSetupGuideSheet()
            }
        }
    }
    
    private var canConnect: Bool {
        !serverUrl.trimmingCharacters(in: .whitespaces).isEmpty &&
        !token.trimmingCharacters(in: .whitespaces).isEmpty
    }
    
    private func connect() {
        isConnecting = true
        Task {
            await authManager.login(serverUrl: serverUrl, token: token)
            isConnecting = false
        }
    }
    
    private func handleQRCode(_ code: String) {
        // Parse QR code URL
        // Format: http://IP:PORT/?token=TOKEN
        guard let url = URL(string: code),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            authManager.error = "Invalid QR code"
            return
        }
        
        // Extract token from query
        if let tokenParam = components.queryItems?.first(where: { $0.name == "token" })?.value {
            token = tokenParam
        }
        
        // Build server URL (without query params)
        if let host = components.host {
            let port = components.port ?? 3847
            serverUrl = "\(components.scheme ?? "http")://\(host):\(port)"
        }
        
        // Auto-connect if we have both
        if !serverUrl.isEmpty && !token.isEmpty {
            connect()
        }
    }
    
    private func connectToSavedHost(_ host: SavedHost) {
        connectingHostId = host.id
        Task {
            await authManager.login(serverUrl: host.serverUrl, token: host.token)
            connectingHostId = nil
        }
    }
}

// MARK: - SavedHostRow Component

struct SavedHostRow: View {
    let host: SavedHost
    let isConnecting: Bool
    let onConnect: () -> Void
    let onDelete: () -> Void
    
    @State private var showDeleteConfirmation = false
    
    var body: some View {
        Button(action: onConnect) {
            HStack(spacing: 12) {
                // Host icon
                Image(systemName: "desktopcomputer")
                    .font(.title2)
                    .foregroundColor(.accentColor)
                    .frame(width: 40, height: 40)
                    .background(Color.accentColor.opacity(0.1))
                    .cornerRadius(8)
                
                // Host info
                VStack(alignment: .leading, spacing: 2) {
                    Text(host.displayName)
                        .font(.headline)
                        .foregroundColor(.primary)
                    
                    Text(host.serverDescription)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Text("Connected \(host.formattedLastConnected)")
                        .font(.caption2)
                        .foregroundColor(.secondary.opacity(0.8))
                }
                
                Spacer()
                
                // Connect/loading indicator
                if isConnecting {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                } else {
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(12)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
        .disabled(isConnecting)
        .contextMenu {
            Button(role: .destructive) {
                showDeleteConfirmation = true
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
        .confirmationDialog(
            "Remove \(host.displayName)?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                onDelete()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove the saved connection. You can reconnect by scanning the QR code or entering the details manually.")
        }
    }
}

struct InstructionRow: View {
    let number: Int
    let text: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 24, height: 24)
                .background(Color.accentColor)
                .clipShape(Circle())
            
            Text(text)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Server Setup Guide Sheet

struct ServerSetupGuideSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var currentStep = 0
    
    private let totalSteps = 3
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Progress indicator
                    VStack(spacing: 8) {
                        HStack(spacing: 4) {
                            ForEach(0..<totalSteps, id: \.self) { step in
                                Capsule()
                                    .fill(step <= currentStep ? Color.accentColor : Color.secondary.opacity(0.3))
                                    .frame(height: 4)
                            }
                        }
                        
                        Text("Step \(currentStep + 1) of \(totalSteps)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    .padding(.top)
                    
                    // Step content
                    TabView(selection: $currentStep) {
                        SetupStep1View()
                            .tag(0)
                        
                        SetupStep2View()
                            .tag(1)
                        
                        SetupStep3View()
                            .tag(2)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .frame(minHeight: 450)
                    
                    // Navigation buttons
                    HStack(spacing: 16) {
                        if currentStep > 0 {
                            Button {
                                withAnimation {
                                    currentStep -= 1
                                }
                            } label: {
                                HStack {
                                    Image(systemName: "chevron.left")
                                    Text("Back")
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.secondarySystemBackground))
                                .foregroundColor(.primary)
                                .cornerRadius(12)
                            }
                        }
                        
                        Button {
                            withAnimation {
                                if currentStep < totalSteps - 1 {
                                    currentStep += 1
                                } else {
                                    dismiss()
                                }
                            }
                        } label: {
                            HStack {
                                Text(currentStep < totalSteps - 1 ? "Next" : "Done")
                                if currentStep < totalSteps - 1 {
                                    Image(systemName: "chevron.right")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.accentColor)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                }
            }
            .navigationTitle("Server Setup Guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Setup Steps

struct SetupStep1View: View {
    var body: some View {
        SetupStepContainer(
            icon: "laptopcomputer",
            title: "Prerequisites",
            subtitle: "What you'll need before starting"
        ) {
            VStack(alignment: .leading, spacing: 16) {
                SetupRequirementRow(
                    icon: "checkmark.circle.fill",
                    iconColor: .green,
                    title: "A Mac, Windows, or Linux computer",
                    description: "The server runs on your computer alongside Cursor IDE"
                )
                
                SetupRequirementRow(
                    icon: "shippingbox.fill",
                    iconColor: .blue,
                    title: "Docker OR Node.js installed",
                    description: "Docker Desktop (recommended) or Node.js 18+"
                )
                
                SetupRequirementRow(
                    icon: "app.badge.fill",
                    iconColor: .purple,
                    title: "Cursor IDE installed",
                    description: "The server connects to Cursor on your computer"
                )
                
                SetupRequirementRow(
                    icon: "wifi",
                    iconColor: .orange,
                    title: "Same WiFi network",
                    description: "Your phone and computer must be on the same network"
                )
            }
        }
    }
}

struct SetupStep2View: View {
    var body: some View {
        SetupStepContainer(
            icon: "play.circle.fill",
            title: "Start the Server",
            subtitle: "One command to get started"
        ) {
            VStack(alignment: .leading, spacing: 16) {
                // Docker option (recommended)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .foregroundColor(.yellow)
                            .font(.caption2)
                        Text("Recommended")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    SetupCodeBlockView(code: "docker run justinlovelessx/napptrapp")
                }
                
                // npx alternative
                VStack(alignment: .leading, spacing: 6) {
                    Text("Or with Node.js:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    SetupCodeBlockView(code: "npx napptrapp")
                }
                
                SetupNoteView(
                    icon: "qrcode",
                    color: .green,
                    text: "A QR code will appear when the server starts!"
                )
            }
        }
    }
}

struct SetupStep3View: View {
    var body: some View {
        SetupStepContainer(
            icon: "qrcode.viewfinder",
            title: "Connect Your Phone",
            subtitle: "Link this app to your server"
        ) {
            VStack(alignment: .leading, spacing: 20) {
                Text("You have two options to connect:")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 12) {
                        Text("1")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .frame(width: 24, height: 24)
                            .background(Color.accentColor)
                            .clipShape(Circle())
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Scan QR Code (Recommended)")
                                .font(.headline)
                            Text("Point your phone's camera at the QR code in the terminal, or use the \"Scan QR Code\" button in this app.")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                    
                    HStack(alignment: .top, spacing: 12) {
                        Text("2")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .frame(width: 24, height: 24)
                            .background(Color.accentColor)
                            .clipShape(Circle())
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Manual Entry")
                                .font(.headline)
                            Text("Enter the server address and auth token shown in your terminal under \"Manual Connection\".")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Divider()
                
                SetupNoteView(
                    icon: "exclamationmark.triangle.fill",
                    color: .orange,
                    text: "Make sure your phone is connected to the same WiFi network as your computer."
                )
                
                SetupNoteView(
                    icon: "checkmark.circle.fill",
                    color: .green,
                    text: "That's it! You're ready to control Cursor from your phone."
                )
            }
        }
    }
}

// MARK: - Setup Helper Views

struct SetupStepContainer<Content: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Header
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 36))
                    .foregroundColor(.accentColor)
                    .frame(width: 60, height: 60)
                    .background(Color.accentColor.opacity(0.15))
                    .cornerRadius(16)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            
            // Content
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SetupRequirementRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let description: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(iconColor)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

struct SetupCodeBlockView: View {
    let code: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Terminal")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(.tertiarySystemBackground))
            
            Text(code)
                .font(.system(.footnote, design: .monospaced))
                .foregroundColor(.primary)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground))
        }
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        )
    }
}

struct SetupNoteView: View {
    let icon: String
    let color: Color
    let text: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundColor(color)
            
            Text(text)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.1))
        .cornerRadius(8)
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthManager())
}

#Preview("Setup Guide") {
    ServerSetupGuideSheet()
}
