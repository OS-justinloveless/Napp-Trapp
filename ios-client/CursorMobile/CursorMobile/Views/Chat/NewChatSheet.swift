import SwiftUI

/// Sheet for creating a new chat with agent/model/mode selection
struct NewChatSheet: View {
    let project: Project
    let onChatCreated: (ChatWindow, String?) -> Void

    @EnvironmentObject var chatManager: ChatManager
    @Environment(\.dismiss) var dismiss

    @State private var selectedAgent: Agent?
    @State private var selectedModel: AIModel?
    @State private var selectedMode: ChatMode = .agent
    @State private var selectedPermissionMode: PermissionMode = .defaultMode
    @State private var topic = ""
    @State private var initialPrompt = ""

    @State private var isCreating = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                // Agent Selection
                Section {
                    if chatManager.isLoadingAgents {
                        HStack {
                            ProgressView()
                                .controlSize(.small)
                            Text("Loading agents...")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        agentPicker
                    }
                } header: {
                    Text("Agent")
                } footer: {
                    if let agent = selectedAgent, !agent.available {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                            Text(agent.installInstructions ?? "Agent not installed on server")
                                .foregroundColor(.secondary)
                        }
                        .font(.caption)
                    } else {
                        Text("Select which AI agent to use. This cannot be changed after chat creation.")
                    }
                }

                // Model Selection
                Section {
                    modelPicker
                } header: {
                    Text("Model")
                } footer: {
                    Text("Choose the AI model. You can change this during the conversation.")
                }

                // Mode Selection
                Section {
                    ChatModePickerView(selectedMode: $selectedMode)
                } header: {
                    Text("Mode")
                } footer: {
                    Text(selectedMode.description)
                }

                // Permission Mode Selection
                Section {
                    permissionModePicker
                } header: {
                    Text("Permissions")
                } footer: {
                    HStack(spacing: 4) {
                        if selectedPermissionMode == .bypassPermissions {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                        }
                        Text(selectedPermissionMode.description)
                            .foregroundColor(selectedPermissionMode == .bypassPermissions ? .orange : .secondary)
                    }
                    .font(.caption)
                }

                // Optional Topic
                Section {
                    TextField("Chat topic (optional)", text: $topic)
                } header: {
                    Text("Topic")
                } footer: {
                    Text("Give your chat a name to help identify it later.")
                }

                // Initial Prompt
                Section {
                    TextEditor(text: $initialPrompt)
                        .frame(minHeight: 80)
                } header: {
                    Text("Initial Message (Optional)")
                } footer: {
                    Text("Start the conversation with a message. Leave empty to start fresh.")
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
            .navigationTitle("New Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        createChat()
                    } label: {
                        if isCreating {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(isCreating || selectedAgent == nil || !selectedAgent!.available)
                }
            }
            .onAppear {
                // Set defaults
                if selectedAgent == nil {
                    selectedAgent = chatManager.defaultAgent
                }
                if selectedModel == nil {
                    selectedModel = chatManager.defaultModel
                }
            }
        }
    }

    // MARK: - Agent Picker

    private var agentPicker: some View {
        ForEach(chatManager.agents) { agent in
            Button {
                if agent.available {
                    selectedAgent = agent
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: agent.icon)
                        .font(.title2)
                        .foregroundColor(agent.available ? agent.color : .secondary)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(agent.displayName)
                            .foregroundColor(agent.available ? .primary : .secondary)

                        if !agent.available {
                            Text("Not installed")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }
                    }

                    Spacer()

                    if selectedAgent?.id == agent.id {
                        Image(systemName: "checkmark")
                            .foregroundColor(.accentColor)
                    }
                }
            }
            .disabled(!agent.available)
        }
    }

    // MARK: - Permission Mode Picker

    private var permissionModePicker: some View {
        ForEach(PermissionMode.allCases) { mode in
            Button {
                selectedPermissionMode = mode
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: mode.icon)
                        .font(.title2)
                        .foregroundColor(mode.color)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(mode.displayName)
                            .foregroundColor(.primary)
                    }

                    Spacer()

                    if selectedPermissionMode == mode {
                        Image(systemName: "checkmark")
                            .foregroundColor(.accentColor)
                    }
                }
            }
        }
    }

    // MARK: - Model Picker

    private var modelPicker: some View {
        ForEach(chatManager.models) { model in
            Button {
                selectedModel = model
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.name)
                            .foregroundColor(.primary)

                        if model.isDefault {
                            Text("Default")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    Spacer()

                    if selectedModel?.id == model.id {
                        Image(systemName: "checkmark")
                            .foregroundColor(.accentColor)
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func createChat() {
        guard let agent = selectedAgent, agent.available else {
            error = "Please select an available agent"
            return
        }

        isCreating = true
        error = nil

        Task {
            do {
                let chat = try await chatManager.createChat(
                    projectId: project.id,
                    projectPath: project.path,
                    tool: agent.id,
                    topic: topic.isEmpty ? nil : topic,
                    model: selectedModel?.id,
                    mode: selectedMode,
                    permissionMode: selectedPermissionMode,
                    initialPrompt: initialPrompt.isEmpty ? nil : initialPrompt
                )

                await MainActor.run {
                    isCreating = false
                    onChatCreated(chat, initialPrompt.isEmpty ? nil : initialPrompt)
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    self.error = "Failed to create chat: \(error.localizedDescription)"
                    isCreating = false
                }
            }
        }
    }
}

#Preview {
    NewChatSheet(
        project: Project(
            id: "test",
            name: "Test Project",
            path: "/test/path",
            lastOpened: Date()
        ),
        onChatCreated: { _, _ in }
    )
    .environmentObject(ChatManager())
}
