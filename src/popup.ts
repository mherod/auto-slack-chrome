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
  const goToSlackButton = document.getElementById('goToSlackButton') as HTMLButtonElement;

  if (statusElement === null || channelInfoElement === null || messageCountElement === null) {
    return;
  }

  if (!popupState.isConnected) {
    statusElement.textContent = 'Not connected to Slack';
    startButton.disabled = true;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    goToSlackButton.style.display = 'block';
    startButton.style.display = 'none';
    stopButton.style.display = 'none';
    channelInfoElement.textContent = '';
    messageCountElement.textContent = '';
    if (messageStatsElement) {
      messageStatsElement.innerHTML = '';
    }
    return;
  }

  // Show extraction buttons and hide Slack button when connected
  goToSlackButton.style.display = 'none';
  startButton.style.display = 'block';
  stopButton.style.display = 'block';

  if (popupState.state === null) {
    statusElement.textContent = 'Connected to Slack';
    startButton.disabled = false;
    stopButton.disabled = true;
    downloadButton.disabled = true;
    channelInfoElement.textContent = '';
    messageCountElement.textContent = '';
    if (messageStatsElement) {
      messageStatsElement.innerHTML = '';
    }
    return;
  }

  // Update status
  statusElement.textContent = popupState.state.isExtracting
    ? 'Extracting messages...'
    : 'Connected to Slack';

  // Update channel info
  channelInfoElement.textContent =
    popupState.state.currentChannel !== null
      ? `Current channel: ${popupState.state.currentChannel.channel} (${popupState.state.currentChannel.organization})`
      : 'No channel selected';

  // Update buttons
  startButton.disabled = popupState.state.isExtracting;
  stopButton.disabled = !popupState.state.isExtracting;
  downloadButton.disabled = false;

  // Update message stats
  if (messageStatsElement !== null) {
    updateMessageStats(messageStatsElement, popupState.state.extractedMessages);
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

const updateMessageStats = (
  container: HTMLElement,
  messages: Record<string, Record<string, Record<string, SlackMessage[]>>>,
): void => {
  const stats = calculateMessageStats(messages);
  const expandedOrgs = new Set<string>();

  // Store currently expanded organizations
  container.querySelectorAll('.org-section').forEach((section) => {
    const orgName = section.querySelector('.org-name')?.textContent;
    if (
      orgName !== null &&
      orgName !== undefined &&
      section.querySelector('.channel-section.expanded') !== null
    ) {
      expandedOrgs.add(orgName);
    }
  });

  // Update or create organization sections
  stats.forEach((org, index) => {
    let orgSection = container.querySelector(`[data-org-name="${org.name}"]`);
    const isExpanded = expandedOrgs.has(org.name);

    if (orgSection === null) {
      // Create new organization section
      orgSection = document.createElement('div');
      orgSection.className = 'org-section';
      orgSection.setAttribute('data-org-name', org.name);
      container.appendChild(orgSection);

      // Create organization header
      const header = document.createElement('div');
      header.className = 'org-header';
      header.innerHTML = `
        <span class="expand-icon">▶</span>
        <span class="org-name">${org.name}</span>
        <span class="org-count">${org.messageCount} messages</span>
      `;
      orgSection.appendChild(header);

      // Create channel section
      const channelSection = document.createElement('div');
      channelSection.className = `channel-section${isExpanded ? ' expanded' : ''}`;
      orgSection.appendChild(channelSection);

      // Add click handler
      header.addEventListener('click', () => {
        channelSection.classList.toggle('expanded');
        header.querySelector('.expand-icon')?.classList.toggle('expanded');
      });
    } else {
      // Update existing organization section
      const header = orgSection.querySelector('.org-header');
      if (header !== null) {
        const countElement = header.querySelector('.org-count');
        if (countElement !== null) {
          countElement.textContent = `${org.messageCount} messages`;
        }
      }
    }

    // Update channel section
    const channelSection = orgSection.querySelector('.channel-section');
    if (channelSection !== null) {
      // Maintain expanded state
      if (isExpanded) {
        channelSection.classList.add('expanded');
        orgSection.querySelector('.expand-icon')?.classList.add('expanded');
      }

      // Update channels
      channelSection.innerHTML = org.channels
        .map(
          (channel) => `
          <div class="channel-row">
            <span class="channel-name">${channel.name}</span>
            <div class="channel-actions">
              <span class="channel-count">${channel.messageCount} messages</span>
              <button class="delete-button" data-org="${org.name}" data-channel="${channel.name}">Delete</button>
            </div>
          </div>
        `,
        )
        .join('');

      // Add click handlers for delete buttons
      channelSection.querySelectorAll('.delete-button').forEach((button) => {
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          const orgName = (button as HTMLButtonElement).getAttribute('data-org');
          const channelName = (button as HTMLButtonElement).getAttribute('data-channel');

          if (orgName && channelName) {
            const confirmed = await showConfirmDialog(
              `Are you sure you want to delete all messages from ${channelName} in ${orgName}?`,
            );

            if (confirmed) {
              const deleteButton = button as HTMLButtonElement;
              deleteButton.disabled = true;
              deleteButton.classList.add('loading');

              try {
                // Send delete request and wait for response
                await chrome.runtime.sendMessage({
                  type: 'DELETE_CHANNEL_MESSAGES',
                  organization: orgName,
                  channel: channelName,
                });

                // Wait for state update message (background will send this)
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
                      ? {
                          name: error.name,
                          message: error.message,
                          stack: error.stack,
                        }
                      : error,
                };

                console.error('Failed to delete messages:', errorDetails);
                showNotification(
                  `Failed to delete messages from ${channelName}. Check console for details.`,
                  5000,
                );
              } finally {
                deleteButton.disabled = false;
                deleteButton.classList.remove('loading');
              }
            }
          }
        });
      });
    }

    // Add divider if not last
    if (index < stats.length - 1) {
      let divider = orgSection.nextElementSibling;
      if (divider === null || !divider.classList.contains('divider')) {
        divider = document.createElement('div');
        divider.className = 'divider';
        orgSection.after(divider);
      }
    }
  });

  // Remove any organizations that no longer exist
  container.querySelectorAll('.org-section').forEach((section) => {
    const orgName = section.getAttribute('data-org-name');
    if (orgName !== null && !stats.some((org) => org.name === orgName)) {
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

function showNotification(message: string, duration: number = 3000): void {
  const notification = document.getElementById('notification');
  if (!notification) return;

  notification.textContent = message;
  notification.classList.add('visible');

  setTimeout(() => {
    notification.classList.remove('visible');
  }, duration);
}

function showConfirmDialog(message: string): Promise<boolean> {
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
}

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
  const goToSlackButton = document.getElementById('goToSlackButton');

  goToSlackButton?.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://app.slack.com/' });
  });

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

// Add styles for the spinner
const style = document.createElement('style');
style.textContent = `
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
document.head.appendChild(style);
