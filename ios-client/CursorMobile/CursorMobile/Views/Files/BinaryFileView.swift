import SwiftUI

struct BinaryFileView: View {
    let fileName: String
    let fileSize: Int
    let mimeType: String?
    let fileExtension: String
    let onViewAsText: () -> Void
    
    private var fileIcon: String {
        let ext = fileExtension.lowercased()
        switch ext {
        // Archives
        case "zip", "rar", "7z", "tar", "gz", "bz2":
            return "doc.zipper"
        // PDFs
        case "pdf":
            return "doc.richtext.fill"
        // Documents
        case "doc", "docx":
            return "doc.fill"
        case "xls", "xlsx":
            return "tablecells.fill"
        case "ppt", "pptx":
            return "rectangle.fill.on.rectangle.fill"
        // Executables
        case "exe", "dll", "so", "dylib", "bin":
            return "gearshape.fill"
        // Databases
        case "sqlite", "db":
            return "cylinder.fill"
        // Fonts
        case "ttf", "otf", "woff", "woff2":
            return "textformat"
        default:
            return "doc.fill"
        }
    }
    
    private var fileTypeDescription: String {
        let ext = fileExtension.lowercased()
        switch ext {
        case "zip": return "ZIP Archive"
        case "rar": return "RAR Archive"
        case "7z": return "7-Zip Archive"
        case "tar": return "TAR Archive"
        case "gz": return "GZip Archive"
        case "pdf": return "PDF Document"
        case "doc", "docx": return "Word Document"
        case "xls", "xlsx": return "Excel Spreadsheet"
        case "ppt", "pptx": return "PowerPoint Presentation"
        case "exe": return "Windows Executable"
        case "dll": return "Dynamic Link Library"
        case "so": return "Shared Object Library"
        case "dylib": return "macOS Dynamic Library"
        case "sqlite", "db": return "Database File"
        case "ttf", "otf": return "Font File"
        case "woff", "woff2": return "Web Font"
        default:
            if let mimeType = mimeType {
                return mimeType
            }
            return "Binary File"
        }
    }
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // File icon
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(.tertiarySystemBackground))
                    .frame(width: 120, height: 120)
                
                Image(systemName: fileIcon)
                    .font(.system(size: 48))
                    .foregroundColor(.secondary)
            }
            
            // File info
            VStack(spacing: 8) {
                Text(fileName)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                
                Text(fileTypeDescription)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                
                Text(ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Message
            VStack(spacing: 8) {
                Image(systemName: "eye.slash")
                    .font(.title2)
                    .foregroundColor(.secondary)
                
                Text("This is a binary file and cannot be displayed normally.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
            .padding(.horizontal)
            
            // View as text button
            Button {
                onViewAsText()
            } label: {
                Label("View as Text", systemImage: "doc.text")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.tertiarySystemBackground))
                    .cornerRadius(12)
            }
            .padding(.horizontal)
            
            Text("Warning: Viewing binary files as text may display garbled content.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            Spacer()
        }
        .padding()
    }
}

#Preview {
    BinaryFileView(
        fileName: "archive.zip",
        fileSize: 1024 * 1024 * 5,
        mimeType: "application/zip",
        fileExtension: "zip",
        onViewAsText: {}
    )
}
