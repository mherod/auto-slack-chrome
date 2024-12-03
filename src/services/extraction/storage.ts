import { merge } from 'lodash';
import type { ExtensionState, MessagesByOrganization } from './types';

export class StorageService {
  public async loadState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(['extensionState']);
    return typeof result.extensionState === 'object' && result.extensionState !== null
      ? result.extensionState
      : {
          isExtracting: false,
          currentChannel: null,
          extractedMessages: {},
        };
  }

  public async saveState(state: ExtensionState): Promise<void> {
    // Always merge with existing state using lodash merge
    const currentState = await this.loadState();
    const mergedState = merge({}, currentState, state, {
      extractedMessages: await this.mergeAndSaveMessages(
        currentState.extractedMessages,
        state.extractedMessages,
      ),
    });
    await chrome.storage.local.set({ extensionState: mergedState });
  }

  public async loadAllMessages(): Promise<MessagesByOrganization> {
    const result = await chrome.storage.local.get(['allMessages']);
    return typeof result.allMessages === 'object' && result.allMessages !== null
      ? result.allMessages
      : {};
  }

  public async saveAllMessages(messages: MessagesByOrganization): Promise<void> {
    // Merge with existing messages before saving
    const currentMessages = await this.loadAllMessages();
    const mergedMessages = merge({}, currentMessages, messages);
    await chrome.storage.local.set({ allMessages: mergedMessages });
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
