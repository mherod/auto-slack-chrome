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

  let isExtracting = false;
  let totalMessages = 0;

  // Initialize UI state
  const initializeState = async (): Promise<void> => {
    const state = await storageService.loadState();
    isExtracting = state.isExtracting;
    scrollingToggle.checked = state.isScrollingEnabled;

    updateUI();

    if (state.currentChannel) {
      channelInfo.textContent = `${state.currentChannel.organization} / ${state.currentChannel.channel}`;
    }

    totalMessages = Object.values(state.extractedMessages)
      .flatMap((org) => Object.values(org))
      .flatMap((channel) => Object.values(channel))
      .reduce((acc, messages) => acc + messages.length, 0);

    messageCount.textContent = totalMessages.toString();
    downloadButton.disabled = totalMessages === 0;
  };

  // Update UI based on state
  const updateUI = (): void => {
    toggleButton.textContent = isExtracting ? 'Stop Extraction' : 'Start Extraction';
    statusIndicator.classList.toggle('active', isExtracting);
    statusText.textContent = isExtracting ? 'Extracting messages...' : 'Idle';
    downloadButton.disabled = totalMessages === 0;
  };

  // Handle download
  downloadButton.addEventListener('click', async () => {
    const state = await storageService.loadState();
    const messages = state.extractedMessages;

    // Create a formatted timestamp for the filename
    const timestamp = format(new Date(), 'yyyy-MM-dd-HH-mm');
    const filename = `slack-messages-${timestamp}.json`;

    // Create a download link
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;

    // Trigger download
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  // Handle extraction toggle
  toggleButton.addEventListener('click', async () => {
    isExtracting = !isExtracting;

    // Send message to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: isExtracting ? 'START_EXTRACTION' : 'STOP_EXTRACTION',
      });
    }

    updateUI();
  });

  // Handle scrolling toggle
  scrollingToggle.addEventListener('change', async () => {
    await storageService.setScrollingEnabled(scrollingToggle.checked);

    // Notify content script of the change
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SET_SCROLLING_ENABLED',
        enabled: scrollingToggle.checked,
      });
    }
  });

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      isExtracting = message.isExtracting;
      if (message.currentChannel) {
        channelInfo.textContent = `${message.currentChannel.organization} / ${message.currentChannel.channel}`;
      }
      totalMessages = message.messageCount;
      messageCount.textContent = totalMessages.toString();
      updateUI();
    }
  });

  // Initialize
  await initializeState();
});
