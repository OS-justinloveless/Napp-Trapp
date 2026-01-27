# Photo and Attachment Support for Mobile Chats

This document describes the implementation of photo and attachment support in Cursor Mobile.

## Overview

Users can now attach photos and files to their mobile chat messages. This feature includes:

- **Photo selection** from the device's photo library
- **Camera integration** to take photos directly
- **Multiple attachments** (up to 5 per message)
- **Image preview** in chat bubbles
- **Full-screen image viewer** with pinch-to-zoom
- **File attachment support** (extensible for documents)

## Architecture

### iOS Client

#### Models (`Models/Conversation.swift`)
- `MessageAttachment`: Represents an attachment with metadata
  - Supports image, document, and file types
  - Contains base64-encoded data and optional thumbnails
  - Includes filename, MIME type, and size information

- `ConversationMessage`: Extended to include optional attachments array

#### UI Components

1. **ImagePicker.swift**: Photo selection component
   - `ImagePickerButton`: Compact button for message input area
   - `CameraPicker`: UIKit wrapper for camera access
   - `SelectedImage`: Model for selected images with thumbnail generation

2. **ConversationsView.swift**: Updated conversation UI
   - Image preview in message input area
   - Remove button for selected images
   - Attachment display in message bubbles:
     - `AttachmentsView`: Container for all attachments
     - `ImageAttachmentView`: Displays images with tap-to-expand
     - `FileAttachmentView`: Displays file attachments with icons
     - `FullScreenImageView`: Full-screen image viewer with zoom

#### API Service (`Services/APIService.swift`)
- `sendMessage()`: Updated to send attachments as part of the request body
- Attachments are JSON-encoded and included in the message payload

### Server

#### API Endpoint (`routes/conversations.js`)
- `POST /api/conversations/:conversationId/messages`: Enhanced to accept attachments
- Processes attachment metadata and stores with messages
- Logs attachment count for debugging

#### Data Storage

1. **MobileChatStore** (`utils/MobileChatStore.js`)
   - Extended to store attachments with messages
   - Attachments persist in mobile chat store JSON file

2. **CursorChatWriter** (`utils/CursorChatWriter.js`)
   - Converts attachments to Cursor's bubble format
   - Images are stored in the `images` array with base64 data
   - Compatible with Cursor IDE's schema (version 3)

### Permissions (`Info.plist`)
- `NSPhotoLibraryUsageDescription`: Permission to access photo library
- `NSCameraUsageDescription`: Permission to use the camera

## Usage

1. **Attach Photos**:
   - Tap the photo icon in the message input area
   - Choose "Photo Library" or "Take Photo"
   - Select up to 5 photos
   - Photos appear as thumbnails above the input field

2. **Remove Photos**:
   - Tap the X button on any thumbnail to remove it

3. **Send Message**:
   - Messages can be sent with text, photos, or both
   - Photos are compressed (70% quality) to reduce bandwidth
   - Thumbnails are generated for efficient display

4. **View Images**:
   - Tap any image in a message bubble to view full-screen
   - Pinch to zoom
   - Tap "Done" to return to conversation

## Technical Details

### Image Compression
- Images are compressed to 70% JPEG quality before sending
- Thumbnails are generated at 150px max dimension
- Base64 encoding is used for transport

### Data Flow
```
1. User selects image → SelectedImage model created
2. On send → Convert to MessageAttachment with base64 data
3. Send to server → Attachments array in JSON body
4. Server stores → MobileChatStore persists attachments
5. Display → Decode base64 and render UIImage
```

### Storage Format

**iOS Model:**
```swift
MessageAttachment {
  id: String
  type: AttachmentType (.image, .document, .file)
  filename: String
  mimeType: String
  size: Int?
  data: String? // Base64 encoded
  url: String?
  thumbnailData: String? // Base64 encoded thumbnail
}
```

**Server Storage (MobileChatStore):**
```json
{
  "messages": {
    "chatId": [
      {
        "id": "msg-123",
        "type": "user",
        "text": "Check out this image",
        "timestamp": 1234567890,
        "attachments": [
          {
            "id": "att-456",
            "type": "image",
            "filename": "photo.jpg",
            "mimeType": "image/jpeg",
            "size": 52341,
            "data": "base64encodeddata..."
          }
        ]
      }
    ]
  }
}
```

**Cursor Database (CursorChatWriter):**
```json
{
  "bubbleId": "123",
  "type": 1,
  "text": "Check out this image",
  "images": [
    {
      "type": "base64",
      "data": "base64encodeddata...",
      "mimeType": "image/jpeg",
      "name": "photo.jpg"
    }
  ]
}
```

## Limitations and Future Enhancements

### Current Limitations
1. **cursor-agent support**: The cursor-agent CLI doesn't currently support image attachments in its input format. Images are stored in the mobile chat store and Cursor database but won't be sent to the AI model via cursor-agent.

2. **File size**: No hard limit on file size, but large images may cause performance issues. Consider adding a size limit (e.g., 10MB per image).

3. **File types**: Currently optimized for images. Document support is implemented in the model but not fully integrated.

### Future Enhancements
1. **Document support**: Add PDF, text file, and other document type support
2. **Video attachments**: Support video recording and playback
3. **Cloud storage**: Offload large attachments to cloud storage with URLs
4. **AI vision**: When cursor-agent supports it, enable AI to analyze attached images
5. **Attachment compression**: More aggressive compression options for bandwidth savings
6. **Progress indicators**: Show upload progress for large files
7. **Offline support**: Queue attachments for sending when connection is restored

## Testing

To test the feature:

1. **Photo Library**:
   - Ensure device has photos
   - Grant photo library permission when prompted
   - Select single and multiple photos

2. **Camera**:
   - Test on physical device (camera not available in simulator)
   - Grant camera permission when prompted
   - Take photos and verify they appear in message

3. **Message Flow**:
   - Send messages with only images
   - Send messages with text and images
   - Verify images appear in sent messages
   - Test image viewer (tap to expand, pinch to zoom)

4. **Edge Cases**:
   - Test with 5 images (maximum)
   - Verify remove button works
   - Test with very large images
   - Test canceling photo picker

## Implementation Notes

- **Memory Management**: Images are held in memory only while composing. Once sent, they're released and only stored as base64 strings.

- **Thread Safety**: All UI updates happen on MainActor to prevent threading issues.

- **Permissions**: The app gracefully handles permission denials. If denied, the respective option won't work but the app continues functioning.

- **Backwards Compatibility**: Messages without attachments continue to work as before. The attachments field is optional everywhere.

## Related Files

### iOS
- `ios-client/CursorMobile/CursorMobile/Models/Conversation.swift`
- `ios-client/CursorMobile/CursorMobile/Views/Components/ImagePicker.swift`
- `ios-client/CursorMobile/CursorMobile/Views/Conversations/ConversationsView.swift`
- `ios-client/CursorMobile/CursorMobile/Services/APIService.swift`
- `ios-client/CursorMobile/CursorMobile/Info.plist`

### Server
- `server/src/routes/conversations.js`
- `server/src/utils/MobileChatStore.js`
- `server/src/utils/CursorChatWriter.js`
