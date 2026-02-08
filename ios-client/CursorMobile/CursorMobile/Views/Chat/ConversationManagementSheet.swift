import SwiftUI

/// Sheet for managing a conversation (delete, clone, view info)
struct ConversationManagementSheet: View {
    let chat: ChatWindow
    let project: Project

    @EnvironmentObject var chatManager: ChatManager
    @Environment(\.dismiss) var dismiss

    @State private var showDeleteConfirmation = false
    @State private var isCloning = false
    @State private var isDeleting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                // Chat Info Section
                Section {
                    LabeledContent("Agent", value: chat.toolEnum?.displayName ?? chat.tool)

                    LabeledContent("Topic", value: chat.displayTitle)

                    if let timestamp = chat.timestamp {
                        LabeledContent("Created") {
                            Text(formatDate(timestamp))
                        }
                    }

                    LabeledContent("Status") {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(chat.isActive ? Color.green : Color.gray)
                                .frame(width: 8, height: 8)
                            Text(chat.isActive ? "Active" : "Inactive")
                        }
                    }
                } header: {
                    Text("Chat Info")
                }

                // Actions Section
                Section {
                    // Clone button (disabled until server endpoint is implemented)
                    Button {
                        cloneChat()
                    } label: {
                        HStack {
                            if isCloning {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Cloning...")
                            } else {
                                Label("Clone with History", systemImage: "doc.on.doc")
                            }
                        }
                    }
                    .disabled(isCloning || isDeleting)

                    // Delete button
                    Button(role: .destructive) {
                        showDeleteConfirmation = true
                    } label: {
                        HStack {
                            if isDeleting {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Deleting...")
                                    .foregroundColor(.red)
                            } else {
                                Label("Delete Chat", systemImage: "trash")
                            }
                        }
                    }
                    .disabled(isCloning || isDeleting)
                } header: {
                    Text("Actions")
                }

                // Error display
                if let error = error {
                    Section {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .foregroundColor(.red)
                        }
                    }
                }
            }
            .navigationTitle("Manage Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .confirmationDialog(
                "Delete Chat?",
                isPresented: $showDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    deleteChat()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete this chat and its history. This cannot be undone.")
            }
        }
    }

    // MARK: - Helpers

    private func formatDate(_ timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000.0)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    // MARK: - Actions

    private func cloneChat() {
        isCloning = true
        error = nil

        Task {
            do {
                _ = try await chatManager.forkChat(
                    chat.effectiveTerminalId,
                    projectPath: project.path
                )
                await MainActor.run {
                    isCloning = false
                    // TODO: Navigate to new chat
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    self.error = "Clone not yet supported. Server endpoint required."
                    isCloning = false
                }
            }
        }
    }

    private func deleteChat() {
        isDeleting = true
        error = nil

        Task {
            do {
                try await chatManager.deleteChat(
                    terminalId: chat.effectiveTerminalId,
                    projectPath: project.path
                )
                await MainActor.run {
                    isDeleting = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    self.error = "Failed to delete: \(error.localizedDescription)"
                    isDeleting = false
                }
            }
        }
    }
}

#Preview {
    ConversationManagementSheet(
        chat: ChatWindow(
            id: "test-123",
            windowName: "chat-test",
            tool: "claude",
            sessionName: "test-session",
            windowIndex: 0,
            projectPath: "/test/path",
            active: true,
            terminalId: "test-123",
            topic: "Test Chat",
            title: "Test Chat",
            timestamp: Date().timeIntervalSince1970 * 1000,
            createdAt: nil,
            status: nil
        ),
        project: Project(
            id: "test",
            name: "Test Project",
            path: "/test/path",
            lastOpened: Date()
        )
    )
    .environmentObject(ChatManager())
}
