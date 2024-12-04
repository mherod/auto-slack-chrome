import { startOfDay } from 'date-fns';
import type { MessageExtractor } from './message-extractor';
import type { StorageService } from './storage';
import type { ChannelInfo, MessagesByOrganization, SlackMessage } from './types';

export class MonitorService {
  private observer: MutationObserver | null = null;
  private titleCheckInterval: number | null = null;
  private extractedMessages: MessagesByOrganization = {};
  private currentChannelInfo: ChannelInfo | null = null;
  private lastMessageTimestamp: number = Date.now();
  private reconnectInterval: number | null = null;
  private scrollTimeout: number | null = null;
  private pollingInterval: number | null = null;
  private readonly EXTRACTED_ATTRIBUTE = 'data-extracted';
  private readonly RANGE_ATTRIBUTE = 'data-in-extracted-range';
  private readonly SCROLL_DEBOUNCE_MS = 250;
  private readonly POLLING_INTERVAL_MS = 2000;
  private readonly TITLE_CHECK_INTERVAL_MS = 5000;
  private readonly RECONNECT_CHECK_INTERVAL_MS = 7500;
  private readonly AUTO_SCROLL_STEP = 600;
  private readonly AUTO_SCROLL_INTERVAL_MS = 400;
  private readonly SCROLL_PAUSE_MS = 500;
  private readonly MAX_SCROLL_ATTEMPTS = 75;
  private readonly SCROLL_THRESHOLD = 100;
  private readonly MAX_WAIT_FOR_MESSAGES_MS = 2000;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly FORCE_SCROLL_MULTIPLIER = 1.5;
  private autoScrollInterval: number | null = null;
  private lastScrollPosition: number = 0;
  private scrollAttempts: number = 0;
  private lastMessageCount: number = 0;
  private isExtracting = false;
  private isAutoScrolling = false;
  private readonly MAX_IDLE_TIME_MS = 10000;
  private lastScrollTime: number = Date.now();

  public constructor(
    private readonly messageExtractor: MessageExtractor,
    private readonly storageService: StorageService,
    private readonly onChannelChange: (channelInfo: ChannelInfo) => void,
    private readonly onSync: () => void,
  ) {
    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'auto-slack-extraction-styles';
    if (document.getElementById(styleId) !== null) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .saved-indicator {
        margin-left: 6px;
        color: var(--sk_foreground_max_solid, #4a154b);
        opacity: 0.7;
        font-size: 12px;
        font-style: italic;
        user-select: none;
        pointer-events: none;
        vertical-align: baseline;
      }

      .auto-slack-scroll-container {
        border: 2px solid rgba(54, 197, 171, 0.4) !important;
        border-radius: 4px !important;
      }

      .auto-slack-scroll-container--scrolling {
        border-color: rgba(54, 197, 171, 0.8) !important;
      }
    `;
    document.head.appendChild(style);
  }

  private markMessageAsExtracted(element: Element): void {
    // Get timestamp to check range status
    const timestampElement = element.querySelector('.c-timestamp');
    if (timestampElement) {
      const { timestamp } = this.messageExtractor.extractMessageTimestamp(timestampElement);
      if (timestamp && this.currentChannelInfo) {
        const messageTime = new Date(timestamp).getTime();
        const isInRange = this.storageService.isTimeRangeExtracted(
          this.currentChannelInfo.organization,
          this.currentChannelInfo.channel,
          messageTime,
        );
        this.messageExtractor.markMessageAsExtracted(element, isInRange);
      } else {
        this.messageExtractor.markMessageAsExtracted(element);
      }
    } else {
      this.messageExtractor.markMessageAsExtracted(element);
    }
  }

  private markScrollContainer(container: Element | null): void {
    if (container === null) return;
    container.classList.add('auto-slack-scroll-container');
  }

  private markScrollContainerAsScrolling(container: Element | null, isScrolling: boolean): void {
    if (container === null) return;
    if (isScrolling) {
      container.classList.add('auto-slack-scroll-container--scrolling');
    } else {
      container.classList.remove('auto-slack-scroll-container--scrolling');
    }
  }

  public async startMonitoring(): Promise<void> {
    // Load previous state
    const state = await this.storageService.loadState();
    this.extractedMessages = state.extractedMessages;

    // Initial channel info extraction
    this.currentChannelInfo = this.messageExtractor.extractChannelInfo();

    // Set up title observer and periodic check
    this.setupTitleObserver();

    // Set up message observer
    this.setupMessageObserver();

    // Mark the scroll container
    const container = this.messageExtractor.getMessageContainer();
    this.markScrollContainer(container);

    // Set up scroll handler
    this.setupScrollHandler();

    // Set up reconnect check
    this.setupReconnectCheck();

    // Set up polling monitor
    this.setupPollingMonitor();

    // Initial extraction
    await this.extractMessages();

    // Start scrolling only if enabled
    if (await this.storageService.isScrollingEnabled()) {
      await this.autoScroll();
    }

    // Save initial state
    await this.saveCurrentState();
  }

  public async stopMonitoring(): Promise<void> {
    // Stop auto-scrolling
    this.isAutoScrolling = false;

    const container = this.messageExtractor.getMessageContainer();

    // Remove visual indicators
    if (container !== null) {
      container.classList.remove(
        'auto-slack-scroll-container',
        'auto-slack-scroll-container--scrolling',
      );
      // Remove scroll listener
      container.removeEventListener('scroll', this.handleScroll);
    }

    // Stop observers and handlers
    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.titleCheckInterval !== null) {
      window.clearInterval(this.titleCheckInterval);
      this.titleCheckInterval = null;
    }

    if (this.reconnectInterval !== null) {
      window.clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    if (this.scrollTimeout !== null) {
      window.clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.autoScrollInterval !== null) {
      window.clearInterval(this.autoScrollInterval);
      this.autoScrollInterval = null;
    }

    // Save state
    await this.saveCurrentState();
  }

  public getCurrentState(): {
    isExtracting: boolean;
    channelInfo: ChannelInfo | null;
    messageCount: number;
    extractedMessages: MessagesByOrganization;
  } {
    const messageCount = Object.values(this.extractedMessages)
      .reduce<number[]>((acc, org) => {
        const orgValues = Object.values(org);
        const channelValues = orgValues.flatMap((channel) => Object.values(channel));
        const messageLengths = channelValues.flatMap((messages) => messages.length);
        return acc.concat(messageLengths);
      }, [])
      .reduce((acc, count) => acc + count, 0);

    return {
      isExtracting: Boolean(this.observer),
      channelInfo: this.currentChannelInfo,
      messageCount,
      extractedMessages: this.extractedMessages,
    };
  }

  private setupScrollHandler(): void {
    const container = this.messageExtractor.getMessageContainer();
    if (container instanceof Element) {
      container.addEventListener('scroll', this.handleScroll);
    }
  }

  private handleScroll = (): void => {
    if (typeof this.scrollTimeout === 'number') {
      window.clearTimeout(this.scrollTimeout);
    }

    // Don't handle manual scrolls during auto-scrolling
    if (this.isAutoScrolling) return;

    // Disconnect observer during scroll
    if (this.observer instanceof MutationObserver) {
      this.observer.disconnect();
    }

    this.scrollTimeout = window.setTimeout(async () => {
      if (!this.isExtracting) {
        // Reconnect observer first
        this.setupMessageObserver();

        // Then extract messages
        await this.extractMessages();
        this.onSync();

        // Update timestamp to prevent unnecessary reconnection
        this.lastMessageTimestamp = Date.now();
      }
    }, this.SCROLL_DEBOUNCE_MS);
  };

  private setupMessageObserver(): void {
    const container = this.messageExtractor.getMessageContainer();
    if (container !== null) {
      // Clean up existing observer if it exists
      if (this.observer !== null) {
        this.observer.disconnect();
      }

      this.observer = new MutationObserver((mutations) => {
        if (!this.isExtracting) {
          // Check if any mutations are relevant to message content
          const hasRelevantChanges = mutations.some(
            (mutation) =>
              mutation.type === 'childList' ||
              (mutation.type === 'attributes' && mutation.attributeName === 'data-qa') ||
              (mutation.type === 'attributes' &&
                mutation.attributeName === 'data-needs-sender-update'),
          );

          if (hasRelevantChanges) {
            void this.extractMessages();
            this.onSync();
            this.lastMessageTimestamp = Date.now();
          }
        }
      });

      this.observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-qa',
          'data-needs-sender-update',
          this.EXTRACTED_ATTRIBUTE,
          this.RANGE_ATTRIBUTE,
        ],
      });
    }
  }

  private setupReconnectCheck(): void {
    this.reconnectInterval = window.setInterval(() => {
      const timeSinceLastMessage = Date.now() - this.lastMessageTimestamp;
      if (timeSinceLastMessage > 10000) {
        // 10 seconds
        // Reconnect observer
        if (this.observer !== null) {
          this.observer.disconnect();
        }
        this.setupMessageObserver();
      }
    }, this.RECONNECT_CHECK_INTERVAL_MS);
  }

  private setupTitleObserver(): void {
    const titleObserver = new MutationObserver(() => void this.checkChannelChange());

    const titleElement = document.querySelector('title');
    if (titleElement !== null) {
      titleObserver.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // Set up periodic title check
    this.titleCheckInterval = window.setInterval(
      () => void this.checkChannelChange(),
      this.TITLE_CHECK_INTERVAL_MS,
    );
  }

  private async checkChannelChange(): Promise<void> {
    const newChannelInfo = this.messageExtractor.extractChannelInfo();
    if (
      newChannelInfo !== null &&
      (this.currentChannelInfo === null ||
        newChannelInfo.channel !== this.currentChannelInfo.channel ||
        newChannelInfo.organization !== this.currentChannelInfo.organization)
    ) {
      // Update channel info
      this.currentChannelInfo = newChannelInfo;

      // Disconnect and reconnect observer to ensure clean state
      if (this.observer !== null) {
        this.observer.disconnect();
      }
      this.setupMessageObserver();

      // Extract messages in new channel
      await this.extractMessages();
      this.onChannelChange(newChannelInfo);

      // Update timestamp to prevent unnecessary reconnection
      this.lastMessageTimestamp = Date.now();
    }
  }

  private nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private log(message: string, data?: unknown): void {
    console.log(`[Slack Extractor] ${message}`, data ?? '');
  }

  private async findAndScrollElement(): Promise<Element | null> {
    // Try specific Slack selectors first
    const slackSelectors = [
      '.c-virtual_list__scroll_container',
      '.p-workspace__primary_view_body',
      '.p-message_pane',
      '[data-qa="message_pane"]',
      '[data-qa="virtual_list"]',
      '.c-scrollbar__hider',
    ];

    // Try Slack-specific selectors first
    for (const selector of slackSelectors) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        const style = window.getComputedStyle(element);
        const isScrollable =
          style.overflowY === 'scroll' ||
          style.overflowY === 'auto' ||
          element.scrollHeight > element.clientHeight;

        if (isScrollable) {
          const beforeScroll = element.scrollTop;
          element.scrollTop = Math.max(0, element.scrollTop - this.AUTO_SCROLL_STEP);
          await this.nextTick();
          if (element.scrollTop !== beforeScroll) {
            this.log('Found Slack scrollable element', {
              selector,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
            });
            return element;
          }
        }
      }
    }

    // Fallback to finding any scrollable element
    const allElements = document.querySelectorAll('*');
    const scrollableElements: HTMLElement[] = [];

    for (const element of allElements) {
      if (element instanceof HTMLElement) {
        const style = window.getComputedStyle(element);
        const hasVisibleScrollbar =
          element.scrollHeight > element.clientHeight &&
          (style.overflowY === 'scroll' || style.overflowY === 'auto') &&
          style.display !== 'none' &&
          element.clientHeight > 0;

        if (hasVisibleScrollbar) {
          scrollableElements.push(element);
        }
      }
    }

    // Sort by scroll height difference to find the most scrollable element
    scrollableElements.sort(
      (a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    );

    for (const element of scrollableElements) {
      const beforeScroll = element.scrollTop;
      element.scrollTop = Math.max(0, element.scrollTop - this.AUTO_SCROLL_STEP);
      await this.nextTick();

      if (element.scrollTop !== beforeScroll) {
        this.log('Found fallback scrollable element', {
          className: element.className,
          id: element.id,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        });
        return element;
      }
    }

    return null;
  }

  private async attemptScrollOnElement(element: Element, amount: number): Promise<boolean> {
    if (!(element instanceof HTMLElement)) return false;

    const el = element;
    const beforeMessageCount = document.querySelectorAll('[data-qa="virtual-list-item"]').length;

    try {
      // Try each scroll method sequentially instead of in parallel
      const scrollMethods = [
        // Method 1: Smooth scroll with animation
        async (): Promise<boolean> => {
          const beforeScroll = el.scrollTop;
          const targetScroll = Math.max(0, el.scrollTop - amount);
          const startTime = performance.now();
          const duration = 400; // Duration in milliseconds

          // Smooth scroll animation
          const animate = async (): Promise<boolean> => {
            const currentTime = performance.now();
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic function for smooth deceleration
            const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
            const currentProgress = easeOut(progress);

            el.scrollTop = beforeScroll - (beforeScroll - targetScroll) * currentProgress;

            if (progress < 1) {
              await new Promise((resolve) => window.requestAnimationFrame(resolve));
              return animate();
            }

            const didScroll = el.scrollTop !== beforeScroll;
            if (didScroll) {
              this.lastScrollTime = Date.now();
            }
            return didScroll;
          };

          return animate();
        },

        // Method 2: ScrollIntoView with smooth behavior
        async (): Promise<boolean> => {
          const unextractedMessage = el.querySelector(
            `[data-qa="virtual-list-item"]:not([${this.EXTRACTED_ATTRIBUTE}="true"])`,
          );

          if (unextractedMessage instanceof HTMLElement) {
            const beforeScroll = el.scrollTop;
            unextractedMessage.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });

            // Wait for smooth scroll to complete
            await new Promise((resolve) => setTimeout(resolve, 400));

            const didScroll = el.scrollTop !== beforeScroll;
            if (didScroll) {
              this.lastScrollTime = Date.now();
            }
            return didScroll;
          }
          return false;
        },

        // Method 3: Force scroll with multiplier (fallback)
        async (): Promise<boolean> => {
          const beforeScroll = el.scrollTop;
          const targetScroll = Math.max(0, el.scrollTop - amount * this.FORCE_SCROLL_MULTIPLIER);

          // Even for force scroll, use smooth animation
          const startTime = performance.now();
          const duration = 300; // Shorter duration for force scroll

          const animate = async (): Promise<boolean> => {
            const currentTime = performance.now();
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const easeOut = (t: number): number => 1 - Math.pow(1 - t, 2);
            const currentProgress = easeOut(progress);

            el.scrollTop = beforeScroll - (beforeScroll - targetScroll) * currentProgress;

            if (progress < 1) {
              await new Promise((resolve) => window.requestAnimationFrame(resolve));
              return animate();
            }

            const didScroll = el.scrollTop !== beforeScroll;
            if (didScroll) {
              this.lastScrollTime = Date.now();
            }
            return didScroll;
          };

          return animate();
        },
      ];

      // Try each method sequentially until one works
      for (const method of scrollMethods) {
        const didScroll = await method();
        if (didScroll) {
          // Give DOM time to update after successful scroll
          await new Promise((resolve) => setTimeout(resolve, this.SCROLL_PAUSE_MS));
          return true;
        }
      }

      // Check if we got new messages even if scrolling appeared to fail
      const afterMessageCount = document.querySelectorAll('[data-qa="virtual-list-item"]').length;
      return afterMessageCount > beforeMessageCount;
    } catch (error) {
      this.log('Error during scroll attempt', {
        element: el.className,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  private async waitForNewMessages(currentCount: number): Promise<boolean> {
    // Check if auto-scroll is still enabled
    const state = await this.storageService.loadState();
    if (!state.isScrollingEnabled) {
      this.log('Auto-scroll was disabled while waiting for messages');
      return false;
    }

    const startTime = Date.now();
    let lastCount = currentCount;
    let noChangeCount = 0;
    const MAX_NO_CHANGE = 3;

    while (Date.now() - startTime < this.MAX_WAIT_FOR_MESSAGES_MS) {
      // Check if auto-scroll was disabled while waiting
      const currentState = await this.storageService.loadState();
      if (!currentState.isScrollingEnabled) {
        this.log('Auto-scroll was disabled while waiting for messages');
        return false;
      }

      const newCount = document.querySelectorAll('[data-qa="virtual-list-item"]').length;

      if (newCount > currentCount) {
        this.log('Found new messages', {
          beforeCount: currentCount,
          afterCount: newCount,
          waitTime: Date.now() - startTime,
        });
        return true;
      }

      if (newCount === lastCount) {
        noChangeCount++;
        if (noChangeCount >= MAX_NO_CHANGE) {
          // If count hasn't changed for several checks, try forcing a scroll
          const scrollableElement = await this.findAndScrollElement();
          if (scrollableElement instanceof HTMLElement) {
            await this.attemptScrollOnElement(
              scrollableElement,
              this.AUTO_SCROLL_STEP * this.FORCE_SCROLL_MULTIPLIER,
            );
          }
        }
      } else {
        noChangeCount = 0;
      }

      lastCount = newCount;
      await new Promise((resolve) => setTimeout(resolve, 50)); // Faster polling
    }

    this.log('Timed out waiting for new messages', {
      messageCount: currentCount,
      waitTime: this.MAX_WAIT_FOR_MESSAGES_MS,
    });
    return false;
  }

  private async autoScroll(): Promise<void> {
    // Check if auto-scroll is enabled in storage
    const state = await this.storageService.loadState();
    if (!state.isScrollingEnabled) {
      this.log('Auto-scroll is disabled in storage, skipping');
      return;
    }

    if (this.isAutoScrolling) {
      this.log('Already auto-scrolling, skipping');
      return;
    }

    this.isAutoScrolling = true;
    this.scrollAttempts = 0;
    let consecutiveNoNewMessages = 0;

    try {
      while (this.scrollAttempts < this.MAX_SCROLL_ATTEMPTS && this.isAutoScrolling) {
        // Check if auto-scroll was disabled while running
        const currentState = await this.storageService.loadState();
        if (!currentState.isScrollingEnabled) {
          this.log('Auto-scroll was disabled while running, stopping');
          break;
        }

        // Quick check for ongoing extraction
        if (this.isExtracting) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        const beforeMessageCount = document.querySelectorAll(
          '[data-qa="virtual-list-item"]',
        ).length;
        const scrollableElement = await this.findAndScrollElement();

        if (!scrollableElement) {
          this.log('No scrollable element found, retrying...');
          await new Promise((resolve) => setTimeout(resolve, this.SCROLL_PAUSE_MS));
          continue;
        }

        this.log('Scrolling attempt', {
          attempt: this.scrollAttempts + 1,
          maxAttempts: this.MAX_SCROLL_ATTEMPTS,
          element: scrollableElement.className,
          consecutiveNoNewMessages,
        });

        // Try to scroll
        const scrolled = await this.attemptScrollOnElement(
          scrollableElement,
          this.AUTO_SCROLL_STEP,
        );

        if (!scrolled) {
          consecutiveNoNewMessages++;
          this.log('Failed to scroll', { consecutiveNoNewMessages });

          if (consecutiveNoNewMessages >= this.MAX_CONSECUTIVE_FAILURES) {
            this.log('Too many consecutive failures, stopping');
            break;
          }

          // Try a more aggressive scroll
          await this.attemptScrollOnElement(
            scrollableElement,
            this.AUTO_SCROLL_STEP * this.FORCE_SCROLL_MULTIPLIER,
          );
        }

        // Quick pause for content load
        await new Promise((resolve) => setTimeout(resolve, this.SCROLL_PAUSE_MS));

        // Extract any new messages
        if (!this.isExtracting) {
          await this.extractMessages();
        }

        // Wait for new messages with timeout
        const gotNewMessages = await this.waitForNewMessages(beforeMessageCount);

        if (gotNewMessages) {
          consecutiveNoNewMessages = 0;
          // Minimal pause after success
          await new Promise((resolve) => setTimeout(resolve, this.SCROLL_PAUSE_MS / 2));
        }

        this.scrollAttempts++;
      }
    } catch (error) {
      this.log('Error during auto-scroll', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isAutoScrolling = false;
      this.log('Auto-scroll complete', {
        attempts: this.scrollAttempts,
        consecutiveNoNewMessages,
      });
    }
  }

  private async extractMessages(): Promise<void> {
    if (this.isExtracting || this.currentChannelInfo === null) {
      this.log('Skipping extraction', {
        reason: this.isExtracting ? 'already_extracting' : 'no_channel_info',
      });
      return;
    }

    this.isExtracting = true;
    this.log('Starting message extraction');

    try {
      const messageElements = document.querySelectorAll('[data-qa="virtual-list-item"]');
      this.log('Found message elements', { count: messageElements.length });

      if (messageElements.length === 0) return;

      // Process messages in dynamic chunks from bottom to top
      const messages = Array.from(messageElements).reverse(); // Reverse to process bottom-to-top
      const viewportHeight = window.innerHeight;
      const avgMessageHeight = 50; // Approximate average height of a message
      const messagesInViewport = Math.ceil(viewportHeight / avgMessageHeight);
      const chunkSize = Math.max(10, messagesInViewport); // At least 10, or enough to fill viewport

      // Track processed message IDs to avoid reprocessing
      const processedIds = new Set<string>();

      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        this.log('Processing message chunk (bottom-to-top)', {
          chunk: i / chunkSize + 1,
          totalChunks: Math.ceil(messages.length / chunkSize),
          chunkSize: chunk.length,
          viewportMessages: messagesInViewport,
          direction: 'bottom-to-top',
        });

        const extractionPromises = chunk.map(async (listItem) => {
          if (!(listItem instanceof HTMLElement)) return;

          const messageId = listItem.getAttribute('id');
          if (!messageId || processedIds.has(messageId)) return;

          // Skip already extracted messages unless they need sender update
          if (
            this.messageExtractor.isMessageExtracted(listItem) &&
            !listItem.hasAttribute('data-needs-sender-update')
          ) {
            // Still check and mark if it's in range
            const timestampElement = listItem.querySelector('.c-timestamp');
            if (timestampElement) {
              const { timestamp } = this.messageExtractor.extractMessageTimestamp(timestampElement);
              this.markMessageInRange(listItem, timestamp);
            }
            processedIds.add(messageId);
            return;
          }

          // Skip invalid messages and UI elements
          if (!this.messageExtractor.isValidMessageId(messageId)) return;

          // Skip empty messages or UI elements without actual text content
          const messageText = listItem.querySelector('[data-qa="message-text"]');
          const text = messageText?.textContent ?? '';
          if (text.trim() === '') return;

          // Extract sender information with follow-up message handling
          const { sender, senderId, avatarUrl, customStatus, isInferred } =
            this.messageExtractor.extractMessageSender(listItem);

          // Get timestamp and permalink
          const timestampElement = listItem.querySelector('.c-timestamp');
          if (timestampElement === null) return;

          const { timestamp, permalink } =
            this.messageExtractor.extractMessageTimestamp(timestampElement);

          // Skip messages without timestamps as they're likely UI elements
          if (timestamp === null) return;

          // Mark if message is in extracted range
          this.markMessageInRange(listItem, timestamp);

          const message: SlackMessage = {
            messageId,
            sender,
            senderId,
            timestamp,
            text,
            permalink,
            customStatus,
            avatarUrl,
            isInferredSender: isInferred,
          };

          // Extract attachments if present
          const attachments = this.messageExtractor.extractAttachments(listItem);
          if (attachments) {
            message.attachments = attachments;
          }

          // Only add valid messages to the hierarchy and mark them as extracted
          if (this.messageExtractor.isValidMessage(message)) {
            await this.updateMessageHierarchy(message);
            this.messageExtractor.markMessageAsExtracted(listItem);
            processedIds.add(messageId);
          }
        });

        // Process chunk in parallel but wait for completion
        await Promise.all(extractionPromises);

        // Allow UI to update between chunks and check if we should continue
        await this.nextTick();

        // Check if extraction should continue
        const state = await this.storageService.loadState();
        if (!state.isScrollingEnabled && this.isAutoScrolling) {
          this.log('Stopping extraction due to disabled auto-scroll');
          break;
        }
      }
    } finally {
      this.isExtracting = false;
      this.log('Message extraction complete');
    }
  }

  private async updateMessageHierarchy(message: SlackMessage): Promise<void> {
    if (this.currentChannelInfo === null || message.timestamp === null) return;

    const { organization, channel } = this.currentChannelInfo;
    const messageDate = startOfDay(new Date(message.timestamp)).toISOString();

    // Initialize hierarchy if needed
    if (!(organization in this.extractedMessages)) {
      this.extractedMessages[organization] = {};
    }
    if (!(channel in this.extractedMessages[organization])) {
      this.extractedMessages[organization][channel] = {};
    }
    if (!(messageDate in this.extractedMessages[organization][channel])) {
      this.extractedMessages[organization][channel][messageDate] = [];
    }

    const messages = this.extractedMessages[organization][channel][messageDate];
    const existingIndex = messages.findIndex((m) => m.messageId === message.messageId);

    if (existingIndex >= 0) {
      // Update existing message if new info is available
      if (!message.isInferredSender && message.sender !== null && message.senderId !== null) {
        messages[existingIndex] = {
          ...messages[existingIndex],
          ...message,
          isInferredSender: false,
        };
      }
    } else {
      // Add new message
      messages.push(message);
    }

    // Sort messages by timestamp
    messages.sort((a, b) => {
      const timeA = new Date(a.timestamp ?? 0).getTime();
      const timeB = new Date(b.timestamp ?? 0).getTime();
      return timeA - timeB;
    });

    // Save state
    await this.saveCurrentState();
  }

  private async saveCurrentState(): Promise<void> {
    await this.storageService.saveState({
      isExtracting: this.observer !== null,
      currentChannel: this.currentChannelInfo,
      extractedMessages: this.extractedMessages,
      extractedTimeRanges: {}, // Let storage service compute this from messages
    });
  }

  private setupPollingMonitor(): void {
    // Clear existing interval if it exists
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
    }

    // Set up new polling interval
    this.pollingInterval = window.setInterval(async () => {
      if (!this.isExtracting) {
        const container = this.messageExtractor.getMessageContainer();
        if (container !== null) {
          // Check if there are any unextracted messages
          const unextractedMessages = container.querySelectorAll(
            `[data-qa="virtual-list-item"]:not([${this.EXTRACTED_ATTRIBUTE}="true"])`,
          );

          if (unextractedMessages.length > 0) {
            // Extract messages if we find any that haven't been processed
            await this.extractMessages();
            this.onSync();
            this.lastMessageTimestamp = Date.now();
          }

          // Check for messages that might need sender updates
          const needsSenderUpdate = container.querySelectorAll('[data-needs-sender-update]');
          if (needsSenderUpdate.length > 0) {
            await this.extractMessages();
            this.onSync();
          }

          // Check if we've been idle too long and should restart scrolling
          const timeSinceLastScroll = Date.now() - this.lastScrollTime;
          if (timeSinceLastScroll > this.MAX_IDLE_TIME_MS && !this.isAutoScrolling) {
            this.log('Restarting scroll due to idle timeout', {
              idleTime: timeSinceLastScroll,
              maxIdleTime: this.MAX_IDLE_TIME_MS,
            });
            void this.autoScroll();
          }
        }
      }
    }, this.POLLING_INTERVAL_MS);
  }

  public setScrollingEnabled(enabled: boolean): void {
    this.log('Setting auto-scroll enabled state', { enabled });
    if (!enabled && Boolean(this.isAutoScrolling)) {
      this.isAutoScrolling = false;
      this.log('Stopping auto-scroll due to preference change');
    }
  }

  private addMessage(organization: string, channel: string, message: SlackMessage): void {
    const messageDate = startOfDay(new Date(message.timestamp ?? new Date())).toISOString();

    // Initialize organization if it doesn't exist
    if (!(organization in this.extractedMessages)) {
      this.extractedMessages[organization] = {};
    }

    // Initialize channel if it doesn't exist
    if (!(channel in this.extractedMessages[organization])) {
      this.extractedMessages[organization][channel] = {};
    }

    // Initialize date if it doesn't exist
    if (!(messageDate in this.extractedMessages[organization][channel])) {
      this.extractedMessages[organization][channel][messageDate] = [];
    }

    const messages = this.extractedMessages[organization][channel][messageDate];
    const existingIndex = messages.findIndex(
      (m: SlackMessage) => m.messageId === message.messageId,
    );

    if (existingIndex >= 0) {
      // Update existing message if new info is available
      messages[existingIndex] = {
        ...messages[existingIndex],
        ...message,
      };
    } else {
      // Add new message
      messages.push(message);
    }

    // Sort messages by timestamp
    messages.sort((a: SlackMessage, b: SlackMessage) => {
      const timeA = new Date(a.timestamp ?? 0).getTime();
      const timeB = new Date(b.timestamp ?? 0).getTime();
      return timeA - timeB;
    });
  }

  private markMessageInRange(element: Element, timestamp: string | null): void {
    if (!timestamp || !this.currentChannelInfo) return;

    const messageTime = new Date(timestamp).getTime();
    const isInRange = this.storageService.isTimeRangeExtracted(
      this.currentChannelInfo.organization,
      this.currentChannelInfo.channel,
      messageTime,
    );

    // Update the text indicator if the message is already extracted
    if (this.messageExtractor.isMessageExtracted(element)) {
      this.messageExtractor.updateRangeIndicator(element, isInRange);
    }
  }
}
