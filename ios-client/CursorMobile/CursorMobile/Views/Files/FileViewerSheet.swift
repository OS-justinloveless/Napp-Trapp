import SwiftUI
import AVKit
import PDFKit

struct FileViewerSheet: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss
    
    let filePath: String
    
    @State private var content: String = ""
    @State private var originalContent: String = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var isEditing = false
    @State private var isSaving = false
    @State private var showSaveSuccess = false
    @State private var fileInfo: FileContent?
    @State private var showMarkdownPreview = true
    @State private var forceTextView = false
    
    var hasChanges: Bool {
        content != originalContent
    }
    
    var fileName: String {
        (filePath as NSString).lastPathComponent
    }
    
    var isMarkdownFile: Bool {
        fileInfo?.language == "markdown" || fileName.lowercased().hasSuffix(".md")
    }
    
    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading file...")
                } else if let error = error {
                    ErrorView(message: error) {
                        loadFile()
                    }
                } else {
                    fileContentView
                }
            }
            .navigationTitle(fileName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(hasChanges ? "Discard" : "Close") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .principal) {
                    if let fileInfo = fileInfo {
                        VStack(spacing: 0) {
                            Text(fileName)
                                .font(.headline)
                            Text(fileInfo.language.uppercased())
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    if isEditing {
                        Button {
                            saveFile()
                        } label: {
                            if isSaving {
                                ProgressView()
                            } else {
                                Text("Save")
                            }
                        }
                        .disabled(!hasChanges || isSaving)
                    } else if !isEditingDisabled {
                        HStack(spacing: 16) {
                            // Preview/Source toggle for markdown files
                            if isMarkdownFile && !(fileInfo?.isBinaryFile ?? false) {
                                Button {
                                    showMarkdownPreview.toggle()
                                } label: {
                                    Image(systemName: showMarkdownPreview ? "doc.text" : "eye")
                                }
                                .help(showMarkdownPreview ? "Show Source" : "Show Preview")
                            }
                            
                            // Edit button (hidden for binary files unless viewing as text)
                            Button {
                                isEditing = true
                                // When editing, always show source
                                showMarkdownPreview = false
                            } label: {
                                Image(systemName: "pencil")
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            loadFile()
        }
        .alert("Saved", isPresented: $showSaveSuccess) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("File saved successfully")
        }
    }
    
    /// Whether this file is a media file (image, video, or audio)
    private var isMediaFile: Bool {
        guard let fileInfo = fileInfo else { return false }
        return fileInfo.isImage || fileInfo.isVideo || fileInfo.isAudio
    }
    
    /// Whether editing should be disabled for this file type
    private var isEditingDisabled: Bool {
        guard let fileInfo = fileInfo else { return false }
        return fileInfo.isBinaryFile && !forceTextView
    }
    
    private var fileContentView: some View {
        VStack(spacing: 0) {
            // File info bar (only for text files or when viewing binary as text)
            if let fileInfo = fileInfo, (!fileInfo.isBinaryFile || forceTextView) {
                HStack {
                    Label(ByteCountFormatter.string(fromByteCount: Int64(fileInfo.size), countStyle: .file), systemImage: "doc")
                    
                    Spacer()
                    
                    if hasChanges {
                        Label("Modified", systemImage: "pencil.circle.fill")
                            .foregroundColor(.orange)
                    }
                }
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
            }
            
            // Content - route to appropriate viewer based on file type
            if let fileInfo = fileInfo {
                if fileInfo.isImage && !forceTextView {
                    // Image viewer
                    ImageViewerView(
                        base64Data: content,
                        fileName: fileName,
                        fileSize: fileInfo.size
                    )
                } else if fileInfo.isVideo && !forceTextView {
                    // Video player
                    VideoPlayerView(
                        base64Data: content,
                        fileName: fileName,
                        fileSize: fileInfo.size,
                        mimeType: fileInfo.mimeType
                    )
                } else if fileInfo.isAudio && !forceTextView {
                    // Audio player
                    AudioPlayerView(
                        base64Data: content,
                        fileName: fileName,
                        fileSize: fileInfo.size,
                        mimeType: fileInfo.mimeType
                    )
                } else if fileInfo.isPDF && !forceTextView {
                    // PDF viewer
                    PDFViewerView(
                        base64Data: content,
                        fileName: fileName,
                        fileSize: fileInfo.size
                    )
                } else if fileInfo.isBinaryNonMedia && !forceTextView {
                    // Binary file view with option to view as text
                    BinaryFileView(
                        fileName: fileName,
                        fileSize: fileInfo.size,
                        mimeType: fileInfo.mimeType,
                        fileExtension: fileInfo.extension,
                        onViewAsText: {
                            forceTextView = true
                        }
                    )
                } else if isEditing {
                    // Text editor mode
                    TextEditor(text: $content)
                        .font(.system(.body, design: .monospaced))
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                } else if isMarkdownFile && showMarkdownPreview && !fileInfo.isBinaryFile {
                    // Markdown preview
                    MarkdownPreviewView(content: content)
                } else {
                    // Code/text view (including binary viewed as text)
                    ScrollView {
                        HighlightedCodeView(content: content, language: fileInfo.language)
                    }
                }
            } else {
                // Fallback for when fileInfo is nil (shouldn't happen)
                ScrollView {
                    HighlightedCodeView(content: content, language: "plaintext")
                }
            }
        }
    }
    
    private func loadFile() {
        isLoading = true
        error = nil
        
        Task {
            guard let api = authManager.createAPIService() else {
                error = "Not authenticated"
                isLoading = false
                return
            }
            
            do {
                let file = try await api.readFile(path: filePath)
                fileInfo = file
                content = file.content
                originalContent = file.content
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            
            isLoading = false
        }
    }
    
    private func saveFile() {
        isSaving = true
        
        Task {
            guard let api = authManager.createAPIService() else {
                isSaving = false
                return
            }
            
            do {
                _ = try await api.writeFile(path: filePath, content: content)
                originalContent = content
                isEditing = false
                // Restore preview mode for markdown files after saving
                if isMarkdownFile {
                    showMarkdownPreview = true
                }
                showSaveSuccess = true
            } catch {
                self.error = error.localizedDescription
            }
            
            isSaving = false
        }
    }
}

struct CodeView: View {
    let content: String
    let language: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            let lines = content.components(separatedBy: .newlines)
            
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .top, spacing: 8) {
                    // Line number
                    Text("\(index + 1)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(.secondary)
                        .frame(width: 40, alignment: .trailing)
                    
                    // Code line
                    Text(line.isEmpty ? " " : line)
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.primary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(index % 2 == 0 ? Color.clear : Color(.systemGray6).opacity(0.5))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }
}

#Preview {
    FileViewerSheet(filePath: "/path/to/file.swift")
        .environmentObject(AuthManager())
}
