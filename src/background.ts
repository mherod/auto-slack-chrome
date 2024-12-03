import type { MessagesByOrganization } from './services/extraction';

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

interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
  status: {
    isExtracting: boolean;
    channelInfo: {
      channel: string;
      organization: string;
    } | null;
    messageCount: number;
  };
}

interface SyncMessage {
  type: 'sync';
  timestamp: number;
  data: {
    extractedMessages: MessagesByOrganization;
    currentChannel: {
      channel: string;
      organization: string;
    } | null;
  };
}

interface PopupStatusMessage {
  type: 'popup_status';
  timestamp: number;
  tabId: number;
}

interface StateUpdateMessage {
  type: 'state_update';
  timestamp: number;
  state: BackgroundState;
}

type IncomingMessage = HeartbeatMessage | SyncMessage | PopupStatusMessage;
type OutgoingMessage = StateUpdateMessage;

const HEARTBEAT_TIMEOUT = 15000; // 15 seconds
const CLEANUP_INTERVAL = 60000; // 1 minute
const SYNC_INTERVAL = 30000; // 30 seconds

const tabStates = new Map<number, TabState>();

// Clean up disconnected tabs
const cleanupTabs = (): void => {
  const now = Date.now();
  Array.from(tabStates.entries()).forEach(([tabId, state]) => {
    const timeSinceLastHeartbeat = now - state.lastHeartbeat;
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
      tabStates.delete(tabId);
    }
  });
};

// Send state update to all connected popups
const broadcastStateUpdate = (tabId: number): void => {
  const tabState = tabStates.get(tabId);
  if (tabState?.state === null) return;

  const message: OutgoingMessage = {
    type: 'state_update',
    timestamp: Date.now(),
    state: tabState.state,
  };

  void chrome.runtime.sendMessage(message);
};

// Handle incoming messages
chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse): boolean => {
  if (message.type === 'heartbeat') {
    const { timestamp, status } = message;
    const tabId = _sender.tab?.id;
    if (tabId === undefined) return false;

    let tabState = tabStates.get(tabId);
    if (tabState === undefined) {
      tabState = {
        lastHeartbeat: timestamp,
        state: {
          isExtracting: status.isExtracting,
          currentChannel: status.channelInfo,
          extractedMessages: {},
        },
      };
      tabStates.set(tabId, tabState);
    } else {
      tabState.lastHeartbeat = timestamp;
      if (tabState.state !== null) {
        tabState.state.isExtracting = status.isExtracting;
        tabState.state.currentChannel = status.channelInfo;
      }
    }

    broadcastStateUpdate(tabId);
    sendResponse({ success: true });
  } else if (message.type === 'sync') {
    const { timestamp, data } = message;
    const tabId = _sender.tab?.id;
    if (tabId === undefined) return false;

    let tabState = tabStates.get(tabId);
    if (tabState === undefined) {
      tabState = {
        lastHeartbeat: timestamp,
        state: {
          isExtracting: false,
          currentChannel: data.currentChannel,
          extractedMessages: data.extractedMessages,
        },
      };
      tabStates.set(tabId, tabState);
    } else {
      tabState.lastHeartbeat = timestamp;
      if (tabState.state !== null) {
        tabState.state.currentChannel = data.currentChannel;
        tabState.state.extractedMessages = data.extractedMessages;
      }
    }

    broadcastStateUpdate(tabId);
    sendResponse({ success: true });
  } else if (message.type === 'popup_status') {
    const { tabId } = message;
    const tabState = tabStates.get(tabId);
    sendResponse({ state: tabState?.state ?? null });
  }

  return true;
});

// Set up periodic cleanup
window.setInterval(cleanupTabs, CLEANUP_INTERVAL);

// Set up periodic sync broadcast
window.setInterval(() => {
  Array.from(tabStates.keys()).forEach((tabId) => {
    broadcastStateUpdate(tabId);
  });
}, SYNC_INTERVAL);
