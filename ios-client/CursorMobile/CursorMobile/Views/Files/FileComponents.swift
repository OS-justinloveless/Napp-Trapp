import SwiftUI

struct FileItemRow: View {
    let item: FileItem
    
    var body: some View {
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

struct RenameSheet: View {
    @Environment(\.dismiss) var dismiss
    
    let item: FileItem
    let onRename: (String) async -> Void
    
    @State private var newName: String
    @State private var isRenaming = false
    
    init(item: FileItem, onRename: @escaping (String) async -> Void) {
        self.item = item
        self.onRename = onRename
        _newName = State(initialValue: item.name)
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Name", text: $newName)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("New Name")
                } footer: {
                    Text("Renaming: \(item.name)")
                }
            }
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        rename()
                    } label: {
                        if isRenaming {
                            ProgressView()
                        } else {
                            Text("Rename")
                        }
                    }
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || newName == item.name || isRenaming)
                }
            }
        }
    }
    
    private func rename() {
        isRenaming = true
        Task {
            await onRename(newName)
            // Parent dismisses by setting item to nil
        }
    }
}

struct MoveSheet: View {
    @Environment(\.dismiss) var dismiss
    
    let item: FileItem
    let currentPath: String
    let allItems: [FileItem]
    let onMove: (String) async -> Void
    
    @State private var selectedDestination: String?
    @State private var isMoving = false
    
    private var availableDirectories: [FileItem] {
        allItems.filter { $0.isDirectory && $0.path != item.path }
    }
    
    var body: some View {
        NavigationView {
            List {
                Section {
                    Text(item.name)
                        .font(.headline)
                } header: {
                    Text("Item to Move")
                }
                
                Section {
                    if availableDirectories.isEmpty {
                        Text("No directories available in current folder")
                            .foregroundColor(.secondary)
                            .italic()
                    } else {
                        ForEach(availableDirectories) { directory in
                            Button {
                                selectedDestination = directory.path
                            } label: {
                                HStack {
                                    Image(systemName: "folder.fill")
                                        .foregroundColor(.accentColor)
                                    Text(directory.name)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if selectedDestination == directory.path {
                                        Image(systemName: "checkmark")
                                            .foregroundColor(.accentColor)
                                    }
                                }
                            }
                        }
                    }
                } header: {
                    Text("Destination")
                } footer: {
                    Text("Select a directory to move this item into")
                }
            }
            .navigationTitle("Move")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        move()
                    } label: {
                        if isMoving {
                            ProgressView()
                        } else {
                            Text("Move")
                        }
                    }
                    .disabled(selectedDestination == nil || isMoving)
                }
            }
        }
    }
    
    private func move() {
        guard let destination = selectedDestination else { return }
        
        isMoving = true
        Task {
            let destinationPath = (destination as NSString).appendingPathComponent(item.name)
            await onMove(destinationPath)
            // Parent dismisses by setting item to nil
        }
    }
}
