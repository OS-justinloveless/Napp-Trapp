import SwiftUI
import PhotosUI

/// Compact image picker button for the message input
struct ImagePickerButton: View {
    @Binding var selectedImages: [SelectedImage]
    @State private var showingImagePicker = false
    @State private var showingCamera = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    
    let maxImages: Int
    
    init(selectedImages: Binding<[SelectedImage]>, maxImages: Int = 5) {
        self._selectedImages = selectedImages
        self.maxImages = maxImages
    }
    
    var body: some View {
        Menu {
            Button {
                showingImagePicker = true
            } label: {
                Label("Photo Library", systemImage: "photo.on.rectangle")
            }
            
            Button {
                showingCamera = true
            } label: {
                Label("Take Photo", systemImage: "camera")
            }
        } label: {
            Image(systemName: selectedImages.isEmpty ? "photo" : "photo.badge.plus")
                .font(.system(size: 20))
                .foregroundColor(selectedImages.count >= maxImages ? .gray : .accentColor)
        }
        .disabled(selectedImages.count >= maxImages)
        .photosPicker(
            isPresented: $showingImagePicker,
            selection: $photoPickerItems,
            maxSelectionCount: maxImages - selectedImages.count,
            matching: .images
        )
        .onChange(of: photoPickerItems) { newItems in
            loadImages(from: newItems)
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                addImage(image)
            }
        }
    }
    
    private func loadImages(from items: [PhotosPickerItem]) {
        Task {
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let uiImage = UIImage(data: data) {
                    await MainActor.run {
                        addImage(uiImage)
                    }
                }
            }
            // Clear picker items
            await MainActor.run {
                photoPickerItems = []
            }
        }
    }
    
    private func addImage(_ uiImage: UIImage) {
        let image = SelectedImage(image: uiImage)
        selectedImages.append(image)
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
