import SwiftUI

struct ImageViewerView: View {
    let base64Data: String
    let fileName: String
    let fileSize: Int
    
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var imageSize: CGSize = .zero
    
    private var image: UIImage? {
        guard let data = Data(base64Encoded: base64Data) else { return nil }
        return UIImage(data: data)
    }
    
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(.systemBackground)
                
                if let uiImage = image {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(scale)
                        .offset(offset)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    let delta = value / lastScale
                                    lastScale = value
                                    scale = min(max(scale * delta, 1), 5)
                                }
                                .onEnded { _ in
                                    lastScale = 1.0
                                    if scale < 1 {
                                        withAnimation {
                                            scale = 1
                                            offset = .zero
                                        }
                                    }
                                }
                        )
                        .simultaneousGesture(
                            DragGesture()
                                .onChanged { value in
                                    if scale > 1 {
                                        offset = CGSize(
                                            width: lastOffset.width + value.translation.width,
                                            height: lastOffset.height + value.translation.height
                                        )
                                    }
                                }
                                .onEnded { _ in
                                    lastOffset = offset
                                }
                        )
                        .simultaneousGesture(
                            TapGesture(count: 2)
                                .onEnded {
                                    withAnimation {
                                        if scale > 1 {
                                            scale = 1
                                            offset = .zero
                                            lastOffset = .zero
                                        } else {
                                            scale = 2
                                        }
                                    }
                                }
                        )
                        .onAppear {
                            imageSize = CGSize(width: uiImage.size.width, height: uiImage.size.height)
                        }
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 48))
                            .foregroundColor(.secondary)
                        Text("Unable to load image")
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let uiImage = image {
                HStack {
                    Label("\(Int(uiImage.size.width)) x \(Int(uiImage.size.height))", systemImage: "aspectratio")
                    Spacer()
                    Label(ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file), systemImage: "doc")
                }
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
            }
        }
    }
}

#Preview {
    ImageViewerView(
        base64Data: "",
        fileName: "test.png",
        fileSize: 1024
    )
}
