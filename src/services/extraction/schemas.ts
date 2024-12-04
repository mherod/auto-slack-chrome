import { z } from 'zod';

export const CustomStatusSchema = z
  .object({
    emoji: z.string().nullable(),
    emojiUrl: z.string().nullable(),
  })
  .strict();

export const AttachmentImageSchema = z
  .object({
    url: z.string(),
    thumbnailUrl: z.string().nullable(),
    alt: z.string().nullable(),
  })
  .strict();

export const AttachmentSchema = z
  .object({
    type: z.string(),
    title: z.string().nullable(),
    text: z.string().nullable(),
    authorName: z.string().nullable(),
    authorIcon: z.string().nullable(),
    footerText: z.string().nullable(),
    timestamp: z.string().nullable(),
    permalink: z.string().nullable(),
    images: z.array(AttachmentImageSchema).nullable(),
  })
  .strict();

// Pre-compile the message schema for better performance
export const SlackMessageSchema = z
  .object({
    sender: z.string().nullable(),
    senderId: z.string().nullable(),
    timestamp: z.string().nullable(),
    text: z.string(),
    permalink: z.string().nullable(),
    customStatus: CustomStatusSchema.nullable(),
    avatarUrl: z.string().nullable(),
    messageId: z.string().nullable(),
    isInferredSender: z.boolean().default(false),
    attachments: z.array(AttachmentSchema).optional(),
  })
  .strict();

export const ChannelInfoSchema = z
  .object({
    channel: z.string(),
    organization: z.string(),
  })
  .strict();

// Use precompiled array schema for better performance
const SlackMessageArraySchema = z.array(SlackMessageSchema);

export const MessagesByDateSchema = z.record(z.string(), SlackMessageArraySchema);
export const MessagesByChannelSchema = z.record(z.string(), MessagesByDateSchema);
export const MessagesByOrganizationSchema = z.record(z.string(), MessagesByChannelSchema);

export const ExtensionStateSchema = z
  .object({
    isExtracting: z.boolean(),
    currentChannel: ChannelInfoSchema.nullable(),
    extractedMessages: MessagesByOrganizationSchema,
  })
  .strict();

export const LastKnownSenderSchema = z
  .object({
    sender: z.string(),
    senderId: z.string(),
    avatarUrl: z.string().nullable(),
    customStatus: CustomStatusSchema.nullable(),
  })
  .strict();

export const SenderInfoSchema = z
  .object({
    sender: z.string().nullable(),
    senderId: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    customStatus: CustomStatusSchema.nullable(),
    isInferred: z.boolean(),
  })
  .strict();

// Message schemas with strict validation
export const HeartbeatMessageSchema = z
  .object({
    type: z.literal('heartbeat'),
    timestamp: z.number(),
    status: z
      .object({
        isExtracting: z.boolean(),
        channelInfo: ChannelInfoSchema.nullable(),
        messageCount: z.number(),
      })
      .strict(),
  })
  .strict();

export const SyncMessageSchema = z
  .object({
    type: z.literal('sync'),
    timestamp: z.number(),
    data: z
      .object({
        extractedMessages: MessagesByOrganizationSchema,
        currentChannel: ChannelInfoSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const ExtractionControlMessageSchema = z
  .object({
    type: z.union([z.literal('START_EXTRACTION'), z.literal('STOP_EXTRACTION')]),
  })
  .strict();

// Pre-compile union types for better performance
export const ContentScriptMessageSchema = z.union([HeartbeatMessageSchema, SyncMessageSchema]);
export const IncomingMessageSchema = z.union([
  ContentScriptMessageSchema,
  ExtractionControlMessageSchema,
]);

// Export inferred types
export type CustomStatus = z.infer<typeof CustomStatusSchema>;
export type AttachmentImage = z.infer<typeof AttachmentImageSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type SlackMessage = z.infer<typeof SlackMessageSchema>;
export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;
export type MessagesByDate = z.infer<typeof MessagesByDateSchema>;
export type MessagesByChannel = z.infer<typeof MessagesByChannelSchema>;
export type MessagesByOrganization = z.infer<typeof MessagesByOrganizationSchema>;
export type ExtensionState = z.infer<typeof ExtensionStateSchema>;
export type LastKnownSender = z.infer<typeof LastKnownSenderSchema>;
export type SenderInfo = z.infer<typeof SenderInfoSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type SyncMessage = z.infer<typeof SyncMessageSchema>;
export type ExtractionControlMessage = z.infer<typeof ExtractionControlMessageSchema>;
export type ContentScriptMessage = z.infer<typeof ContentScriptMessageSchema>;
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;
