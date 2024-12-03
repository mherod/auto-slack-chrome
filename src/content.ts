import type { IncomingMessage } from './services/extraction';
import {
  ConnectionService,
  MessageExtractor,
  MonitorService,
  StorageService,
} from './services/extraction';

let monitorService: MonitorService;
let connectionService: ConnectionService;
let messageExtractor: MessageExtractor;
let storageService: StorageService;

const RETRY_DELAY = 1000; // 1 second
const MAX_RETRIES = 3;
const CONNECTION_CHECK_INTERVAL = 10000; // 10 seconds
let retryCount = 0;

const isContextInvalidated = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.message.includes('Extension context invalidated');
  }
  if (chrome.runtime.lastError) {
    return chrome.runtime.lastError.message?.includes('Extension context invalidated') ?? false;
  }
  return false;
};

const handleContextInvalidation = (): void => {
  if (retryCount >= MAX_RETRIES) {
    console.error('Max retries reached for context invalidation recovery');
    return;
  }

  retryCount++;
  console.log(
    `Attempting to recover from context invalidation (attempt ${retryCount}/${MAX_RETRIES})`,
  );

  // Clean up existing services
  stopConnectionCheck();
  if (typeof monitorService !== 'undefined') {
    void monitorService.stopMonitoring();
  }

  // Attempt to reinitialize after a delay
  window.setTimeout(() => {
    initializeServices();
    startConnectionCheck();
  }, RETRY_DELAY * retryCount); // Exponential backoff
};

const initializeServices = (): void => {
  try {
    // Initialize services
    messageExtractor = new MessageExtractor();
    storageService = new StorageService();

    // Initialize monitor service first since connection service needs its state
    monitorService = new MonitorService(
      messageExtractor,
      storageService,
      (channelInfo) => {
        // Handle channel change
        void chrome.runtime
          .sendMessage({
            type: 'EXTRACTION_STATUS',
            status: `Now monitoring ${channelInfo.channel}...`,
          })
          .catch((error) => {
            if (isContextInvalidated(error)) {
              handleContextInvalidation();
            }
          });
      },
      () => {
        // Handle sync request
        if (connectionService !== undefined && connectionService.isConnected()) {
          void connectionService.sendSync().catch((error) => {
            if (isContextInvalidated(error)) {
              handleContextInvalidation();
            }
          });
        }
      },
    );

    // Initialize connection service
    connectionService = new ConnectionService(
      () => {
        // Handle connection loss
        if (isContextInvalidated(chrome.runtime.lastError)) {
          handleContextInvalidation();
        }
      },
      () => monitorService.getCurrentState(),
    );

    // Initialize connection
    connectionService.initializeConnection();

    // Reset retry count on successful initialization
    retryCount = 0;
  } catch (error) {
    console.error('Failed to initialize services:', error);
    if (isContextInvalidated(error)) {
      handleContextInvalidation();
    }
  }
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
  try {
    if (message.type === 'heartbeat' && 'timestamp' in message) {
      connectionService.updateLastHeartbeat(message.timestamp);
      sendResponse({ success: true });
    } else if (message.type === 'sync' && 'data' in message) {
      // Handle sync message
      const currentState = monitorService.getCurrentState();
      void storageService
        .mergeAndSaveMessages(currentState.extractedMessages, message.data.extractedMessages)
        .catch((error) => {
          if (isContextInvalidated(error)) {
            handleContextInvalidation();
          }
        });
      sendResponse({ success: true });
    } else if (message.type === 'START_EXTRACTION') {
      void monitorService.startMonitoring().catch((error) => {
        if (isContextInvalidated(error)) {
          handleContextInvalidation();
        }
      });
      sendResponse({ success: true });
    } else if (message.type === 'STOP_EXTRACTION') {
      void monitorService.stopMonitoring().catch((error) => {
        if (isContextInvalidated(error)) {
          handleContextInvalidation();
        }
      });
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    if (isContextInvalidated(error)) {
      handleContextInvalidation();
    }
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  return true;
});

// Check connection status periodically
let connectionCheckInterval: number | null = null;

const startConnectionCheck = (): void => {
  if (connectionCheckInterval === null) {
    connectionCheckInterval = window.setInterval(() => {
      try {
        if (connectionService !== undefined) {
          connectionService.checkConnection();
        }
      } catch (error) {
        console.error('Connection check failed:', error);
        if (isContextInvalidated(error)) {
          handleContextInvalidation();
        }
      }
    }, CONNECTION_CHECK_INTERVAL);
  }
};

const stopConnectionCheck = (): void => {
  if (connectionCheckInterval !== null) {
    window.clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
};

// Initialize services when content script loads
initializeServices();
startConnectionCheck();

// Cleanup on unload
window.addEventListener('unload', () => {
  stopConnectionCheck();
  if (typeof monitorService !== 'undefined') {
    void monitorService.stopMonitoring();
  }
});
