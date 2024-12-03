import { merge } from 'lodash';
import type { ExtensionState, MessagesByOrganization } from './types';

export class StorageService {
  public async loadState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(['extensionState']);
    return (
      result.extensionState || {
        isExtracting: false,
        currentChannel: null,
        extractedMessages: {},
      }
    );
  }

  public async saveState(state: ExtensionState): Promise<void> {
    await chrome.storage.local.set({ extensionState: state });
  }

  public async loadAllMessages(): Promise<MessagesByOrganization> {
    const result = await chrome.storage.local.get(['allMessages']);
    return result.allMessages || {};
  }

  public async saveAllMessages(messages: MessagesByOrganization): Promise<void> {
    await chrome.storage.local.set({ allMessages: messages });
  }

  public async mergeAndSaveMessages(
    currentMessages: MessagesByOrganization,
    newMessages: MessagesByOrganization,
  ): Promise<MessagesByOrganization> {
    const allMessages = await this.loadAllMessages();
    const mergedMessages = merge({}, allMessages, currentMessages, newMessages);
    await this.saveAllMessages(mergedMessages);
    return mergedMessages;
  }
}
