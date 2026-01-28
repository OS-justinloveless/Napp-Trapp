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
    @State private var selectedItem: FileItem?
    @State private var showNewFileSheet = false
    @State private var itemToRename: FileItem?
    @State private var itemToMove: FileItem?
    @State private var itemToDelete: FileItem?
    @State private var showDeleteAlert = false
    @State private var operationError: String?
    
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
        .onChange(of: project.id) { _, _ in
            // Reset state when project changes
            currentPath = project.path
            pathHistory = []
            items = []
            isLoading = true
            error = nil
            loadDirectory()
        }
        .sheet(item: $selectedFilePath) { path in
            FileViewerSheet(filePath: path)
        }
        .sheet(isPresented: $showNewFileSheet) {
            NewFileSheet(basePath: currentPath) { fileName, content in
                await createFile(name: fileName, content: content)
            }
        }
        .sheet(item: $itemToRename) { item in
            RenameSheet(item: item) { newName in
                await renameItem(item: item, newName: newName)
            }
        }
        .sheet(item: $itemToMove) { item in
            MoveSheet(item: item, currentPath: currentPath, allItems: items) { destinationPath in
                await moveItem(item: item, destinationPath: destinationPath)
            }
        }
        .alert("Delete \(itemToDelete?.name ?? "item")?", isPresented: $showDeleteAlert) {
            Button("Cancel", role: .cancel) { 
                itemToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let item = itemToDelete {
                    Task {
                        await deleteItem(item)
                    }
                }
            }
        } message: {
            Text("This action cannot be undone.")
        }
        .alert("Operation Failed", isPresented: .init(
            get: { operationError != nil },
            set: { if !$0 { operationError = nil } }
        )) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(operationError ?? "Unknown error")
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
        List(selection: $selectedItem) {
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
                    FileItemRow(item: item)
                        .tag(item)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                itemToDelete = item
                                showDeleteAlert = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                itemToRename = item
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            .tint(.orange)
                            
                            Button {
                                itemToMove = item
                            } label: {
                                Label("Move", systemImage: "folder")
                            }
                            .tint(.blue)
                        }
                }
            }
        }
        .onChange(of: selectedItem) { _, newValue in
            if let item = newValue {
                selectedItem = nil  // Reset selection
                if item.isDirectory {
                    navigateToDirectory(item.path)
                } else {
                    selectedFilePath = item.path
                }
            }
        }
        .refreshable {
            await refreshDirectory()
        }
    }
    
    private func loadDirectory() {
        // Try to load from cache first
        if let cached = CacheManager.shared.loadDirectory(path: currentPath) {
            items = cached.data
            isLoading = false
            error = nil
            print("[ProjectFilesView] Loaded \(items.count) items from cache")
        } else {
            isLoading = true
        }
        
        error = nil
        
        // Fetch fresh data in the background
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
            let freshItems = try await api.listDirectory(path: currentPath)
            items = freshItems
            error = nil
            
            // Save to cache
            CacheManager.shared.saveDirectory(freshItems, path: currentPath)
            print("[ProjectFilesView] Fetched and cached \(freshItems.count) items")
        } catch {
            // Only show error if we don't have cached data
            if items.isEmpty {
                self.error = error.localizedDescription
            } else {
                print("[ProjectFilesView] Failed to refresh directory, using cached data: \(error)")
            }
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
    
    private func renameItem(item: FileItem, newName: String) async {
        guard let api = authManager.createAPIService() else { 
            itemToRename = nil
            operationError = "Not authenticated"
            return 
        }
        
        do {
            _ = try await api.renameFile(oldPath: item.path, newName: newName)
            itemToRename = nil
            await refreshDirectory()
        } catch {
            itemToRename = nil
            operationError = "Failed to rename: \(error.localizedDescription)"
        }
    }
    
    private func moveItem(item: FileItem, destinationPath: String) async {
        guard let api = authManager.createAPIService() else { 
            itemToMove = nil
            operationError = "Not authenticated"
            return 
        }
        
        do {
            _ = try await api.moveFile(sourcePath: item.path, destinationPath: destinationPath)
            itemToMove = nil
            await refreshDirectory()
        } catch {
            itemToMove = nil
            operationError = "Failed to move: \(error.localizedDescription)"
        }
    }
    
    private func deleteItem(_ item: FileItem) async {
        guard let api = authManager.createAPIService() else { 
            itemToDelete = nil
            operationError = "Not authenticated"
            return 
        }
        
        do {
            _ = try await api.deleteFile(path: item.path)
            itemToDelete = nil
            await refreshDirectory()
        } catch {
            itemToDelete = nil
            operationError = "Failed to delete: \(error.localizedDescription)"
        }
    }
}

#Preview {
    NavigationStack {
        ProjectFilesView(project: Project(id: "test", name: "Test Project", path: "/path/to/project"))
    }
    .environmentObject(AuthManager())
}
