import { parse } from 'date-fns';
import {
  type SlackMessage,
  type ChannelInfo,
  type SenderInfo,
  type LastKnownSender,
} from './types';

export class MessageExtractor {
  private lastKnownSender: LastKnownSender | null = null;

  public getMessageContainer(): Element | null {
    const selectors = [
      '.p-workspace__primary_view_contents',
      '.c-virtual_list__scroll_container',
      '.p-workspace__primary_view_body',
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) return container;
    }

    return null;
  }

  public extractChannelInfo(): ChannelInfo | null {
    // Try to match channel title format
    const channelMatch = document.title.match(/^(.+?) \(Channel\) - (.+?) - Slack$/);
    if (channelMatch) {
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
    if (dmMatch) {
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
    const senderButton = listItem.querySelector('[data-qa="message_sender_name"]');
    const avatarImg = listItem.querySelector('.c-message_kit__avatar img');
    const customStatusEmoji = listItem.querySelector('.c-custom_status .c-emoji img');

    // If we find a direct sender, use it and update lastKnownSender
    if (senderButton) {
      const sender = senderButton.textContent?.trim() || null;
      const senderId = senderButton.getAttribute('data-message-sender') || null;
      const avatarUrl = avatarImg?.getAttribute('src') || null;
      const customStatus = customStatusEmoji
        ? {
            emoji: customStatusEmoji.getAttribute('alt')?.replace(/:/g, '') || null,
            emojiUrl: customStatusEmoji.getAttribute('src') || null,
          }
        : null;

      if (sender && senderId) {
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

    // If no direct sender found, use lastKnownSender if available
    if (this.lastKnownSender) {
      return {
        ...this.lastKnownSender,
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
    if (!message.messageId || !message.timestamp || !message.text) {
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
    if (!message.isInferredSender && (!message.sender || !message.senderId)) {
      return false;
    }

    // Validate permalink format
    if (!message.permalink?.startsWith('https://')) {
      return false;
    }

    // Validate message content
    if (message.text.trim().length === 0) {
      return false;
    }

    return true;
  }

  public isValidMessageId(id: string): boolean {
    // Message IDs from actual messages typically follow the pattern: timestamp.number
    return /^\d+\.\d+$/.test(id);
  }

  public extractMessageTimestamp(timestampElement: Element): {
    timestamp: string | null;
    permalink: string | null;
  } {
    let timestamp: string | null = null;
    let permalink: string | null = null;

    const unixTimestamp = timestampElement.getAttribute('data-ts');
    if (unixTimestamp) {
      const timestampMs = parseFloat(unixTimestamp) * 1000;
      timestamp = new Date(timestampMs).toISOString();
    } else {
      const ariaLabel = timestampElement.getAttribute('aria-label');
      if (ariaLabel) {
        const dateMatch = ariaLabel.match(
          /(\d{1,2})\s+(\w+)(?:\s+at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/,
        );
        if (dateMatch) {
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
    permalink = timestampElement.getAttribute('href') || null;
    if (permalink && !permalink.startsWith('http')) {
      permalink = `https://slack.com${permalink}`;
    }

    return { timestamp, permalink };
  }

  public resetLastKnownSender(): void {
    this.lastKnownSender = null;
  }
}
