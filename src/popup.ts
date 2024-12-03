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

const POPUP_SYNC_INTERVAL = 2500; // 2.5 seconds for popup since it's temporary

const popupState: PopupState = {
  isConnected: false,
  activeTabId: null,
  lastSync: Date.now(),
  state: null,
};

// Update UI based on current state
const updateUI = (): void => {
  const statusElement = document.getElementById('status');
  const channelInfoElement = document.getElementById('channelInfo');
  const messageCountElement = document.getElementById('messageCount');
  const messageStatsElement = document.getElementById('messageStats');
  const startButton = document.getElementById('startButton') as HTMLButtonElement;
  const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;

  if (statusElement === null || channelInfoElement === null || messageCountElement === null) {
    return;
  }

  if (!popupState.isConnected) {
    statusElement.textContent = 'Not connected to Slack';
    startButton.disabled = true;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    return;
  }

  if (popupState.state === null) {
    statusElement.textContent = 'Connected to Slack';
    startButton.disabled = false;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    return;
  }

  // Update status
  statusElement.textContent = popupState.state.isExtracting
    ? 'Extracting messages...'
    : 'Connected to Slack';

  // Update channel info
  if (popupState.state.currentChannel !== null) {
    channelInfoElement.textContent = `Current channel: ${popupState.state.currentChannel.channel} (${popupState.state.currentChannel.organization})`;
  } else {
    channelInfoElement.textContent = 'No channel selected';
  }

  // Update buttons
  startButton.disabled = popupState.state.isExtracting;
  stopButton.disabled = !popupState.state.isExtracting;
  downloadButton.disabled = false;

  // Update message stats
  if (messageStatsElement !== null) {
    const stats = calculateMessageStats(popupState.state.extractedMessages);
    messageStatsElement.innerHTML = generateStatsHTML(stats);
    setupStatsInteractivity();
  }

  // Update total message count
  const totalMessages = calculateTotalMessages(popupState.state.extractedMessages);
  messageCountElement.textContent = `Total messages: ${totalMessages}`;
};

interface ChannelStats {
  name: string;
  messageCount: number;
}

interface OrganizationStats {
  name: string;
  messageCount: number;
  channels: ChannelStats[];
}

const calculateMessageStats = (
  messages: Record<string, Record<string, Record<string, SlackMessage[]>>>,
): OrganizationStats[] => {
  return Object.entries(messages)
    .map(([orgName, orgData]) => {
      const channels = Object.entries(orgData).map(([channelName, channelData]) => {
        const messageCount = Object.values(channelData).reduce(
          (sum, messages) => sum + messages.length,
          0,
        );
        return { name: channelName, messageCount };
      });

      const messageCount = channels.reduce((sum, channel) => sum + channel.messageCount, 0);

      return {
        name: orgName,
        messageCount,
        channels: channels.sort((a, b) => b.messageCount - a.messageCount),
      };
    })
    .sort((a, b) => b.messageCount - a.messageCount);
};

const generateStatsHTML = (stats: OrganizationStats[]): string => {
  return stats
    .map(
      (org, index) => `
        <div class="org-section" data-org-index="${index}">
          <div class="org-header">
            <span class="expand-icon">▶</span>
            <span class="org-name">${org.name}</span>
            <span class="org-count">${org.messageCount} messages</span>
          </div>
          <div class="channel-section">
            ${org.channels
              .map(
                (channel) => `
                <div class="channel-row">
                  <span class="channel-name">${channel.name}</span>
                  <span class="channel-count">${channel.messageCount} messages</span>
                </div>
              `,
              )
              .join('')}
          </div>
          ${index < stats.length - 1 ? '<div class="divider"></div>' : ''}
        </div>
      `,
    )
    .join('');
};

const setupStatsInteractivity = (): void => {
  document.querySelectorAll('.org-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.closest('.org-section');
      const channelSection = section?.querySelector('.channel-section');
      if (channelSection) {
        channelSection.classList.toggle('expanded');
        header.querySelector('.expand-icon')?.classList.toggle('expanded');
      }
    });
  });
};

const calculateTotalMessages = (
  messages: Record<string, Record<string, Record<string, SlackMessage[]>>>,
): number => {
  return Object.values(messages)
    .flatMap((org) => Object.values(org))
    .flatMap((channel) => Object.values(channel))
    .reduce((sum, messages) => sum + messages.length, 0);
};

// Handle messages from background script
const handleMessage = (message: PopupMessage): void => {
  if (message.type === 'state_update') {
    popupState.state = message.state;
    updateUI();
  }
};

// Send status message to background script
const sendStatusMessage = (): void => {
  if (popupState.activeTabId !== null) {
    const message: StatusMessage = {
      type: 'popup_status',
      timestamp: Date.now(),
      tabId: popupState.activeTabId,
    };
    void chrome.runtime.sendMessage(message);
  }
};

// Start periodic sync
const startSync = (): void => {
  sendStatusMessage();
  window.setInterval(sendStatusMessage, POPUP_SYNC_INTERVAL);
};

// Initialize popup
const initialize = async (): Promise<void> => {
  // Get active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (activeTab?.id !== undefined) {
    popupState.activeTabId = activeTab.id;
    popupState.isConnected = activeTab.url?.includes('slack.com') ?? false;
  }

  // Set up message listener
  chrome.runtime.onMessage.addListener(handleMessage);

  // Set up button handlers
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const downloadButton = document.getElementById('downloadButton');

  startButton?.addEventListener('click', () => {
    const message: ExtractionControlMessage = { type: 'START_EXTRACTION' };
    if (popupState.activeTabId !== null) {
      void chrome.tabs.sendMessage(popupState.activeTabId, message);
    }
  });

  stopButton?.addEventListener('click', () => {
    const message: ExtractionControlMessage = { type: 'STOP_EXTRACTION' };
    if (popupState.activeTabId !== null) {
      void chrome.tabs.sendMessage(popupState.activeTabId, message);
    }
  });

  downloadButton?.addEventListener('click', () => {
    if (popupState.state !== null) {
      const data = JSON.stringify(popupState.state.extractedMessages, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'slack-messages.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  });

  // Start sync and update UI
  startSync();
  updateUI();
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});
