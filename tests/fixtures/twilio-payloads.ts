/**
 * Sample Twilio status callback payloads for testing
 */

export const deliveredStatusPayload = {
  MessageSid: "SM1234567890abcdef1234567890abcdef",
  MessageStatus: "delivered",
  From: "+15551234567",
  To: "+15559876543",
  ApiVersion: "2010-04-01",
  AccountSid: "ACtest1234567890",
};

export const failedStatusPayload = {
  MessageSid: "SM1234567890abcdef1234567890abcdef",
  MessageStatus: "failed",
  ErrorCode: "30008",
  ErrorMessage: "Unknown error",
  From: "+15551234567",
  To: "+15559876543",
  ApiVersion: "2010-04-01",
  AccountSid: "ACtest1234567890",
};

export const sentStatusPayload = {
  MessageSid: "SM1234567890abcdef1234567890abcdef",
  MessageStatus: "sent",
  From: "+15551234567",
  To: "+15559876543",
  ApiVersion: "2010-04-01",
  AccountSid: "ACtest1234567890",
};

export const queuedStatusPayload = {
  MessageSid: "SM1234567890abcdef1234567890abcdef",
  MessageStatus: "queued",
  From: "+15551234567",
  To: "+15559876543",
  ApiVersion: "2010-04-01",
  AccountSid: "ACtest1234567890",
};

export const undeliveredStatusPayload = {
  MessageSid: "SM1234567890abcdef1234567890abcdef",
  MessageStatus: "undelivered",
  ErrorCode: "30003",
  ErrorMessage: "Unreachable destination handset",
  From: "+15551234567",
  To: "+15559876543",
  ApiVersion: "2010-04-01",
  AccountSid: "ACtest1234567890",
};
