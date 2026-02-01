import SwiftUI
import AVFoundation

struct AudioPlayerView: View {
    let base64Data: String
    let fileName: String
    let fileSize: Int
    let mimeType: String?
    
    @State private var audioPlayer: AVAudioPlayer?
    @State private var tempFileURL: URL?
    @State private var error: String?
    @State private var isLoading = true
    @State private var isPlaying = false
    @State private var currentTime: TimeInterval = 0
    @State private var duration: TimeInterval = 0
    @State private var timer: Timer?
    @State private var audioSessionConfigured = false
    
    var body: some View {
        ZStack {
            Color(.systemBackground)
            
            if isLoading {
                ProgressView("Loading audio...")
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
            } else {
                VStack(spacing: 32) {
                    // Album art placeholder
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color(.tertiarySystemBackground))
                            .frame(width: 200, height: 200)
                        
                        Image(systemName: "music.note")
                            .font(.system(size: 64))
                            .foregroundColor(.secondary)
                    }
                    
                    // File name
                    Text(fileName)
                        .font(.headline)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    
                    // Progress slider
                    VStack(spacing: 4) {
                        Slider(value: $currentTime, in: 0...max(duration, 1)) { editing in
                            if !editing {
                                audioPlayer?.currentTime = currentTime
                            }
                        }
                        .tint(.accentColor)
                        
                        HStack {
                            Text(formatTime(currentTime))
                            Spacer()
                            Text(formatTime(duration))
                        }
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 32)
                    
                    // Playback controls
                    HStack(spacing: 48) {
                        // Rewind 15 seconds
                        Button {
                            seek(by: -15)
                        } label: {
                            Image(systemName: "gobackward.15")
                                .font(.system(size: 28))
                        }
                        
                        // Play/Pause
                        Button {
                            togglePlayback()
                        } label: {
                            Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                .font(.system(size: 64))
                        }
                        
                        // Forward 15 seconds
                        Button {
                            seek(by: 15)
                        } label: {
                            Image(systemName: "goforward.15")
                                .font(.system(size: 28))
                        }
                    }
                }
                .padding()
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                if let mimeType = mimeType {
                    Label(mimeType, systemImage: "waveform")
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
            loadAudio()
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
            try audioSession.setCategory(.playback, mode: .default, options: [])
            try audioSession.setActive(true)
            audioSessionConfigured = true
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }
    
    private func loadAudio() {
        isLoading = true
        error = nil
        
        // Configure audio session on main thread before loading
        configureAudioSession()
        
        DispatchQueue.global(qos: .userInitiated).async {
            guard let data = Data(base64Encoded: base64Data) else {
                DispatchQueue.main.async {
                    self.error = "Unable to decode audio data"
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
                
                let player = try AVAudioPlayer(contentsOf: tempURL)
                player.prepareToPlay()
                
                DispatchQueue.main.async {
                    self.tempFileURL = tempURL
                    self.audioPlayer = player
                    self.duration = player.duration
                    self.isLoading = false
                    self.startTimer()
                }
            } catch {
                DispatchQueue.main.async {
                    self.error = "Failed to prepare audio: \(error.localizedDescription)"
                    self.isLoading = false
                }
            }
        }
    }
    
    private func getFileExtension() -> String {
        // Try to get extension from mime type
        if let mimeType = mimeType {
            switch mimeType {
            case "audio/mpeg": return "mp3"
            case "audio/wav", "audio/wave": return "wav"
            case "audio/mp4", "audio/x-m4a": return "m4a"
            case "audio/aac": return "aac"
            case "audio/flac": return "flac"
            case "audio/ogg": return "ogg"
            default: break
            }
        }
        
        // Fall back to filename extension
        return (fileName as NSString).pathExtension.lowercased()
    }
    
    private func togglePlayback() {
        guard let player = audioPlayer else { return }
        
        if isPlaying {
            player.pause()
        } else {
            player.play()
        }
        isPlaying.toggle()
    }
    
    private func seek(by seconds: TimeInterval) {
        guard let player = audioPlayer else { return }
        let newTime = max(0, min(player.currentTime + seconds, player.duration))
        player.currentTime = newTime
        currentTime = newTime
    }
    
    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            if let player = audioPlayer {
                currentTime = player.currentTime
                if !player.isPlaying && isPlaying {
                    // Playback finished
                    isPlaying = false
                    currentTime = 0
                    player.currentTime = 0
                }
            }
        }
    }
    
    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
    
    private func cleanup() {
        timer?.invalidate()
        timer = nil
        audioPlayer?.stop()
        audioPlayer = nil
        
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
    AudioPlayerView(
        base64Data: "",
        fileName: "test.mp3",
        fileSize: 1024,
        mimeType: "audio/mpeg"
    )
}
