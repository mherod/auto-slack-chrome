import type { IncomingMessage } from './services/extraction';
import { ConnectionService } from './services/extraction/connection';
import { MessageExtractor } from './services/extraction/message-extractor';
import { MonitorService } from './services/extraction/monitor';
import { StorageService } from './services/extraction/storage';

// Initialize services
const messageExtractor = new MessageExtractor();
const storageService = new StorageService();
let monitorService: MonitorService;
let connectionService: ConnectionService;

const initializeServices = (): void => {
  try {
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
          .catch(() => {
            // Ignore chrome.runtime errors when context is invalidated
          });
      },
      () => {
        // Handle sync request
        if (connectionService !== undefined && connectionService.isConnected()) {
          void connectionService.sendSync();
        }
      },
    );

    // Initialize connection service
    connectionService = new ConnectionService(
      () => {
        // Handle connection loss
      },
      () => monitorService.getCurrentState(),
    );

    // Initialize connection
    connectionService.initializeConnection();
  } catch (error) {
    // Log error and attempt to reinitialize
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    void chrome.runtime
      .sendMessage({
        type: 'ERROR',
        error: `Failed to initialize services: ${errorMessage}`,
      })
      .catch(() => {
        // Ignore chrome.runtime errors when context is invalidated
      });

    // Attempt to reinitialize after a delay if it was a context invalidation
    const lastError = chrome.runtime.lastError;
    if (
      lastError !== undefined &&
      lastError.message !== undefined &&
      lastError.message.includes('Extension context invalidated')
    ) {
      window.setTimeout(initializeServices, 1000);
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
      void storageService.mergeAndSaveMessages(
        currentState.extractedMessages,
        message.data.extractedMessages,
      );
      sendResponse({ success: true });
    } else if (message.type === 'START_EXTRACTION') {
      void monitorService.startMonitoring();
      sendResponse({ success: true });
    } else if (message.type === 'STOP_EXTRACTION') {
      void monitorService.stopMonitoring();
      sendResponse({ success: true });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    void chrome.runtime
      .sendMessage({
        type: 'ERROR',
        error: `Error handling message: ${errorMessage}`,
      })
      .catch(() => {
        // Ignore chrome.runtime errors when context is invalidated
      });
    sendResponse({ success: false, error: errorMessage });
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        void chrome.runtime
          .sendMessage({
            type: 'ERROR',
            error: `Connection check failed: ${errorMessage}`,
          })
          .catch(() => {
            // Ignore chrome.runtime errors when context is invalidated
          });

        const lastError = chrome.runtime.lastError;
        if (
          lastError !== undefined &&
          lastError.message !== undefined &&
          lastError.message.includes('Extension context invalidated')
        ) {
          stopConnectionCheck();
          window.setTimeout(initializeServices, 1000);
        }
      }
    }, 15000); // 15 seconds
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
});
