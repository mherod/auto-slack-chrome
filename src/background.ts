/// <reference lib="webworker" />

import type {
  ChannelInfo,
  ExtractionStatusMessage,
  HeartbeatMessage,
  IncomingMessage,
  MessagesByOrganization,
  OutgoingMessage,
  PopupStatusMessage,
  SyncMessage,
} from './services/extraction';
import { StorageService } from './services/extraction';

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

// Constants
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds
const CLEANUP_INTERVAL = 10000; // 10 seconds
const SYNC_INTERVAL = 10000; // 10 seconds

// Global state
const tabStates = new Map<number, TabState>();
const storageService = new StorageService();

// State management helpers
const createInitialState = (
  isExtracting: boolean,
  currentChannel: ChannelInfo | null,
  extractedMessages: MessagesByOrganization = {},
): BackgroundState => ({
  isExtracting,
  currentChannel,
  extractedMessages,
});

const cleanupTabs = (): void => {
  const now = Date.now();
  for (const [tabId, state] of tabStates.entries()) {
    if (now - state.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      tabStates.delete(tabId);
    }
  }
};

const broadcastStateUpdate = (tabId: number): void => {
  const tabState = tabStates.get(tabId);
  if (tabState?.state) {
    const message: OutgoingMessage = {
      type: 'state_update',
      timestamp: Date.now(),
      state: tabState.state,
    };

    void chrome.runtime.sendMessage(message).catch(() => {
      // Ignore chrome.runtime errors when context is invalidated
    });
  }
};

const reloadSlackTabs = async (): Promise<void> => {
  const tabs = await chrome.tabs.query({ url: 'https://app.slack.com/*' });
  for (const tab of tabs) {
    if (tab.id && tab.id > 0) {
      void chrome.tabs.reload(tab.id);
    }
  }
};

// Message handlers
const handleHeartbeat = (
  message: HeartbeatMessage,
  tabId: number,
  sendResponse: (response: { success: boolean }) => void,
): void => {
  const { timestamp, status } = message;
  let tabState = tabStates.get(tabId);

  if (!tabState) {
    tabState = {
      lastHeartbeat: timestamp,
      state: createInitialState(status.isExtracting, status.channelInfo),
    };
    tabStates.set(tabId, tabState);
  } else {
    tabState.lastHeartbeat = timestamp;
    if (tabState.state) {
      tabState.state.isExtracting = status.isExtracting;
      tabState.state.currentChannel = status.channelInfo;
    }
  }

  broadcastStateUpdate(tabId);
  sendResponse({ success: true });
};

const handleSync = (
  message: SyncMessage,
  tabId: number,
  sendResponse: (response: { success: boolean }) => void,
): void => {
  const { timestamp, data } = message;
  let tabState = tabStates.get(tabId);

  if (!tabState) {
    tabState = {
      lastHeartbeat: timestamp,
      state: createInitialState(false, data.currentChannel, data.extractedMessages),
    };
    tabStates.set(tabId, tabState);
  } else {
    tabState.lastHeartbeat = timestamp;
    if (tabState.state) {
      tabState.state.currentChannel = data.currentChannel;
      tabState.state.extractedMessages = data.extractedMessages;
    }
  }

  broadcastStateUpdate(tabId);
  sendResponse({ success: true });
};

const handlePopupStatus = (
  message: PopupStatusMessage,
  sendResponse: (response: { state: BackgroundState | null }) => void,
): void => {
  const tabState = tabStates.get(message.tabId);
  sendResponse({ state: tabState?.state ?? null });
};

const handleExtractionStatus = (
  _message: ExtractionStatusMessage,
  sendResponse: (response: { success: boolean }) => void,
): void => {
  sendResponse({ success: true });
};

// Message listener
chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse): boolean => {
  try {
    const tabId = _sender.tab?.id;

    // Handle popup status messages which don't require a tab ID
    if (message.type === 'popup_status') {
      handlePopupStatus(message, sendResponse);
      return true;
    }

    // For other message types, ensure we have a valid tab ID
    if (!tabId || tabId <= 0) {
      console.error('No valid tab ID for message:', message.type);
      sendResponse({ success: false, error: 'No valid tab ID' });
      return false;
    }

    switch (message.type) {
      case 'heartbeat':
        handleHeartbeat(message, tabId, sendResponse);
        break;
      case 'sync':
        handleSync(message, tabId, sendResponse);
        break;
      case 'EXTRACTION_STATUS':
        handleExtractionStatus(message, sendResponse);
        break;
      default:
        console.error('Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return true;
});

// Interval management
const startIntervals = (): void => {
  cleanupInterval ??= self.setInterval(cleanupTabs, CLEANUP_INTERVAL);
  syncInterval ??= self.setInterval(() => {
    for (const tabId of tabStates.keys()) {
      broadcastStateUpdate(tabId);
    }
  }, SYNC_INTERVAL);
};

const stopIntervals = (): void => {
  if (cleanupInterval) {
    self.clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (syncInterval) {
    self.clearInterval(syncInterval);
    syncInterval = null;
  }
};

let cleanupInterval: number | null = null;
let syncInterval: number | null = null;

startIntervals();

// Chrome extension lifecycle handlers
chrome.runtime.onInstalled.addListener(() => {
  void reloadSlackTabs();
});

chrome.runtime.onSuspend.addListener(() => {
  stopIntervals();
});

// State broadcasting
const broadcastStateToTabs = async (state: BackgroundState): Promise<void> => {
  const tabs = await chrome.tabs.query({});
  const updatePromises = tabs.map(async (tab) => {
    if (tab.id && tab.id > 0) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'state_update',
          timestamp: Date.now(),
          state,
        });
      } catch {
        console.debug('Could not send state update to tab:', tab.id);
      }
    }
  });

  await Promise.all(updatePromises);
};

// Delete channel message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DELETE_CHANNEL_MESSAGES') {
    void (async (): Promise<void> => {
      try {
        await storageService.deleteChannelMessages(message.organization, message.channel);
        const state = await storageService.loadState();

        await broadcastStateToTabs(state);
        await chrome.runtime.sendMessage({
          type: 'state_update',
          timestamp: Date.now(),
          state,
        });

        sendResponse({ success: true });
      } catch (error) {
        console.error('Error handling delete:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })();
    return true;
  }
  return false;
});
