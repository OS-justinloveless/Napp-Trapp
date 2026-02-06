import SwiftUI

/// A sheet that lets users browse the server's filesystem and select a folder to open as a project.
struct FolderBrowserSheet: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var authManager: AuthManager
    
    /// Called when the user selects a folder. Passes the absolute path.
    let onSelect: (String) async -> Void
    
    @State private var currentPath: String = ""
    @State private var items: [FileItem] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var pathHistory: [String] = []
    @State private var isSelecting = false
    @State private var manualPath: String = ""
    @State private var showManualEntry = false
    
    /// Common quick-access locations
    private let quickAccessPaths: [(name: String, path: String, icon: String)] = [
        ("Home", "~", "house.fill"),
        ("Desktop", "~/Desktop", "menubar.dock.rectangle"),
        ("Documents", "~/Documents", "doc.fill"),
        ("Code", "~/Code", "chevron.left.forwardslash.chevron.right"),
        ("Projects", "~/Projects", "folder.fill"),
        ("Developer", "~/Developer", "hammer.fill"),
        ("Root", "/", "externaldrive.fill")
    ]
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Current path breadcrumb
                if !currentPath.isEmpty {
                    pathBreadcrumb
                }
                
                Divider()
                
                // Content
                if isLoading {
                    Spacer()
                    ProgressView("Loading...")
                    Spacer()
                } else if let error = error {
                    errorView(error)
                } else if currentPath.isEmpty {
                    quickAccessView
                } else {
                    folderListView
                }
            }
            .navigationTitle("Open Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .primaryAction) {
                    if !currentPath.isEmpty {
                        Button {
                            selectCurrentFolder()
                        } label: {
                            if isSelecting {
                                ProgressView()
                            } else {
                                Text("Open")
                                    .fontWeight(.semibold)
                            }
                        }
                        .disabled(isSelecting)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    HStack {
                        Button {
                            showManualEntry = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "character.cursor.ibeam")
                                    .font(.caption)
                                Text("Enter Path")
                                    .font(.caption)
                            }
                        }
                        Spacer()
                    }
                }
            }
            .alert("Enter Path", isPresented: $showManualEntry) {
                TextField("/path/to/folder", text: $manualPath)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                Button("Go") {
                    if !manualPath.isEmpty {
                        navigateTo(manualPath)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Enter the full path to navigate to")
            }
        }
        .onAppear {
            // Start with quick access view (empty currentPath)
            isLoading = false
        }
    }
    
    // MARK: - Subviews
    
    private var pathBreadcrumb: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                // Back button
                Button {
                    goBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.caption)
                        .foregroundColor(.accentColor)
                }
                .disabled(pathHistory.isEmpty)
                
                // Home button
                Button {
                    navigateTo("")
                } label: {
                    Image(systemName: "house.fill")
                        .font(.caption)
                        .foregroundColor(.accentColor)
                }
                
                // Path segments
                let segments = pathSegments()
                ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                    HStack(spacing: 2) {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        
                        Button {
                            let targetPath = buildPath(upToIndex: index, segments: segments)
                            navigateTo(targetPath)
                        } label: {
                            Text(segment)
                                .font(.caption)
                                .fontWeight(index == segments.count - 1 ? .semibold : .regular)
                                .foregroundColor(index == segments.count - 1 ? .primary : .accentColor)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(.secondarySystemBackground))
    }
    
    private var quickAccessView: some View {
        List {
            Section {
                ForEach(quickAccessPaths, id: \.path) { location in
                    Button {
                        navigateTo(location.path)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: location.icon)
                                .font(.title3)
                                .foregroundColor(.accentColor)
                                .frame(width: 28)
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text(location.name)
                                    .font(.body)
                                    .foregroundColor(.primary)
                                Text(location.path)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
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
            } header: {
                Text("Quick Access")
            }
        }
    }
    
    private var folderListView: some View {
        let directories = items.filter { $0.isDirectory }
        let files = items.filter { !$0.isDirectory }
        
        return List {
            // Show parent directory option
            if currentPath != "/" {
                Button {
                    goUp()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.up.doc.fill")
                            .font(.title3)
                            .foregroundColor(.secondary)
                            .frame(width: 28)
                        
                        Text("..")
                            .font(.body)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            
            // Directories (tappable to navigate)
            if !directories.isEmpty {
                Section {
                    ForEach(directories) { item in
                        Button {
                            navigateTo(item.path)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "folder.fill")
                                    .font(.title3)
                                    .foregroundColor(.accentColor)
                                    .frame(width: 28)
                                
                                Text(item.name)
                                    .font(.body)
                                    .foregroundColor(.primary)
                                    .lineLimit(1)
                                
                                Spacer()
                                
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    if !files.isEmpty {
                        Text("Folders")
                    }
                }
            }
            
            // Files (shown for reference, not tappable)
            if !files.isEmpty {
                Section {
                    ForEach(files) { item in
                        HStack(spacing: 12) {
                            Image(systemName: item.icon)
                                .font(.title3)
                                .foregroundColor(.secondary)
                                .frame(width: 28)
                            
                            Text(item.name)
                                .font(.body)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                            
                            Spacer()
                            
                            Text(item.formattedSize)
                                .font(.caption2)
                                .foregroundColor(.secondary.opacity(0.7))
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Files")
                }
            }
            
            // Empty state
            if directories.isEmpty && files.isEmpty {
                VStack(spacing: 8) {
                    Text("Empty Folder")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Text("Tap Open to use this folder as a project.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
        }
    }
    
    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            
            Text("Could not load directory")
                .font(.headline)
            
            Text(message)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            HStack(spacing: 12) {
                Button("Go Back") {
                    goBack()
                }
                .buttonStyle(.bordered)
                
                Button("Retry") {
                    loadDirectory(currentPath)
                }
                .buttonStyle(.bordered)
            }
            
            Spacer()
        }
        .padding()
    }
    
    // MARK: - Navigation
    
    private func navigateTo(_ path: String) {
        if path.isEmpty {
            // Go back to quick access
            pathHistory.removeAll()
            currentPath = ""
            items = []
            error = nil
            isLoading = false
            return
        }
        
        // Push current path to history (if we have one)
        if !currentPath.isEmpty {
            pathHistory.append(currentPath)
        }
        
        currentPath = path
        loadDirectory(path)
    }
    
    private func goBack() {
        if let previous = pathHistory.popLast() {
            if previous.isEmpty {
                currentPath = ""
                items = []
                error = nil
                isLoading = false
            } else {
                currentPath = previous
                loadDirectory(previous)
            }
        } else {
            // Go to quick access
            currentPath = ""
            items = []
            error = nil
            isLoading = false
        }
    }
    
    private func goUp() {
        // Navigate to parent directory
        let components = currentPath.split(separator: "/")
        if components.count > 1 {
            let parentPath = "/" + components.dropLast().joined(separator: "/")
            navigateTo(parentPath)
        } else if components.count == 1 {
            navigateTo("/")
        }
    }
    
    private func loadDirectory(_ path: String) {
        isLoading = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                error = "Not authenticated"
                isLoading = false
                return
            }
            
            do {
                let response = try await api.listDirectoryFull(path: path)
                items = response.items.sorted { a, b in
                    // Directories first, then alphabetical
                    if a.isDirectory && !b.isDirectory { return true }
                    if !a.isDirectory && b.isDirectory { return false }
                    return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
                }
                error = nil
                
                // Use the server's resolved path (handles ~ expansion etc.)
                if let resolvedPath = response.resolvedPath, !resolvedPath.isEmpty {
                    currentPath = resolvedPath
                }
            } catch {
                self.error = error.localizedDescription
            }
            
            isLoading = false
        }
    }
    
    private func selectCurrentFolder() {
        guard !currentPath.isEmpty else { return }
        isSelecting = true
        
        Task {
            await onSelect(currentPath)
            isSelecting = false
        }
    }
    
    // MARK: - Helpers
    
    private func pathSegments() -> [String] {
        let path = currentPath.hasPrefix("/") ? String(currentPath.dropFirst()) : currentPath
        return path.split(separator: "/").map(String.init)
    }
    
    private func buildPath(upToIndex index: Int, segments: [String]) -> String {
        let subSegments = Array(segments.prefix(index + 1))
        return "/" + subSegments.joined(separator: "/")
    }
}

#Preview {
    FolderBrowserSheet { path in
        print("Selected: \(path)")
    }
    .environmentObject(AuthManager())
}
