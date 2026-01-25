import SwiftUI

struct ProjectDetailView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var webSocketManager: WebSocketManager
    
    let project: Project
    
    @State private var fileTree: [FileTreeItem] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var expandedFolders: Set<String> = []
    @State private var selectedFilePath: String?
    
    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading project...")
            } else if let error = error {
                ErrorView(message: error) {
                    loadProject()
                }
            } else if fileTree.isEmpty {
                EmptyStateView(
                    icon: "folder",
                    title: "Empty Project",
                    message: "No files found in this project"
                )
            } else {
                fileTreeList
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
            loadProject()
            webSocketManager.watchPath(project.path)
        }
        .onDisappear {
            webSocketManager.unwatchPath(project.path)
        }
        .sheet(item: $selectedFilePath) { path in
            FileViewerSheet(filePath: path)
        }
    }
    
    private var fileTreeList: some View {
        List {
            ForEach(fileTree) { item in
                FileTreeRow(
                    item: item,
                    expandedFolders: $expandedFolders,
                    onFileSelect: { path in
                        selectedFilePath = path
                    }
                )
            }
        }
        .refreshable {
            await refreshProject()
        }
    }
    
    private func loadProject() {
        isLoading = true
        error = nil
        
        Task {
            await refreshProject()
            isLoading = false
        }
    }
    
    private func refreshProject() async {
        guard let api = authManager.createAPIService() else {
            error = "Not authenticated"
            return
        }
        
        do {
            fileTree = try await api.getProjectTree(id: project.id, depth: 4)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
    
    private func openInCursor() {
        Task {
            guard let api = authManager.createAPIService() else { return }
            do {
                try await api.openProject(id: project.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

struct FileTreeRow: View {
    let item: FileTreeItem
    @Binding var expandedFolders: Set<String>
    let onFileSelect: (String) -> Void
    let depth: Int
    
    init(
        item: FileTreeItem,
        expandedFolders: Binding<Set<String>>,
        onFileSelect: @escaping (String) -> Void,
        depth: Int = 0
    ) {
        self.item = item
        self._expandedFolders = expandedFolders
        self.onFileSelect = onFileSelect
        self.depth = depth
    }
    
    private var isExpanded: Bool {
        expandedFolders.contains(item.path)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if item.isDirectory {
                    toggleExpanded()
                } else {
                    onFileSelect(item.path)
                }
            } label: {
                HStack(spacing: 8) {
                    if item.isDirectory {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 16)
                    } else {
                        Spacer()
                            .frame(width: 16)
                    }
                    
                    Image(systemName: item.isDirectory ? (isExpanded ? "folder.fill" : "folder") : fileIcon)
                        .foregroundColor(item.isDirectory ? .accentColor : .secondary)
                    
                    Text(item.name)
                        .foregroundColor(.primary)
                    
                    Spacer()
                }
                .padding(.leading, CGFloat(depth) * 16)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            
            if item.isDirectory && isExpanded, let children = item.children {
                ForEach(children) { child in
                    FileTreeRow(
                        item: child,
                        expandedFolders: $expandedFolders,
                        onFileSelect: onFileSelect,
                        depth: depth + 1
                    )
                }
            }
        }
    }
    
    private func toggleExpanded() {
        if expandedFolders.contains(item.path) {
            expandedFolders.remove(item.path)
        } else {
            expandedFolders.insert(item.path)
        }
    }
    
    private var fileIcon: String {
        let ext = (item.name as NSString).pathExtension.lowercased()
        
        switch ext {
        case "swift":
            return "swift"
        case "js", "jsx", "ts", "tsx":
            return "chevron.left.forwardslash.chevron.right"
        case "py":
            return "chevron.left.forwardslash.chevron.right"
        case "json":
            return "curlybraces"
        case "md", "txt":
            return "doc.text"
        case "html", "css":
            return "globe"
        case "png", "jpg", "jpeg", "gif", "svg":
            return "photo"
        default:
            return "doc"
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
