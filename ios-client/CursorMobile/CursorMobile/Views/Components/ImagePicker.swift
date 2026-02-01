import SwiftUI
import PhotosUI
import AVFoundation

/// Compact media picker button for the message input (supports images and videos)
struct ImagePickerButton: View {
    @Binding var selectedMedia: [SelectedMedia]
    @State private var showingMediaPicker = false
    @State private var showingCamera = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var isLoading = false
    
    let maxItems: Int
    
    init(selectedImages: Binding<[SelectedMedia]>, maxImages: Int = 5) {
        self._selectedMedia = selectedImages
        self.maxItems = maxImages
    }
    
    var body: some View {
        Menu {
            Button {
                showingMediaPicker = true
            } label: {
                Label("Photo & Video Library", systemImage: "photo.on.rectangle")
            }
            
            Button {
                showingCamera = true
            } label: {
                Label("Take Photo", systemImage: "camera")
            }
        } label: {
            ZStack {
                Image(systemName: selectedMedia.isEmpty ? "photo" : "photo.badge.plus")
                    .font(.system(size: 20))
                    .foregroundColor(selectedMedia.count >= maxItems ? .gray : .accentColor)
                    .opacity(isLoading ? 0.3 : 1)
                
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                }
            }
        }
        .disabled(selectedMedia.count >= maxItems || isLoading)
        .photosPicker(
            isPresented: $showingMediaPicker,
            selection: $photoPickerItems,
            maxSelectionCount: maxItems - selectedMedia.count,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: photoPickerItems) { _, newItems in
            loadMedia(from: newItems)
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                addImage(image)
            }
        }
    }
    
    private func loadMedia(from items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        
        isLoading = true
        
        Task {
            for item in items {
                // Check if it's a video
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) || $0.conforms(to: .video) }) {
                    await loadVideo(from: item)
                } else {
                    // It's an image
                    await loadImage(from: item)
                }
            }
            
            // Clear picker items
            await MainActor.run {
                photoPickerItems = []
                isLoading = false
            }
        }
    }
    
    private func loadImage(from item: PhotosPickerItem) async {
        if let data = try? await item.loadTransferable(type: Data.self),
           let uiImage = UIImage(data: data) {
            await MainActor.run {
                addImage(uiImage)
            }
        }
    }
    
    private func loadVideo(from item: PhotosPickerItem) async {
        // Load video as transferable movie
        if let movie = try? await item.loadTransferable(type: VideoTransferable.self) {
            let videoData = movie.data
            let thumbnail = await generateVideoThumbnail(from: videoData)
            let duration = await getVideoDuration(from: videoData)
            let mimeType = getMimeType(for: item)
            
            await MainActor.run {
                let video = SelectedVideo(
                    data: videoData,
                    thumbnail: thumbnail,
                    duration: duration,
                    mimeType: mimeType
                )
                selectedMedia.append(.video(video))
            }
        }
    }
    
    private func generateVideoThumbnail(from data: Data) async -> UIImage? {
        // Write data to temp file to generate thumbnail
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        
        do {
            try data.write(to: tempURL)
            let asset = AVURLAsset(url: tempURL)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 300, height: 300)
            
            let cgImage = try generator.copyCGImage(at: .zero, actualTime: nil)
            try? FileManager.default.removeItem(at: tempURL)
            return UIImage(cgImage: cgImage)
        } catch {
            try? FileManager.default.removeItem(at: tempURL)
            return nil
        }
    }
    
    private func getVideoDuration(from data: Data) async -> Double? {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
        
        do {
            try data.write(to: tempURL)
            let asset = AVURLAsset(url: tempURL)
            let duration = try await asset.load(.duration)
            try? FileManager.default.removeItem(at: tempURL)
            return CMTimeGetSeconds(duration)
        } catch {
            try? FileManager.default.removeItem(at: tempURL)
            return nil
        }
    }
    
    private func getMimeType(for item: PhotosPickerItem) -> String {
        for contentType in item.supportedContentTypes {
            if contentType.conforms(to: .mpeg4Movie) {
                return "video/mp4"
            } else if contentType.conforms(to: .quickTimeMovie) {
                return "video/quicktime"
            }
        }
        return "video/mp4"
    }
    
    private func addImage(_ uiImage: UIImage) {
        let image = SelectedImage(image: uiImage)
        selectedMedia.append(.image(image))
    }
}

/// Transferable struct for loading video data
struct VideoTransferable: Transferable {
    let data: Data
    
    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .movie) { data in
            VideoTransferable(data: data)
        }
    }
}

/// Camera picker using UIImagePickerController
struct CameraPicker: UIViewControllerRepresentable {
    let onImagePicked: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss
    
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        
        init(_ parent: CameraPicker) {
            self.parent = parent
        }
        
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImagePicked(image)
            }
            parent.dismiss()
        }
        
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
