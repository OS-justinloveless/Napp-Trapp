import SwiftUI
import AVKit
import AVFoundation

struct VideoPlayerView: View {
    let base64Data: String
    let fileName: String
    let fileSize: Int
    let mimeType: String?
    
    @State private var player: AVPlayer?
    @State private var tempFileURL: URL?
    @State private var error: String?
    @State private var isLoading = true
    @State private var audioSessionConfigured = false
    
    var body: some View {
        ZStack {
            Color(.systemBackground)
            
            if isLoading {
                ProgressView("Loading video...")
            } else if let error = error {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)
                    Text(error)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            } else if let player = player {
                VideoPlayer(player: player)
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                if let mimeType = mimeType {
                    Label(mimeType, systemImage: "film")
                }
                Spacer()
                Label(ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file), systemImage: "doc")
            }
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground))
        }
        .onAppear {
            loadVideo()
        }
        .onDisappear {
            cleanup()
        }
    }
    
    private func configureAudioSession() {
        guard !audioSessionConfigured else { return }
        
        do {
            let audioSession = AVAudioSession.sharedInstance()
            // Use .playback category to ensure audio plays through the speaker
            try audioSession.setCategory(.playback, mode: .moviePlayback, options: [])
            try audioSession.setActive(true)
            audioSessionConfigured = true
        } catch {
            print("Failed to configure audio session for video: \(error)")
        }
    }
    
    private func loadVideo() {
        isLoading = true
        error = nil
        
        // Configure audio session on main thread before loading
        configureAudioSession()
        
        DispatchQueue.global(qos: .userInitiated).async {
            guard let data = Data(base64Encoded: base64Data) else {
                DispatchQueue.main.async {
                    self.error = "Unable to decode video data"
                    self.isLoading = false
                }
                return
            }
            
            // Determine file extension from mime type or filename
            let ext = getFileExtension()
            
            // Create temporary file
            let tempDir = FileManager.default.temporaryDirectory
            let tempURL = tempDir.appendingPathComponent(UUID().uuidString + "." + ext)
            
            do {
                try data.write(to: tempURL)
                
                DispatchQueue.main.async {
                    self.tempFileURL = tempURL
                    self.player = AVPlayer(url: tempURL)
                    self.isLoading = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.error = "Failed to prepare video: \(error.localizedDescription)"
                    self.isLoading = false
                }
            }
        }
    }
    
    private func getFileExtension() -> String {
        // Try to get extension from mime type
        if let mimeType = mimeType {
            switch mimeType {
            case "video/mp4": return "mp4"
            case "video/quicktime": return "mov"
            case "video/x-m4v": return "m4v"
            case "video/webm": return "webm"
            case "video/x-msvideo": return "avi"
            default: break
            }
        }
        
        // Fall back to filename extension
        return (fileName as NSString).pathExtension.lowercased()
    }
    
    private func cleanup() {
        player?.pause()
        player = nil
        
        // Clean up temp file
        if let tempURL = tempFileURL {
            try? FileManager.default.removeItem(at: tempURL)
        }
        
        // Deactivate audio session
        if audioSessionConfigured {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("Failed to deactivate audio session: \(error)")
            }
        }
    }
}

#Preview {
    VideoPlayerView(
        base64Data: "",
        fileName: "test.mp4",
        fileSize: 1024,
        mimeType: "video/mp4"
    )
}
