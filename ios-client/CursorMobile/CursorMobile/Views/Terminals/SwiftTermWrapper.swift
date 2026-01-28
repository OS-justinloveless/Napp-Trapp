import SwiftUI
import SwiftTerm

/// Coordinator to handle terminal delegate callbacks
class TerminalCoordinator: NSObject, TerminalViewDelegate {
    // Use weak reference to avoid retain cycle with UIViewRepresentable
    weak var terminalView: SwiftTerm.TerminalView?
    
    // Store callbacks directly instead of parent reference to avoid retain cycle
    var onInput: ((String) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    
    // Track last fed data to prevent duplicate feeds
    var lastFedData: String = ""
    
    // Track last reported size to prevent duplicate resize calls
    var lastReportedCols: Int = 0
    var lastReportedRows: Int = 0
    
    override init() {
        super.init()
    }
    
    // Update callbacks - called from updateUIView
    func updateCallbacks(onInput: @escaping (String) -> Void, onResize: @escaping (Int, Int) -> Void) {
        self.onInput = onInput
        self.onResize = onResize
    }
    
    // Clean up to break any remaining references
    func cleanup() {
        onInput = nil
        onResize = nil
        terminalView = nil
        lastFedData = ""
    }
    
    // MARK: - Required TerminalViewDelegate Methods
    
    // Called when user types or sends input
    func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
        let string = String(bytes: data, encoding: .utf8) ?? ""
        onInput?(string)
    }
    
    // Called when the terminal buffer size changes
    func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
        onResize?(newCols, newRows)
    }
    
    // Called when the terminal title changes
    func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
        // Not used in this implementation
    }
    
    // Update current directory
    func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {
        // Not used in this implementation
    }
    
    // Called when the terminal wants to scroll
    func scrolled(source: SwiftTerm.TerminalView, position: Double) {
        // Auto-handled by the view
    }
    
    // Called when clipboard copy is requested
    func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
        if let string = String(data: content, encoding: .utf8) {
            UIPasteboard.general.string = string
        }
    }
    
    // Called when the visible range changes
    func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {
        // Not used in this implementation
    }
    
    // MARK: - Optional TerminalViewDelegate Methods (with default implementations)
    
    // Called when terminal wants to open a link
    func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String : String]) {
        if let url = URL(string: link) {
            UIApplication.shared.open(url)
        }
    }
    
    // Called when terminal wants to ring the bell
    func bell(source: SwiftTerm.TerminalView) {
        // Provide haptic feedback for bell
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
    }
}

/// SwiftUI wrapper for SwiftTerm's TerminalView - simplified, no scroll view
/// Horizontal scrolling disabled to focus on fixing newline rendering
struct SwiftTermWrapper: UIViewRepresentable {
    let terminalId: String
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    
    @Binding var terminalData: String
    
    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let terminal = SwiftTerm.TerminalView()
        terminal.terminalDelegate = context.coordinator
        
        // Configure terminal appearance
        terminal.nativeForegroundColor = UIColor.label
        terminal.nativeBackgroundColor = UIColor.systemBackground
        terminal.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        
        // Store weak reference for updates
        context.coordinator.terminalView = terminal
        
        // Set up callbacks
        context.coordinator.updateCallbacks(onInput: onInput, onResize: onResize)
        
        return terminal
    }
    
    func updateUIView(_ terminal: SwiftTerm.TerminalView, context: Context) {
        // Update callbacks in case they changed
        context.coordinator.updateCallbacks(onInput: onInput, onResize: onResize)
        
        // Feed any new data to the terminal as raw bytes
        // Use coordinator to track what we've already fed to prevent duplicates
        let coordinator = context.coordinator
        if !terminalData.isEmpty && terminalData != coordinator.lastFedData {
            coordinator.lastFedData = terminalData
            
            // Convert to bytes - terminal data should be fed as raw bytes
            if let bytes = terminalData.data(using: .utf8) {
                let byteArray = Array(bytes)
                terminal.feed(byteArray: byteArray[...]) // Convert to ArraySlice
            }
            
            // Clear the data after feeding to prevent re-feeding
            DispatchQueue.main.async { [weak coordinator] in
                self.terminalData = ""
                coordinator?.lastFedData = ""  // Reset so next data can be processed
            }
        }
        
        // Report terminal size only if it changed
        let terminalObj = terminal.getTerminal()
        let cols = terminalObj.cols
        let rows = terminalObj.rows
        if cols > 0 && rows > 0 && 
           (cols != context.coordinator.lastReportedCols || rows != context.coordinator.lastReportedRows) {
            context.coordinator.lastReportedCols = cols
            context.coordinator.lastReportedRows = rows
            onResize(cols, rows)
        }
    }
    
    static func dismantleUIView(_ uiView: SwiftTerm.TerminalView, coordinator: TerminalCoordinator) {
        // Clean up coordinator to break retain cycles
        coordinator.cleanup()
        // Clear delegate to prevent callbacks after dismantling
        uiView.terminalDelegate = nil
    }
    
    func makeCoordinator() -> TerminalCoordinator {
        TerminalCoordinator()
    }
}
