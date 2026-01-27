import SwiftUI

struct ProjectFilesView: View {
    @EnvironmentObject var authManager: AuthManager
    
    let project: Project
    
    @State private var currentPath: String = ""
    @State private var items: [FileItem] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var pathHistory: [String] = []
    @State private var selectedFilePath: String?
    @State private var showNewFileSheet = false
    
    var body: some View {
        Group {
            if isLoading && items.isEmpty {
                ProgressView("Loading files...")
            } else if let error = error {
                ErrorView(message: error) {
                    loadDirectory()
                }
            } else if items.isEmpty {
                EmptyStateView(
                    icon: "folder",
                    title: "Empty Directory",
                    message: "No files or folders here"
                )
            } else {
                fileList
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showNewFileSheet = true
                    } label: {
                        Label("New File", systemImage: "doc.badge.plus")
                    }
                    
                    Button {
                        loadDirectory()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    
                    if !pathHistory.isEmpty {
                        Button {
                            goToProjectRoot()
                        } label: {
                            Label("Go to Project Root", systemImage: "house")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .onAppear {
            if currentPath.isEmpty {
                currentPath = project.path
                loadDirectory()
            }
        }
        .sheet(item: $selectedFilePath) { path in
            FileViewerSheet(filePath: path)
        }
        .sheet(isPresented: $showNewFileSheet) {
            NewFileSheet(basePath: currentPath) { fileName, content in
                await createFile(name: fileName, content: content)
            }
        }
    }
    
    private var currentPathName: String {
        // Show relative path within project
        if currentPath == project.path {
            return project.name
        }
        
        if currentPath.hasPrefix(project.path) {
            let relativePath = String(currentPath.dropFirst(project.path.count))
            return relativePath.hasPrefix("/") ? String(relativePath.dropFirst()) : relativePath
        }
        
        return (currentPath as NSString).lastPathComponent
    }
    
    private var fileList: some View {
        List {
            // Show current relative path
            if currentPath != project.path {
                Section {
                    HStack {
                        Button {
                            goBack()
                        } label: {
                            HStack {
                                Image(systemName: "chevron.left")
                                Text("Back")
                            }
                        }
                        
                        Spacer()
                        
                        Text(currentPathName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            
            Section {
                ForEach(items) { item in
                    FileItemRow(item: item) {
                        if item.isDirectory {
                            navigateToDirectory(item.path)
                        } else {
                            selectedFilePath = item.path
                        }
                    }
                }
            }
        }
        .refreshable {
            await refreshDirectory()
        }
    }
    
    private func loadDirectory() {
        isLoading = true
        error = nil
        
        Task {
            await refreshDirectory()
            isLoading = false
        }
    }
    
    private func refreshDirectory() async {
        guard let api = authManager.createAPIService() else {
            error = "Not authenticated"
            return
        }
        
        do {
            items = try await api.listDirectory(path: currentPath)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
    
    private func navigateToDirectory(_ path: String) {
        // Only allow navigation within project path
        guard path.hasPrefix(project.path) else {
            error = "Cannot navigate outside project directory"
            return
        }
        
        pathHistory.append(currentPath)
        currentPath = path
        loadDirectory()
    }
    
    private func goBack() {
        guard let previousPath = pathHistory.popLast() else { return }
        currentPath = previousPath
        loadDirectory()
    }
    
    private func goToProjectRoot() {
        pathHistory.removeAll()
        currentPath = project.path
        loadDirectory()
    }
    
    private func createFile(name: String, content: String) async {
        guard let api = authManager.createAPIService() else { return }
        
        let filePath = (currentPath as NSString).appendingPathComponent(name)
        
        do {
            _ = try await api.createFile(path: filePath, content: content)
            await refreshDirectory()
            showNewFileSheet = false
        } catch {
            self.error = error.localizedDescription
        }
    }
}

#Preview {
    NavigationStack {
        ProjectFilesView(project: Project(id: "test", name: "Test Project", path: "/path/to/project"))
    }
    .environmentObject(AuthManager())
}
