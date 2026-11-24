// models/Message.js
import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    // Hierarchy / Tenancy
    adminId:   { type: mongoose.Schema.Types.ObjectId, ref: "Admin",   default: null },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },

    // Group chat reference (null for direct 1-to-1)
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatGroup",
      default: null,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "senderModel",
      required: true,
    },
    senderModel: {
      type: String,
      required: true,
      enum: ["Employee", "SupportAdmin", "Admin"],
      default: "Employee",
    },

    // Required only for direct 1-to-1 chats (not group chats)
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "receiverModel",
      default: null,
      required: function () {
        return !this.groupId;
      },
    },
    receiverModel: {
      type: String,
      enum: ["Employee", "SupportAdmin", "Admin"],
      default: "Employee",
      required: function () {
        return !this.groupId;
      },
    },

    message: {
      type: String,
      default: "",
      trim: true,
    },

    // Media & Document Attachments
    attachments: [
      {
        url: { type: String, required: true },
        fileType: { type: String, default: "file" }, // "image", "file", "audio"
        fileName: { type: String, default: "" },
        fileSize: { type: Number, default: 0 },
      },
    ],

    // WhatsApp-style Emoji Reactions
    reactions: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        userName: { type: String, default: "" },
        emoji: { type: String, required: true },
      },
    ],

    // Group Read Receipts
    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        readAt: { type: Date, default: Date.now },
      },
    ],

    isRead:    { type: Boolean, default: false },
    isEdited:  { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    isSystem:  { type: Boolean, default: false },
    messageType: { type: String, enum: ["user", "system"], default: "user" },
    systemAction: { type: String, default: null },
    performer: {
      userId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
    },
    targetUsers: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, default: null },
        name: { type: String, default: "" },
      },
    ],

    // Per-user message deletion ("Delete for me")
    deletedFor: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        deletedAt: { type: Date, default: Date.now },
      },
    ],

    // Per-user chat clear for 1-on-1 direct conversations
    clearedFor: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true },
        clearedAt: { type: Date, default: Date.now },
      },
    ],

    // Message deletion for everyone ("Delete for everyone")
    deletedForEveryone: { type: Boolean, default: false },
    deletedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, default: null },
      userName: { type: String, default: "" },
      deletedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

MessageSchema.index({ "deletedFor.userId": 1 });
MessageSchema.index({ "clearedFor.userId": 1 });

MessageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });
MessageSchema.index({ receiver: 1, isRead: 1 });
MessageSchema.index({ groupId: 1, createdAt: 1 });

export default mongoose.model("Message", MessageSchema);
