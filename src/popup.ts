import { StorageService } from './services/extraction/storage';
import { format } from 'date-fns';

document.addEventListener('DOMContentLoaded', async () => {
  const storageService = new StorageService();
  const toggleButton = document.getElementById('toggleButton') as HTMLButtonElement;
  const downloadButton = document.getElementById('downloadButton') as HTMLButtonElement;
  const statusIndicator = document.getElementById('statusIndicator') as HTMLDivElement;
  const statusText = document.getElementById('statusText') as HTMLSpanElement;
  const messageCount = document.getElementById('messageCount') as HTMLSpanElement;
  const channelInfo = document.getElementById('channelInfo') as HTMLSpanElement;
  const scrollingToggle = document.getElementById('scrollingToggle') as HTMLInputElement;
  const container = document.querySelector('.container') as HTMLDivElement;

  let isExtracting = false;
  let totalMessages = 0;
  let isLoading = true;

  const setError = (message: string): void => {
    statusText.textContent = message;
    statusIndicator.style.backgroundColor = '#dc3545';
    setLoading(false);
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
    if (!tab.id) {
      setError('Invalid tab state');
      return null;
    }
    return tab;
  };

  const sendMessageToTab = async (message: unknown): Promise<void> => {
    try {
      const tab = await findSlackTab();
      if (!tab?.id) return;

      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      console.error('Failed to send message to tab:', error);
      if (error instanceof Error && error.message.includes('Could not establish connection')) {
        setError('Please refresh the Slack tab');
      } else {
        setError('Failed to communicate with Slack');
      }
      throw error;
    }
  };

  const setLoading = (loading: boolean): void => {
    isLoading = loading;
    if (loading) {
      container.classList.add('loading');
      messageCount.classList.add('skeleton');
      channelInfo.classList.add('skeleton');
      toggleButton.disabled = true;
      downloadButton.disabled = true;
    } else {
      container.classList.remove('loading');
      messageCount.classList.remove('skeleton');
      channelInfo.classList.remove('skeleton');
      toggleButton.disabled = false;
      downloadButton.disabled = totalMessages === 0;
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
      if (!tab) return;

      const state = await storageService.loadState();
      isExtracting = state.isExtracting;
      scrollingToggle.checked = state.isScrollingEnabled;

      if (state.currentChannel) {
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
      updateUI();
    } catch (error) {
      console.error('Failed to initialize state:', error);
      setError('Failed to initialize');
    } finally {
      setLoading(false);
    }
  };

  // Update UI based on state
  const updateUI = (): void => {
    toggleButton.textContent = isExtracting ? 'Stop Extraction' : 'Start Extraction';
    statusIndicator.classList.toggle('active', isExtracting);
    statusText.textContent = isExtracting ? 'Extracting messages...' : 'Idle';
    downloadButton.disabled = isLoading || totalMessages === 0;
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
      await storageService.setScrollingEnabled(scrollingToggle.checked);

      await sendMessageToTab({
        type: 'SET_SCROLLING_ENABLED',
        enabled: scrollingToggle.checked,
      });
    } catch (error) {
      console.error('Failed to toggle scrolling:', error);
      scrollingToggle.checked = !scrollingToggle.checked; // Revert state on error
    } finally {
      setLoading(false);
    }
  });

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener((message) => {
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
      updateUI();
    }
  });

  // Initialize
  await initializeState();
});
