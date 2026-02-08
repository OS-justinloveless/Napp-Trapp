import SwiftUI

/// Message input bar with text input, mode picker, model picker, and send button
struct ChatInputBar: View {
    @Binding var text: String
    @Binding var selectedMode: ChatMode
    @Binding var selectedModel: AIModel?
    let availableModels: [AIModel]
    let defaultModel: AIModel?
    let isStreaming: Bool
    let onSend: () -> Void
    let onCancel: () -> Void
    let projectId: String

    @EnvironmentObject var chatManager: ChatManager

    @State private var showAutocomplete = false
    @State private var autocompleteTrigger: AutocompleteTrigger?
    @State private var autocompleteQuery = ""
    @State private var suggestions: [Suggestion] = []

    @FocusState private var isTextFieldFocused: Bool

    enum AutocompleteTrigger {
        case at      // @ for context (files, rules, agents)
        case slash   // / for commands
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            // Autocomplete overlay
            if showAutocomplete && !suggestions.isEmpty {
                autocompleteOverlay
            }

            // Mode picker
            ChatModePickerView(selectedMode: $selectedMode)
                .padding(.horizontal)
                .padding(.top, 8)

            // Model selector dropdown (separate row to avoid segmented control stealing touches)
            HStack {
                Menu {
                    ForEach(availableModels) { model in
                        Button {
                            selectedModel = model
                        } label: {
                            HStack {
                                Text(model.name)
                                if selectedModel?.id == model.id || (selectedModel == nil && model.isDefault) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "cpu")
                            .font(.caption2)
                        Text(selectedModel?.name ?? defaultModel?.name ?? "Model")
                            .font(.caption)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color(.systemGray5))
                    .cornerRadius(6)
                }

                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 4)

            // Input area
            HStack(alignment: .bottom, spacing: 12) {
                // Text input
                TextField("Message...", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .padding(12)
                    .background(Color(.systemGray6))
                    .cornerRadius(20)
                    .focused($isTextFieldFocused)
                    .onChange(of: text) { _, newValue in
                        detectTrigger(in: newValue)
                    }

                // Send/Cancel button
                Button {
                    if isStreaming {
                        onCancel()
                    } else {
                        isTextFieldFocused = false
                        onSend()
                    }
                } label: {
                    Image(systemName: isStreaming ? "stop.fill" : "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundColor(isStreaming ? .red : (text.isEmpty ? .secondary : .accentColor))
                }
                .disabled(!isStreaming && text.isEmpty)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .background(Color(.systemBackground))
        }
    }

    // MARK: - Autocomplete

    @ViewBuilder
    private var autocompleteOverlay: some View {
        let bgColor = Color(.systemBackground)

        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(suggestions) { suggestion in
                        SuggestionRowView(
                            suggestion: suggestion,
                            color: suggestionColor(for: suggestion),
                            onSelect: { selectSuggestion(suggestion) }
                        )
                    }
                }
            }
            .frame(maxHeight: 200)
            .background(bgColor)
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.1), radius: 8, y: -4)
        }
        .padding(.horizontal)
    }

    private func suggestionColor(for suggestion: Suggestion) -> Color {
        switch suggestion.type {
        case .file: return .blue
        case .rule: return .green
        case .command: return .purple
        case .agent: return .orange
        case .skill: return .cyan
        }
    }

    // MARK: - Trigger Detection

    private func detectTrigger(in text: String) {
        let currentWord = getCurrentWord(from: text)

        if currentWord.hasPrefix("@") {
            autocompleteTrigger = .at
            autocompleteQuery = String(currentWord.dropFirst())
            showAutocomplete = true
            fetchSuggestions(type: nil)
        } else if currentWord.hasPrefix("/") {
            autocompleteTrigger = .slash
            autocompleteQuery = String(currentWord.dropFirst())
            showAutocomplete = true
            fetchSuggestions(type: "command")
        } else {
            showAutocomplete = false
            autocompleteTrigger = nil
        }
    }

    private func getCurrentWord(from text: String) -> String {
        let words = text.components(separatedBy: .whitespacesAndNewlines)
        return words.last ?? ""
    }

    private func fetchSuggestions(type: String?) {
        Task {
            do {
                let results = try await chatManager.getSuggestions(
                    projectId: projectId,
                    type: type,
                    query: autocompleteQuery.isEmpty ? nil : autocompleteQuery
                )
                await MainActor.run {
                    self.suggestions = results
                }
            } catch {
                print("[ChatInputBar] Failed to fetch suggestions: \(error)")
            }
        }
    }

    private func selectSuggestion(_ suggestion: Suggestion) {
        let trigger = autocompleteTrigger == .at ? "@" : "/"

        if let range = text.range(of: trigger + autocompleteQuery, options: .backwards) {
            text.replaceSubrange(range, with: suggestion.insertText)
        }

        showAutocomplete = false
        autocompleteTrigger = nil
    }
}

// MARK: - Suggestion Row View

private struct SuggestionRowView: View {
    let suggestion: Suggestion
    let color: Color
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: suggestion.icon)
                    .font(.body)
                    .foregroundColor(color)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(suggestion.name)
                        .font(.body)
                        .foregroundColor(.primary)

                    if let subtitle = suggestion.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(.systemBackground))
        }
        .buttonStyle(.plain)

        Divider()
            .padding(.leading, 52)
    }
}

#Preview {
    VStack {
        Spacer()
        ChatInputBar(
            text: .constant("Hello, how can I help?"),
            selectedMode: .constant(.agent),
            selectedModel: .constant(nil),
            availableModels: [
                AIModel(id: "sonnet-4.5", name: "Claude 4.5 Sonnet", isDefault: true, isCurrent: true),
                AIModel(id: "opus-4", name: "Claude 4 Opus", isDefault: false, isCurrent: false)
            ],
            defaultModel: AIModel(id: "sonnet-4.5", name: "Claude 4.5 Sonnet", isDefault: true, isCurrent: true),
            isStreaming: false,
            onSend: {},
            onCancel: {},
            projectId: "test"
        )
        .environmentObject(ChatManager())
    }
}
