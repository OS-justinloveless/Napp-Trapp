import SwiftUI
import PDFKit

struct PDFViewerView: View {
    let base64Data: String
    let fileName: String
    let fileSize: Int
    
    @State private var pdfDocument: PDFDocument?
    @State private var error: String?
    @State private var isLoading = true
    @State private var currentPage = 1
    @State private var totalPages = 0
    
    var body: some View {
        ZStack {
            Color(.systemBackground)
            
            if isLoading {
                ProgressView("Loading PDF...")
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
            } else if let document = pdfDocument {
                PDFKitView(document: document, currentPage: $currentPage)
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                if totalPages > 0 {
                    Label("Page \(currentPage) of \(totalPages)", systemImage: "doc.text")
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
            loadPDF()
        }
    }
    
    private func loadPDF() {
        isLoading = true
        error = nil
        
        DispatchQueue.global(qos: .userInitiated).async {
            guard let data = Data(base64Encoded: base64Data) else {
                DispatchQueue.main.async {
                    self.error = "Unable to decode PDF data"
                    self.isLoading = false
                }
                return
            }
            
            guard let document = PDFDocument(data: data) else {
                DispatchQueue.main.async {
                    self.error = "Unable to parse PDF document"
                    self.isLoading = false
                }
                return
            }
            
            DispatchQueue.main.async {
                self.pdfDocument = document
                self.totalPages = document.pageCount
                self.isLoading = false
            }
        }
    }
}

// UIViewRepresentable wrapper for PDFView
struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument
    @Binding var currentPage: Int
    
    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.document = document
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.backgroundColor = .systemBackground
        
        // Add observer for page changes
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.pageChanged(_:)),
            name: .PDFViewPageChanged,
            object: pdfView
        )
        
        return pdfView
    }
    
    func updateUIView(_ uiView: PDFView, context: Context) {
        // Update document if needed
        if uiView.document !== document {
            uiView.document = document
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject {
        var parent: PDFKitView
        
        init(_ parent: PDFKitView) {
            self.parent = parent
        }
        
        @objc func pageChanged(_ notification: Notification) {
            guard let pdfView = notification.object as? PDFView,
                  let currentPage = pdfView.currentPage,
                  let pageIndex = pdfView.document?.index(for: currentPage) else {
                return
            }
            
            DispatchQueue.main.async {
                self.parent.currentPage = pageIndex + 1
            }
        }
    }
}

#Preview {
    PDFViewerView(
        base64Data: "",
        fileName: "test.pdf",
        fileSize: 1024
    )
}
