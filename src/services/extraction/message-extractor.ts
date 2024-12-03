import { parse } from 'date-fns';
import {
  type ChannelInfo,
  type LastKnownSender,
  type SenderInfo,
  type SlackMessage,
} from './types';

export class MessageExtractor {
  private lastKnownSender: LastKnownSender | null = null;

  public getMessageContainer(): Element | null {
    const selectors = [
      '.p-workspace__primary_view_contents',
      '.c-virtual_list__scroll_container',
      '.p-workspace__primary_view_body',
      '.c-search__results_container',
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container !== null) return container;
    }

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

      if (channel && organization) {
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

  public resetLastKnownSender(): void {
    this.lastKnownSender = null;
  }
}
