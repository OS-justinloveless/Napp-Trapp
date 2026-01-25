import SwiftUI

struct ConversationsView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedConversation: Conversation?
    
    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading conversations...")
                } else if let error = error {
                    ErrorView(message: error) {
                        loadConversations()
                    }
                } else if conversations.isEmpty {
                    EmptyStateView(
                        icon: "bubble.left.and.bubble.right",
                        title: "No Conversations",
                        message: "Your Cursor AI chat sessions will appear here"
                    )
                } else {
                    conversationsList
                }
            }
            .navigationTitle("Conversations")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        loadConversations()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .navigationDestination(item: $selectedConversation) { conversation in
                ConversationDetailView(conversation: conversation)
            }
        }
        .onAppear {
            if conversations.isEmpty {
                loadConversations()
            }
        }
    }
    
    private var conversationsList: some View {
        List {
            ForEach(conversations) { conversation in
                ConversationRow(conversation: conversation) {
                    selectedConversation = conversation
                }
            }
        }
        .refreshable {
            await refreshConversations()
        }
    }
    
    private func loadConversations() {
        isLoading = true
        error = nil
        
        Task {
            await refreshConversations()
            isLoading = false
        }
    }
    
    private func refreshConversations() async {
        guard let api = authManager.createAPIService() else {
            error = "Not authenticated"
            return
        }
        
        do {
            conversations = try await api.getConversations()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.title2)
                    .foregroundColor(.accentColor)
                    .frame(width: 40)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(displayName)
                        .font(.headline)
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    
                    Text(conversation.id)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                    
                    if let lastModified = conversation.lastModified {
                        Text(formatDate(lastModified))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
    
    private var displayName: String {
        let name = conversation.projectName
        
        // Clean up common path prefixes
        if let lastComponent = name.split(separator: "/").last {
            return String(lastComponent)
        }
        
        return name
    }
    
    private func formatDate(_ date: Date) -> String {
        let now = Date()
        let diff = now.timeIntervalSince(date)
        
        if diff < 60 {
            return "Just now"
        } else if diff < 3600 {
            return "\(Int(diff / 60))m ago"
        } else if diff < 86400 {
            return "\(Int(diff / 3600))h ago"
        } else if diff < 604800 {
            return "\(Int(diff / 86400))d ago"
        } else {
            let formatter = DateFormatter()
            formatter.dateStyle = .short
            return formatter.string(from: date)
        }
    }
}

struct ConversationDetailView: View {
    @EnvironmentObject var authManager: AuthManager
    
    let conversation: Conversation
    
    @State private var messages: [ConversationMessage] = []
    @State private var isLoading = true
    @State private var error: String?
    
    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading messages...")
            } else if let error = error {
                ErrorView(message: error) {
                    loadMessages()
                }
            } else if messages.isEmpty {
                EmptyStateView(
                    icon: "bubble.left",
                    title: "No Messages",
                    message: "Conversation messages could not be loaded"
                )
            } else {
                messagesList
            }
        }
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            loadMessages()
        }
    }
    
    private var messagesList: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(messages, id: \.messageId) { message in
                    MessageBubble(message: message)
                }
            }
            .padding()
        }
    }
    
    private func loadMessages() {
        isLoading = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                error = "Not authenticated"
                isLoading = false
                return
            }
            
            do {
                messages = try await api.getConversationMessages(id: conversation.id)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            
            isLoading = false
        }
    }
}

struct MessageBubble: View {
    let message: ConversationMessage
    
    var body: some View {
        HStack {
            if message.isAssistant {
                Spacer(minLength: 40)
            }
            
            VStack(alignment: message.isAssistant ? .trailing : .leading, spacing: 4) {
                // Role label
                Text(message.role?.capitalized ?? "Unknown")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                // Message content
                Text(message.content ?? "")
                    .font(.body)
                    .padding(12)
                    .background(message.isAssistant ? Color.accentColor : Color(.secondarySystemBackground))
                    .foregroundColor(message.isAssistant ? .white : .primary)
                    .cornerRadius(16)
            }
            
            if !message.isAssistant {
                Spacer(minLength: 40)
            }
        }
    }
}

extension Conversation: @retroactive Hashable {
    public static func == (lhs: Conversation, rhs: Conversation) -> Bool {
        lhs.id == rhs.id
    }
    
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

#Preview {
    ConversationsView()
        .environmentObject(AuthManager())
}
