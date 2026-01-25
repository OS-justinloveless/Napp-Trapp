import SwiftUI

struct FileBrowserView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var currentPath: String = ""
    @State private var items: [FileItem] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var pathHistory: [String] = []
    @State private var selectedFilePath: String?
    @State private var showNewFileSheet = false
    
    var body: some View {
        NavigationStack {
            Group {
                if isLoading && items.isEmpty {
                    ProgressView("Loading...")
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
            .navigationTitle(currentPathName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if !pathHistory.isEmpty {
                        Button {
                            goBack()
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                    }
                }
                
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
                        
                        Button {
                            goHome()
                        } label: {
                            Label("Go Home", systemImage: "house")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .onAppear {
                if currentPath.isEmpty {
                    initializePath()
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
    }
    
    private var currentPathName: String {
        if currentPath.isEmpty {
            return "Files"
        }
        return (currentPath as NSString).lastPathComponent
    }
    
    private var fileList: some View {
        List {
            // Show current path
            if !currentPath.isEmpty {
                Section {
                    Text(currentPath)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
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
    
    private func initializePath() {
        Task {
            guard let api = authManager.createAPIService() else { return }
            
            do {
                let systemInfo = try await api.getSystemInfo()
                currentPath = systemInfo.homeDir
                loadDirectory()
            } catch {
                self.error = error.localizedDescription
                isLoading = false
            }
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
        pathHistory.append(currentPath)
        currentPath = path
        loadDirectory()
    }
    
    private func goBack() {
        guard let previousPath = pathHistory.popLast() else { return }
        currentPath = previousPath
        loadDirectory()
    }
    
    private func goHome() {
        pathHistory.removeAll()
        initializePath()
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

struct FileItemRow: View {
    let item: FileItem
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: item.icon)
                    .font(.title2)
                    .foregroundColor(item.isDirectory ? .accentColor : .secondary)
                    .frame(width: 32)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.body)
                        .foregroundColor(.primary)
                    
                    HStack(spacing: 8) {
                        if !item.isDirectory {
                            Text(item.formattedSize)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        
                        if let modified = item.modified {
                            Text(formatDate(modified))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Spacer()
                
                if item.isDirectory {
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
    
    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

struct NewFileSheet: View {
    @Environment(\.dismiss) var dismiss
    
    let basePath: String
    let onCreate: (String, String) async -> Void
    
    @State private var fileName = ""
    @State private var content = ""
    @State private var isCreating = false
    
    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("filename.txt", text: $fileName)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                } header: {
                    Text("File Name")
                }
                
                Section {
                    TextEditor(text: $content)
                        .frame(minHeight: 150)
                        .font(.system(.body, design: .monospaced))
                } header: {
                    Text("Content (Optional)")
                }
            }
            .navigationTitle("New File")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        createFile()
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(fileName.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
    }
    
    private func createFile() {
        isCreating = true
        Task {
            await onCreate(fileName, content)
            isCreating = false
            dismiss()
        }
    }
}

#Preview {
    FileBrowserView()
        .environmentObject(AuthManager())
}
