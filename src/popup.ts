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
  syncIntervalId?: number;
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
const NOTIFICATION_DURATION = 3000; // 3 seconds default notification duration

const popupState: PopupState = {
  isConnected: false,
  activeTabId: null,
  lastSync: Date.now(),
  state: null,
};

interface UIElements {
  status: HTMLElement;
  channelInfo: HTMLElement;
  messageCount: HTMLElement;
  messageStats: HTMLElement | null;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  goToSlackButton: HTMLButtonElement;
}

const getUIElements = (): UIElements | null => {
  const status = document.getElementById('status');
  const channelInfo = document.getElementById('channelInfo');
  const messageCount = document.getElementById('messageCount');

  if (!status || !channelInfo || !messageCount) {
    return null;
  }

  return {
    status,
    channelInfo,
    messageCount,
    messageStats: document.getElementById('messageStats'),
    startButton: document.getElementById('startButton') as HTMLButtonElement,
    stopButton: document.getElementById('stopButton') as HTMLButtonElement,
    downloadButton: document.getElementById('downloadButton') as HTMLButtonElement,
    goToSlackButton: document.getElementById('goToSlackButton') as HTMLButtonElement,
  };
};

// Update UI based on current state
const updateUI = (): void => {
  const elements = getUIElements();
  if (!elements) return;

  const {
    status,
    channelInfo,
    messageCount,
    messageStats,
    startButton,
    stopButton,
    downloadButton,
    goToSlackButton,
  } = elements;

  if (!popupState.isConnected) {
    status.textContent = 'Not connected to Slack';
    startButton.disabled = true;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    goToSlackButton.style.display = 'block';
    startButton.style.display = 'none';
    stopButton.style.display = 'none';
    channelInfo.textContent = '';
    messageCount.textContent = '';
    if (messageStats) {
      messageStats.innerHTML = '';
    }
    return;
  }

  // Show extraction buttons and hide Slack button when connected
  goToSlackButton.style.display = 'none';
  startButton.style.display = 'block';
  stopButton.style.display = 'block';

  if (popupState.state === null) {
    status.textContent = 'Connected to Slack';
    startButton.disabled = false;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    channelInfo.textContent = '';
    messageCount.textContent = '';
    if (messageStats) {
      messageStats.innerHTML = '';
    }
    return;
  }

  // Update status
  status.textContent = popupState.state.isExtracting
    ? 'Extracting messages...'
    : 'Connected to Slack';

  // Update channel info
  const { currentChannel } = popupState.state;
  channelInfo.textContent = currentChannel
    ? `Current channel: ${currentChannel.channel} (${currentChannel.organization})`
    : 'No channel selected';

  // Update buttons
  startButton.disabled = popupState.state.isExtracting;
  stopButton.disabled = !popupState.state.isExtracting;
  downloadButton.disabled = false;

  // Update message stats
  if (messageStats) {
    updateMessageStats(messageStats, popupState.state.extractedMessages);
  }

  // Update total message count
  const totalMessages = calculateTotalMessages(popupState.state.extractedMessages);
  messageCount.textContent = `Total messages: ${totalMessages}`;
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

const createChannelRow = (channel: ChannelStats, orgName: string): string => `
  <div class="channel-row">
    <span class="channel-name">${channel.name}</span>
    <div class="channel-actions">
      <span class="channel-count">${channel.messageCount} messages</span>
      <button class="delete-button" data-org="${orgName}" data-channel="${channel.name}">Delete</button>
    </div>
  </div>
`;

const createOrgSection = (org: OrganizationStats, isExpanded: boolean): HTMLElement => {
  const orgSection = document.createElement('div');
  orgSection.className = 'org-section';
  orgSection.setAttribute('data-org-name', org.name);

  const header = document.createElement('div');
  header.className = 'org-header';
  header.innerHTML = `
    <span class="expand-icon">▶</span>
    <span class="org-name">${org.name}</span>
    <span class="org-count">${org.messageCount} messages</span>
  `;

  const channelSection = document.createElement('div');
  channelSection.className = `channel-section${isExpanded ? ' expanded' : ''}`;

  orgSection.appendChild(header);
  orgSection.appendChild(channelSection);

  header.addEventListener('click', () => {
    channelSection.classList.toggle('expanded');
    header.querySelector('.expand-icon')?.classList.toggle('expanded');
  });

  return orgSection;
};

const handleDeleteChannel = async (
  button: HTMLButtonElement,
  orgName: string,
  channelName: string,
): Promise<void> => {
  const confirmed = await showConfirmDialog(
    `Are you sure you want to delete all messages from ${channelName} in ${orgName}?`,
  );

  if (!confirmed) return;

  const updatedButton = button.cloneNode(true) as HTMLButtonElement;
  button.replaceWith(updatedButton);
  updatedButton.disabled = true;
  updatedButton.classList.add('loading');

  try {
    await chrome.runtime.sendMessage({
      type: 'DELETE_CHANNEL_MESSAGES',
      organization: orgName,
      channel: channelName,
    });

    await new Promise<void>((resolve) => {
      const handleStateUpdate = (message: { type: string }): void => {
        if (message.type === 'state_update') {
          chrome.runtime.onMessage.removeListener(handleStateUpdate);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(handleStateUpdate);
    });

    showNotification(`Successfully deleted messages from ${channelName}`);
  } catch (error) {
    const errorDetails = {
      action: 'Delete Channel Messages',
      organization: orgName,
      channel: channelName,
      timestamp: new Date().toISOString(),
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    };

    console.error('Failed to delete messages:', errorDetails);
    showNotification(
      `Failed to delete messages from ${channelName}. Check console for details.`,
      5000,
    );
  } finally {
    const finalButton = updatedButton.cloneNode(true) as HTMLButtonElement;
    updatedButton.replaceWith(finalButton);
    finalButton.disabled = false;
    finalButton.classList.remove('loading');
  }
};

const updateMessageStats = (
  container: HTMLElement,
  messages: Record<string, Record<string, Record<string, SlackMessage[]>>>,
): void => {
  const stats = calculateMessageStats(messages);
  const expandedOrgs = new Set<string>();

  // Store currently expanded organizations
  container.querySelectorAll('.org-section').forEach((section) => {
    const orgName = section.querySelector('.org-name')?.textContent;
    if (orgName && section.querySelector('.channel-section.expanded')) {
      expandedOrgs.add(orgName);
    }
  });

  // Update or create organization sections
  stats.forEach((org, index) => {
    let orgSection = container.querySelector(`[data-org-name="${org.name}"]`);
    const isExpanded = expandedOrgs.has(org.name);

    if (!orgSection) {
      orgSection = createOrgSection(org, isExpanded);
      container.appendChild(orgSection);
    } else {
      const countElement = orgSection.querySelector('.org-count');
      if (countElement) {
        countElement.textContent = `${org.messageCount} messages`;
      }
    }

    const channelSection = orgSection.querySelector('.channel-section');
    if (channelSection) {
      if (isExpanded) {
        channelSection.classList.add('expanded');
        orgSection.querySelector('.expand-icon')?.classList.add('expanded');
      }

      channelSection.innerHTML = org.channels
        .map((channel) => createChannelRow(channel, org.name))
        .join('');

      channelSection.querySelectorAll('.delete-button').forEach((button) => {
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          const orgName = button.getAttribute('data-org');
          const channelName = button.getAttribute('data-channel');

          if (orgName && channelName) {
            await handleDeleteChannel(button as HTMLButtonElement, orgName, channelName);
          }
        });
      });
    }

    // Add divider if not last
    if (index < stats.length - 1) {
      let divider = orgSection.nextElementSibling;
      if (!divider?.classList.contains('divider')) {
        divider = document.createElement('div');
        divider.className = 'divider';
        orgSection.after(divider);
      }
    }
  });

  // Remove obsolete organizations
  container.querySelectorAll('.org-section').forEach((section) => {
    const orgName = section.getAttribute('data-org-name');
    if (orgName && !stats.some((org) => org.name === orgName)) {
      const divider = section.nextElementSibling;
      if (divider?.classList.contains('divider')) {
        divider.remove();
      }
      section.remove();
    }
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

const handleMessage = (message: PopupMessage): void => {
  if (message.type === 'state_update') {
    popupState.state = message.state;
    updateUI();
  }
};

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

const startSync = (): void => {
  // Clear any existing interval
  if (popupState.syncIntervalId) {
    clearInterval(popupState.syncIntervalId);
  }

  // Send initial status message
  sendStatusMessage();

  // Start new interval and store the ID
  popupState.syncIntervalId = window.setInterval(sendStatusMessage, POPUP_SYNC_INTERVAL);
};

const stopSync = (): void => {
  if (popupState.syncIntervalId) {
    clearInterval(popupState.syncIntervalId);
    delete popupState.syncIntervalId;
  }
};

const showNotification = (message: string, duration: number = NOTIFICATION_DURATION): void => {
  const notification = document.getElementById('notification');
  if (!notification) return;

  notification.textContent = message;
  notification.classList.add('visible');

  setTimeout(() => {
    notification.classList.remove('visible');
  }, duration);
};

const showConfirmDialog = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirmDialog');
    const messageEl = document.getElementById('confirmMessage');
    const confirmButton = document.getElementById('confirmOk');
    const cancelButton = document.getElementById('confirmCancel');

    if (!dialog || !messageEl || !confirmButton || !cancelButton) {
      resolve(false);
      return;
    }

    messageEl.textContent = message;
    dialog.classList.add('visible');

    const handleConfirm = (): void => {
      cleanup();
      resolve(true);
    };

    const handleCancel = (): void => {
      cleanup();
      resolve(false);
    };

    const cleanup = (): void => {
      dialog.classList.remove('visible');
      confirmButton.removeEventListener('click', handleConfirm);
      cancelButton.removeEventListener('click', handleCancel);
    };

    confirmButton.addEventListener('click', handleConfirm);
    cancelButton.addEventListener('click', handleCancel);
  });
};

const setupButtonHandlers = (tabId: number): void => {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const downloadButton = document.getElementById('downloadButton');
  const goToSlackButton = document.getElementById('goToSlackButton');

  goToSlackButton?.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://app.slack.com/' });
  });

  startButton?.addEventListener('click', () => {
    const message: ExtractionControlMessage = { type: 'START_EXTRACTION' };
    void chrome.tabs.sendMessage(tabId, message);
  });

  stopButton?.addEventListener('click', () => {
    const message: ExtractionControlMessage = { type: 'STOP_EXTRACTION' };
    void chrome.tabs.sendMessage(tabId, message);
  });

  downloadButton?.addEventListener('click', () => {
    if (popupState.state) {
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
};

const initialize = async (): Promise<void> => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (activeTab?.id !== undefined) {
    popupState.activeTabId = activeTab.id;
    popupState.isConnected = activeTab.url?.includes('slack.com') ?? false;
    setupButtonHandlers(activeTab.id);
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  startSync();
  updateUI();
};

// Clean up when popup is closed
window.addEventListener('unload', () => {
  stopSync();
  chrome.runtime.onMessage.removeListener(handleMessage);
});

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});

const spinnerStyles = `
  .delete-button {
    position: relative;
  }

  .delete-button.loading {
    color: transparent;
  }

  .delete-button.loading::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    top: 50%;
    left: 50%;
    margin: -8px 0 0 -8px;
    border: 2px solid #ffffff;
    border-radius: 50%;
    border-right-color: transparent;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

const style = document.createElement('style');
style.textContent = spinnerStyles;
document.head.appendChild(style);
