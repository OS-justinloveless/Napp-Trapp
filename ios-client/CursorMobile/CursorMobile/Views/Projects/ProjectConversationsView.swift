import SwiftUI

struct ProjectConversationsView: View {
    @EnvironmentObject var authManager: AuthManager
    
    let project: Project
    
    @State private var conversations: [Conversation] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedConversation: Conversation?
    @State private var isCreatingChat = false
    @State private var newChatId: String?
    @State private var searchText = ""
    @State private var hideReadOnly = false
    
    /// Conversations filtered to exclude empty ones (0 messages) and apply search/filter
    private var filteredConversations: [Conversation] {
        var result = conversations.filter { $0.messageCount > 0 }
        
        // Filter out read-only if enabled
        if hideReadOnly {
            result = result.filter { !$0.isReadOnlyConversation }
        }
        
        // Filter by search text
        if !searchText.isEmpty {
            let lowercasedSearch = searchText.lowercased()
            result = result.filter { conversation in
                // Search in title
                if conversation.title.lowercased().contains(lowercasedSearch) {
                    return true
                }
                // Search in project name
                if let projectName = conversation.projectName,
                   projectName.lowercased().contains(lowercasedSearch) {
                    return true
                }
                // Search in type
                if conversation.type.lowercased().contains(lowercasedSearch) {
                    return true
                }
                return false
            }
        }
        
        return result
    }
    
    /// Non-empty conversations count (before search/filter)
    private var totalNonEmptyCount: Int {
        conversations.filter { $0.messageCount > 0 }.count
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            searchBar
            
            // Content
            if isLoading {
                Spacer()
                ProgressView("Loading conversations...")
                Spacer()
            } else if let error = error {
                Spacer()
                ErrorView(message: error) {
                    loadConversations()
                }
                Spacer()
            } else if totalNonEmptyCount == 0 {
                // No conversations at all
                emptyStateWithNewChat
            } else if filteredConversations.isEmpty {
                // Have conversations but filter/search yields no results
                filteredEmptyState
            } else {
                conversationsList
            }
        }
        .navigationDestination(item: $selectedConversation) { conversation in
            ConversationDetailView(conversation: conversation)
        }
        .navigationDestination(item: $newChatId) { chatId in
            // Navigate to the new chat using a temporary Conversation object
            // New chats from mobile are editable (not read-only)
            ConversationDetailView(conversation: Conversation(
                id: chatId,
                type: "chat",
                title: "New Chat",
                timestamp: Date().timeIntervalSince1970 * 1000,
                messageCount: 0,
                workspaceId: project.id,
                source: "mobile",
                projectName: project.name,
                workspaceFolder: project.path,
                isProjectChat: true,
                isReadOnly: false,
                readOnlyReason: nil,
                canFork: false
            ))
        }
        .onAppear {
            if conversations.isEmpty {
                loadConversations()
            }
        }
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            conversations = []
            selectedConversation = nil
            newChatId = nil
            isLoading = true
            error = nil
            searchText = ""
            loadConversations()
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    Button {
                        createNewChat()
                    } label: {
                        if isCreatingChat {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                        } else {
                            Image(systemName: "plus.bubble")
                        }
                    }
                    .disabled(isCreatingChat)
                    
                    Button {
                        loadConversations()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }
    
    private var searchBar: some View {
        HStack(spacing: 8) {
            // Filter button
            Menu {
                Toggle(isOn: $hideReadOnly) {
                    Label("Hide Read-Only", systemImage: hideReadOnly ? "eye.slash.fill" : "eye.slash")
                }
            } label: {
                Image(systemName: hideReadOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .font(.system(size: 20))
                    .foregroundColor(hideReadOnly ? .accentColor : .secondary)
                    .frame(width: 36, height: 36)
            }
            
            // Search field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                
                TextField("Search conversations...", text: $searchText)
                    .textFieldStyle(.plain)
                
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
    
    private var filteredEmptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            
            Image(systemName: "magnifyingglass")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            
            Text("No Results")
                .font(.title2)
                .fontWeight(.semibold)
            
            Text(hideReadOnly 
                ? "No editable conversations match your search. Try adjusting the filter."
                : "No conversations match your search.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            if hideReadOnly {
                Button {
                    hideReadOnly = false
                } label: {
                    Text("Show All Conversations")
                        .font(.subheadline)
                }
            }
            
            Spacer()
        }
        .padding()
    }
    
    private var emptyStateWithNewChat: some View {
        VStack(spacing: 20) {
            EmptyStateView(
                icon: "bubble.left.and.bubble.right",
                title: "No Conversations",
                message: "Start a new AI chat session for this project"
            )
            
            Button {
                createNewChat()
            } label: {
                HStack {
                    if isCreatingChat {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                            .tint(.white)
                    } else {
                        Image(systemName: "plus.bubble.fill")
                    }
                    Text("New Chat")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(Color.accentColor)
                .cornerRadius(12)
            }
            .disabled(isCreatingChat)
        }
    }
    
    private var conversationsList: some View {
        List {
            // Show filter status if active
            if hideReadOnly || !searchText.isEmpty {
                HStack {
                    Text("Showing \(filteredConversations.count) of \(totalNonEmptyCount)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Spacer()
                    
                    if hideReadOnly {
                        Text("Editable only")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.accentColor.opacity(0.2))
                            .foregroundColor(.accentColor)
                            .cornerRadius(4)
                    }
                }
                .listRowBackground(Color.clear)
            }
            
            ForEach(filteredConversations) { conversation in
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
        // Try to load from cache first
        if let cached = CacheManager.shared.loadProjectConversations(projectId: project.id) {
            conversations = cached.data
            isLoading = false
            error = nil
            print("[ProjectConversationsView] Loaded \(conversations.count) conversations from cache")
        } else {
            isLoading = true
        }
        
        error = nil
        
        // Fetch fresh data in the background
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
            let freshConversations = try await api.getProjectConversations(projectId: project.id)
            conversations = freshConversations
            error = nil
            
            // Save to cache
            CacheManager.shared.saveProjectConversations(freshConversations, projectId: project.id)
            print("[ProjectConversationsView] Fetched and cached \(freshConversations.count) conversations")
        } catch {
            // Only show error if we don't have cached data
            if conversations.isEmpty {
                self.error = error.localizedDescription
            } else {
                print("[ProjectConversationsView] Failed to refresh conversations, using cached data: \(error)")
            }
        }
    }
    
    private func createNewChat() {
        isCreatingChat = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                await MainActor.run {
                    error = "Not authenticated"
                    isCreatingChat = false
                }
                return
            }
            
            do {
                let chatId = try await api.createConversation(workspaceId: project.id)
                await MainActor.run {
                    isCreatingChat = false
                    // Navigate to the new chat
                    newChatId = chatId
                }
            } catch {
                await MainActor.run {
                    self.error = "Failed to create chat: \(error.localizedDescription)"
                    isCreatingChat = false
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ProjectConversationsView(project: Project(id: "test", name: "Test Project", path: "/path/to/project"))
    }
    .environmentObject(AuthManager())
}
