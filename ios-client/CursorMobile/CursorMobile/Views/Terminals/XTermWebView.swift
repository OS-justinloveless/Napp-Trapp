import SwiftUI
import WebKit

/// Coordinator to handle WKWebView delegate callbacks and JavaScript messages
class XTermCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var webView: WKWebView?
    
    var onInput: ((String) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onReady: (() -> Void)?
    var onOpenLink: ((String) -> Void)?
    
    private var pendingData: [String] = []
    private var isTerminalReady = false
    
    override init() {
        super.init()
    }
    
    func updateCallbacks(
        onInput: @escaping (String) -> Void,
        onResize: @escaping (Int, Int) -> Void
    ) {
        self.onInput = onInput
        self.onResize = onResize
    }
    
    func cleanup() {
        onInput = nil
        onResize = nil
        onReady = nil
        onOpenLink = nil
        webView = nil
        pendingData.removeAll()
        isTerminalReady = false
    }
    
    // MARK: - WKScriptMessageHandler
    
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            return
        }
        
        switch type {
        case "input":
            if let data = body["data"] as? String {
                onInput?(data)
            }
            
        case "resize":
            if let cols = body["cols"] as? Int,
               let rows = body["rows"] as? Int {
                onResize?(cols, rows)
            }
            
        case "ready":
            isTerminalReady = true
            onReady?()
            // Flush any pending data
            flushPendingData()
            
        case "openLink":
            if let url = body["url"] as? String {
                onOpenLink?(url)
                // Open URL in Safari
                if let linkUrl = URL(string: url) {
                    DispatchQueue.main.async {
                        UIApplication.shared.open(linkUrl)
                    }
                }
            }
            
        default:
            break
        }
    }
    
    // MARK: - WKNavigationDelegate
    
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("XTermWebView: Page loaded")
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("XTermWebView: Navigation failed - \(error.localizedDescription)")
    }
    
    // MARK: - Data Writing
    
    /// Write data to the terminal (base64 encoded for binary safety)
    func writeData(_ data: String) {
        guard !data.isEmpty else { return }
        
        if !isTerminalReady {
            pendingData.append(data)
            return
        }
        
        // Convert to base64 for safe JavaScript string handling
        guard let base64Data = data.data(using: .utf8)?.base64EncodedString() else {
            return
        }
        
        let script = "window.terminalBridge.writeData('\(base64Data)');"
        webView?.evaluateJavaScript(script) { _, error in
            if let error = error {
                print("XTermWebView: Error writing data - \(error.localizedDescription)")
            }
        }
    }
    
    /// Flush pending data that was queued before terminal was ready
    private func flushPendingData() {
        for data in pendingData {
            writeData(data)
        }
        pendingData.removeAll()
    }
    
    /// Focus the terminal for keyboard input
    func focus() {
        let script = "window.terminalBridge.focus();"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }
    
    /// Fit terminal to container
    func fit() {
        let script = "window.terminalBridge.fit();"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }
    
    /// Clear the terminal
    func clear() {
        let script = "window.terminalBridge.clear();"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }
    
    /// Scroll to bottom
    func scrollToBottom() {
        let script = "window.terminalBridge.scrollToBottom();"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }
}

/// SwiftUI wrapper for xterm.js in a WKWebView
struct XTermWebView: UIViewRepresentable {
    let terminalId: String
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    
    @Binding var terminalData: String
    
    func makeUIView(context: Context) -> WKWebView {
        // Configure WKWebView
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        
        // Set up user content controller for JavaScript messaging
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "terminal")
        configuration.userContentController = contentController
        
        // Create the web view
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        
        // Allow keyboard input without user gesture
        webView.allowsBackForwardNavigationGestures = false
        
        // Store reference in coordinator
        context.coordinator.webView = webView
        
        // Set up callbacks
        context.coordinator.updateCallbacks(onInput: onInput, onResize: onResize)
        
        // Load the xterm.html from bundle
        if let htmlURL = Bundle.main.url(forResource: "xterm", withExtension: "html") {
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        } else {
            print("XTermWebView: Failed to find xterm.html in bundle")
            // Fallback: load a basic error page
            let errorHTML = """
            <html><body style="background:#1e1e1e;color:#fff;padding:20px;font-family:system-ui;">
            <h2>Error</h2><p>Failed to load terminal. xterm.html not found in bundle.</p>
            </body></html>
            """
            webView.loadHTMLString(errorHTML, baseURL: nil)
        }
        
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update callbacks in case they changed
        context.coordinator.updateCallbacks(onInput: onInput, onResize: onResize)
        
        // Write any new terminal data
        if !terminalData.isEmpty {
            context.coordinator.writeData(terminalData)
            
            // Clear the data after writing to prevent re-writing
            DispatchQueue.main.async {
                terminalData = ""
            }
        }
    }
    
    static func dismantleUIView(_ uiView: WKWebView, coordinator: XTermCoordinator) {
        // Clean up coordinator
        coordinator.cleanup()
        
        // Remove message handler to prevent memory leaks
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "terminal")
        
        // Stop loading and clear
        uiView.stopLoading()
        uiView.navigationDelegate = nil
    }
    
    func makeCoordinator() -> XTermCoordinator {
        XTermCoordinator()
    }
}

// MARK: - Preview

#Preview {
    XTermWebView(
        terminalId: "preview-1",
        onInput: { data in
            print("Input: \(data)")
        },
        onResize: { cols, rows in
            print("Resize: \(cols)x\(rows)")
        },
        terminalData: .constant("")
    )
    .frame(height: 400)
    .background(Color.black)
}
