import SwiftUI

struct TerminalView: View {
    let terminal: Terminal
    let project: Project
    
    @EnvironmentObject var webSocketManager: WebSocketManager
    @State private var terminalData = ""
    @State private var isConnected = false
    @State private var error: String?
    @State private var showKeyboardToolbar = true
    
    var body: some View {
        VStack(spacing: 0) {
            // Terminal output area
            SwiftTermWrapper(
                terminalId: terminal.id,
                onInput: { data in
                    // Send user input to the terminal via WebSocket
                    webSocketManager.sendTerminalInput(terminal.id, data: data)
                },
                onResize: { cols, rows in
                    // Notify server of terminal size changes
                    webSocketManager.resizeTerminal(terminal.id, cols: cols, rows: rows)
                },
                terminalData: $terminalData
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            
            // Keyboard toolbar for special keys
            if showKeyboardToolbar {
                keyboardToolbar
            }
        }
        .navigationTitle(terminal.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showKeyboardToolbar.toggle()
                } label: {
                    Image(systemName: showKeyboardToolbar ? "keyboard.chevron.compact.down" : "keyboard")
                }
            }
        }
        .onAppear {
            connectToTerminal()
        }
        .onDisappear {
            disconnectFromTerminal()
        }
        .alert("Terminal Error", isPresented: Binding(
            get: { error != nil },
            set: { if !$0 { error = nil } }
        )) {
            Button("OK") {
                error = nil
            }
        } message: {
            if let error = error {
                Text(error)
            }
        }
    }
    
    private var keyboardToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                toolbarButton("⇥", label: "Tab") { sendKey("\t") }
                toolbarButton("⎋", label: "Esc") { sendKey("\u{1B}") }
                toolbarButton("⌃C", label: "Ctrl+C") { sendKey("\u{03}") }
                toolbarButton("⌃D", label: "Ctrl+D") { sendKey("\u{04}") }
                toolbarButton("⌃Z", label: "Ctrl+Z") { sendKey("\u{1A}") }
                toolbarButton("↑", label: "Up") { sendKey("\u{1B}[A") }
                toolbarButton("↓", label: "Down") { sendKey("\u{1B}[B") }
                toolbarButton("←", label: "Left") { sendKey("\u{1B}[D") }
                toolbarButton("→", label: "Right") { sendKey("\u{1B}[C") }
                toolbarButton("↵", label: "Enter") { sendKey("\r") }
                toolbarButton("⌫", label: "Delete") { sendKey("\u{7F}") }
            }
            .padding(.horizontal)
        }
        .frame(height: 44)
        .background(Color(.systemGray6))
    }
    
    private func toolbarButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol)
                .font(.system(size: 16, weight: .medium))
                .frame(minWidth: 36, minHeight: 32)
                .background(Color(.systemGray5))
                .cornerRadius(6)
        }
        .accessibilityLabel(label)
    }
    
    private func sendKey(_ key: String) {
        webSocketManager.sendTerminalInput(terminal.id, data: key)
    }
    
    private func connectToTerminal() {
        print("TerminalView: Connecting to terminal \(terminal.id)")
        
        // Attach to terminal via WebSocket, passing projectPath for Cursor IDE terminals
        // Note: These closures are stored in WebSocketManager, so we need to be careful
        // about strong captures. The closures update @State vars which are value types,
        // but the closure itself can keep the view context alive.
        // WebSocketManager.detachTerminal removes these handlers on disconnect.
        webSocketManager.attachTerminal(
            terminal.id,
            projectPath: project.path,
            onData: { [weak webSocketManager] data in
                // Check if we're still connected before updating
                guard webSocketManager != nil else { return }
                // Use Task to safely update @State on main actor
                Task { @MainActor in
                    terminalData = data
                }
            },
            onError: { [weak webSocketManager] errorMessage in
                guard webSocketManager != nil else { return }
                Task { @MainActor in
                    error = errorMessage
                }
            }
        )
        
        isConnected = true
    }
    
    private func disconnectFromTerminal() {
        print("TerminalView: Disconnecting from terminal \(terminal.id)")
        webSocketManager.detachTerminal(terminal.id)
        isConnected = false
    }
}

#Preview {
    NavigationStack {
        TerminalView(
            terminal: Terminal(
                id: "cursor-1",
                name: "zsh project",
                cwd: "/Users/test/project",
                pid: 12345,
                active: true,
                exitCode: nil,
                source: "cursor-ide",
                lastCommand: nil,
                activeCommand: "npm start",
                shell: "/bin/zsh",
                projectPath: "/Users/test/project",
                createdAt: Date().timeIntervalSince1970 * 1000,
                cols: 80,
                rows: 24,
                exitSignal: nil,
                exitedAt: nil,
                isHistory: false
            ),
            project: Project(
                id: "1",
                name: "Test Project",
                path: "/Users/test/project",
                lastOpened: Date()
            )
        )
        .environmentObject(WebSocketManager())
    }
}
