import { parse } from 'date-fns';
import {
  type ChannelInfo,
  type LastKnownSender,
  type SenderInfo,
  type SlackMessage,
  type Attachment,
  type AttachmentImage,
} from './schemas';

export class MessageExtractor {
  private lastKnownSender: LastKnownSender | null = null;
  private EXTRACTED_ATTRIBUTE = 'data-extracted';

  private log(message: string, data?: unknown): void {
    console.log(`[Slack Extractor] ${message}`, data ?? '');
  }

  private isScrollableContainer(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(element);

    // Check for scrollability in multiple ways
    const hasScroll =
      style.overflowY === 'scroll' ||
      style.overflowY === 'auto' ||
      element.scrollHeight > element.clientHeight ||
      element.classList.contains('c-virtual_list__scroll_container') ||
      element.classList.contains('p-workspace__primary_view_body');

    const hasHeight = element.clientHeight > 100; // Ensure it's a significant container

    const hasMessages = element.querySelectorAll('[data-qa="message-text"]').length > 0;
    const hasVirtualItems = element.querySelectorAll('[data-qa="virtual-list-item"]').length > 0;
    const hasMessageBlocks = element.querySelectorAll('.c-message_kit__blocks').length > 0;
    const hasMessageContent = hasMessages || hasVirtualItems || hasMessageBlocks;

    // Check for Slack's specific message pane classes
    const isMessagePane =
      element.classList.contains('p-message_pane') ||
      (element.hasAttribute('data-qa') && element.getAttribute('data-qa') === 'message_pane');

    const isPrimaryContainer =
      isMessagePane ||
      element.classList.contains('p-workspace__primary_view_body') ||
      element.classList.contains('c-virtual_list__scroll_container');

    this.log('Checking container candidate', {
      element: element.className,
      hasScroll,
      hasHeight,
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      hasMessages,
      hasVirtualItems,
      hasMessageBlocks,
      isPrimaryContainer,
      isMessagePane,
      overflowY: style.overflowY,
      dataQa: element.getAttribute('data-qa'),
    });

    // For message panes, we're more lenient with the requirements
    if (isMessagePane) {
      return hasHeight && hasMessageContent;
    }

    return hasScroll && hasHeight && hasMessageContent && isPrimaryContainer;
  }

  public getMessageContainer(): Element | null {
    this.log('Starting container search');

    // First try to find the message pane directly
    const messagePane = document.querySelector('.p-message_pane');
    if (messagePane instanceof HTMLElement) {
      this.log('Found message pane directly', {
        className: messagePane.className,
        height: messagePane.clientHeight,
        scrollHeight: messagePane.scrollHeight,
      });

      if (this.isScrollableContainer(messagePane)) {
        return messagePane;
      }
    }

    // Then try to find the scroll container
    const scrollContainer = document.querySelector('.c-virtual_list__scroll_container');
    if (scrollContainer instanceof HTMLElement) {
      this.log('Found scroll container directly', {
        className: scrollContainer.className,
        height: scrollContainer.clientHeight,
        scrollHeight: scrollContainer.scrollHeight,
      });

      if (this.isScrollableContainer(scrollContainer)) {
        return scrollContainer;
      }
    }

    // Rest of the existing search logic...
    const allDivs = document.querySelectorAll('div');
    this.log(`Found ${allDivs.length} divs to check`);

    const potentialContainers: Element[] = [];

    for (const div of allDivs) {
      if (this.isScrollableContainer(div)) {
        this.log('Found potential container', {
          className: div.className,
          id: div.id,
          messageCount: div.querySelectorAll('[data-qa="message-text"]').length,
          height: (div as HTMLElement).clientHeight,
          scrollHeight: (div as HTMLElement).scrollHeight,
        });
        potentialContainers.push(div);
      }
    }

    this.log(`Found ${potentialContainers.length} potential containers`);

    // If we found multiple containers, prefer the one with more messages
    if (potentialContainers.length > 0) {
      const bestContainer = potentialContainers.reduce((best, current) => {
        const bestMessages = best.querySelectorAll('[data-qa="message-text"]').length;
        const currentMessages = current.querySelectorAll('[data-qa="message-text"]').length;
        return currentMessages > bestMessages ? current : best;
      });

      this.log('Selected best container', {
        className: bestContainer.className,
        id: bestContainer.id,
        messageCount: bestContainer.querySelectorAll('[data-qa="message-text"]').length,
        height: (bestContainer as HTMLElement).clientHeight,
        scrollHeight: (bestContainer as HTMLElement).scrollHeight,
      });

      return bestContainer;
    }

    // Fallback to known Slack container classes if no scrollable container found
    this.log('No containers found, trying fallback selectors');

    const selectors = [
      '.p-message_pane.p-message_pane--classic-nav',
      '.p-message_pane',
      '.p-message_pane--with-bookmarks-bar',
      '.c-virtual_list__scroll_container',
      '[data-qa="message_pane"]',
      '[data-qa="virtual_list"]',
      '.p-workspace__primary_view_contents',
      '.p-workspace__primary_view_body',
      '.c-search__results_container',
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container !== null) {
        this.log('Checking fallback selector', {
          selector,
          found: true,
          className: container.className,
          id: container.id,
        });

        if (this.isScrollableContainer(container)) {
          this.log('Found valid container via fallback', {
            selector,
            className: container.className,
            id: container.id,
            messageCount: container.querySelectorAll('[data-qa="message-text"]').length,
          });
          return container;
        }
      } else {
        this.log('Checking fallback selector', {
          selector,
          found: false,
        });
      }
    }

    this.log('No valid container found');
    return null;
  }

  public extractChannelInfo(): ChannelInfo | null {
    // First try to get channel info from search result
    const searchChannelName = document.querySelector('.c-channel_entity__name');
    if (searchChannelName !== null) {
      const channel = searchChannelName.textContent?.trim() ?? '';

      // Check if we're in search view
      const searchMatch = document.title.match(/^Search - (.+?) - Slack$/);
      if (searchMatch?.at(1) !== undefined) {
        const organization = searchMatch[1].trim();
        if (channel && organization) {
          return {
            channel,
            organization,
          };
        }
      }

      // Fallback to URL-based organization if not in search
      const orgMatch = window.location.hostname.match(/^([^.]+)\.slack\.com$/);
      const organization = orgMatch?.at(1)?.trim() ?? '';

      // Reject 'app' as a valid organization
      if (channel && organization && organization !== 'app') {
        return {
          channel,
          organization,
        };
      }
    }

    // Try to match channel title format
    const channelMatch = document.title.match(/^(.+?) \(Channel\) - (.+?) - Slack$/);
    if (channelMatch?.at(1) !== undefined && channelMatch?.at(2) !== undefined) {
      const [_, channel, organization] = channelMatch;
      const cleanChannel = channel.replace(/^[!*]/, '').trim();
      const cleanOrg = organization.replace(/\s*-\s*\d+\s*(new\s*items?)?$/, '').trim();
      return {
        channel: cleanChannel,
        organization: cleanOrg,
      };
    }

    // Try to match DM title format
    const dmMatch = document.title.match(/^(.+?) \(DM\) - (.+?) - Slack$/);
    if (dmMatch?.at(1) !== undefined && dmMatch?.at(2) !== undefined) {
      const [_, user, organization] = dmMatch;
      const cleanUser = user.replace(/^[!*]/, '').trim();
      const cleanOrg = organization.replace(/\s*-\s*\d+\s*(new\s*items?)?$/, '').trim();
      return {
        channel: `DM: ${cleanUser}`,
        organization: cleanOrg,
      };
    }

    return null;
  }

  public extractMessageSender(listItem: Element): SenderInfo {
    // Try search result format first
    const searchSenderButton = listItem.querySelector('[data-message-sender]');
    const searchAvatarImg = listItem.querySelector('.c-search_message__avatar img');
    const searchCustomStatusEmoji = listItem.querySelector('.c-custom_status .c-emoji img');

    if (searchSenderButton !== null) {
      const senderText = searchSenderButton.textContent;
      const sender = senderText !== null ? senderText.trim() : null;
      const senderId = searchSenderButton.getAttribute('data-message-sender');
      const avatarUrl = searchAvatarImg?.getAttribute('src') ?? null;
      const customStatus =
        searchCustomStatusEmoji !== null
          ? {
              emoji: ((): string | null => {
                const alt = searchCustomStatusEmoji.getAttribute('alt');
                return alt !== null ? alt.replace(/:/g, '') : null;
              })(),
              emojiUrl: searchCustomStatusEmoji?.getAttribute('src') ?? null,
            }
          : null;

      if (sender !== null && senderId !== null) {
        this.lastKnownSender = {
          sender,
          senderId,
          avatarUrl,
          customStatus,
        };
      }

      return {
        sender,
        senderId,
        avatarUrl,
        customStatus,
        isInferred: false,
      };
    }

    // Try regular message format
    const senderButton = listItem.querySelector('[data-qa="message_sender_name"]');
    const avatarImg = listItem.querySelector('.c-message_kit__avatar img');
    const customStatusEmoji = listItem.querySelector('.c-custom_status .c-emoji img');

    // If we find a direct sender, use it and update lastKnownSender
    if (senderButton !== null) {
      const senderText = senderButton.textContent;
      const sender = senderText !== null ? senderText.trim() : null;
      const senderId = senderButton.getAttribute('data-message-sender');
      const avatarUrl = avatarImg?.getAttribute('src') ?? null;
      const customStatus =
        customStatusEmoji !== null
          ? {
              emoji: ((): string | null => {
                const alt = customStatusEmoji.getAttribute('alt');
                return alt !== null ? alt.replace(/:/g, '') : null;
              })(),
              emojiUrl: customStatusEmoji?.getAttribute('src') ?? null,
            }
          : null;

      if (sender !== null && senderId !== null) {
        this.lastKnownSender = {
          sender,
          senderId,
          avatarUrl,
          customStatus,
        };
      }

      return {
        sender,
        senderId,
        avatarUrl,
        customStatus,
        isInferred: false,
      };
    }

    // If no direct sender found, try to infer from lastKnownSender
    if (this.lastKnownSender !== null) {
      return {
        sender: this.lastKnownSender.sender,
        senderId: this.lastKnownSender.senderId,
        avatarUrl: this.lastKnownSender.avatarUrl,
        customStatus: this.lastKnownSender.customStatus,
        isInferred: true,
      };
    }

    // No sender information available
    return {
      sender: null,
      senderId: null,
      avatarUrl: null,
      customStatus: null,
      isInferred: false,
    };
  }

  public isValidMessage(message: SlackMessage): boolean {
    // Basic required fields
    if (message.messageId === null || message.timestamp === null || message.text === '') {
      return false;
    }

    // Validate timestamp format
    try {
      const timestamp = new Date(message.timestamp);
      if (isNaN(timestamp.getTime())) {
        return false;
      }
    } catch {
      return false;
    }

    // Validate sender info
    if (!message.isInferredSender && (message.sender === null || message.senderId === null)) {
      return false;
    }

    // Validate permalink format
    if (message.permalink === null || message.permalink.startsWith('https://') === false) {
      return false;
    }

    // Validate message content
    if (message.text.trim() === '') {
      return false;
    }

    return true;
  }

  public isValidMessageId(id: string): boolean {
    // Message IDs from actual messages typically follow the pattern: timestamp.number
    // Search results use a UUID format
    return /^\d+\.\d+$/.test(id) || /^messages_[0-9a-f-]+$/.test(id);
  }

  public extractMessageTimestamp(timestampElement: Element): {
    timestamp: string | null;
    permalink: string | null;
  } {
    let timestamp: string | null = null;
    let permalink: string | null = null;

    // Try search result format first
    const searchTimestamp = timestampElement.getAttribute('data-ts');
    if (searchTimestamp !== null) {
      const timestampMs = parseFloat(searchTimestamp) * 1000;
      timestamp = new Date(timestampMs).toISOString();
      permalink = timestampElement.getAttribute('href');
    } else {
      // Try regular message format
      const unixTimestamp = timestampElement.getAttribute('data-ts');
      if (unixTimestamp !== null) {
        const timestampMs = parseFloat(unixTimestamp) * 1000;
        timestamp = new Date(timestampMs).toISOString();
      } else {
        const ariaLabel = timestampElement.getAttribute('aria-label');
        if (ariaLabel !== null) {
          const dateMatch = ariaLabel.match(
            /(\d{1,2})\s+(\w+)(?:\s+at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/,
          );
          if (dateMatch?.at(1) !== undefined && dateMatch?.at(2) !== undefined) {
            const [_, day, month, hours, minutes, seconds = '0'] = dateMatch;
            const year = new Date().getFullYear();
            const date = parse(
              `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`,
              'd MMM yyyy H:mm:ss',
              new Date(),
            );
            timestamp = date.toISOString();
          }
        }
      }

      // Get permalink
      permalink = timestampElement.getAttribute('href');
    }

    if (permalink !== null && !permalink.startsWith('http')) {
      permalink = `https://slack.com${permalink}`;
    }

    return { timestamp, permalink };
  }

  public extractAttachments(messageElement: Element): Attachment[] | undefined {
    const attachmentsContainer = messageElement.querySelector('.c-message_kit__attachments');
    if (!attachmentsContainer) return undefined;

    const attachments: Attachment[] = [];
    const attachmentElements = attachmentsContainer.querySelectorAll('.c-message_attachment');

    for (const attachmentElement of attachmentElements) {
      const attachment: Attachment = {
        type: 'message_attachment',
        title: null,
        text: null,
        authorName: null,
        authorIcon: null,
        footerText: null,
        timestamp: null,
        permalink: null,
        images: null,
      };

      // Extract author info
      const authorElement = attachmentElement.querySelector('.c-message_attachment__author');
      if (authorElement) {
        attachment.authorName = authorElement.textContent?.trim() ?? null;
        const authorIcon = authorElement.querySelector('img');
        attachment.authorIcon = authorIcon?.getAttribute('src') ?? null;
      }

      // Extract text content
      const textElement = attachmentElement.querySelector(
        '[data-qa="message_attachment_slack_msg_text"]',
      );
      if (textElement) {
        attachment.text = textElement.textContent?.trim() ?? null;
      }

      // Extract footer
      const footerElement = attachmentElement.querySelector('[data-qa="attachment-footer"]');
      if (footerElement) {
        attachment.footerText = footerElement.textContent?.trim() ?? null;
        const timestampElement = footerElement.querySelector(
          '[data-qa="attachment-footer-timestamp"] a',
        );
        if (timestampElement) {
          attachment.timestamp = timestampElement.getAttribute('aria-label') ?? null;
        }
        const permalinkElement = footerElement.querySelector(
          '[data-qa="attachment-footer-permalink"] a',
        );
        if (permalinkElement) {
          attachment.permalink = permalinkElement.getAttribute('href') ?? null;
        }
      }

      // Extract images
      const images: AttachmentImage[] = [];
      const imageElements = attachmentElement.querySelectorAll('.p-file_image_thumbnail__wrapper');
      for (const imageElement of imageElements) {
        const img = imageElement.querySelector('img');
        if (img) {
          images.push({
            url: imageElement.getAttribute('href') ?? '',
            thumbnailUrl: img.getAttribute('src') ?? null,
            alt: img.getAttribute('alt') ?? null,
          });
        }
      }

      if (images.length > 0) {
        attachment.images = images;
      }

      attachments.push(attachment);
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  public resetLastKnownSender(): void {
    this.lastKnownSender = null;
  }

  public markMessageAsExtracted(element: Element, isInRange?: boolean): void {
    // Add the extracted attribute
    element.setAttribute(this.EXTRACTED_ATTRIBUTE, 'true');

    // Find the timestamp element - try multiple selectors for different message formats
    const timestampElement = element.querySelector(
      '[data-ts], .c-timestamp, .c-message_kit__timestamp',
    );
    if (timestampElement instanceof HTMLElement) {
      // Create or find the saved indicator
      let savedIndicator = timestampElement.nextElementSibling?.classList.contains(
        'saved-indicator',
      )
        ? (timestampElement.nextElementSibling as HTMLElement)
        : null;

      if (!savedIndicator) {
        savedIndicator = document.createElement('span');
        savedIndicator.className = 'saved-indicator';
        savedIndicator.textContent = '• Saved';
        timestampElement.insertAdjacentElement('afterend', savedIndicator);
      }

      // Update text to show range status if provided
      if (typeof isInRange === 'boolean') {
        savedIndicator.textContent = isInRange ? '• Saved (in range)' : '• Saved';
      }
    }
  }

  public updateRangeIndicator(element: Element, isInRange: boolean): void {
    const timestampElement = element.querySelector(
      '[data-ts], .c-timestamp, .c-message_kit__timestamp',
    );
    if (timestampElement instanceof HTMLElement) {
      const savedIndicator = timestampElement.nextElementSibling;
      if (savedIndicator?.classList.contains('saved-indicator')) {
        savedIndicator.textContent = isInRange ? '• Saved (in range)' : '• Saved';
      }
    }
  }

  public isMessageExtracted(element: Element): boolean {
    return (
      element.hasAttribute(this.EXTRACTED_ATTRIBUTE) ||
      element.querySelector('.saved-indicator') !== null
    );
  }

  public removeExtractionMark(messageElement: HTMLElement): void {
    messageElement.removeAttribute(this.EXTRACTED_ATTRIBUTE);
    const savedIndicator = messageElement.querySelector('.saved-indicator');
    if (savedIndicator) {
      savedIndicator.remove();
    }
  }
}
