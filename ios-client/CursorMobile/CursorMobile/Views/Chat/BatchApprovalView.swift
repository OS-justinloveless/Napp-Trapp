import SwiftUI

/// Displays a batch approval interface for multiple approval requests
struct BatchApprovalView: View {
    let approvalBlocks: [ChatContentBlock]
    let hasResponded: Bool
    let onBatchApproval: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "hand.raised.fill")
                    .foregroundColor(.yellow)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Multiple Approvals Required")
                        .font(.headline)
                    Text("\(approvalBlocks.count) actions need your permission")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            // List of approval items
            VStack(alignment: .leading, spacing: 8) {
                ForEach(approvalBlocks) { block in
                    ApprovalItemRow(block: block)
                }
            }
            .padding(.vertical, 4)

            Divider()

            // Action buttons or response indicator
            if hasResponded {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("Response sent for all items")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            } else {
                HStack(spacing: 12) {
                    Button {
                        onBatchApproval(true)
                    } label: {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                            Text("Approve All")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.green)
                        .cornerRadius(8)
                    }

                    Button {
                        onBatchApproval(false)
                    } label: {
                        HStack {
                            Image(systemName: "xmark.circle.fill")
                            Text("Reject All")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.red)
                        .cornerRadius(8)
                    }
                }
            }
        }
        .padding(16)
        .background(Color.yellow.opacity(0.1))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.yellow.opacity(0.3), lineWidth: 2)
        )
    }
}

/// Individual row showing a single approval item in the batch
struct ApprovalItemRow: View {
    let block: ChatContentBlock

    var body: some View {
        HStack(spacing: 8) {
            // Icon based on tool name or action type
            Image(systemName: iconName)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                if let toolName = block.toolName {
                    Text(toolName)
                        .font(.caption.weight(.medium))
                        .foregroundColor(.primary)
                }

                if let prompt = block.prompt {
                    Text(prompt)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color(.systemBackground))
        .cornerRadius(6)
    }

    private var iconName: String {
        if let toolName = block.toolName?.lowercased() {
            if toolName.contains("edit") || toolName.contains("write") {
                return "pencil"
            } else if toolName.contains("read") {
                return "doc.text"
            } else if toolName.contains("bash") || toolName.contains("command") {
                return "terminal"
            } else if toolName.contains("delete") {
                return "trash"
            }
        }
        return "wrench.and.screwdriver"
    }
}

#Preview {
    let sampleBlocks = [
        ChatContentBlock(
            id: "1",
            type: .approvalRequest,
            timestamp: Date().timeIntervalSince1970,
            toolName: "Edit",
            prompt: "Edit file: src/components/Button.tsx"
        ),
        ChatContentBlock(
            id: "2",
            type: .approvalRequest,
            timestamp: Date().timeIntervalSince1970,
            toolName: "Edit",
            prompt: "Edit file: src/styles/theme.css"
        ),
        ChatContentBlock(
            id: "3",
            type: .approvalRequest,
            timestamp: Date().timeIntervalSince1970,
            toolName: "Write",
            prompt: "Write new file: src/utils/helpers.ts"
        ),
    ]

    return VStack(spacing: 20) {
        BatchApprovalView(
            approvalBlocks: sampleBlocks,
            hasResponded: false,
            onBatchApproval: { approved in
                print("Batch approval: \(approved)")
            }
        )

        BatchApprovalView(
            approvalBlocks: sampleBlocks,
            hasResponded: true,
            onBatchApproval: { _ in }
        )
    }
    .padding()
}
