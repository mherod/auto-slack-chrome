import type { SlackMessage } from './services/extraction';

interface ExtensionState {
  isExtracting: boolean;
  currentChannel: {
    channel: string;
    organization: string;
  } | null;
  extractedMessages: Record<string, Record<string, Record<string, SlackMessage[]>>>;
}

interface PopupState {
  isConnected: boolean;
  activeTabId: number | null;
  lastSync: number;
  state: ExtensionState | null;
}

interface StatusMessage {
  type: 'popup_status';
  timestamp: number;
  tabId: number;
}

interface StateUpdateMessage {
  type: 'state_update';
  timestamp: number;
  state: ExtensionState;
}

interface ExtractionControlMessage {
  type: 'START_EXTRACTION' | 'STOP_EXTRACTION';
}

type PopupMessage = StatusMessage | StateUpdateMessage;

const POPUP_SYNC_INTERVAL = 1000; // 1 second for popup since it's temporary

const popupState: PopupState = {
  isConnected: false,
  activeTabId: null,
  lastSync: Date.now(),
  state: null,
};

// Update UI based on current state
const updateUI = (): void => {
  const startButton = document.getElementById('startButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const statusText = document.getElementById('status') as HTMLDivElement;
  const channelInfo = document.getElementById('channelInfo') as HTMLDivElement;
  const messageCount = document.getElementById('messageCount') as HTMLDivElement;

  if (!popupState.isConnected) {
    statusText.textContent = 'Connecting...';
    startButton.disabled = true;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    channelInfo.textContent = '';
    messageCount.textContent = '';
    return;
  }

  if (popupState.state === null) {
    statusText.textContent = 'No active extraction';
    startButton.disabled = false;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    channelInfo.textContent = '';
    messageCount.textContent = '';
    return;
  }

  const { isExtracting, currentChannel, extractedMessages } = popupState.state;

  // Update extraction controls
  startButton.disabled = isExtracting;
  stopButton.disabled = !isExtracting;

  // Update status
  statusText.textContent = isExtracting ? 'Extracting messages...' : 'Ready';

  // Update channel info
  if (currentChannel !== null) {
    channelInfo.textContent = `Channel: ${currentChannel.channel} (${currentChannel.organization})`;
  } else {
    channelInfo.textContent = 'No channel selected';
  }

  // Count total messages
  const totalMessages = Object.values(extractedMessages)
    .flatMap((org) => Object.values(org))
    .flatMap((channel) => Object.values(channel))
    .reduce((acc, messages) => acc + messages.length, 0);

  messageCount.textContent = `Messages: ${totalMessages}`;

  // Enable download if we have messages
  downloadButton.disabled = totalMessages === 0;
};

// Request current state from background script
const requestState = async (): Promise<void> => {
  if (popupState.activeTabId === null) return;

  void chrome.runtime.sendMessage(
    {
      type: 'popup_status',
      timestamp: Date.now(),
      tabId: popupState.activeTabId,
    },
    (response) => {
      if (chrome.runtime.lastError !== undefined) {
        popupState.isConnected = false;
        updateUI();
        return;
      }

      if (response?.state !== undefined) {
        popupState.isConnected = true;
        popupState.state = response.state;
        popupState.lastSync = Date.now();
        updateUI();
      }
    },
  );
};

// Initialize popup
const initializePopup = async (): Promise<void> => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    popupState.activeTabId = tab.id;
  }

  // Set up start button
  const startButton = document.getElementById('startButton');
  if (startButton !== null) {
    startButton.addEventListener('click', () => {
      if (popupState.activeTabId === null) return;

      void chrome.tabs.sendMessage(popupState.activeTabId, {
        type: 'START_EXTRACTION',
      } as ExtractionControlMessage);

      // Update UI immediately for responsiveness
      if (popupState.state !== null) {
        popupState.state.isExtracting = true;
        updateUI();
      }
    });
  }

  // Set up stop button
  const stopButton = document.getElementById('stopButton');
  if (stopButton !== null) {
    stopButton.addEventListener('click', () => {
      if (popupState.activeTabId === null) return;

      void chrome.tabs.sendMessage(popupState.activeTabId, {
        type: 'STOP_EXTRACTION',
      } as ExtractionControlMessage);

      // Update UI immediately for responsiveness
      if (popupState.state !== null) {
        popupState.state.isExtracting = false;
        updateUI();
      }
    });
  }

  // Set up download button
  const downloadButton = document.getElementById('downloadButton');
  if (downloadButton !== null) {
    downloadButton.addEventListener('click', () => {
      if (popupState.state?.extractedMessages === undefined) return;

      const blob = new Blob([JSON.stringify(popupState.state.extractedMessages, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'slack-messages.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Start sync interval
  window.setInterval(() => void requestState(), POPUP_SYNC_INTERVAL);

  // Initial state request
  void requestState();
};

// Listen for state updates from background script
chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, _sendResponse) => {
  if (message.type === 'state_update' && popupState.activeTabId !== null) {
    popupState.isConnected = true;
    popupState.state = message.state;
    popupState.lastSync = message.timestamp;
    updateUI();
  }
  return true;
});

// Initialize when popup loads
document.addEventListener('DOMContentLoaded', () => void initializePopup());
