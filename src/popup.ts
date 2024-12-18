import { format } from 'date-fns';
import { StorageService } from './services/extraction/storage';

document.addEventListener('DOMContentLoaded', async () => {
  const storageService = new StorageService();
  const toggleButton = document.getElementById('toggleButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const statusIndicator = document.getElementById('statusIndicator') as HTMLDivElement;
  const statusText = document.getElementById('statusText') as HTMLSpanElement;
  const messageCount = document.getElementById('messageCount') as HTMLSpanElement;
  const channelInfo = document.getElementById('channelInfo') as HTMLSpanElement;
  const timeRanges = document.getElementById('timeRanges') as HTMLDivElement;
  const scrollingToggle = document.getElementById('scrollingToggle') as HTMLInputElement;
  const container = document.querySelector('.container') as HTMLDivElement;
  const confirmDialog = document.getElementById('confirmDialog') as HTMLDivElement;
  const confirmMessage = document.getElementById('confirmMessage') as HTMLDivElement;
  const confirmDeleteButton = document.getElementById('confirmDelete') as HTMLButtonElement;
  const cancelDeleteButton = document.getElementById('cancelDelete') as HTMLButtonElement;

  let isExtracting = false;
  let totalMessages = 0;
  let isLoading = true;
  let pendingDelete: { organization: string; channel: string } | null = null;

  const showConfirmDialog = (organization: string, channel: string): void => {
    const channelDisplay = channel.startsWith('DM: ') ? channel.substring(4) : `#${channel}`;
    confirmMessage.textContent = `Delete all messages from ${channelDisplay} in ${organization}?`;
    confirmDialog.classList.add('visible');
    pendingDelete = { organization, channel };
  };

  const hideConfirmDialog = (): void => {
    confirmDialog.classList.remove('visible');
    pendingDelete = null;
  };

  // Handle dialog buttons
  confirmDeleteButton.addEventListener('click', async () => {
    if (pendingDelete) {
      await handleDelete(pendingDelete.organization, pendingDelete.channel);
      hideConfirmDialog();
    }
  });

  cancelDeleteButton.addEventListener('click', () => {
    hideConfirmDialog();
  });

  // Close dialog on overlay click
  confirmDialog.addEventListener('click', (e) => {
    if (e.target === confirmDialog) {
      hideConfirmDialog();
    }
  });

  // Close dialog on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmDialog.classList.contains('visible')) {
      hideConfirmDialog();
    }
  });

  const setError = (message: string): void => {
    const errorElement = document.getElementById('error');
    if (errorElement instanceof HTMLElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
  };

  const findSlackTab = async (): Promise<chrome.tabs.Tab | null> => {
    const tabs = await chrome.tabs.query({
      url: 'https://app.slack.com/*',
      active: true,
      currentWindow: true,
    });
    if (tabs.length === 0) {
      setError('Please open Slack in your browser');
      return null;
    }
    const tab = tabs[0];
    if (typeof tab.id !== 'number' || tab.id <= 0) {
      setError('Invalid tab state');
      return null;
    }
    return tab;
  };

  const sendMessageToTab = async (message: unknown): Promise<void> => {
    try {
      const tab = await findSlackTab();
      if (typeof tab?.id !== 'number' || tab.id <= 0) return;

      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      console.error('Failed to send message to tab:', error);
      if (
        error instanceof Error &&
        typeof error.message === 'string' &&
        error.message.includes('Could not establish connection')
      ) {
        setError('Please refresh the Slack tab');
      } else {
        setError('Failed to communicate with Slack');
      }
      throw error;
    }
  };

  const formatTimeRange = (start: number, end: number): string => {
    const startDate = new Date(start);
    const endDate = new Date(end);

    // If same day, show single date with time range
    if (startDate.toDateString() === endDate.toDateString()) {
      return `${format(startDate, 'MMM d, yyyy')} ${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;
    }

    // Different days, show full range
    return `${format(startDate, 'MMM d, yyyy HH:mm')} - ${format(endDate, 'MMM d, yyyy HH:mm')}`;
  };

  const handleDelete = async (organization: string, channel: string): Promise<void> => {
    try {
      setLoading(true);
      await storageService.pruneMessagesByOrgGroup([{ organization, channel }]);

      // Refresh the UI
      const state = await storageService.loadState();
      totalMessages = Object.values(state.extractedMessages)
        .flatMap((org) => Object.values(org))
        .flatMap((channel) => Object.values(channel))
        .reduce((acc, messages) => acc + messages.length, 0);

      messageCount.textContent = totalMessages.toLocaleString();
      updateTimeRanges(state);
      updateUI();
    } catch (error) {
      console.error('Failed to delete messages:', error);
      setError('Failed to delete messages');
    } finally {
      setLoading(false);
    }
  };

  const updateTimeRanges = (state: Awaited<ReturnType<typeof storageService.loadState>>): void => {
    if (!timeRanges) return;

    const ranges = state.extractedTimeRanges;
    if (!ranges || Object.keys(ranges).length === 0) {
      timeRanges.innerHTML = 'No ranges extracted';
      return;
    }

    const rangeElements: string[] = [];

    for (const [org, orgRanges] of Object.entries(ranges)) {
      for (const [channel, channelRanges] of Object.entries(orgRanges)) {
        if (channelRanges.length === 0) continue;

        const channelDisplay = channel.startsWith('DM: ') ? channel.substring(4) : `#${channel}`;
        const rangeStrings = channelRanges
          .sort((a, b) => b.end - a.end) // Most recent first
          .map((range) => formatTimeRange(range.start, range.end));

        const deleteButtonId = `delete-${org}-${channel}`.replace(/[^a-zA-Z0-9-]/g, '-');

        rangeElements.push(`
          <div class="time-range-item">
            <div class="time-range-header">
              <div class="time-range-channel">${org} / ${channelDisplay}</div>
              <button class="delete-button" id="${deleteButtonId}" title="Delete all messages from this channel">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div class="time-range-dates">${rangeStrings.join('<br>')}</div>
          </div>
        `);
      }
    }

    if (rangeElements.length === 0) {
      timeRanges.innerHTML = 'No ranges extracted';
    } else {
      timeRanges.innerHTML = rangeElements.join('');

      // Add click handlers for delete buttons
      for (const [org, orgRanges] of Object.entries(ranges)) {
        for (const channel of Object.keys(orgRanges)) {
          const deleteButtonId = `delete-${org}-${channel}`.replace(/[^a-zA-Z0-9-]/g, '-');
          const deleteButton = document.getElementById(deleteButtonId);
          if (deleteButton) {
            deleteButton.addEventListener('click', async (e) => {
              e.stopPropagation();
              showConfirmDialog(org, channel);
            });
          }
        }
      }
    }
  };

  const setLoading = (loading: boolean): void => {
    isLoading = loading;
    if (loading) {
      container.classList.add('loading');
      messageCount.classList.add('skeleton');
      channelInfo.classList.add('skeleton');
      timeRanges.classList.add('skeleton');
      toggleButton.disabled = true;
      downloadButton.disabled = true;
    } else {
      container.classList.remove('loading');
      messageCount.classList.remove('skeleton');
      channelInfo.classList.remove('skeleton');
      timeRanges.classList.remove('skeleton');
      toggleButton.disabled = false;
      downloadButton.disabled = totalMessages <= 0;
    }
  };

  const formatChannelInfo = (organization: string, channel: string): string => {
    if (channel.startsWith('DM: ')) {
      return `${organization} / ${channel.substring(4)}`;
    }
    return `${organization} / #${channel}`;
  };

  // Initialize UI state
  const initializeState = async (): Promise<void> => {
    try {
      setLoading(true);

      // Check for valid Slack tab first
      const tab = await findSlackTab();
      if (typeof tab === 'undefined' || tab === null) return;

      const state = await storageService.loadState();
      isExtracting = state.isExtracting;
      scrollingToggle.checked = Boolean(state.isScrollingEnabled);

      if (typeof state.currentChannel === 'object' && state.currentChannel !== null) {
        channelInfo.textContent = formatChannelInfo(
          state.currentChannel.organization,
          state.currentChannel.channel,
        );
      } else {
        channelInfo.textContent = 'No channel selected';
      }

      totalMessages = Object.values(state.extractedMessages)
        .flatMap((org) => Object.values(org))
        .flatMap((channel) => Object.values(channel))
        .reduce((acc, messages) => acc + messages.length, 0);

      messageCount.textContent = totalMessages.toLocaleString();
      updateTimeRanges(state);
      updateUI();
    } catch (error) {
      console.error('Failed to initialize state:', error);
      if (error instanceof Error && typeof error.message === 'string') {
        setError(`Failed to initialize: ${error.message}`);
      } else if (
        error !== null &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        setError(`Failed to initialize: ${error.message}`);
      } else {
        setError('Failed to initialize');
      }
    } finally {
      setLoading(false);
    }
  };

  // Update UI based on state
  const updateUI = (): void => {
    toggleButton.textContent = isExtracting ? 'Stop Extraction' : 'Start Extraction';
    statusIndicator.classList.toggle('active', Boolean(isExtracting));
    statusText.textContent = isExtracting ? 'Extracting messages...' : 'Idle';
    downloadButton.disabled = isLoading || totalMessages <= 0;
    toggleButton.disabled = isLoading;
  };

  // Handle download
  downloadButton.addEventListener('click', async () => {
    try {
      setLoading(true);
      const state = await storageService.loadState();
      const messages = state.extractedMessages;

      const timestamp = format(new Date(), 'yyyy-MM-dd-HH-mm');
      const filename = `slack-messages-${timestamp}.json`;

      const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;

      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download messages:', error);
      setError('Download failed');
    } finally {
      setLoading(false);
    }
  });

  // Handle extraction toggle
  toggleButton.addEventListener('click', async () => {
    try {
      setLoading(true);
      isExtracting = !isExtracting;

      await sendMessageToTab({
        type: isExtracting ? 'START_EXTRACTION' : 'STOP_EXTRACTION',
      });

      updateUI();
    } catch (error) {
      console.error('Failed to toggle extraction:', error);
      isExtracting = !isExtracting; // Revert state on error
    } finally {
      setLoading(false);
    }
  });

  // Handle scrolling toggle
  scrollingToggle.addEventListener('change', async () => {
    try {
      setLoading(true);
      const newState = scrollingToggle.checked;

      await sendMessageToTab({
        type: 'SET_SCROLLING_ENABLED',
        enabled: newState,
      });

      await storageService.setScrollingEnabled(newState);
    } catch (error) {
      console.error('Failed to toggle scrolling:', error);
      scrollingToggle.checked = !scrollingToggle.checked; // Revert state on error
    } finally {
      setLoading(false);
    }
  });

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'STATE_UPDATE') {
      isExtracting = message.isExtracting;
      if (message.currentChannel) {
        channelInfo.textContent = formatChannelInfo(
          message.currentChannel.organization,
          message.currentChannel.channel,
        );
      } else {
        channelInfo.textContent = 'No channel selected';
      }
      totalMessages = message.messageCount;
      messageCount.textContent = totalMessages.toLocaleString();

      // Update time ranges when state changes
      const state = await storageService.loadState();
      updateTimeRanges(state);
      updateUI();
    }
  });

  // Initialize
  await initializeState();
});
