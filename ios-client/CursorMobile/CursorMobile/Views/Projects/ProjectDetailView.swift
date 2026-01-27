import SwiftUI

struct ProjectDetailView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    let project: Project
    
    @State private var selectedSection: ProjectSection = .files
    
    enum ProjectSection: String, CaseIterable {
        case files = "Files"
        case terminals = "Terminals"
        case chat = "Chat"
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Segmented control for section selection
            Picker("Section", selection: $selectedSection) {
                ForEach(ProjectSection.allCases, id: \.self) { section in
                    Text(section.rawValue).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .padding()
            
            // Content based on selected section
            switch selectedSection {
            case .files:
                ProjectFilesView(project: project)
            case .terminals:
                TerminalListView(project: project)
            case .chat:
                ProjectConversationsView(project: project)
            }
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    openInCursor()
                } label: {
                    Label("Open in Cursor", systemImage: "arrow.up.forward.app")
                }
            }
        }
        .onAppear {
            webSocketManager.watchPath(project.path)
        }
        .onDisappear {
            webSocketManager.unwatchPath(project.path)
        }
    }
    
    private func openInCursor() {
        Task {
            guard let api = authManager.createAPIService() else { return }
            do {
                try await api.openProject(id: project.id)
            } catch {
                print("Error opening project in Cursor: \(error)")
            }
        }
    }
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}

#Preview {
    NavigationStack {
        ProjectDetailView(project: Project(id: "test", name: "Test Project", path: "/path/to/project"))
    }
    .environmentObject(AuthManager())
    .environmentObject(WebSocketManager())
}
