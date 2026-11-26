// routes/messageRoutes.js
import express from "express";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import path from "path";
import { Readable } from "stream";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import Message from "../models/Message.js";
import ChatGroup from "../models/ChatGroup.js";
import Employee from "../models/employeeModel.js";
import SupportAdmin from "../models/supportAdminModel.js";
import Admin from "../models/adminModel.js";
import { protect } from "../controllers/authController.js";
import { cloudinary } from "../config/cloudinary.js";

const router = express.Router();

// io lives in server.js and is shared via app.set("io", io)
// All routes access it through req.app.get("io") — no initSocket needed here
const getIO = (req) => req.app.get("io");

/* ===============================================================
   SMTP TRANSPORTER
=============================================================== */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* ===============================================================
   UNREAD MESSAGE NOTIFICATION — 5-minute delay
   Called right after a message is saved.
   After 5 min, checks DB — if still unread, fires email to receiver.
=============================================================== */
const UNREAD_NOTIFY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

const scheduleUnreadEmail = ({ messageId, senderName, receiverName, receiverEmail, messagePreview }) => {
  if (!receiverEmail) return; // no email on record — skip silently

  setTimeout(async () => {
    try {
      // Re-check: is this specific message still unread?
      const msg = await Message.findById(messageId).lean();
      if (!msg || msg.isRead || msg.isDeleted) return; // already read or deleted — skip

      await transporter.sendMail({
        from:    `"HRMS Messenger" <${process.env.SMTP_USER}>`,
        to:      receiverEmail,
        subject: `${senderName} wants to connect with you on HRMS`,
        html:    unreadMessageEmail({ senderName, receiverName, messagePreview }),
      });
      console.log(`✅ Unread message notification sent to: ${receiverEmail}`);
    } catch (err) {
      console.error("❌ Failed to send unread message notification:", err.message);
    }
  }, UNREAD_NOTIFY_DELAY_MS);
};

/* ===============================================================
   EMAIL TEMPLATE — Unread message notification to receiver
=============================================================== */
const unreadMessageEmail = ({ senderName, receiverName, messagePreview }) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;
             font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
         style="padding:40px 15px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:14px;overflow:hidden;
                    box-shadow:0 8px 24px rgba(0,0,0,0.09);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a,#3b82f6,#06b6d4);
                     padding:40px 32px;text-align:center;">
            <div style="width:60px;height:60px;background:rgba(255,255,255,0.18);
                        border-radius:50%;margin:0 auto 14px;line-height:60px;
                        font-size:28px;">
              &#128172;
            </div>
            <p style="margin:0 0 8px;font-size:12px;color:#bfdbfe;
                      letter-spacing:3px;text-transform:uppercase;font-weight:700;">
              HRMS Messenger
            </p>
            <h1 style="margin:0;font-size:24px;color:#ffffff;font-weight:800;line-height:1.3;">
              You have an unread message
            </h1>
            <p style="margin:10px 0 0;color:#bae6fd;font-size:14px;line-height:1.6;">
              <strong style="color:#ffffff;">${senderName}</strong>
              sent you a message on HRMS
            </p>
          </td>
        </tr>

        <!-- Banner -->
        <tr>
          <td style="background:#eff6ff;border-bottom:3px solid #3b82f6;
                     padding:13px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#1d4ed8;font-weight:600;">
              ${senderName} is been waiting for your reply — log in to reply
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px 28px;">
            <p style="margin:0 0 6px;font-size:16px;color:#1f2937;">
              Hi <strong>${receiverName}</strong>,
            </p>
            <p style="margin:0 0 26px;font-size:15px;color:#4b5563;line-height:1.8;">
              Your colleague <strong>${senderName}</strong> was trying to reach you
              on the HRMS internal messenger and it has been unread for a while.
              Don't leave them waiting — log in to catch up!
            </p>

            <!-- Sender + Receiver Info -->
            <table width="100%" cellspacing="0" cellpadding="0"
                   style="background:#f8fafc;border-radius:10px;padding:18px 20px;
                          border:1px solid #e5e7eb;margin-bottom:26px;">
              <tr><td>
                <table width="100%" style="font-size:14px;border-collapse:collapse;">
                  <tr>
                    <td style="padding:9px 0;color:#6b7280;width:38%;">From</td>
                    <td style="padding:9px 0;text-align:right;font-weight:700;color:#111827;">
                      ${senderName}
                    </td>
                  </tr>
                  <tr style="border-top:1px solid #f1f5f9;">
                    <td style="padding:9px 0;color:#6b7280;">To</td>
                    <td style="padding:9px 0;text-align:right;font-weight:700;color:#111827;">
                      ${receiverName}
                    </td>
                  </tr>
                  <tr style="border-top:1px solid #f1f5f9;">
                    <td style="padding:9px 0;color:#6b7280;">Platform</td>
                    <td style="padding:9px 0;text-align:right;font-weight:600;color:#3b82f6;">
                      HRMS Internal Messenger
                    </td>
                  </tr>
                  <tr style="border-top:1px solid #f1f5f9;">
                    <td style="padding:9px 0;color:#6b7280;">Status</td>
                    <td style="padding:9px 0;text-align:right;">
                      <span style="background:#fee2e2;color:#991b1b;padding:3px 14px;
                                   border-radius:20px;font-size:13px;font-weight:700;">
                        Unread
                      </span>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellspacing="0" cellpadding="0"
                   style="background:linear-gradient(135deg,#eff6ff,#dbeafe);
                          border-radius:10px;padding:22px;border:1px solid #bfdbfe;
                          margin-bottom:22px;">
              <tr><td style="text-align:center;">
                <p style="margin:0 0 6px;font-size:15px;color:#1e3a8a;font-weight:700;">
                  Ready to reply?
                </p>
                <p style="margin:0;font-size:14px;color:#3b82f6;line-height:1.6;">
                  Log in to your HRMS portal and open the Messenger
                  to continue your conversation with ${senderName}.
                </p>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7;">
              You are receiving this notification because a message sent to you
              on HRMS was unread for more than 30 minutes.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f3f4f6;padding:18px 32px;text-align:center;
                     font-size:12px;color:#9ca3af;line-height:1.7;">
            &copy; ${new Date().getFullYear()} Attendance Management System &nbsp;&bull;&nbsp;
            This is an automated message notification. Please do not reply directly.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/* ===============================================================
   PARTICIPANT RESOLVER HELPER
   Resolves any userId across Employee, SupportAdmin, and Admin
=============================================================== */
const resolveParticipant = async (userId) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  try {
    const emp = await Employee.findById(userId)
      .select("name email employeeId department currentDepartment currentRole profileImageUrl adminId company lastSeen")
      .lean();
    if (emp) {
      return {
        _id: emp._id,
        name: emp.name || "Employee",
        email: emp.email || "",
        employeeId: emp.employeeId || "",
        department: emp.department || emp.currentDepartment || "General",
        positionName: emp.currentRole || "Employee",
        role: "employee",
        userType: "Employee",
        profileImageUrl: emp.profileImageUrl || null,
        company: emp.company || null,
        adminId: emp.adminId || null,
        lastSeen: emp.lastSeen || emp.updatedAt || emp.createdAt,
      };
    }

    const sa = await SupportAdmin.findById(userId)
      .select("name email supportAdminId department positionName profileImageUrl adminId lastSeen")
      .lean();
    if (sa) {
      return {
        _id: sa._id,
        name: sa.name || "Manager",
        email: sa.email || "",
        employeeId: sa.supportAdminId || "",
        department: sa.department || "Administration",
        positionName: sa.positionName || "Manager",
        role: "manager",
        userType: "SupportAdmin",
        profileImageUrl: sa.profileImageUrl || null,
        adminId: sa.adminId || null,
        lastSeen: sa.lastSeen || sa.updatedAt || sa.createdAt,
      };
    }

    const adm = await Admin.findById(userId)
      .select("name email department companyLogo adminId lastSeen lastLoginAt")
      .lean();
    if (adm) {
      return {
        _id: adm._id,
        name: adm.name || "Administrator",
        email: adm.email || "",
        employeeId: "ADMIN",
        department: adm.department || "Administration",
        positionName: "Administrator",
        role: "admin",
        userType: "Admin",
        profileImageUrl: adm.companyLogo || null,
        adminId: adm.adminId || adm._id,
        lastSeen: adm.lastSeen || adm.lastLoginAt || adm.updatedAt || adm.createdAt,
      };
    }
  } catch (err) {
    console.error("resolveParticipant error:", err.message);
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/presence — List active online user IDs
// ─────────────────────────────────────────────────────────────────────────────
router.get("/presence", protect, async (req, res) => {
  try {
    const onlineMap = req.app.get("onlineUsersMap");
    const onlineUserIds = onlineMap
      ? Array.from(onlineMap.keys()).filter((id) => (onlineMap.get(id)?.size || 0) > 0)
      : [];
    return res.json({ onlineUserIds });
  } catch (err) {
    console.error("Get presence error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/contacts — Full contacts directory (Employees, Managers, Admins)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/contacts", protect, async (req, res) => {
  try {
    const myId = (req.user.actualId || req.user._id).toString();
    const rootAdminId = req.user.adminId || (req.user.role === "admin" ? (req.user.actualId || req.user._id) : null);
    const onlineMap = req.app.get("onlineUsersMap");
    const isUserOnline = (id) =>
      !!(onlineMap && onlineMap.has(id.toString()) && (onlineMap.get(id.toString())?.size || 0) > 0);

    // 1. Fetch Employees
    const empQuery = { isActive: { $ne: false } };
    if (rootAdminId) empQuery.adminId = rootAdminId;
    if (req.user.role === "employee" && req.user.company) {
      empQuery.company = req.user.company;
    }
    const employees = await Employee.find(empQuery)
      .select("name email employeeId department currentDepartment currentRole profileImageUrl lastSeen updatedAt createdAt")
      .lean();

    // 2. Fetch SupportAdmins (Managers / Administration)
    const saQuery = { loginEnabled: { $ne: false } };
    if (rootAdminId) saQuery.adminId = rootAdminId;
    const supportAdmins = await SupportAdmin.find(saQuery)
      .select("name email supportAdminId department positionName profileImageUrl lastSeen updatedAt createdAt")
      .lean();

    // 3. Fetch Admin
    let admins = [];
    if (rootAdminId) {
      const rootAdmin = await Admin.findById(rootAdminId)
        .select("name email department companyLogo lastSeen lastLoginAt updatedAt createdAt")
        .lean();
      if (rootAdmin) admins.push(rootAdmin);
    }

    const contacts = [];

    // Normalize Employees
    employees.forEach((emp) => {
      if (emp._id.toString() === myId) return;
      contacts.push({
        _id: emp._id,
        name: emp.name || "Employee",
        email: emp.email || "",
        employeeId: emp.employeeId || "",
        department: emp.department || emp.currentDepartment || "General",
        positionName: emp.currentRole || "Employee",
        role: "employee",
        userType: "Employee",
        profileImageUrl: emp.profileImageUrl || null,
        isOnline: isUserOnline(emp._id),
        lastSeen: emp.lastSeen || emp.updatedAt || emp.createdAt,
      });
    });

    // Normalize SupportAdmins (Managers)
    supportAdmins.forEach((sa) => {
      if (sa._id.toString() === myId) return;
      contacts.push({
        _id: sa._id,
        name: sa.name || "Manager",
        email: sa.email || "",
        employeeId: sa.supportAdminId || "",
        department: sa.department || "Administration",
        positionName: sa.positionName || "Manager",
        role: "manager",
        userType: "SupportAdmin",
        profileImageUrl: sa.profileImageUrl || null,
        isOnline: isUserOnline(sa._id),
        lastSeen: sa.lastSeen || sa.updatedAt || sa.createdAt,
      });
    });

    // Normalize Admins
    admins.forEach((adm) => {
      if (adm._id.toString() === myId) return;
      contacts.push({
        _id: adm._id,
        name: adm.name || "Administrator",
        email: adm.email || "",
        employeeId: "ADMIN",
        department: adm.department || "Administration",
        positionName: "Administrator",
        role: "admin",
        userType: "Admin",
        profileImageUrl: adm.companyLogo || null,
        isOnline: isUserOnline(adm._id),
        lastSeen: adm.lastSeen || adm.lastLoginAt || adm.updatedAt || adm.createdAt,
      });
    });

    return res.json(contacts);
  } catch (err) {
    console.error("Get contacts error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/send — Send a new message
// ─────────────────────────────────────────────────────────────────────────────
router.post("/send", protect, async (req, res) => {
  try {
    const { receiverId, message, attachments } = req.body;
    const senderId = req.user.actualId || req.user._id;

    if (!receiverId || (!message?.trim() && (!attachments || attachments.length === 0)))
      return res.status(400).json({ error: "Receiver and message or attachment are required" });

    if (!mongoose.Types.ObjectId.isValid(receiverId))
      return res.status(400).json({ error: "Invalid receiverId" });

    // Determine senderModel
    let senderModel = "Employee";
    if (req.user.role === "admin") senderModel = "Admin";
    else if (req.user.role === "support-admin") senderModel = "SupportAdmin";

    // Look up receiver across all 3 models
    let receiver = await Employee.findById(receiverId);
    let receiverModel = "Employee";
    if (!receiver) {
      receiver = await SupportAdmin.findById(receiverId);
      if (receiver) receiverModel = "SupportAdmin";
    }
    if (!receiver) {
      receiver = await Admin.findById(receiverId);
      if (receiver) receiverModel = "Admin";
    }
    if (!receiver)
      return res.status(404).json({ error: "Receiver not found" });

    // Company scope guard — only when both sides have a company set
    if (
      req.user.role === "employee" &&
      req.user.company &&
      receiver.company &&
      req.user.company.toString() !== receiver.company.toString()
    ) {
      return res.status(403).json({ error: "Cannot message outside your company" });
    }

    // Safely resolve hierarchy fields
    const resolvedAdminId =
      req.user.adminId || (req.user.role === "admin" ? (req.user.actualId || req.user._id) : null);
    const resolvedCompanyId = req.user.company || null;
    const trimmedMessage = message ? message.trim() : "";

    // Guard against rapid duplicate sends (e.g. key repeat or double click within 1.5s)
    if (!attachments || attachments.length === 0) {
      const recentDuplicate = await Message.findOne({
        sender: senderId,
        receiver: receiverId,
        message: trimmedMessage,
        createdAt: { $gte: new Date(Date.now() - 1500) },
        isDeleted: false,
      })
        .populate([
          { path: "sender", select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
          { path: "receiver", select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
        ]);

      if (recentDuplicate) {
        return res.status(200).json(recentDuplicate);
      }
    }

    const newMessage = await Message.create({
      adminId:   resolvedAdminId,
      companyId: resolvedCompanyId,
      sender:    senderId,
      senderModel,
      receiver:  receiverId,
      receiverModel,
      message:   trimmedMessage,
      attachments: Array.isArray(attachments) ? attachments : [],
      isRead:    false,
    });

    await newMessage.populate([
      { path: "sender",   select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
      { path: "receiver", select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
    ]);

    // Update sender's lastSeen asynchronously
    const updateTime = newMessage.createdAt || new Date();
    Promise.any([
      Employee.findByIdAndUpdate(senderId, { lastSeen: updateTime }),
      SupportAdmin.findByIdAndUpdate(senderId, { lastSeen: updateTime }),
      Admin.findByIdAndUpdate(senderId, { lastSeen: updateTime }),
    ]).catch(() => {});

    // Real-time delivery
    const io = getIO(req);
    if (io) {
      io.to(`user_${receiverId.toString()}`).emit("receive_message", newMessage);
      io.to(`user_${senderId.toString()}`).emit("message_sent", newMessage);
    } else {
      console.warn("⚠️ io not found on app — real-time delivery skipped");
    }

    // Schedule unread email notification
    scheduleUnreadEmail({
      messageId:      newMessage._id,
      senderName:     req.user.name || newMessage.sender?.name || "A colleague",
      receiverName:   receiver.name || "there",
      receiverEmail:  receiver.email || "",
      messagePreview: message.trim().length > 120
        ? message.trim().slice(0, 120) + "..."
        : message.trim(),
    });

    return res.status(201).json(newMessage);
  } catch (err) {
    console.error("❌ Send message error:", err.message);
    return res.status(500).json({ error: err.message, details: err.errors });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/history/:userId — Conversation history
// ─────────────────────────────────────────────────────────────────────────────
router.get("/history/:userId", protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const rawMe = req.user.actualId || req.user._id;
    const meStr = rawMe ? rawMe.toString() : "";
    const meObj = (rawMe && mongoose.Types.ObjectId.isValid(rawMe))
      ? new mongoose.Types.ObjectId(rawMe)
      : null;

    if (!mongoose.Types.ObjectId.isValid(userId))
      return res.status(400).json({ error: "Invalid userId" });

    const userObj = new mongoose.Types.ObjectId(userId);
    const allMyIds = [meObj, meStr, req.user._id, req.user.actualId].filter(Boolean);

    const orConditions = [
      { sender: meObj, receiver: userObj },
      { sender: userObj, receiver: meObj },
      { sender: meStr, receiver: userId },
      { sender: userId, receiver: meStr },
    ];

    if (req.user.actualId && req.user._id && req.user.actualId.toString() !== req.user._id.toString()) {
      const otherId = req.user._id.toString();
      const otherObj = new mongoose.Types.ObjectId(otherId);
      orConditions.push(
        { sender: otherObj, receiver: userObj },
        { sender: userObj, receiver: otherObj },
        { sender: otherId, receiver: userId },
        { sender: userId, receiver: otherId }
      );
    }

    const messages = await Message.find({
      groupId: null,
      "clearedFor.userId": { $nin: allMyIds },
      $or: orConditions,
      $and: [
        {
          $or: [
            { isDeleted: false },
            { deletedForEveryone: true },
          ],
        },
      ],
    })
      .populate("sender",   "name employeeId supportAdminId department positionName profileImageUrl companyLogo")
      .populate("receiver", "name employeeId supportAdminId department positionName profileImageUrl companyLogo")
      .sort({ createdAt: 1 });

    // Map messages according to deleted status
    const mappedMessages = messages.map((m) => {
      const mObj = m.toObject ? m.toObject() : m;
      const isDeletedForMe = Array.isArray(mObj.deletedFor) && mObj.deletedFor.some(
        (d) => d.userId && allMyIds.some((id) => id && id.toString() === d.userId.toString())
      );

      if (isDeletedForMe) {
        return {
          ...mObj,
          deletedForMe: true,
          message: "Deleted for you",
          attachments: [],
          reactions: [],
        };
      }

      if (mObj.deletedForEveryone) {
        const isMe = mObj.deletedBy?.userId && allMyIds.some(
          (id) => id && id.toString() === mObj.deletedBy.userId.toString()
        );
        return {
          ...mObj,
          deletedForEveryone: true,
          message: isMe ? "Deleted for everyone" : `${mObj.deletedBy?.userName || "This person"} deleted this message`,
          attachments: [],
          reactions: [],
        };
      }

      return mObj;
    });

    // Mark received messages as read (serverless safe with await)
    try {
      await Message.updateMany(
        {
          sender: { $in: [userObj, userId] },
          receiver: { $in: allMyIds },
          isRead: false,
          "clearedFor.userId": { $nin: allMyIds },
        },
        { isRead: true }
      );
    } catch (readErr) {
      console.error("Direct history mark read error:", readErr);
    }

    // Notify the other side their messages were read
    const io = getIO(req);
    if (io) {
      io.to(`user_${userId}`).emit("messages_read", {
        readBy:   meStr,
        senderId: userId,
      });
    }

    // Collapse any duplicate historical system events (e.g. from rapid retries)
    const seenSystemEvents = new Set();
    const cleanMessages = [];
    for (const msg of mappedMessages) {
      if (msg.isSystem || msg.messageType === "system" || msg.sender?.name === "System") {
        const timeKey = msg.createdAt ? new Date(msg.createdAt).toISOString().slice(0, 16) : "";
        const eventKey = `${(msg.message || "").trim()}_${timeKey}`;
        if (seenSystemEvents.has(eventKey)) {
          continue; // skip duplicate from earlier testing
        }
        seenSystemEvents.add(eventKey);
      }
      cleanMessages.push(msg);
    }

    return res.json(cleanMessages);
  } catch (err) {
    console.error("Get history error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE / POST /api/chat/history/:userId/clear — Clear 1-on-1 direct conversation FOR CALLER ONLY
// ─────────────────────────────────────────────────────────────────────────────
const clearDirectChatHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const rawMe = req.user.actualId || req.user._id;
    const meStr = rawMe ? rawMe.toString() : "";

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const meObj = (rawMe && mongoose.Types.ObjectId.isValid(rawMe))
      ? new mongoose.Types.ObjectId(rawMe)
      : null;
    const userObj = new mongoose.Types.ObjectId(userId);
    const allMyIds = [meObj, meStr, req.user._id, req.user.actualId].filter(Boolean);

    const orConditions = [
      { sender: userObj, receiver: meObj },
      { sender: meObj, receiver: userObj },
      { sender: userId, receiver: meStr },
      { sender: meStr, receiver: userId },
    ];

    if (req.user.actualId && req.user._id && req.user.actualId.toString() !== req.user._id.toString()) {
      const otherId = req.user._id.toString();
      const otherObj = new mongoose.Types.ObjectId(otherId);
      orConditions.push(
        { sender: userObj, receiver: otherObj },
        { sender: otherObj, receiver: userObj },
        { sender: userId, receiver: otherId },
        { sender: otherId, receiver: userId }
      );
    }

    // Per-user clear for 1-on-1: add caller to clearedFor (do not delete globally for other user)
    await Message.updateMany(
      {
        groupId: null,
        $or: orConditions,
        "clearedFor.userId": { $nin: allMyIds },
      },
      {
        $addToSet: {
          clearedFor: {
            userId: meObj || rawMe,
            clearedAt: new Date(),
          },
        },
      }
    );

    // Notify ONLY caller so the other person's active screen and chat history are NOT wiped
    try {
      const io = getIO(req);
      if (io) {
        const payload = { clearedBy: meStr, peerId: userId };
        io.to(`user_${meStr}`).emit("chat_cleared", payload);
        if (req.user._id && req.user._id.toString() !== meStr) {
          io.to(`user_${req.user._id.toString()}`).emit("chat_cleared", payload);
        }
      }
    } catch (socketErr) {
      console.warn("Socket error on clear direct chat:", socketErr.message);
    }

    return res.json({ success: true, message: "Chat cleared successfully" });
  } catch (err) {
    console.error("Clear direct chat error:", err);
    return res.status(500).json({ error: err.message });
  }
};

router.delete("/history/:userId/clear", protect, clearDirectChatHandler);
router.post("/history/:userId/clear", protect, clearDirectChatHandler);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/users — Chat list with last message + unread counts
// ─────────────────────────────────────────────────────────────────────────────
router.get("/users", protect, async (req, res) => {
  try {
    const rawUserId = req.user.actualId || req.user._id;
    const userObj = (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId))
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;
    const allMyIds = [userObj, req.user.actualId, req.user._id].filter(Boolean);

    const conversations = await Message.aggregate([
      {
        $match: {
          groupId: null,
          "clearedFor.userId": { $nin: allMyIds },
          isDeleted: false,
          $or: [{ sender: userObj }, { receiver: userObj }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$sender", userObj] }, "$receiver", "$sender"] },
          lastMessage:     { $first: "$message" },
          lastMessageTime: { $first: "$createdAt" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$receiver", userObj] }, { $eq: ["$isRead", false] }] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { lastMessageTime: -1 } },
    ]);

    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const participant = await resolveParticipant(conv._id);
        if (!participant) return null;
        return {
          _id:             conv._id,
          name:            participant.name,
          employeeId:      participant.employeeId,
          department:      participant.department,
          positionName:    participant.positionName,
          role:            participant.role,
          userType:        participant.userType,
          profileImageUrl: participant.profileImageUrl,
          lastMessage:     conv.lastMessage,
          lastMessageTime: conv.lastMessageTime,
          unreadCount:     conv.unreadCount,
          lastSeen:        participant.lastSeen || conv.lastMessageTime,
        };
      })
    );

    return res.json(enriched.filter(Boolean));
  } catch (err) {
    console.error("Get users error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/chat/read/:senderId — Mark messages from sender as read
// ─────────────────────────────────────────────────────────────────────────────
router.put("/read/:senderId", protect, async (req, res) => {
  try {
    const { senderId } = req.params;
    const rawMe = req.user.actualId || req.user._id;
    const meStr = rawMe ? rawMe.toString() : "";
    const meObj = (rawMe && mongoose.Types.ObjectId.isValid(rawMe))
      ? new mongoose.Types.ObjectId(rawMe)
      : null;
    const allMyIds = [meObj, meStr, req.user._id, req.user.actualId].filter(Boolean);

    if (!mongoose.Types.ObjectId.isValid(senderId))
      return res.status(400).json({ error: "Invalid senderId" });

    await Message.updateMany(
      { sender: senderId, receiver: { $in: allMyIds }, isRead: false },
      { isRead: true }
    );

    const io = getIO(req);
    if (io) {
      io.to(`user_${senderId}`).emit("messages_read", {
        readBy:   me.toString(),
        senderId,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/chat/:msgId — Edit a message
// NOTE: must stay BELOW /read/:senderId to avoid route collision
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:msgId", protect, async (req, res) => {
  try {
    const { msgId } = req.params;
    const { message } = req.body;
    const me = req.user.actualId || req.user._id;

    if (!mongoose.Types.ObjectId.isValid(msgId))
      return res.status(400).json({ error: "Invalid message id" });

    if (!message?.trim())
      return res.status(400).json({ error: "Message cannot be empty" });

    const msg = await Message.findById(msgId);
    if (!msg) return res.status(404).json({ error: "Message not found" });

    if (msg.sender.toString() !== me.toString())
      return res.status(403).json({ error: "Cannot edit someone else's message" });

    msg.message  = message.trim();
    msg.isEdited = true;
    await msg.save();

    await msg.populate([
      { path: "sender",   select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
      { path: "receiver", select: "name employeeId supportAdminId department positionName profileImageUrl companyLogo" },
    ]);

    const io = getIO(req);
    if (io) {
      const receiverId = msg.receiver?._id?.toString() || msg.receiver.toString();
      const payload    = { messageId: msgId, newMessage: message.trim() };
      io.to(`user_${receiverId}`).emit("message_edited", payload);
      io.to(`user_${me.toString()}`).emit("message_edited", payload);
    }

    return res.json(msg);
  } catch (err) {
    console.error("Edit message error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE / POST /api/chat/:msgId — Delete a message ("for_me" or "for_everyone")
// ─────────────────────────────────────────────────────────────────────────────
const deleteMessageHandler = async (req, res) => {
  try {
    const { msgId } = req.params;
    const deleteType = req.body?.deleteType || req.query?.deleteType || "for_everyone";
    const rawMe = req.user.actualId || req.user._id;
    const meStr = rawMe ? rawMe.toString() : "";
    const meObj = (rawMe && mongoose.Types.ObjectId.isValid(rawMe))
      ? new mongoose.Types.ObjectId(rawMe)
      : null;

    if (!mongoose.Types.ObjectId.isValid(msgId))
      return res.status(400).json({ error: "Invalid message id" });

    const msg = await Message.findById(msgId);
    if (!msg) return res.status(404).json({ error: "Message not found" });

    const allMyIds = [meObj, meStr, req.user._id, req.user.actualId].filter(Boolean);
    const isSender = allMyIds.some((id) => id && id.toString() === msg.sender?.toString());

    if (deleteType === "for_me") {
      // ── Option A: Delete for me ───────────────────────────────────────────
      // Add caller to msg.deletedFor array so it only disappears / shows deleted for caller
      const alreadyDeletedForMe = Array.isArray(msg.deletedFor) && msg.deletedFor.some(
        (d) => d.userId && allMyIds.some((id) => id && id.toString() === d.userId.toString())
      );

      if (!alreadyDeletedForMe) {
        msg.deletedFor.push({
          userId: meObj || rawMe,
          deletedAt: new Date(),
        });
        await msg.save();
      }

      const io = getIO(req);
      if (io) {
        const payload = {
          messageId: msgId,
          deleteType: "for_me",
          deletedForMe: true,
          groupId: msg.groupId,
        };
        io.to(`user_${meStr}`).emit("message_deleted", payload);
        if (req.user._id && req.user._id.toString() !== meStr) {
          io.to(`user_${req.user._id.toString()}`).emit("message_deleted", payload);
        }
      }

      return res.json({ success: true, deleteType: "for_me", message: "Deleted for you" });
    } else {
      // ── Option B: Delete for everyone ─────────────────────────────────────
      let canDeleteForEveryone = isSender || req.user.role === "admin";
      if (!canDeleteForEveryone && msg.groupId) {
        const group = await ChatGroup.findById(msg.groupId).lean();
        if (group) {
          const isGroupCreator = group.createdBy && allMyIds.some((id) => id && id.toString() === group.createdBy.toString());
          const isGroupAdmin = Array.isArray(group.members) && group.members.some(
            (m) => m.role === "admin" && allMyIds.some((id) => id && id.toString() === m.userId?.toString())
          );
          if (isGroupCreator || isGroupAdmin) canDeleteForEveryone = true;
        }
      }

      if (!canDeleteForEveryone) {
        return res.status(403).json({ error: "Only the sender or admin can delete this message for everyone" });
      }

      msg.deletedForEveryone = true;
      msg.isDeleted = true;
      msg.deletedBy = {
        userId: meObj || rawMe,
        userName: req.user.name || "Member",
        deletedAt: new Date(),
      };
      msg.message = "This message was deleted";
      msg.attachments = [];
      msg.reactions = [];
      await msg.save();

      const io = getIO(req);
      if (io) {
        const payload = {
          messageId: msgId,
          deleteType: "for_everyone",
          deletedForEveryone: true,
          deletedBy: {
            userId: meStr,
            userName: req.user.name || "Member",
            deletedAt: new Date(),
          },
          groupId: msg.groupId,
        };

        if (msg.groupId) {
          io.to(`group_${msg.groupId.toString()}`).emit("message_deleted", payload);
        } else {
          if (msg.receiver) io.to(`user_${msg.receiver.toString()}`).emit("message_deleted", payload);
          io.to(`user_${meStr}`).emit("message_deleted", payload);
          if (req.user._id && req.user._id.toString() !== meStr) {
            io.to(`user_${req.user._id.toString()}`).emit("message_deleted", payload);
          }
        }
      }

      return res.json({ success: true, deleteType: "for_everyone", message: "Deleted for everyone" });
    }
  } catch (err) {
    console.error("Delete message error:", err);
    return res.status(500).json({ error: err.message });
  }
};

router.delete("/:msgId", protect, deleteMessageHandler);
router.post("/:msgId/delete", protect, deleteMessageHandler);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/unread/count
// ─────────────────────────────────────────────────────────────────────────────
router.get("/unread/count", protect, async (req, res) => {
  try {
    const rawMyId = req.user.actualId || req.user._id;
    const myIdStr = rawMyId ? rawMyId.toString() : "";
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    const allMyIds = [myIdObj, myIdStr, req.user._id, req.user.actualId].filter(Boolean);

    // 1. Direct 1-on-1 unread messages (exclude system messages)
    const directCount = await Message.countDocuments({
      receiver: { $in: allMyIds },
      isRead: false,
      isDeleted: false,
      isSystem: { $ne: true },
      messageType: { $ne: "system" },
      deletedForEveryone: { $ne: true },
      "deletedFor.userId": { $nin: allMyIds },
      "clearedFor.userId": { $nin: allMyIds },
    });

    // 2. Teams / Groups unread messages
    const memberQueries = [
      { "members.userId": myIdObj },
      { "members.userId": myIdStr },
    ];
    if (req.user._id && req.user.actualId && req.user._id.toString() !== req.user.actualId.toString()) {
      const altStr = req.user._id.toString();
      const altObj = new mongoose.Types.ObjectId(altStr);
      memberQueries.push({ "members.userId": altObj }, { "members.userId": altStr });
    }

    const myGroups = await ChatGroup.find({
      isDeleted: false,
      $or: [
        ...memberQueries,
        { createdBy: { $in: allMyIds } },
      ],
    }).select("_id members").lean();

    let groupCount = 0;
    if (myGroups.length > 0) {
      const groupConditions = myGroups.map((g) => {
        const myMember = g.members?.find((m) =>
          m.userId && allMyIds.some((id) => id && id.toString() === m.userId.toString())
        );
        const clearedAt = myMember?.clearedAt ? new Date(myMember.clearedAt) : null;

        const cond = {
          groupId: g._id,
          sender: { $nin: allMyIds },
          "readBy.userId": { $nin: allMyIds },
          isDeleted: false,
          isSystem: { $ne: true },
          messageType: { $ne: "system" },
          deletedForEveryone: { $ne: true },
          "deletedFor.userId": { $nin: allMyIds },
        };
        if (clearedAt) {
          cond.createdAt = { $gt: clearedAt };
        }
        return cond;
      });

      groupCount = await Message.countDocuments({
        $or: groupConditions,
      });
    }

    return res.json({
      count: directCount + groupCount,
      directCount,
      groupCount,
    });
  } catch (err) {
    console.error("Unread count error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/groups — Create a new group (Teams style)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/groups", protect, async (req, res) => {
  try {
    const { name, description, avatar, memberIds } = req.body;
    const myId = (req.user.actualId || req.user._id).toString();

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }

    let creatorModel = "Employee";
    if (req.user.role === "admin") creatorModel = "Admin";
    else if (req.user.role === "support-admin") creatorModel = "SupportAdmin";

    const resolvedAdminId =
      req.user.adminId || (req.user.role === "admin" ? (req.user.actualId || req.user._id) : null);
    const resolvedCompanyId = req.user.company || null;

    // Collect all unique member IDs, ensuring creator is included
    const allMemberIds = Array.from(
      new Set([myId, ...(Array.isArray(memberIds) ? memberIds.map((id) => id.toString()) : [])])
    );

    // Resolve member model for each member
    const members = await Promise.all(
      allMemberIds.map(async (mId) => {
        const isCreator = mId === myId;
        let userModel = isCreator ? creatorModel : "Employee";
        if (!isCreator) {
          const emp = await Employee.findById(mId).select("_id").lean();
          if (!emp) {
            const sa = await SupportAdmin.findById(mId).select("_id").lean();
            if (sa) userModel = "SupportAdmin";
            else {
              const adm = await Admin.findById(mId).select("_id").lean();
              if (adm) userModel = "Admin";
            }
          }
        }
        return {
          userId: mId,
          userModel,
          role: isCreator ? "admin" : "member",
          joinedAt: new Date(),
        };
      })
    );

    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const recentDuplicate = await ChatGroup.findOne({
      name: name.trim(),
      createdBy: myId,
      createdAt: { $gte: fiveSecondsAgo },
      isDeleted: false,
    });
    if (recentDuplicate) {
      const populatedMembers = await Promise.all(
        recentDuplicate.members.map(async (m) => {
          const participant = await resolveParticipant(m.userId);
          return {
            ...m.toObject(),
            user: participant,
          };
        })
      );
      return res.status(200).json({
        ...recentDuplicate.toObject(),
        members: populatedMembers,
      });
    }

    const newGroup = await ChatGroup.create({
      name: name.trim(),
      description: description ? description.trim() : "",
      avatar: avatar || "",
      companyId: resolvedCompanyId,
      adminId: resolvedAdminId,
      createdBy: myId,
      creatorModel,
      members,
      lastMessage: {
        text: `Group "${name.trim()}" created`,
        senderName: req.user.name || "Admin",
        timestamp: new Date(),
      },
    });

    const populatedMembers = await Promise.all(
      newGroup.members.map(async (m) => {
        const participant = await resolveParticipant(m.userId);
        return {
          ...m.toObject(),
          user: participant,
        };
      })
    );

    const groupResponse = {
      ...newGroup.toObject(),
      members: populatedMembers,
    };

    const io = getIO(req);
    if (io) {
      allMemberIds
        .filter((mId) => mId !== myId)
        .forEach((mId) => {
          io.to(`user_${mId}`).emit("group_created", groupResponse);
        });
    }

    return res.status(201).json(groupResponse);
  } catch (err) {
    console.error("Create group error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/groups — List user's groups
// ─────────────────────────────────────────────────────────────────────────────
router.get("/groups", protect, async (req, res) => {
  try {
    const rawMyId = req.user.actualId || req.user._id;
    const myIdStr = rawMyId ? rawMyId.toString() : "";
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    const memberQueries = [
      { "members.userId": myIdObj },
      { "members.userId": myIdStr },
    ];
    if (req.user._id && req.user.actualId && req.user._id.toString() !== req.user.actualId.toString()) {
      const altStr = req.user._id.toString();
      const altObj = new mongoose.Types.ObjectId(altStr);
      memberQueries.push({ "members.userId": altObj }, { "members.userId": altStr });
    }

    const groups = await ChatGroup.find({
      isDeleted: false,
      $or: memberQueries,
    })
      .sort({ "lastMessage.timestamp": -1, updatedAt: -1 })
      .lean();

    const enrichedGroups = await Promise.all(
      groups.map(async (g) => {
        const populatedMembers = await Promise.all(
          g.members.map(async (m) => {
            const participant = await resolveParticipant(m.userId);
            return {
              ...m,
              user: participant,
            };
          })
        );

        const myMember = g.members?.find((m) =>
          m.userId && (
            m.userId.toString() === myIdStr ||
            (req.user._id && m.userId.toString() === req.user._id.toString()) ||
            (req.user.actualId && m.userId.toString() === req.user.actualId.toString())
          )
        );
        const clearedAt = myMember?.clearedAt ? new Date(myMember.clearedAt) : null;

        const allMyIds = [myIdObj, myIdStr, req.user._id, req.user.actualId].filter(Boolean);

        const unreadCount = await Message.countDocuments({
          groupId: g._id,
          sender: { $nin: allMyIds },
          "readBy.userId": { $nin: allMyIds },
          isDeleted: false,
          isSystem: { $ne: true },
          messageType: { $ne: "system" },
          deletedForEveryone: { $ne: true },
          "deletedFor.userId": { $nin: allMyIds },
          ...(clearedAt ? { createdAt: { $gt: clearedAt } } : {}),
        });

        // If the last message was sent before clearedAt, hide preview for this user
        let userLastMessage = g.lastMessage;
        if (clearedAt && g.lastMessage?.timestamp && new Date(g.lastMessage.timestamp) <= clearedAt) {
          userLastMessage = {
            text: "",
            senderName: "",
            timestamp: null,
          };
        }

        return {
          ...g,
          members: populatedMembers,
          lastMessage: userLastMessage,
          unreadCount,
        };
      })
    );

    return res.json(enrichedGroups);
  } catch (err) {
    console.error("Get groups error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/groups/:groupId/history — Group message history
// ─────────────────────────────────────────────────────────────────────────────
router.get("/groups/:groupId/history", protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const rawMyId = req.user.actualId || req.user._id;
    const myIdStr = rawMyId ? rawMyId.toString() : "";

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    const membershipCheck = [
      { "members.userId": myIdObj },
      { "members.userId": myIdStr },
      { createdBy: myIdObj },
      { createdBy: myIdStr },
    ];
    if (req.user._id && req.user.actualId && req.user._id.toString() !== req.user.actualId.toString()) {
      const altStr = req.user._id.toString();
      const altObj = new mongoose.Types.ObjectId(altStr);
      membershipCheck.push(
        { "members.userId": altObj },
        { "members.userId": altStr },
        { createdBy: altObj },
        { createdBy: altStr }
      );
    }
    if (req.user.role === "admin") {
      membershipCheck.push({});
    }

    const group = await ChatGroup.findOne({
      _id: groupObjId,
      isDeleted: false,
      $or: membershipCheck,
    }).lean();

    if (!group) {
      return res.status(403).json({ error: "Group not found or you are not a member" });
    }

    // Find if this user cleared this group's messages
    const myMember = group.members?.find((m) =>
      m.userId && (
        m.userId.toString() === myIdStr ||
        (req.user._id && m.userId.toString() === req.user._id.toString()) ||
        (req.user.actualId && m.userId.toString() === req.user.actualId.toString())
      )
    );
    const clearedAt = myMember?.clearedAt ? new Date(myMember.clearedAt) : null;

    const messageQuery = {
      groupId: groupObjId,
      $or: [
        { isDeleted: false },
        { deletedForEveryone: true },
      ],
    };
    if (clearedAt) {
      messageQuery.createdAt = { $gt: clearedAt };
    }

    const messages = await Message.find(messageQuery)
      .populate("sender", "name employeeId supportAdminId department positionName profileImageUrl companyLogo")
      .sort({ createdAt: 1 });

    // If the group's last message was a System event (e.g. "Test left the group") that wasn't stored as a Message doc, include it
    if (
      group.lastMessage?.senderName === "System" &&
      group.lastMessage?.text &&
      !messages.some((m) => m.message === group.lastMessage.text)
    ) {
      // Use deterministic, stable ID so client-side polling does not duplicate the message
      const timeMs = group.lastMessage.timestamp ? new Date(group.lastMessage.timestamp).getTime() : 0;
      const stableId = `sys_${group._id}_${timeMs}`;
      const fallbackPerformerId = group.lastMessage?.performerId || null;
      const fallbackPerformerName = group.lastMessage?.performerName || "";

      const fallbackSystemMsg = {
        _id: stableId,
        groupId: groupObjId,
        sender: {
          _id: fallbackPerformerId || group.createdBy || myIdObj || rawMyId,
          name: fallbackPerformerName || "System",
        },
        performer: {
          userId: fallbackPerformerId,
          name: fallbackPerformerName,
        },
        systemAction: group.lastMessage?.systemAction || null,
        message: group.lastMessage.text,
        isSystem: true,
        messageType: "system",
        createdAt: group.lastMessage.timestamp || new Date(),
      };
      messages.push(fallbackSystemMsg);

      // Persist so it is permanently in Message collection with the creator's model
      let creatorModel = group.creatorModel || "Employee";
      Message.create({
        groupId: groupObjId,
        sender: fallbackPerformerId || group.createdBy || myIdObj || rawMyId,
        senderModel: creatorModel,
        message: group.lastMessage.text,
        isSystem: true,
        messageType: "system",
        systemAction: group.lastMessage?.systemAction || null,
        performer: {
          userId: fallbackPerformerId,
          name: fallbackPerformerName,
        },
        createdAt: group.lastMessage.timestamp || new Date(),
        isRead: true,
      }).catch(() => {});
    }

    const allMyIds = [myIdObj, myIdStr, req.user._id, req.user.actualId].filter(Boolean);

    // Map messages according to deleted status
    const mappedMessages = messages.map((m) => {
      const mObj = m.toObject ? m.toObject() : m;
      const isDeletedForMe = Array.isArray(mObj.deletedFor) && mObj.deletedFor.some(
        (d) => d.userId && allMyIds.some((id) => id && id.toString() === d.userId.toString())
      );

      if (isDeletedForMe) {
        return {
          ...mObj,
          deletedForMe: true,
          message: "Deleted for you",
          attachments: [],
          reactions: [],
        };
      }

      if (mObj.deletedForEveryone) {
        const isMe = mObj.deletedBy?.userId && allMyIds.some(
          (id) => id && id.toString() === mObj.deletedBy.userId.toString()
        );
        return {
          ...mObj,
          deletedForEveryone: true,
          message: isMe ? "Deleted for everyone" : `${mObj.deletedBy?.userName || "This person"} deleted this message`,
          attachments: [],
          reactions: [],
        };
      }

      return mObj;
    });

    // Build receipt entries for all identities (SupportAdmin dual-ID & standard accounts)
    const readReceiptEntries = [];
    if (myIdObj) {
      readReceiptEntries.push({ userId: myIdObj, readAt: new Date() });
    }
    if (req.user.actualId && req.user._id && req.user.actualId.toString() !== req.user._id.toString()) {
      try {
        readReceiptEntries.push({ userId: new mongoose.Types.ObjectId(req.user._id.toString()), readAt: new Date() });
      } catch (_) {}
    }
    if (readReceiptEntries.length === 0 && rawMyId) {
      readReceiptEntries.push({ userId: rawMyId, readAt: new Date() });
    }

    // Await database update so serverless execution (Vercel/Render) never freezes before write completes
    try {
      await Message.updateMany(
        {
          groupId: groupObjId,
          sender: { $nin: allMyIds },
          "readBy.userId": { $nin: allMyIds },
          ...(clearedAt ? { createdAt: { $gt: clearedAt } } : {}),
        },
        {
          $addToSet: {
            readBy: {
              $each: readReceiptEntries,
            },
          },
        }
      );
    } catch (groupReadErr) {
      console.error("Group history mark read error:", groupReadErr);
    }

    // Collapse any duplicate historical system events (e.g. from rapid retries)
    const seenSystemEvents = new Set();
    const cleanMessages = [];
    for (const msg of mappedMessages) {
      if (msg.isSystem || msg.messageType === "system" || msg.sender?.name === "System") {
        const timeKey = msg.createdAt ? new Date(msg.createdAt).toISOString().slice(0, 16) : "";
        const eventKey = `${(msg.message || "").trim()}_${timeKey}`;
        if (seenSystemEvents.has(eventKey)) {
          continue; // skip duplicate from earlier testing
        }
        seenSystemEvents.add(eventKey);
      }
      cleanMessages.push(msg);
    }

    return res.json(cleanMessages);
  } catch (err) {
    console.error("Get group history error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/chat/groups/:groupId/read — Mark all group messages as read
// ─────────────────────────────────────────────────────────────────────────────
router.put("/groups/:groupId/read", protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }
    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const rawMyId = req.user.actualId || req.user._id;
    const myIdStr = rawMyId ? rawMyId.toString() : "";
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;
    const allMyIds = [myIdObj, myIdStr, req.user._id, req.user.actualId].filter(Boolean);

    const readReceiptEntries = [];
    if (myIdObj) {
      readReceiptEntries.push({ userId: myIdObj, readAt: new Date() });
    }
    if (req.user.actualId && req.user._id && req.user.actualId.toString() !== req.user._id.toString()) {
      try {
        readReceiptEntries.push({ userId: new mongoose.Types.ObjectId(req.user._id.toString()), readAt: new Date() });
      } catch (_) {}
    }
    if (readReceiptEntries.length === 0 && rawMyId) {
      readReceiptEntries.push({ userId: rawMyId, readAt: new Date() });
    }

    await Message.updateMany(
      {
        groupId: groupObjId,
        sender: { $nin: allMyIds },
        "readBy.userId": { $nin: allMyIds },
      },
      {
        $addToSet: {
          readBy: {
            $each: readReceiptEntries,
          },
        },
      }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Mark group read error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/groups/:groupId/send — Send message in group
// ─────────────────────────────────────────────────────────────────────────────
router.post("/groups/:groupId/send", protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { message, attachments } = req.body;
    const myId = req.user.actualId || req.user._id;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: "Message or attachment is required" });
    }

    const group = await ChatGroup.findOne({
      _id: groupId,
      isDeleted: false,
      "members.userId": myId,
    });

    if (!group) {
      return res.status(403).json({ error: "Group not found or you are not a member" });
    }

    let senderModel = "Employee";
    if (req.user.role === "admin") senderModel = "Admin";
    else if (req.user.role === "support-admin") senderModel = "SupportAdmin";

    const resolvedAdminId =
      req.user.adminId || (req.user.role === "admin" ? (req.user.actualId || req.user._id) : null);
    const resolvedCompanyId = req.user.company || null;
    const trimmedMessage = message ? message.trim() : "";

    // Guard against rapid duplicate group sends (within 1.5s)
    if (!attachments || attachments.length === 0) {
      const recentDuplicate = await Message.findOne({
        groupId,
        sender: myId,
        message: trimmedMessage,
        createdAt: { $gte: new Date(Date.now() - 1500) },
        isDeleted: false,
      }).populate(
        "sender",
        "name employeeId supportAdminId department positionName profileImageUrl companyLogo"
      );

      if (recentDuplicate) {
        return res.status(200).json(recentDuplicate);
      }
    }

    const newMessage = await Message.create({
      adminId:   resolvedAdminId,
      companyId: resolvedCompanyId,
      groupId,
      sender:    myId,
      senderModel,
      message:   trimmedMessage,
      attachments: Array.isArray(attachments) ? attachments : [],
      readBy:    [{ userId: myId, readAt: new Date() }],
    });

    await newMessage.populate(
      "sender",
      "name employeeId supportAdminId department positionName profileImageUrl companyLogo"
    );

    const previewText = message?.trim()
      ? message.trim()
      : attachments?.length
      ? "📎 Attachment"
      : "";

    group.lastMessage = {
      text: previewText,
      senderName: req.user.name || "Member",
      timestamp: new Date(),
    };
    await group.save();

    const io = getIO(req);
    if (io) {
      io.to(`group_${groupId.toString()}`).emit("receive_group_message", newMessage);
      group.members.forEach((m) => {
        io.to(`user_${m.userId.toString()}`).emit("group_activity", {
          groupId,
          lastMessage: group.lastMessage,
          senderId: myId.toString(),
        });
      });
    }

    return res.status(201).json(newMessage);
  } catch (err) {
    console.error("Send group message error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/chat/groups/:groupId — Delete a group (Creator or Admin)
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/groups/:groupId", protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const myId = (req.user.actualId || req.user._id).toString();

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const group = await ChatGroup.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isCreator = group.createdBy && group.createdBy.toString() === myId;
    const isAdminMember = group.members.some(
      (m) => m.userId.toString() === myId && m.role === "admin"
    );

    if (!isCreator && !isAdminMember && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only group admins can delete this group" });
    }

    group.isDeleted = true;
    await group.save();

    const io = getIO(req);
    if (io) {
      group.members.forEach((m) => {
        io.to(`user_${m.userId.toString()}`).emit("group_deleted", { groupId });
      });
    }

    return res.json({ success: true, message: "Group deleted" });
  } catch (err) {
    console.error("Delete group error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE / POST /api/chat/groups/:groupId/clear — Clear group chat FOR THE CALLING USER ONLY
// ─────────────────────────────────────────────────────────────────────────────
const clearGroupChatHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const rawMyId = req.user.actualId || req.user._id;
    const myId = rawMyId ? rawMyId.toString() : "";

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    // Check membership / permissions using both ObjectId and string matching
    const memberOrConditions = [
      { createdBy: myIdObj },
      { createdBy: myId },
      { "members.userId": myIdObj },
      { "members.userId": myId },
    ];

    if (req.user.actualId && req.user._id && req.user.actualId.toString() !== req.user._id.toString()) {
      const otherId = req.user._id.toString();
      const otherObj = new mongoose.Types.ObjectId(otherId);
      memberOrConditions.push(
        { createdBy: otherObj },
        { createdBy: otherId },
        { "members.userId": otherObj },
        { "members.userId": otherId }
      );
    }

    if (req.user.role === "admin") {
      memberOrConditions.push({});
    }

    const group = await ChatGroup.findOne({
      _id: groupObjId,
      isDeleted: false,
      $or: memberOrConditions,
    });

    if (!group) {
      return res.status(403).json({ error: "Group not found or you are not a member" });
    }

    // Per-user clear: update clearedAt timestamp only for this user in group.members
    const now = new Date();
    let memberFound = false;

    if (Array.isArray(group.members)) {
      for (const m of group.members) {
        if (
          m.userId &&
          (m.userId.toString() === myId ||
            (req.user._id && m.userId.toString() === req.user._id.toString()) ||
            (req.user.actualId && m.userId.toString() === req.user.actualId.toString()))
        ) {
          m.clearedAt = now;
          memberFound = true;
          break;
        }
      }
    }

    if (!memberFound) {
      let userModel = "Employee";
      if (req.user.role === "admin") userModel = "Admin";
      else if (req.user.role === "support-admin") userModel = "SupportAdmin";

      group.members.push({
        userId: myIdObj || rawMyId,
        userModel,
        role: group.createdBy && group.createdBy.toString() === myId ? "admin" : "member",
        joinedAt: now,
        clearedAt: now,
      });
    }

    await group.save();

    // Notify ONLY the user who cleared the chat so other members' messages remain untouched
    try {
      const io = getIO(req);
      if (io) {
        io.to(`user_${myId}`).emit("group_chat_cleared", { groupId });
        if (req.user._id && req.user._id.toString() !== myId) {
          io.to(`user_${req.user._id.toString()}`).emit("group_chat_cleared", { groupId });
        }
      }
    } catch (socketErr) {
      console.warn("Socket error on clear group chat:", socketErr.message);
    }

    return res.json({ success: true, message: "Group chat cleared" });
  } catch (err) {
    console.error("Clear group chat error:", err);
    return res.status(500).json({ error: err.message });
  }
};

router.delete("/groups/:groupId/clear", protect, clearGroupChatHandler);
router.post("/groups/:groupId/clear", protect, clearGroupChatHandler);

// ─────────────────────────────────────────────────────────────────────────────
// POST / DELETE /api/chat/groups/:groupId/leave — Member leaves a group
// ─────────────────────────────────────────────────────────────────────────────
const leaveGroupHandler = async (req, res) => {
  try {
    const { groupId } = req.params;
    const rawMyId = req.user.actualId || req.user._id;
    const myId = rawMyId ? rawMyId.toString() : "";

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    const membershipCheck = [
      { "members.userId": myIdObj },
      { "members.userId": myId },
      { createdBy: myIdObj },
      { createdBy: myId },
    ];
    if (req.user._id && req.user.actualId && req.user._id.toString() !== req.user.actualId.toString()) {
      const altStr = req.user._id.toString();
      const altObj = new mongoose.Types.ObjectId(altStr);
      membershipCheck.push(
        { "members.userId": altObj },
        { "members.userId": altStr },
        { createdBy: altObj },
        { createdBy: altStr }
      );
    }

    const group = await ChatGroup.findOne({
      _id: groupObjId,
      isDeleted: false,
      $or: membershipCheck,
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found or you are not a member" });
    }

    // Check if the user is the creator/admin
    const isCreator = group.createdBy && (
      group.createdBy.toString() === myId ||
      (req.user._id && group.createdBy.toString() === req.user._id.toString()) ||
      (req.user.actualId && group.createdBy.toString() === req.user.actualId.toString())
    );

    if (isCreator) {
      return res.status(400).json({ error: "Group creators cannot leave the group. You can delete the group instead." });
    }

    // Filter out the leaving user
    group.members = group.members.filter((m) => {
      if (!m.userId) return true;
      const mStr = m.userId.toString();
      if (mStr === myId) return false;
      if (req.user._id && mStr === req.user._id.toString()) return false;
      if (req.user.actualId && mStr === req.user.actualId.toString()) return false;
      return true;
    });

    const leaverName = req.user.name || "A member";
    const systemText = `${leaverName} left the group`;

    group.lastMessage = {
      text: systemText,
      senderName: "System",
      timestamp: new Date(),
      systemAction: "member_left",
      performerId: myId,
      performerName: leaverName,
    };

    let senderModel = "Employee";
    if (req.user.role === "admin") senderModel = "Admin";
    else if (req.user.role === "support-admin") senderModel = "SupportAdmin";

    // Create system message in Message collection so it appears in the right-side chat panel
    const systemMsg = await Message.create({
      groupId: groupObjId,
      sender: myIdObj || rawMyId,
      senderModel,
      message: systemText,
      isSystem: true,
      messageType: "system",
      systemAction: "member_left",
      performer: { userId: myIdObj || rawMyId, name: leaverName },
      isRead: true,
    });

    const populatedSystemMsg = await Message.findById(systemMsg._id)
      .populate("sender", "name employeeId supportAdminId department positionName profileImageUrl companyLogo")
      .lean();

    await group.save();

    // Broadcast socket events
    try {
      const io = getIO(req);
      if (io) {
        // Broadcast the system leave message to all remaining members in the group room
        io.to(`group_${groupId.toString()}`).emit("receive_group_message", populatedSystemMsg);

        // Emit to user who left to remove the group from their active list
        io.to(`user_${myId}`).emit("group_deleted", { groupId });
        if (req.user._id && req.user._id.toString() !== myId) {
          io.to(`user_${req.user._id.toString()}`).emit("group_deleted", { groupId });
        }

        // Populate remaining members
        const populatedMembers = await Promise.all(
          group.members.map(async (m) => {
            const participant = await resolveParticipant(m.userId);
            return {
              ...(m.toObject ? m.toObject() : m),
              user: participant,
            };
          })
        );

        const updatedGroupPayload = {
          ...group.toObject(),
          members: populatedMembers,
        };

        // Notify remaining members
        group.members.forEach((m) => {
          io.to(`user_${m.userId.toString()}`).emit("group_updated", updatedGroupPayload);
          io.to(`user_${m.userId.toString()}`).emit("group_activity", {
            groupId,
            lastMessage: group.lastMessage,
          });
        });
      }
    } catch (socketErr) {
      console.warn("Socket error on leave group:", socketErr.message);
    }

    return res.json({ success: true, message: "You have left the group" });
  } catch (err) {
    console.error("Leave group error:", err);
    return res.status(500).json({ error: err.message });
  }
};

router.post("/groups/:groupId/leave", protect, leaveGroupHandler);
router.delete("/groups/:groupId/leave", protect, leaveGroupHandler);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/groups/:groupId/members — Add new members to an existing group
// ─────────────────────────────────────────────────────────────────────────────
router.post("/groups/:groupId/members", protect, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberIds } = req.body;
    const rawMyId = req.user.actualId || req.user._id;
    const myId = (rawMyId || "").toString();

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: "Please select colleagues to add" });
    }

    const groupObjId = new mongoose.Types.ObjectId(groupId);
    const myIdObj = (rawMyId && mongoose.Types.ObjectId.isValid(rawMyId))
      ? new mongoose.Types.ObjectId(rawMyId)
      : null;

    const group = await ChatGroup.findOne({
      _id: groupId,
      isDeleted: false,
      "members.userId": myId,
    });

    if (!group) {
      return res.status(403).json({ error: "Group not found or you are not a member" });
    }

    // Filter out existing member IDs
    const existingMemberIdStrings = new Set(
      group.members.map((m) => m.userId.toString())
    );
    const newMemberIds = memberIds.filter(
      (id) => !existingMemberIdStrings.has(id.toString())
    );

    if (newMemberIds.length === 0) {
      return res.status(400).json({ error: "Selected users are already members of this group" });
    }

    // Resolve userModel for new members
    const newMembers = await Promise.all(
      newMemberIds.map(async (mId) => {
        let userModel = "Employee";
        const emp = await Employee.findById(mId).select("_id").lean();
        if (!emp) {
          const sa = await SupportAdmin.findById(mId).select("_id").lean();
          if (sa) userModel = "SupportAdmin";
          else {
            const adm = await Admin.findById(mId).select("_id").lean();
            if (adm) userModel = "Admin";
          }
        }
        return {
          userId: mId,
          userModel,
          role: "member",
          joinedAt: new Date(),
        };
      })
    );

    group.members.push(...newMembers);
    await group.save();

    // Populate all members
    const populatedMembers = await Promise.all(
      group.members.map(async (m) => {
        const participant = await resolveParticipant(m.userId);
        return {
          ...m.toObject(),
          user: participant,
        };
      })
    );

    const groupResponse = {
      ...group.toObject(),
      members: populatedMembers,
    };

    const addedUserList = populatedMembers
      .filter((m) => newMemberIds.includes(m.userId.toString()))
      .map((m) => ({
        userId: m.userId?.toString() || m.userId,
        name: m.user?.name || "Member",
      }));

    const adderName = req.user.name || "A member";
    const addedNames = addedUserList.map((m) => m.name).join(", ");
    const joinText = `${adderName} added ${addedNames || "new members"} to the group`;

    group.lastMessage = {
      text: joinText,
      senderName: "System",
      timestamp: new Date(),
      systemAction: "member_added",
      performerId: myId,
      performerName: adderName,
      targetUsers: addedUserList,
    };
    await group.save();

    let adderModel = "Employee";
    if (req.user.role === "admin") adderModel = "Admin";
    else if (req.user.role === "support-admin") adderModel = "SupportAdmin";

    // Deduplicate: check if recent systemMsg with same text exists within 15 seconds
    let systemMsg = await Message.findOne({
      groupId: groupObjId,
      isSystem: true,
      message: joinText,
      createdAt: { $gte: new Date(Date.now() - 15000) },
    });

    if (!systemMsg) {
      systemMsg = await Message.create({
        groupId: groupObjId,
        sender: myIdObj || rawMyId,
        senderModel: adderModel,
        message: joinText,
        isSystem: true,
        messageType: "system",
        systemAction: "member_added",
        performer: { userId: myIdObj || rawMyId, name: adderName },
        targetUsers: addedUserList,
        isRead: true,
      });
    }

    const populatedSystemMsg = await Message.findById(systemMsg._id)
      .populate("sender", "name employeeId supportAdminId department positionName profileImageUrl companyLogo")
      .lean();

    const io = getIO(req);
    if (io) {
      // Broadcast system activity to the group chat panel in real time
      io.to(`group_${groupId.toString()}`).emit("receive_group_message", populatedSystemMsg);

      // Notify newly added members so group shows up for them in real-time
      newMemberIds.forEach((mId) => {
        io.to(`user_${mId.toString()}`).emit("group_created", groupResponse);
      });
      // Notify all existing members of the updated group
      existingMemberIdStrings.forEach((mId) => {
        io.to(`user_${mId.toString()}`).emit("group_updated", groupResponse);
      });
    }

    return res.json({ success: true, group: groupResponse });
  } catch (err) {
    console.error("Add group members error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/messages/:messageId/react — Toggle emoji reaction
// ─────────────────────────────────────────────────────────────────────────────
router.post("/messages/:messageId/react", protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const myId = req.user.actualId || req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid messageId" });
    }
    if (!emoji) {
      return res.status(400).json({ error: "Emoji is required" });
    }

    const msg = await Message.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: "Message not found" });
    }

    const existingIndex = msg.reactions.findIndex(
      (r) => r.userId.toString() === myId.toString() && r.emoji === emoji
    );

    if (existingIndex > -1) {
      msg.reactions.splice(existingIndex, 1);
    } else {
      msg.reactions.push({
        userId: myId,
        userName: req.user.name || "User",
        emoji,
      });
    }

    await msg.save();

    const io = getIO(req);
    if (io) {
      const payload = {
        messageId: msg._id,
        reactions: msg.reactions,
        groupId: msg.groupId,
      };

      if (msg.groupId) {
        io.to(`group_${msg.groupId.toString()}`).emit("message_reacted", payload);
      } else {
        if (msg.receiver) io.to(`user_${msg.receiver.toString()}`).emit("message_reacted", payload);
        if (msg.sender) io.to(`user_${msg.sender.toString()}`).emit("message_reacted", payload);
      }
    }

    return res.json({ success: true, reactions: msg.reactions });
  } catch (err) {
    console.error("React message error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Chat Attachment Storage & Helpers (isolated from shared config/cloudinary.js)
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_CHAT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_CHAT_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".pdf", ".doc", ".docx", ".txt", ".csv", ".xls", ".xlsx",
]);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (
      file.mimetype?.startsWith("image/") ||
      ALLOWED_CHAT_MIME_TYPES.has(file.mimetype) ||
      ALLOWED_CHAT_EXTENSIONS.has(ext)
    ) {
      return cb(null, true);
    }
    return cb(new Error("Unsupported file type. Allowed: images, PDF, DOC, DOCX, TXT."));
  },
});

const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });

const buildCloudinaryDownloadCandidates = (fileUrl) => {
  const candidates = [];
  const match = fileUrl.match(/\/(raw|image|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (match) {
    const resourceType = match[1];
    const rawPath = decodeURIComponent(match[2].split("?")[0]);

    if (resourceType === "raw") {
      candidates.push(
        cloudinary.utils.private_download_url(rawPath, undefined, {
          resource_type: "raw",
          type: "upload",
        })
      );
    } else {
      const lastSlash = rawPath.lastIndexOf("/");
      const lastDot = rawPath.lastIndexOf(".");
      const hasExt = lastDot > lastSlash;
      const publicId = hasExt ? rawPath.slice(0, lastDot) : rawPath;
      const format = hasExt ? rawPath.slice(lastDot + 1) : undefined;

      candidates.push(
        cloudinary.utils.private_download_url(publicId, format, {
          resource_type: resourceType,
          type: "upload",
        })
      );
      candidates.push(
        cloudinary.url(rawPath, {
          resource_type: resourceType,
          type: "upload",
          sign_url: true,
          secure: true,
        })
      );
    }
  }
  candidates.push(fileUrl);
  return [...new Set(candidates.filter(Boolean))];
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/upload — Media / Document Upload
// ─────────────────────────────────────────────────────────────────────────────
router.post("/upload", protect, (req, res) => {
  chatUpload.single("file")(req, res, async (err) => {
    if (err) {
      console.error("Upload multer error:", err);
      return res.status(400).json({ error: err.message || "Failed to upload file" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const isImage = req.file.mimetype?.startsWith("image/");
      const ext = path.extname(req.file.originalname || "").toLowerCase();

      // Upload images as "image" and PDFs/documents as "raw" so Cloudinary
      // serves documents publicly from /raw/upload/ without PDF delivery blocks.
      const uploadOptions = isImage
        ? {
            folder: "chat_attachments",
            resource_type: "image",
            type: "upload",
          }
        : {
            folder: "chat_attachments",
            resource_type: "raw",
            type: "upload",
            public_id: `${uuidv4()}${ext}`,
          };

      const result = await uploadBufferToCloudinary(req.file.buffer, uploadOptions);

      return res.json({
        url: result.secure_url,
        fileType: isImage ? "image" : "file",
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });
    } catch (uploadErr) {
      console.error("Chat Cloudinary upload error:", uploadErr);
      return res.status(500).json({ error: uploadErr.message || "Failed to upload file" });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/download — Authenticated attachment download (supports old & new)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/download", protect, async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    const requestedName = typeof req.query.fileName === "string" ? req.query.fileName.trim() : "";

    if (!rawUrl) {
      return res.status(400).json({ error: "Attachment URL is required" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "Invalid attachment URL" });
    }

    const expectedCloud = process.env.CLOUDINARY_CLOUD_NAME;
    const isValidCloudinary =
      (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") &&
      parsedUrl.hostname === "res.cloudinary.com" &&
      (!expectedCloud || parsedUrl.pathname.startsWith(`/${expectedCloud}/`));

    if (!isValidCloudinary) {
      return res.status(400).json({ error: "Unsupported attachment host" });
    }

    const normalizedUrl = rawUrl.replace(/^http:\/\//i, "https://");
    const candidates = buildCloudinaryDownloadCandidates(normalizedUrl);
    let upstreamRes = null;

    for (const candidateUrl of candidates) {
      try {
        const attempt = await fetch(candidateUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });
        if (attempt.ok) {
          upstreamRes = attempt;
          break;
        }
        console.warn("Chat download candidate failed:", attempt.status, candidateUrl.split("?")[0]);
      } catch (fetchErr) {
        console.warn("Chat download candidate error:", fetchErr.message);
      }
    }

    if (!upstreamRes) {
      return res.status(502).json({ error: "Unable to fetch attachment from storage" });
    }

    const fallbackName = decodeURIComponent(path.basename(parsedUrl.pathname)) || "attachment";
    const safeName = (requestedName || fallbackName)
      .replace(/[\r\n"]/g, "_")
      .trim() || "attachment";

    let contentType = upstreamRes.headers.get("content-type") || "application/octet-stream";
    if (
      (contentType === "application/octet-stream" || contentType === "text/plain") &&
      (safeName.toLowerCase().endsWith(".pdf") || parsedUrl.pathname.toLowerCase().endsWith(".pdf"))
    ) {
      contentType = "application/pdf";
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader("Cache-Control", "private, max-age=300");

    if (upstreamRes.body && typeof Readable.fromWeb === "function") {
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on("error", (streamErr) => {
        console.error("Chat download stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(streamErr);
        }
      });
      return nodeStream.pipe(res);
    }

    const buffer = Buffer.from(await upstreamRes.arrayBuffer());
    return res.send(buffer);
  } catch (err) {
    console.error("Chat attachment download error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to download attachment" });
    }
  }
});

export default router;