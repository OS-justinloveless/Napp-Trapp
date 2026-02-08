import SwiftUI

/// Mode switcher (Plan/Ask/Agent) for chat input
struct ChatModePickerView: View {
    @Binding var selectedMode: ChatMode

    var body: some View {
        Picker("Mode", selection: $selectedMode) {
            ForEach(ChatMode.allCases) { mode in
                Label(mode.displayName, systemImage: modeIcon(for: mode))
                    .tag(mode)
            }
        }
        .pickerStyle(.segmented)
    }

    private func modeIcon(for mode: ChatMode) -> String {
        switch mode {
        case .agent: return "cpu"
        case .plan: return "list.bullet.clipboard"
        case .ask: return "questionmark.circle"
        }
    }
}

// MARK: - Chat Model Picker

/// Model selection dropdown for chat
struct ChatModelPickerView: View {
    @Binding var selectedModel: AIModel?
    let availableModels: [AIModel]

    var body: some View {
        Menu {
            ForEach(availableModels) { model in
                Button {
                    selectedModel = model
                } label: {
                    HStack {
                        Text(model.name)
                        if selectedModel?.id == model.id {
                            Image(systemName: "checkmark")
                        } else if selectedModel == nil && model.isDefault {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(selectedModel?.name ?? "Model")
                    .font(.caption)
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color(.systemGray5))
            .cornerRadius(6)
        }
    }
}

// MARK: - Agent Selector View

/// Agent picker with availability status (for NewChatSheet only)
struct AgentSelectorView: View {
    @Binding var selectedAgent: Agent?
    let availableAgents: [Agent]

    var body: some View {
        Menu {
            ForEach(availableAgents) { agent in
                Button {
                    if agent.available {
                        selectedAgent = agent
                    }
                } label: {
                    HStack {
                        Image(systemName: agent.icon)
                            .foregroundColor(agent.color)

                        Text(agent.displayName)

                        Spacer()

                        if !agent.available {
                            Text("Not installed")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        if selectedAgent?.id == agent.id {
                            Image(systemName: "checkmark")
                        }
                    }
                }
                .disabled(!agent.available)
            }
        } label: {
            HStack(spacing: 6) {
                if let agent = selectedAgent {
                    Image(systemName: agent.icon)
                        .foregroundColor(agent.color)
                    Text(agent.displayName)
                        .font(.subheadline.weight(.medium))
                } else {
                    Image(systemName: "cpu")
                    Text("Select Agent")
                }
                Image(systemName: "chevron.down")
                    .font(.caption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemGray5))
            .cornerRadius(8)
        }
    }
}

#Preview("Mode Picker") {
    VStack {
        ChatModePickerView(selectedMode: .constant(.agent))
            .padding()
    }
}

#Preview("Model Picker") {
    VStack {
        ChatModelPickerView(
            selectedModel: .constant(nil),
            availableModels: [
                AIModel(id: "sonnet-4.5", name: "Claude 4.5 Sonnet", isDefault: true, isCurrent: true),
                AIModel(id: "opus-4", name: "Claude 4 Opus", isDefault: false, isCurrent: false)
            ]
        )
        .padding()
    }
}

#Preview("Agent Selector") {
    VStack {
        AgentSelectorView(
            selectedAgent: .constant(nil),
            availableAgents: [
                Agent(id: "claude", displayName: "Claude Code", available: true, installInstructions: nil, capabilities: nil),
                Agent(id: "cursor-agent", displayName: "Cursor Agent", available: true, installInstructions: nil, capabilities: nil),
                Agent(id: "gemini", displayName: "Google Gemini", available: false, installInstructions: "npm install -g @google/gemini-cli", capabilities: nil)
            ]
        )
        .padding()
    }
}
