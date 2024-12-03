import type { IncomingMessage } from './services/extraction';
import { MessageExtractor } from './services/extraction/message-extractor';
import { StorageService } from './services/extraction/storage';
import { ConnectionService } from './services/extraction/connection';
import { MonitorService } from './services/extraction/monitor';

// Initialize services
const messageExtractor = new MessageExtractor();
const storageService = new StorageService();
let monitorService: MonitorService;
let connectionService: ConnectionService;

const initializeServices = (): void => {
  // Initialize monitor service first since connection service needs its state
  monitorService = new MonitorService(
    messageExtractor,
    storageService,
    (channelInfo) => {
      // Handle channel change
      void chrome.runtime.sendMessage({
        type: 'EXTRACTION_STATUS',
        status: `Now monitoring ${channelInfo.channel}...`,
      });
    },
    () => {
      // Handle sync request
      if (connectionService.isConnected()) {
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
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
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
  return true;
});

// Check connection status periodically
window.setInterval(() => {
  connectionService.checkConnection();
}, 15000); // 15 seconds

// Initialize services when content script loads
initializeServices();
