# Auto Slack Chrome Extension - Technical Reference

## TL;DR

Chrome extension for automated Slack message extraction and organization. This document serves as
the comprehensive technical reference for the team.

## Architecture Overview

Below is the complete technical implementation. Each section contains detailed specifications and
code examples for team reference.

### Project Structure

```
src/
├── services/          # Core functionality
│   └── extraction/    # Message extraction services
│       ├── connection.ts      # Connection management
│       ├── message-extractor.ts # Message extraction logic
│       ├── monitor.ts         # Monitoring service
│       ├── schemas.ts         # Zod schemas and types
│       ├── storage.ts         # Storage management
│       ├── types.ts          # Type exports
│       └── index.ts          # Service exports
├── background.ts      # Service worker
├── content.ts         # Content script
├── popup.ts          # Extension UI logic
├── popup.html        # Extension UI markup
└── manifest.json     # Extension config
```

## Implementation Specifications

### 1. Background Service Worker (background.ts)

The background script manages global state and communication between components.

Key Features:

- State management for tab-specific extraction status
- Message routing between content scripts and popup
- Heartbeat monitoring for connection health
- Sync coordination between tabs

Key Interfaces:

```typescript
interface BackgroundState {
  isExtracting: boolean;
  currentChannel: {
    channel: string;
    organization: string;
  } | null;
  extractedMessages: MessagesByOrganization;
}

interface TabState {
  lastHeartbeat: number;
  state: BackgroundState | null;
}
```

Constants:

```typescript
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds
const CLEANUP_INTERVAL = 10000; // 10 seconds
const SYNC_INTERVAL = 10000; // 10 seconds
```

### 2. Content Script (content.ts)

Handles direct interaction with Slack's web interface.

Key Features:

- Service initialization and management
- Message extraction coordination
- Connection monitoring
- Error handling and recovery

Key Services Initialization:

```typescript
let monitorService: MonitorService;
let connectionService: ConnectionService;
let messageExtractor: MessageExtractor;
let storageService: StorageService;
```

Constants:

```typescript
const RETRY_DELAY = 1000; // 1 second
const MAX_RETRIES = 3;
const CONNECTION_CHECK_INTERVAL = 10000; // 10 seconds
```

### 3. Popup Interface (popup.ts, popup.html)

Manages the extension's user interface.

Key Features:

- Dark mode support with system color scheme preference
- Modern UI with optimized spacing and layout
- Extraction control (start/stop)
- Status display with loading states
- Message count tracking
- Time range visualization
- Download functionality
- Channel-specific message deletion
- Custom confirmation dialogs
- Auto-scroll toggle

HTML Structure:

```html
<meta name="color-scheme" content="dark light">
<style>
  :root {
    color-scheme: dark light;
  }
  body {
    overscroll-behavior: none;
  }
</style>
```

UI Components:

- Status indicator with loading skeleton states
- Control buttons with disabled states
- Statistics display
- Time range display with delete functionality
- Auto-scroll toggle
- Custom confirmation dialog
- Modern SVG icons

Delete Functionality:

```typescript
interface OrgChannelGroup {
  organization: string;
  channel: string;
}

const handleDelete = async (organization: string, channel: string): Promise<void> => {
  await storageService.pruneMessagesByOrgGroup([{ organization, channel }]);
  // Update UI state
};
```

### 4. Message Extractor Service (message-extractor.ts)

Core service for extracting messages from Slack's DOM.

Key Methods:

```typescript
class MessageExtractor {
  public getMessageContainer(): Element | null;
  public extractChannelInfo(): ChannelInfo | null;
  public extractMessageSender(listItem: Element): SenderInfo;
  public extractMessageTimestamp(element: Element): {
    timestamp: string | null;
    permalink: string | null;
  };
  public extractMessageText(element: Element): string;
  public extractMessageAttachments(element: Element): Attachment[];
  public markMessageAsExtracted(element: Element, isInRange?: boolean): void;
}
```

### 5. Monitor Service (monitor.ts)

Manages message extraction monitoring and auto-scrolling.

Key Features:

```typescript
class MonitorService {
  public async startMonitoring(): Promise<void>;
  public async stopMonitoring(): Promise<void>;
  public getCurrentState(): {
    isExtracting: boolean;
    channelInfo: ChannelInfo | null;
    messageCount: number;
    extractedMessages: MessagesByOrganization;
  };
}
```

Constants:

```typescript
private readonly SCROLL_DEBOUNCE_MS = 250;
private readonly POLLING_INTERVAL_MS = 2000;
private readonly TITLE_CHECK_INTERVAL_MS = 5000;
private readonly RECONNECT_CHECK_INTERVAL_MS = 7500;
private readonly AUTO_SCROLL_STEP = 300;
private readonly AUTO_SCROLL_INTERVAL_MS = 200;
private readonly SCROLL_PAUSE_MS = 250;
private readonly MAX_SCROLL_ATTEMPTS = 150;
private readonly SCROLL_THRESHOLD = 100;
private readonly MAX_WAIT_FOR_MESSAGES_MS = 1500;
private readonly MAX_CONSECUTIVE_FAILURES = 3;
```

Mutation Observer Levels:

```typescript
private readonly OBSERVER_LEVELS = {
  CONTAINER: 'container',
  MESSAGE_LIST: 'messageList',
  MESSAGE_ITEM: 'messageItem',
  MESSAGE_CONTENT: 'messageContent',
} as const;
```

### 6. Storage Service (storage.ts)

Manages data persistence using Chrome's storage API.

Key Methods:

```typescript
class StorageService {
  public async loadState(): Promise<StorageState>;
  public async loadAllMessages(): Promise<MessagesByOrganization>;
  public async saveState(state: StorageState): Promise<void>;
  public async mergeAndSaveMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): Promise<void>;
  public isTimeRangeExtracted(organization: string, channel: string, timestamp: number): boolean;
  public async pruneMessagesByOrgGroup(groups: Array<{ organization: string; channel: string }>): Promise<void>;
}
```

### 7. Connection Service (connection.ts)

Manages communication between components.

Key Methods:

```typescript
class ConnectionService {
  public initializeConnection(): void;
  public handleConnectionLoss(): void;
  public checkConnection(): void;
  public updateLastHeartbeat(timestamp: number): void;
  public isConnected(): boolean;
  public async sendSync(): Promise<void>;
}
```

Constants:

```typescript
private static readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
private static readonly SYNC_INTERVAL = 10000; // 10 seconds
private static readonly HEARTBEAT_TIMEOUT = 10000; // 10 seconds
private static readonly DEBOUNCE_DELAY = 1000; // 1 second
```

## Technical Architecture

### Data Structures (schemas.ts)

#### Message Schemas

```typescript
const SlackMessageSchema = z.object({
  sender: z.string().nullable(),
  senderId: z.string().nullable(),
  timestamp: z.string().nullable(),
  text: z.string(),
  permalink: z.string().nullable(),
  customStatus: CustomStatusSchema.nullable(),
  avatarUrl: z.string().nullable(),
  messageId: z.string().nullable(),
  isInferredSender: z.boolean().default(false),
  attachments: z.array(AttachmentSchema).optional(),
});

const MessagesByDateSchema = z.record(z.string(), z.array(SlackMessageSchema));
const MessagesByChannelSchema = z.record(z.string(), MessagesByDateSchema);
const MessagesByOrganizationSchema = z.record(z.string(), MessagesByChannelSchema);
```

#### State Schemas

```typescript
const ExtensionStateSchema = z.object({
  isExtracting: z.boolean(),
  currentChannel: ChannelInfoSchema.nullable(),
  extractedMessages: MessagesByOrganizationSchema,
});

const StorageStateSchema = z.object({
  isExtracting: z.boolean(),
  currentChannel: z.union([
    z.null(),
    z.object({
      organization: z.string(),
      channel: z.string(),
    }),
  ]),
  extractedMessages: MessagesByOrganizationSchema,
  isScrollingEnabled: z.boolean().default(true),
  extractedTimeRanges: z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.array(
          z.object({
            start: z.number(),
            end: z.number(),
          }),
        ),
      ),
    )
    .default({}),
});
```

## Message Flow

1. Content script initializes services
2. Hierarchical mutation observers monitor DOM changes at multiple levels:
   - Container level for structural changes
   - Message list level for new messages
   - Message item level for content updates
   - Message content level for text changes
3. Message extractor pulls data from message elements
4. Storage service persists extracted messages with organization-channel grouping
5. Connection service maintains sync between components
6. Background script coordinates between tabs
7. Popup interface provides user control and feedback with modern UI

## Error Handling

- Automatic retry mechanism for failed operations
- Connection loss recovery
- Context invalidation handling
- Storage error recovery
- DOM mutation handling

## Performance Considerations

- Debounced writes to storage
- Batched message processing
- Efficient DOM traversal
- Memory usage optimization
- Connection health monitoring

## Security Considerations

- Data is stored locally in Chrome storage
- No external API calls
- Sandboxed content script
- Clean data validation through Zod schemas

## Implementation Details

### DOM Interaction

#### Message Container Selection

```typescript
// Priority order for container selection:
1. .p-message_pane
2. .c-virtual_list__scroll_container
3. [data-qa="message_pane"]
4. .p-workspace__primary_view_body
```

#### Message Extraction Selectors

```typescript
// Message text
'[data-qa="message-text"]';

// Sender information
'[data-message-sender]';
'.c-message__sender';

// Timestamp
'.c-timestamp';
'[data-ts]';

// Attachments
'.c-message_kit__attachments';
'.p-rich_text_block';
```

### Storage Implementation

#### Chrome Storage Structure

```typescript
interface StorageData {
  [STORAGE_KEY]: StorageState;
  [METRICS_KEY]: {
    avgReadTime: number;
    avgWriteTime: number;
    totalReads: number;
    totalWrites: number;
  };
}
```

#### Storage Optimization

- Debounced writes (1000ms delay)
- Batched operations
- Memory caching
- Write queue management

### Message Processing Pipeline

1. DOM Mutation Detection

```typescript
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      // Process new nodes
    }
  }
});
```

2. Message Extraction

```typescript
// Extraction process:
1. Identify message container
2. Extract channel info
3. Process message elements
4. Extract sender info
5. Extract timestamp
6. Extract message content
7. Process attachments
8. Mark as extracted
```

3. Storage Processing

```typescript
// Message storage hierarchy:
Organization
└── Channel
    └── Date
        └── Messages[]
```

### Error Recovery Mechanisms

#### Connection Loss

```typescript
const handleConnectionLoss = () => {
  1. Mark connection as lost
  2. Clear intervals
  3. Trigger recovery callback
  4. Reinitialize connection
  5. Retry with exponential backoff
};
```

#### Storage Errors

```typescript
const handleStorageError = async () => {
  1. Attempt to load from cache
  2. If cache fails, initialize empty state
  3. Queue failed writes for retry
  4. Monitor storage quota
};
```

#### Context Invalidation

```typescript
const handleContextInvalidation = () => {
  1. Check retry count
  2. Clean up services
  3. Attempt reinitialization
  4. Apply exponential backoff
};
```

### Performance Optimization

#### Memory Management

```typescript
// Message cleanup strategy
1. Group messages by time ranges
2. Merge overlapping ranges
3. Limit range count per channel
4. Implement LRU cache for active ranges
```

#### DOM Operations

```typescript
// Optimization techniques
1. Use DocumentFragment for batch updates
2. Debounce scroll handlers
3. Throttle mutation observers
4. Cache DOM queries
5. Use virtual scrolling markers
```

### Security Considerations

#### Data Sanitization

```typescript
// Input sanitization steps
1. Validate DOM content
2. Sanitize message text
3. Validate timestamps
4. Verify permalinks
5. Sanitize custom status
```

#### Storage Security

```typescript
// Storage security measures
1. Validate data before storage
2. Encrypt sensitive data
3. Implement quota management
4. Handle storage corruption
5. Validate data on retrieval
```

## Debugging Guide

### Common Issues

1. Message Extraction Fails

```typescript
// Troubleshooting steps
1. Check DOM structure changes
2. Verify selectors
3. Check mutation observer
4. Validate extraction timing
```

2. Storage Issues

```typescript
// Debug process
1. Check quota limits
2. Verify data structure
3. Check for corruption
4. Validate schema
```

3. Connection Problems

```typescript
// Resolution steps
1. Check heartbeat
2. Verify message routing
3. Check service worker
4. Validate tab state
```

### Development Tools

#### Chrome Extension Tools

- Chrome DevTools
- Background Page Inspector
- Storage Inspector
- Network Monitor

#### Debug Logging

```typescript
// Log levels
1. ERROR: Critical failures
2. WARN: Recoverable issues
3. INFO: State changes
4. DEBUG: Detailed operations
```

## Visual Indicators

### CSS Classes and Styling

```css
.saved-indicator {
  margin-left: 6px;
  color: var(--sk_foreground_max_solid, #4a154b);
  opacity: 0.7;
  font-size: 12px;
  font-style: italic;
  user-select: none;
  pointer-events: none;
  vertical-align: baseline;
}

.auto-slack-scroll-container {
  border: 2px solid rgba(54, 197, 171, 0.4) !important;
  border-radius: 4px !important;
}

.auto-slack-scroll-container--scrolling {
  border-color: rgba(54, 197, 171, 0.8) !important;
}
```

### DOM Attributes

```typescript
// Extraction markers
private readonly EXTRACTED_ATTRIBUTE = 'data-extracted';
private readonly RANGE_ATTRIBUTE = 'data-in-extracted-range';
```

## Monitoring Service Details

### Time Constants

```typescript
// Timing configurations
private readonly SCROLL_DEBOUNCE_MS = 250;
private readonly POLLING_INTERVAL_MS = 2000;
private readonly TITLE_CHECK_INTERVAL_MS = 5000;
private readonly RECONNECT_CHECK_INTERVAL_MS = 7500;
private readonly AUTO_SCROLL_STEP = 300;
private readonly AUTO_SCROLL_INTERVAL_MS = 200;
private readonly SCROLL_PAUSE_MS = 250;
private readonly MAX_WAIT_FOR_MESSAGES_MS = 1500;
private readonly MAX_IDLE_TIME_MS = 10000;
```

### Scroll Management

```typescript
// Scroll control
private readonly MAX_SCROLL_ATTEMPTS = 150;
private readonly SCROLL_THRESHOLD = 100;
private readonly FORCE_SCROLL_MULTIPLIER = 2;
private autoScrollInterval: number | null = null;
private lastScrollPosition: number = 0;
private scrollAttempts: number = 0;
```

### Bi-directional Scrolling

The extension supports bi-directional scrolling with direction tracking per channel:

```typescript
// Direction schema
export const ScrollDirectionSchema = z.enum(['up', 'down']).default('up');
export const ScrollDirectionsSchema = z
  .record(z.string(), z.record(z.string(), ScrollDirectionSchema))
  .default({});
```

#### Direction Management

1. Direction Storage:
   - Stored per organization and channel
   - Persists across sessions
   - Defaults to 'up' for new channels

2. Direction Toggle:
   ```typescript
   // Toggle direction when reaching endpoint
   const isAtEndpoint = direction === 'up'
     ? element.scrollTop <= buffer // Near top
     : element.scrollTop + element.clientHeight >= element.scrollHeight - buffer; // Near bottom
   ```

3. Message Processing:
   ```typescript
   // Process messages based on direction
   const messages = direction === 'up'
     ? Array.from(messageElements).reverse() // Bottom to top
     : Array.from(messageElements); // Top to bottom
   ```

4. Auto-scroll Behavior:
   - Starts scrolling up by default
   - Toggles direction at endpoints (top/bottom)
   - Maintains scroll direction per channel
   - Resets scroll attempts on direction change
   - Uses 100px buffer for endpoint detection

5. Performance Optimizations:
   - Dynamic chunk sizing based on viewport
   - Direction-aware message processing
   - Smooth scrolling with easing functions
   - Debounced scroll operations
   - Efficient DOM updates

### State Management

```typescript
// Service state
private observer: MutationObserver | null = null;
private titleCheckInterval: number | null = null;
private extractedMessages: MessagesByOrganization = {};
private currentChannelInfo: ChannelInfo | null = null;
private lastMessageTimestamp: number = Date.now();
private reconnectInterval: number | null = null;
private scrollTimeout: number | null = null;
private pollingInterval: number | null = null;
private lastMessageCount: number = 0;
private isExtracting = false;
private isAutoScrolling = false;
private lastScrollTime: number = Date.now();
```

## Error Handling Enhancements

### Context Recovery

```typescript
// Recovery steps for context invalidation
1. Check current extraction state
2. Save pending changes
3. Clear all intervals and timeouts
4. Reset service state
5. Attempt service reinitialization
6. Restore last known state
7. Resume extraction if active
```

### Storage Recovery

```typescript
// Storage error recovery process
1. Validate storage integrity
2. Attempt to recover from cache
3. Merge conflicting changes
4. Rebuild time ranges
5. Verify data consistency
6. Update metrics
7. Resume normal operation
```

## Performance Optimizations

### DOM Monitoring

```typescript
// Mutation observer optimization
const observerOptions = {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false,
};

// Selective node processing
const shouldProcessNode = (node: Node): boolean => {
  return (
    node instanceof Element &&
    !node.hasAttribute(EXTRACTED_ATTRIBUTE) &&
    (node.matches('[data-qa="message-text"]') ||
      node.querySelector('[data-qa="message-text"]') !== null)
  );
};
```

### Memory Management

```typescript
// Memory optimization strategies
1. Clear extracted messages periodically
2. Implement message age-out policy
3. Limit time range storage
4. Cleanup orphaned references
5. Garbage collection hints
```

## Development Guidelines

### Code Style

```typescript
// Naming conventions
interface IService {}        // Interface prefix
type TConfig = {}           // Type prefix
const CONSTANT_VALUE = '';  // Constants uppercase
private _privateVar = null; // Private prefix

// File organization
1. Imports
2. Types/Interfaces
3. Constants
4. Class declaration
5. Private methods
6. Public methods
7. Event handlers
```

## Maintenance Scripts

### Health Check

```bash
#!/bin/bash
# health-check.sh
echo "Checking extension health..."

# Verify storage
chrome.storage.local.get(null, function(data) {
  console.log('Storage size:', JSON.stringify(data).length);
});

# Check performance
console.time('messageExtraction');
// Run extraction
console.timeEnd('messageExtraction');

# Validate selectors
const selectors = [
  '.p-message_pane',
  '[data-qa="message-text"]',
  '.c-timestamp'
];
selectors.forEach(s => {
  const el = document.querySelector(s);
  console.log(`${s}: ${el ? 'Found' : 'Missing'}`);
});
```

## Support and Troubleshooting

### Common Issues

1. Message Extraction Stops

   - Check DOM changes
   - Verify scroll position
   - Validate channel info
   - Check storage quota

2. Performance Degradation

   - Monitor message count
   - Check memory usage
   - Verify observer load
   - Profile DOM operations

3. Storage Issues
   - Verify quota usage
   - Check data integrity
   - Validate schemas
   - Review error logs

### Recovery Procedures

1. Extension Reset

```typescript
// Reset steps
1. Clear storage
2. Reset service worker
3. Reinitialize services
4. Rebuild indexes
5. Restore configuration
```

2. Data Recovery

```typescript
// Recovery process
1. Export current data
2. Validate backup
3. Clear corrupted data
4. Import verified data
5. Rebuild time ranges
```

## Security Guidelines

### Data Handling

```typescript
// Security practices
1. Sanitize message content
2. Validate timestamps
3. Verify permalinks
4. Escape HTML content
5. Validate JSON data
```

### Storage Security

```typescript
// Storage security
1. Encrypt sensitive data
2. Validate data integrity
3. Implement access control
4. Handle quota exceeded
5. Secure error logging
```

## Message Extraction Implementation

### Organization Name Extraction

The extension extracts organization names in the following priority order:

1. From search view title:

```typescript
// Match pattern: "Search - {org} - Slack"
const searchMatch = document.title.match(/^Search - (.+?) - Slack$/);
```

2. From URL hostname:

```typescript
// Match pattern: "{org}.slack.com"
const orgMatch = window.location.hostname.match(/^([^.]+)\.slack\.com$/);
// Reject 'app' as a valid organization
if (organization && organization !== 'app') {
  // Use organization name
}
```

3. From channel title:

```typescript
// Match pattern: "{channel} (Channel) - {org} - Slack"
const channelMatch = document.title.match(/^(.+?) \(Channel\) - (.+?) - Slack$/);
// Clean organization name by removing notification counts
const cleanOrg = organization.replace(/\s*-\s*\d+\s*(new\s*items?)?$/, '').trim();
```

4. From DM title:

```typescript
// Match pattern: "{user} (DM) - {org} - Slack"
const dmMatch = document.title.match(/^(.+?) \(DM\) - (.+?) - Slack$/);
// Clean organization name by removing notification counts
const cleanOrg = organization.replace(/\s*-\s*\d+\s*(new\s*items?)?$/, '').trim();
```

### Container Detection

The extension needs to find the correct container for Slack messages. This is done in order of
preference:

1. Direct message pane lookup:

```typescript
// Primary container selectors
'.p-message_pane';
'.c-virtual_list__scroll_container';
'[data-qa="message_pane"]';
```

2. Container validation checks:

```typescript
const isValidContainer = (element: Element) => {
  // Must be scrollable
  const hasScroll = element.scrollHeight > element.clientHeight;

  // Must have sufficient height
  const hasHeight = element.clientHeight > 100;

  // Must contain messages
  const hasMessages = element.querySelector('[data-qa="message-text"]');

  return hasScroll && hasHeight && hasMessages;
};
```

### Channel Information

The extension extracts channel info from multiple sources:

1. Search Results:

```typescript
// From search view
'.c-channel_entity__name'
document.title pattern: 'Search - {org} - Slack'

// From URL
hostname pattern: '{org}.slack.com'
```

2. Regular Channels:

```typescript
// Title patterns
Channel: '{channel} (Channel) - {org} - Slack';
DM: '{user} (DM) - {org} - Slack';
```

### Message Processing

1. Message Structure:

```typescript
interface SlackMessage {
  sender: string | null; // Message sender
  senderId: string | null; // Unique sender ID
  timestamp: string | null; // Message timestamp
  text: string; // Message content
  permalink: string | null; // Message link
  customStatus?: {
    // Sender's status
    emoji: string | null;
    emojiUrl: string | null;
  };
  avatarUrl: string | null; // Sender's avatar
  messageId: string | null; // Unique message ID
  attachments?: Array<{
    // Message attachments
    type: string;
    title: string | null;
    text: string | null;
    images?: Array<{
      url: string;
      thumbnailUrl: string | null;
      alt: string | null;
    }>;
  }>;
}
```

2. Storage Organization:

```typescript
type MessageStore = {
  [organization: string]: {
    [channel: string]: {
      [date: string]: SlackMessage[];
    };
  };
};
```

## State Management

### Extension States

```typescript
interface ExtensionState {
  isExtracting: boolean; // Extraction active
  currentChannel: {
    // Current channel
    channel: string;
    organization: string;
  } | null;
  extractedMessages: MessageStore; // All messages
  isScrollingEnabled: boolean; // Auto-scroll
}
```

### Storage Management

The extension uses Chrome's storage API with optimizations:

1. Write Batching:

```typescript
// Batch writes with 1-second delay
private WRITE_DELAY = 1000;
private writeQueue: Array<() => Promise<void>> = [];

private scheduleWrite(write: () => Promise<void>) {
  this.writeQueue.push(write);
  if (!this.writeTimeout) {
    this.writeTimeout = setTimeout(
      () => this.flushWrites(),
      this.WRITE_DELAY
    );
  }
}
```

2. Memory Management:

```typescript
// Clear old messages periodically
const cleanupOldMessages = () => {
  const thirtyDaysAgo = subDays(new Date(), 30);
  // Remove messages older than 30 days
  // Keep important messages
  // Update storage
};
```

## Error Recovery

### Connection Issues

The extension handles various connection scenarios:

1. Tab Disconnection:

```typescript
// Check connection every 10 seconds
const checkConnection = () => {
  const now = Date.now();
  if (now - lastHeartbeat > 10000) {
    handleConnectionLoss();
  }
};
```

2. Service Worker Reset:

```typescript
// Handle service worker updates
chrome.runtime.onUpdateAvailable.addListener(() => {
  // Save state
  // Clear intervals
  // Reload extension
});
```

### Data Integrity

The extension ensures data integrity through:

1. Schema Validation:

```typescript
// Validate all data through Zod schemas
const validateMessage = (data: unknown) => {
  return SlackMessageSchema.parse(data);
};
```

2. Storage Checks:

```typescript
// Verify storage integrity
const verifyStorage = async () => {
  const data = await chrome.storage.local.get();
  return StorageStateSchema.safeParse(data);
};
```

## Performance Considerations

### DOM Interaction

The extension optimizes DOM operations:

1. Mutation Observer:

```typescript
// Only observe relevant changes
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      processNewNodes(mutation.addedNodes);
    }
  }
});

observer.observe(container, {
  childList: true,
  subtree: true,
  attributes: false,
});
```

2. Scroll Management:

```typescript
// Debounce scroll events
const handleScroll = debounce(() => {
  if (isAutoScrolling) return;
  processVisibleMessages();
}, 250);
```

### Memory Usage

The extension manages memory through:

1. Message Cleanup:

```typescript
// Remove processed messages
const cleanupProcessedMessages = () => {
  const processedNodes = container.querySelectorAll(`[${EXTRACTED_ATTRIBUTE}]`);
  for (const node of processedNodes) {
    node.remove();
  }
};
```

2. Storage Optimization:

```typescript
// Compress message data
const compressMessages = (messages: SlackMessage[]) => {
  return messages.map((msg) => ({
    ...msg,
    // Remove null values
    // Compress long text
    // Remove duplicate data
  }));
};
```

## UI/UX Considerations

### Dark Mode Support

- System color scheme preference detection
- Consistent dark mode styling
- Smooth transitions between modes
- High contrast text and controls

### Modern Interface

- Skeleton loading states
- Custom confirmation dialogs
- Smooth animations
- Responsive layout
- Optimized spacing
- SVG icons
- No nested scrolling
- Disabled rubber-band scrolling

### Message Management

- Organization-channel group deletion
- Custom confirmation dialogs
- Visual feedback for actions
- Loading states during operations
- Error handling with user feedback
