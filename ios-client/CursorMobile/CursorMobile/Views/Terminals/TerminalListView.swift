import SwiftUI

struct TerminalListView: View {
    let project: Project
    
    @EnvironmentObject var authManager: AuthManager
    @State private var terminals: [Terminal] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var selectedTerminal: Terminal?
    @State private var showInfoSheet = false
    
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
                Button {
                    showInfoSheet = true
                } label: {
                    Image(systemName: "info.circle")
                }
            }
        }
        .task {
            await loadTerminals()
        }
        .refreshable {
            await loadTerminals()
        }
    }
    
    private var noTerminalsView: some View {
        VStack(spacing: 20) {
            Image(systemName: "terminal")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)
            
            Text("No Cursor IDE Terminals")
                .font(.title2)
                .fontWeight(.semibold)
            
            Text("Open a terminal in Cursor IDE to see it here.\n\nUse ⌃` (Control + backtick) or\nTerminal → New Terminal in Cursor.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            Button("Refresh") {
                Task { await loadTerminals() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }
    
    private var terminalList: some View {
        List {
            ForEach(terminals) { terminal in
                Button {
                    selectedTerminal = terminal
                } label: {
                    TerminalRowView(terminal: terminal)
                }
                .buttonStyle(.plain)
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
}

struct TerminalRowView: View {
    let terminal: Terminal
    
    var body: some View {
        HStack(spacing: 12) {
            // Terminal icon with status color
            Image(systemName: terminal.active ? "terminal.fill" : "terminal")
                .font(.title2)
                .foregroundStyle(terminal.active ? .green : .secondary)
                .frame(width: 32)
            
            VStack(alignment: .leading, spacing: 4) {
                // Terminal name (e.g., "node server", "zsh ios-client")
                Text(terminal.name)
                    .font(.headline)
                
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
                        
                        Text("Cursor IDE Terminals")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top)
                    
                    // Explanation
                    VStack(alignment: .leading, spacing: 16) {
                        FeatureInfoRow(
                            icon: "display",
                            title: "View Terminals",
                            description: "This app shows terminals that are open in the Cursor IDE on your Mac."
                        )
                        
                        FeatureInfoRow(
                            icon: "keyboard",
                            title: "Send Commands",
                            description: "You can type commands and send input to any active Cursor terminal."
                        )
                        
                        FeatureInfoRow(
                            icon: "arrow.triangle.2.circlepath",
                            title: "Real-time Updates",
                            description: "Pull to refresh to see the latest terminal output and new terminals."
                        )
                    }
                    .padding(.horizontal)
                    
                    // How to create
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Creating New Terminals")
                            .font(.headline)
                        
                        Text("Terminals must be created in the Cursor IDE:")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                Text("⌃`")
                                    .font(.system(.body, design: .monospaced))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color(.systemGray5))
                                    .cornerRadius(6)
                                Text("Control + Backtick")
                                    .font(.subheadline)
                            }
                            
                            HStack(spacing: 8) {
                                Text("⌘J")
                                    .font(.system(.body, design: .monospaced))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color(.systemGray5))
                                    .cornerRadius(6)
                                Text("Toggle Terminal Panel")
                                    .font(.subheadline)
                            }
                            
                            Text("Or use: Terminal → New Terminal")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
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
