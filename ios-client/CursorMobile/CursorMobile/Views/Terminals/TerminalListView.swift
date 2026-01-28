import SwiftUI

struct TerminalListView: View {
    let project: Project
    
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    @State private var terminals: [Terminal] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var selectedTerminal: Terminal?
    @State private var showInfoSheet = false
    @State private var isCreatingTerminal = false
    
    // Separate terminals by source
    private var ptyTerminals: [Terminal] {
        terminals.filter { $0.source == "mobile-pty" }
    }
    
    private var cursorTerminals: [Terminal] {
        terminals.filter { $0.source == "cursor-ide" }
    }
    
    var body: some View {
        Group {
            if isLoading && terminals.isEmpty {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading terminals...")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            } else if let error = error, terminals.isEmpty {
                ErrorView(message: error) {
                    Task { await loadTerminals() }
                }
            } else if terminals.isEmpty {
                noTerminalsView
            } else {
                terminalList
            }
        }
        .navigationTitle("Terminals")
        .navigationDestination(item: $selectedTerminal) { terminal in
            TerminalView(terminal: terminal, project: project)
        }
        .sheet(isPresented: $showInfoSheet) {
            TerminalInfoSheet()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 12) {
                    Button {
                        createNewTerminal()
                    } label: {
                        if isCreatingTerminal {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "plus")
                        }
                    }
                    .disabled(isCreatingTerminal)
                    
                    Button {
                        showInfoSheet = true
                    } label: {
                        Image(systemName: "info.circle")
                    }
                }
            }
        }
        .task {
            await loadTerminals()
        }
        .refreshable {
            await loadTerminals()
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            terminals = []
            selectedTerminal = nil
            isLoading = true
            error = nil
            Task { await loadTerminals() }
        }
    }
    
    private var noTerminalsView: some View {
        VStack(spacing: 20) {
            Image(systemName: "terminal")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)
            
            Text("No Terminals")
                .font(.title2)
                .fontWeight(.semibold)
            
            Text("Create a new terminal or open one in Cursor IDE.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            HStack(spacing: 16) {
                Button {
                    createNewTerminal()
                } label: {
                    Label("New Terminal", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isCreatingTerminal)
                
                Button("Refresh") {
                    Task { await loadTerminals() }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
    }
    
    private var terminalList: some View {
        List {
            // PTY Terminals (Mobile) - with full input support
            if !ptyTerminals.isEmpty {
                Section {
                    ForEach(ptyTerminals) { terminal in
                        Button {
                            selectedTerminal = terminal
                        } label: {
                            TerminalRowView(terminal: terminal, showSource: true)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                killTerminal(terminal.id)
                            } label: {
                                Label("Close", systemImage: "xmark.circle")
                            }
                        }
                    }
                } header: {
                    Label("Mobile Terminals", systemImage: "iphone")
                } footer: {
                    Text("Full input support. Swipe to close.")
                }
            }
            
            // Cursor IDE Terminals - read-only output
            if !cursorTerminals.isEmpty {
                Section {
                    ForEach(cursorTerminals) { terminal in
                        Button {
                            selectedTerminal = terminal
                        } label: {
                            TerminalRowView(terminal: terminal, showSource: true)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Label("Cursor IDE Terminals", systemImage: "desktopcomputer")
                } footer: {
                    Text("View-only. Input not available due to macOS restrictions.")
                }
            }
        }
        .listStyle(.insetGrouped)
    }
    
    private func loadTerminals() async {
        isLoading = true
        error = nil
        
        do {
            guard let api = authManager.createAPIService() else {
                self.error = "Not authenticated"
                isLoading = false
                return
            }
            terminals = try await api.getTerminals(projectPath: project.path)
        } catch {
            self.error = error.localizedDescription
        }
        
        isLoading = false
    }
    
    private func createNewTerminal() {
        isCreatingTerminal = true
        
        webSocketManager.createTerminal(cwd: project.path) { terminal in
            Task { @MainActor in
                isCreatingTerminal = false
                // Add to list and select
                terminals.insert(terminal, at: 0)
                selectedTerminal = terminal
            }
        }
        
        // Timeout after 10 seconds
        Task {
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            await MainActor.run {
                if isCreatingTerminal {
                    isCreatingTerminal = false
                    error = "Failed to create terminal - timeout"
                }
            }
        }
    }
    
    private func killTerminal(_ terminalId: String) {
        webSocketManager.killTerminal(terminalId)
        terminals.removeAll { $0.id == terminalId }
    }
}

struct TerminalRowView: View {
    let terminal: Terminal
    var showSource: Bool = false
    
    var body: some View {
        HStack(spacing: 12) {
            // Terminal icon with status color
            Image(systemName: terminal.active ? "terminal.fill" : "terminal")
                .font(.title2)
                .foregroundStyle(iconColor)
                .frame(width: 32)
            
            VStack(alignment: .leading, spacing: 4) {
                // Terminal name (e.g., "node server", "zsh ios-client")
                HStack {
                    Text(terminal.name)
                        .font(.headline)
                    
                    if showSource && terminal.source == "mobile-pty" {
                        Text("PTY")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.2))
                            .foregroundColor(.blue)
                            .cornerRadius(4)
                    }
                }
                
                // Show active command with play indicator
                if let activeCmd = terminal.activeCommand, !activeCmd.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "play.fill")
                            .font(.caption2)
                            .foregroundStyle(.green)
                        Text(activeCmd)
                            .font(.subheadline)
                            .foregroundStyle(.green)
                            .lineLimit(1)
                    }
                } else if !terminal.active, let exitCode = terminal.exitCode {
                    // Show exit status for inactive terminals
                    HStack(spacing: 4) {
                        Image(systemName: exitCode == 0 ? "checkmark.circle" : "xmark.circle")
                            .font(.caption2)
                            .foregroundColor(exitCode == 0 ? .secondary : .red)
                        Text("Exited (\(exitCode))")
                            .font(.subheadline)
                            .foregroundColor(exitCode == 0 ? .secondary : .red)
                    }
                } else if terminal.source == "mobile-pty" {
                    Text("Ready for input")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            
            Spacer()
            
            // Status indicator dot
            Circle()
                .fill(terminal.active ? Color.green : Color.gray)
                .frame(width: 10, height: 10)
        }
        .padding(.vertical, 6)
    }
    
    private var iconColor: Color {
        if terminal.source == "mobile-pty" {
            return terminal.active ? .blue : .secondary
        }
        return terminal.active ? .green : .secondary
    }
}

struct TerminalInfoSheet: View {
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Header
                    VStack(spacing: 12) {
                        Image(systemName: "terminal.fill")
                            .font(.system(size: 50))
                            .foregroundStyle(.blue)
                        
                        Text("Terminal Types")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top)
                    
                    // Mobile PTY Terminals
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "iphone")
                                .foregroundStyle(.blue)
                            Text("Mobile Terminals")
                                .font(.headline)
                        }
                        
                        Text("Full-featured terminals created from the app. These support complete bidirectional input/output.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        
                        HStack(spacing: 8) {
                            Label("Input", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.green)
                            Label("Output", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.green)
                            Label("Resize", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.green)
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                    
                    // Cursor IDE Terminals
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "desktopcomputer")
                                .foregroundStyle(.orange)
                            Text("Cursor IDE Terminals")
                                .font(.headline)
                        }
                        
                        Text("Terminals from Cursor IDE. Due to macOS security restrictions, these are view-only from the mobile app.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        
                        HStack(spacing: 8) {
                            Label("Input", systemImage: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.red)
                            Label("Output", systemImage: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.green)
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                    
                    // Tip
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Tip")
                            .font(.headline)
                        Text("For full terminal functionality, tap the + button to create a new Mobile Terminal. These run on your Mac but are fully controllable from your phone.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(12)
                    .padding(.horizontal)
                    
                    Spacer()
                }
            }
            .navigationTitle("About Terminals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct FeatureInfoRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.blue)
                .frame(width: 32)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
