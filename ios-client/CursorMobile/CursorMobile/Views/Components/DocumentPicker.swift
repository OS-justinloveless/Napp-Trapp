import SwiftUI
import UniformTypeIdentifiers
import PhotosUI
import AVFoundation

/// A file selected for upload
struct SelectedFile: Identifiable {
    let id = UUID()
    let filename: String
    let data: Data
    let mimeType: String
    let fileSize: Int
    
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(fileSize))
    }
    
    /// Convert to UploadFile for API
    func toUploadFile() -> UploadFile {
        return UploadFile(filename: filename, data: data, mimeType: mimeType)
    }
}

/// Transferable struct for loading video data from PhotosPicker
struct VideoFileTransferable: Transferable {
    let data: Data
    
    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .movie) { data in
            VideoFileTransferable(data: data)
        }
    }
}

/// Document picker that allows selecting files from the Files app
struct DocumentPicker: UIViewControllerRepresentable {
    let onFilesSelected: ([SelectedFile]) -> Void
    let allowedContentTypes: [UTType]
    let allowsMultipleSelection: Bool
    
    @Environment(\.dismiss) private var dismiss
    
    init(
        allowedContentTypes: [UTType] = [.item],
        allowsMultipleSelection: Bool = true,
        onFilesSelected: @escaping ([SelectedFile]) -> Void
    ) {
        self.allowedContentTypes = allowedContentTypes
        self.allowsMultipleSelection = allowsMultipleSelection
        self.onFilesSelected = onFilesSelected
    }
    
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: allowedContentTypes, asCopy: true)
        picker.allowsMultipleSelection = allowsMultipleSelection
        picker.delegate = context.coordinator
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: DocumentPicker
        
        init(_ parent: DocumentPicker) {
            self.parent = parent
        }
        
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            var selectedFiles: [SelectedFile] = []
            
            for url in urls {
                // Try to start accessing security-scoped resource
                // With asCopy: true, this will return false since copied files aren't security-scoped
                // We still try to read the file regardless
                let hasSecurityAccess = url.startAccessingSecurityScopedResource()
                
                defer {
                    if hasSecurityAccess {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                
                do {
                    let data = try Data(contentsOf: url)
                    let filename = url.lastPathComponent
                    let mimeType = UploadFile.detectMimeType(filename: filename)
                    
                    let selectedFile = SelectedFile(
                        filename: filename,
                        data: data,
                        mimeType: mimeType,
                        fileSize: data.count
                    )
                    selectedFiles.append(selectedFile)
                    
                    print("[DocumentPicker] Selected file: \(filename) (\(data.count) bytes, securityScoped: \(hasSecurityAccess))")
                } catch {
                    print("[DocumentPicker] Failed to read file \(url): \(error)")
                }
            }
            
            parent.onFilesSelected(selectedFiles)
        }
        
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.dismiss()
        }
    }
}

/// Sheet view for uploading files
struct FileUploadSheet: View {
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var authManager: AuthManager
    
    let destinationPath: String
    let onUploadComplete: () -> Void
    
    @State private var selectedFiles: [SelectedFile] = []
    @State private var showDocumentPicker = false
    @State private var showImagePicker = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var isUploading = false
    @State private var uploadError: String?
    @State private var uploadResult: UploadFilesResponse?
    
    var body: some View {
        NavigationView {
            VStack {
                if selectedFiles.isEmpty {
                    emptyState
                } else {
                    fileList
                }
                
                if let error = uploadError {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                        .padding()
                }
                
                if let result = uploadResult {
                    uploadResultView(result)
                }
            }
            .navigationTitle("Upload Files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        uploadFiles()
                    } label: {
                        if isUploading {
                            ProgressView()
                        } else {
                            Text("Upload")
                        }
                    }
                    .disabled(selectedFiles.isEmpty || isUploading)
                }
            }
            .sheet(isPresented: $showDocumentPicker) {
                DocumentPicker { files in
                    selectedFiles.append(contentsOf: files)
                }
            }
        }
    }
    
    private var emptyState: some View {
        VStack(spacing: 20) {
            Spacer()
            
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            
            Text("No files selected")
                .font(.headline)
                .foregroundColor(.secondary)
            
            Text("Tap below to select files to upload")
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            VStack(spacing: 12) {
                Button {
                    showDocumentPicker = true
                } label: {
                    Label("Select Files", systemImage: "folder")
                        .frame(minWidth: 160)
                        .padding()
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
                
                PhotosPicker(
                    selection: $photoPickerItems,
                    maxSelectionCount: 10,
                    matching: .any(of: [.images, .videos])
                ) {
                    Label("Select Media", systemImage: "photo.on.rectangle")
                        .frame(minWidth: 160)
                        .padding()
                        .background(Color.accentColor.opacity(0.8))
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
            
            Spacer()
        }
        .padding()
        .onChange(of: photoPickerItems) { _, newItems in
            loadMediaFromPicker(newItems)
        }
    }
    
    private var fileList: some View {
        List {
            Section {
                ForEach(selectedFiles) { file in
                    HStack {
                        Image(systemName: iconForFile(file.filename))
                            .foregroundColor(.accentColor)
                        
                        VStack(alignment: .leading) {
                            Text(file.filename)
                                .font(.body)
                            Text(file.formattedSize)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Button {
                            removeFile(file)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: {
                HStack {
                    Text("Selected Files (\(selectedFiles.count))")
                    Spacer()
                    Menu {
                        Button {
                            showDocumentPicker = true
                        } label: {
                            Label("Add Files", systemImage: "folder")
                        }
                    } label: {
                        Label("Add More", systemImage: "plus")
                            .font(.caption)
                    }
                    
                    PhotosPicker(
                        selection: $photoPickerItems,
                        maxSelectionCount: 10,
                        matching: .any(of: [.images, .videos])
                    ) {
                        Label("Add Media", systemImage: "photo")
                            .font(.caption)
                    }
                    .onChange(of: photoPickerItems) { _, newItems in
                        loadMediaFromPicker(newItems)
                    }
                }
            } footer: {
                Text("Uploading to: \(destinationPath)")
                    .font(.caption2)
            }
        }
    }
    
    private func uploadResultView(_ result: UploadFilesResponse) -> some View {
        VStack(spacing: 8) {
            if result.totalUploaded > 0 {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("\(result.totalUploaded) file(s) uploaded successfully")
                }
            }
            
            if result.totalFailed > 0 {
                HStack {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(.red)
                    Text("\(result.totalFailed) file(s) failed")
                }
            }
        }
        .font(.caption)
        .padding()
    }
    
    private func iconForFile(_ filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "js", "jsx", "ts", "tsx": return "chevron.left.forwardslash.chevron.right"
        case "py": return "chevron.left.forwardslash.chevron.right"
        case "json": return "curlybraces"
        case "md", "txt": return "doc.text.fill"
        case "html", "css": return "globe"
        case "png", "jpg", "jpeg", "gif", "svg", "heic", "webp": return "photo.fill"
        case "mp4", "mov", "m4v", "avi", "mkv", "webm": return "video.fill"
        case "pdf": return "doc.richtext.fill"
        case "zip", "tar", "gz", "rar": return "doc.zipper"
        default: return "doc.fill"
        }
    }
    
    private func removeFile(_ file: SelectedFile) {
        selectedFiles.removeAll { $0.id == file.id }
    }
    
    private func loadMediaFromPicker(_ items: [PhotosPickerItem]) {
        Task {
            for item in items {
                // Check if it's a video
                let isVideo = item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) || $0.conforms(to: .video) })
                
                if isVideo {
                    await loadVideoFromPicker(item)
                } else {
                    await loadImageFromPicker(item)
                }
            }
            
            // Clear picker items
            await MainActor.run {
                photoPickerItems = []
            }
        }
    }
    
    private func loadImageFromPicker(_ item: PhotosPickerItem) async {
        do {
            if let data = try await item.loadTransferable(type: Data.self) {
                // Try to determine the image format and generate appropriate filename
                let (filename, mimeType) = generateImageFilenameAndMimeType(from: data)
                
                let selectedFile = SelectedFile(
                    filename: filename,
                    data: data,
                    mimeType: mimeType,
                    fileSize: data.count
                )
                
                await MainActor.run {
                    selectedFiles.append(selectedFile)
                }
                
                print("[FileUploadSheet] Added image: \(filename) (\(data.count) bytes)")
            }
        } catch {
            print("[FileUploadSheet] Failed to load image: \(error)")
        }
    }
    
    private func loadVideoFromPicker(_ item: PhotosPickerItem) async {
        do {
            if let movie = try await item.loadTransferable(type: VideoFileTransferable.self) {
                let data = movie.data
                let (filename, mimeType) = generateVideoFilenameAndMimeType(for: item)
                
                let selectedFile = SelectedFile(
                    filename: filename,
                    data: data,
                    mimeType: mimeType,
                    fileSize: data.count
                )
                
                await MainActor.run {
                    selectedFiles.append(selectedFile)
                }
                
                print("[FileUploadSheet] Added video: \(filename) (\(data.count) bytes)")
            }
        } catch {
            print("[FileUploadSheet] Failed to load video: \(error)")
        }
    }
    
    private func generateVideoFilenameAndMimeType(for item: PhotosPickerItem) -> (String, String) {
        let timestamp = Int(Date().timeIntervalSince1970)
        let randomSuffix = Int.random(in: 1000...9999)
        
        for contentType in item.supportedContentTypes {
            if contentType.conforms(to: .mpeg4Movie) {
                return ("video_\(timestamp)_\(randomSuffix).mp4", "video/mp4")
            } else if contentType.conforms(to: .quickTimeMovie) {
                return ("video_\(timestamp)_\(randomSuffix).mov", "video/quicktime")
            }
        }
        
        return ("video_\(timestamp)_\(randomSuffix).mp4", "video/mp4")
    }
    
    private func generateImageFilenameAndMimeType(from data: Data) -> (String, String) {
        // Check magic bytes to determine image format
        let bytes = [UInt8](data.prefix(12))
        
        let timestamp = Int(Date().timeIntervalSince1970)
        let randomSuffix = Int.random(in: 1000...9999)
        
        if bytes.count >= 8 {
            // PNG: 89 50 4E 47 0D 0A 1A 0A
            if bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 {
                return ("image_\(timestamp)_\(randomSuffix).png", "image/png")
            }
            
            // JPEG: FF D8 FF
            if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
                return ("image_\(timestamp)_\(randomSuffix).jpg", "image/jpeg")
            }
            
            // GIF: 47 49 46 38
            if bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38 {
                return ("image_\(timestamp)_\(randomSuffix).gif", "image/gif")
            }
            
            // WebP: RIFF....WEBP
            if bytes.count >= 12 &&
               bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
               bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50 {
                return ("image_\(timestamp)_\(randomSuffix).webp", "image/webp")
            }
            
            // HEIC: Check for ftyp box with heic/heix brand
            if bytes.count >= 12 && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70 {
                return ("image_\(timestamp)_\(randomSuffix).heic", "image/heic")
            }
        }
        
        // Default to JPEG if we can't determine the format
        return ("image_\(timestamp)_\(randomSuffix).jpg", "image/jpeg")
    }
    
    private func uploadFiles() {
        guard let api = authManager.createAPIService() else {
            uploadError = "Not authenticated"
            return
        }
        
        isUploading = true
        uploadError = nil
        
        Task {
            do {
                let uploadFiles = selectedFiles.map { $0.toUploadFile() }
                let result = try await api.uploadFiles(files: uploadFiles, destinationPath: destinationPath)
                
                await MainActor.run {
                    uploadResult = result
                    isUploading = false
                    
                    if result.success && result.totalFailed == 0 {
                        // All files uploaded successfully, dismiss after a short delay
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                            onUploadComplete()
                            dismiss()
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    uploadError = error.localizedDescription
                    isUploading = false
                }
            }
        }
    }
}

#Preview {
    FileUploadSheet(destinationPath: "/path/to/directory") {
        print("Upload complete")
    }
    .environmentObject(AuthManager())
}
