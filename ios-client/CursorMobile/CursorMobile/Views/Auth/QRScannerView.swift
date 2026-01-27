import SwiftUI
import AVFoundation

struct QRScannerView: UIViewControllerRepresentable {
    let onCodeScanned: (String) -> Void
    
    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.onCodeScanned = onCodeScanned
        return controller
    }
    
    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}
}

class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var captureSession: AVCaptureSession?
    var previewLayer: AVCaptureVideoPreviewLayer?
    var onCodeScanned: ((String) -> Void)?
    
    private var hasScanned = false
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        view.backgroundColor = .black
        
        // Check camera permission
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    DispatchQueue.main.async {
                        self?.setupCamera()
                    }
                } else {
                    DispatchQueue.main.async {
                        self?.showPermissionError()
                    }
                }
            }
        default:
            showPermissionError()
        }
        
        setupUI()
    }
    
    private func setupCamera() {
        let session = AVCaptureSession()
        
        guard let device = AVCaptureDevice.default(for: .video) else {
            showCameraError()
            return
        }
        
        do {
            let input = try AVCaptureDeviceInput(device: device)
            
            if session.canAddInput(input) {
                session.addInput(input)
            }
            
            let output = AVCaptureMetadataOutput()
            
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
                output.metadataObjectTypes = [.qr]
            }
            
            let previewLayer = AVCaptureVideoPreviewLayer(session: session)
            previewLayer.frame = view.layer.bounds
            previewLayer.videoGravity = .resizeAspectFill
            view.layer.insertSublayer(previewLayer, at: 0)
            
            self.previewLayer = previewLayer
            self.captureSession = session
            
            DispatchQueue.global(qos: .userInitiated).async {
                session.startRunning()
            }
        } catch {
            showCameraError()
        }
    }
    
    private func setupUI() {
        // Add close button
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = .white
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(closeButton)
        
        // Add scan frame overlay
        let overlayView = ScannerOverlayView()
        overlayView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlayView)
        
        // Add instruction label
        let instructionLabel = UILabel()
        instructionLabel.text = "Point camera at QR code"
        instructionLabel.textColor = .white
        instructionLabel.font = .systemFont(ofSize: 16, weight: .medium)
        instructionLabel.textAlignment = .center
        instructionLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(instructionLabel)
        
        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            closeButton.widthAnchor.constraint(equalToConstant: 44),
            closeButton.heightAnchor.constraint(equalToConstant: 44),
            
            overlayView.topAnchor.constraint(equalTo: view.topAnchor),
            overlayView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlayView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlayView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            instructionLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
            instructionLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
    }
    
    @objc private func closeTapped() {
        dismiss(animated: true)
    }
    
    private func showPermissionError() {
        let label = UILabel()
        label.text = "Camera access is required to scan QR codes.\n\nPlease enable camera access in Settings."
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)
        ])
    }
    
    private func showCameraError() {
        let label = UILabel()
        label.text = "Unable to access camera"
        label.textColor = .white
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
    
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.layer.bounds
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureSession?.stopRunning()
    }
    
    // MARK: - AVCaptureMetadataOutputObjectsDelegate
    
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasScanned,
              let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              metadataObject.type == .qr,
              let stringValue = metadataObject.stringValue else {
            return
        }
        
        hasScanned = true
        
        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
        
        captureSession?.stopRunning()
        onCodeScanned?(stringValue)
        dismiss(animated: true)
    }
}

class ScannerOverlayView: UIView {
    private let scanAreaSize: CGFloat = 250
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        
        // Semi-transparent overlay
        context.setFillColor(UIColor.black.withAlphaComponent(0.5).cgColor)
        context.fill(rect)
        
        // Clear center area
        let centerX = rect.midX - scanAreaSize / 2
        let centerY = rect.midY - scanAreaSize / 2
        let scanRect = CGRect(x: centerX, y: centerY, width: scanAreaSize, height: scanAreaSize)
        
        context.setBlendMode(.clear)
        context.fill(scanRect)
        
        // Draw corner brackets
        context.setBlendMode(.normal)
        context.setStrokeColor(UIColor.white.cgColor)
        context.setLineWidth(4)
        
        let cornerLength: CGFloat = 30
        let corners: [(CGPoint, CGPoint, CGPoint)] = [
            // Top-left
            (CGPoint(x: scanRect.minX, y: scanRect.minY + cornerLength),
             CGPoint(x: scanRect.minX, y: scanRect.minY),
             CGPoint(x: scanRect.minX + cornerLength, y: scanRect.minY)),
            // Top-right
            (CGPoint(x: scanRect.maxX - cornerLength, y: scanRect.minY),
             CGPoint(x: scanRect.maxX, y: scanRect.minY),
             CGPoint(x: scanRect.maxX, y: scanRect.minY + cornerLength)),
            // Bottom-left
            (CGPoint(x: scanRect.minX, y: scanRect.maxY - cornerLength),
             CGPoint(x: scanRect.minX, y: scanRect.maxY),
             CGPoint(x: scanRect.minX + cornerLength, y: scanRect.maxY)),
            // Bottom-right
            (CGPoint(x: scanRect.maxX - cornerLength, y: scanRect.maxY),
             CGPoint(x: scanRect.maxX, y: scanRect.maxY),
             CGPoint(x: scanRect.maxX, y: scanRect.maxY - cornerLength))
        ]
        
        for (start, corner, end) in corners {
            context.move(to: start)
            context.addLine(to: corner)
            context.addLine(to: end)
            context.strokePath()
        }
    }
}
