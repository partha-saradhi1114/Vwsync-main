// models/ChatGroup.js
import mongoose from "mongoose";

const ChatGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    avatar: {
      type: String,
      default: "",
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "creatorModel",
    },
    creatorModel: {
      type: String,
      required: true,
      enum: ["Employee", "SupportAdmin", "Admin"],
      default: "Employee",
    },
    members: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },
        userModel: {
          type: String,
          required: true,
          enum: ["Employee", "SupportAdmin", "Admin"],
          default: "Employee",
        },
        role: {
          type: String,
          enum: ["admin", "member"],
          default: "member",
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
        clearedAt: {
          type: Date,
          default: null,
        },
      },
    ],
    lastMessage: {
      text: { type: String, default: "" },
      senderName: { type: String, default: "" },
      timestamp: { type: Date, default: Date.now },
      systemAction: { type: String, default: null },
      performerId: { type: String, default: "" },
      performerName: { type: String, default: "" },
      targetUsers: [
        {
          userId: { type: String, default: "" },
          name: { type: String, default: "" },
        },
      ],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

ChatGroupSchema.index({ "members.userId": 1 });
ChatGroupSchema.index({ companyId: 1, adminId: 1 });

export default mongoose.model("ChatGroup", ChatGroupSchema);
