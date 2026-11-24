import express from "express";
import mongoose from "mongoose";
import Notice from "../models/Notice.js";
import Notification from "../models/notificationModel.js";
import Employee from "../models/employeeModel.js";
import SupportAdmin from "../models/supportAdminModel.js";
import { protect } from "../controllers/authController.js";
import { onlyAdmin } from "../middleware/roleMiddleware.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ============================================================================
   📌 ADMIN → GET ALL NOTICES (SCOPED)
============================================================================ */
router.get("/all", protect, onlyAdmin, async (req, res) => {
  try {
    const allNotices = await Notice.find({ adminId: req.user._id })
      .populate("createdBy", "name employeeId supportAdminId") 
      .populate("readBy.employeeId", "name employeeId")
      .populate("replies.employeeId", "name employeeId")
      .populate("replies.adminId", "name")
      .sort({ date: -1 })
      .lean();
    res.json(allNotices);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch notices" });
  }
});

/* ============================================================================
   👤 EMPLOYEE → GET NOTICES (SCOPED)
   FIXED: Improved filtering for "ALL" recipients to ensure company-wide visibility
============================================================================ */
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    
    // Identify the organization context
    const userCompany = req.user.company || req.user.companyId;
    const userAdmin = req.user.adminId;

    const query = {
        $or: [
            // Case 1: Notice is for everyone in the company/under the admin
            { 
              recipients: "ALL", 
              $or: [
                { companyId: userCompany },
                { adminId: userAdmin },
                { adminId: userId } // If the user is the admin themselves
              ]
            }, 
            // Case 2: User is specifically mentioned in recipients array
            { recipients: { $in: [userId] } },
            // Case 3: User created the notice
            { createdBy: userId } 
        ]
    };

    let notices = await Notice.find(query)
      .populate("createdBy", "name employeeId supportAdminId") 
      .populate("recipients", "name employeeId")
      .populate("replies.employeeId", "name employeeId")
      .populate("replies.adminId", "name")
      .sort({ date: -1 })
      .lean();

    res.json(notices);
  } catch (error) {
    console.error("Fetch Notices Error:", error);
    res.status(500).json({ message: "Failed to fetch notices" });
  }
});

/* ============================================================================
   ✉️ CREATE NOTICE (SCOPED)
   FIXED: Ensures companyId and adminId are consistently saved
============================================================================ */
router.post("/", protect, async (req, res) => {
  try {
    const { title, description, recipients, companyId, meetingDate, meetingTime } = req.body;
    
    // If recipients is empty or explicitly "ALL", store as "ALL"
    const recipientValue = (Array.isArray(recipients) && recipients.length > 0) ? recipients : "ALL";
    
    const isAdmin = req.user.role && (req.user.role.toLowerCase() === "admin" || req.user.role.toLowerCase() === "support-admin");
    
    let creatorModel = "Employee";
    if (req.user.role?.toLowerCase() === "admin") creatorModel = "Admin";
    else if (req.user.role?.toLowerCase() === "support-admin") creatorModel = "SupportAdmin";

    // Determine Admin and Company IDs
    const assignedAdminId = req.user.role?.toLowerCase() === "admin" ? req.user._id : req.user.adminId;
    const assignedCompanyId = isAdmin 
      ? (companyId || req.user.company || req.user.companyId || req.user._id) 
      : req.user.company;

    const savedNotice = await Notice.create({
      adminId: assignedAdminId,
      companyId: assignedCompanyId,
      title,
      description,
      date: new Date(),
      meetingDate,
      meetingTime,
      createdBy: req.user.actualId || req.user._id,
      creatorModel: creatorModel,
      recipients: recipientValue
    });

    // 🔔 Notify remaining users about the new announcement
    try {
      if (title && !title.startsWith("__SYSTEM_")) {
        const senderId = (req.user.actualId || req.user._id).toString();
        const senderName = req.user.name || (isAdmin ? "Admin" : "Employee");

        const targetUserMap = new Map(); // key: userId string, value: { userId, userType }

        // 1. If an employee or support-admin posted, notify the Admin
        if (!isAdmin || req.user.role?.toLowerCase() === "support-admin") {
          if (assignedAdminId && assignedAdminId.toString() !== senderId) {
            targetUserMap.set(assignedAdminId.toString(), {
              userId: assignedAdminId,
              userType: "Admin",
            });
          }
        }

        // 2. Determine target employees
        if (recipientValue === "ALL") {
          const orClauses = [];
          if (assignedAdminId) orClauses.push({ adminId: assignedAdminId });
          if (assignedCompanyId && mongoose.Types.ObjectId.isValid(assignedCompanyId)) {
            orClauses.push({ company: assignedCompanyId });
          }

          const empFilter = {
            ...(orClauses.length > 0 ? { $or: orClauses } : {}),
            isActive: { $ne: false },
          };

          const allEmps = await Employee.find(empFilter).select("_id").lean();
          for (const emp of allEmps) {
            const empIdStr = emp._id.toString();
            if (empIdStr !== senderId) {
              targetUserMap.set(empIdStr, {
                userId: emp._id,
                userType: "Employee",
              });
            }
          }

          // Also notify support-admins under this admin if not sender
          if (assignedAdminId) {
            const supportAdmins = await SupportAdmin.find({
              adminId: assignedAdminId,
              isActive: { $ne: false },
            }).select("_id").lean();

            for (const sa of supportAdmins) {
              const saIdStr = sa._id.toString();
              if (saIdStr !== senderId) {
                targetUserMap.set(saIdStr, {
                  userId: sa._id,
                  userType: "Employee",
                });
              }
            }
          }
        } else if (Array.isArray(recipientValue)) {
          // Specific recipients
          for (const recId of recipientValue) {
            if (!recId) continue;
            const recIdStr = (typeof recId === "object" && recId._id ? recId._id : recId).toString();
            if (recIdStr !== senderId) {
              targetUserMap.set(recIdStr, {
                userId: recIdStr,
                userType: "Employee",
              });
            }
          }
        }

        const notificationsToCreate = [];
        const messageText = isAdmin
          ? `Admin posted an announcement: "${title}"`
          : `${senderName} posted an announcement: "${title}"`;

        for (const target of targetUserMap.values()) {
          notificationsToCreate.push({
            adminId: assignedAdminId,
            companyId: (assignedCompanyId && mongoose.Types.ObjectId.isValid(assignedCompanyId)) ? assignedCompanyId : assignedAdminId,
            userId: target.userId,
            userType: target.userType,
            title: "Notice Board Announcement",
            message: messageText,
            type: "notice",
            isRead: false,
            date: new Date(),
          });
        }

        if (notificationsToCreate.length > 0) {
          const insertedNotifs = await Notification.insertMany(notificationsToCreate);

          const io = req.app.get("io");
          if (io) {
            for (const notif of insertedNotifs) {
              const uid = notif.userId.toString();
              io.to(`user_${uid}`).emit("newNotification", notif);
              if (notif.userType === "Admin") {
                io.to(`admin_${uid}`).emit("newNotification", notif);
              }
            }
            io.emit("notice:updated", { noticeId: savedNotice._id });
            io.emit("newNotice", { _id: savedNotice._id, title: savedNotice.title });
          }
        }
      }
    } catch (notifErr) {
      console.error("Notice notification error:", notifErr);
    }

    res.status(201).json({ message: "Posted", notice: savedNotice });
  } catch (e) {
    console.error("Create Notice Error:", e);
    res.status(500).json({ message: "Error creating notice", error: e.message });
  }
});

/* ============================================================================
   🛠️ UPDATE NOTICE
============================================================================ */
router.put("/:id", protect, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    const userId = req.user._id;
    const isAdmin = req.user.role && (req.user.role.toLowerCase() === "admin" || req.user.role.toLowerCase() === "support-admin");
    const isOwner = notice.createdBy.equals(userId);

    if (isAdmin && notice.adminId && !notice.adminId.equals(userId)) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { title, description, recipients, meetingDate, meetingTime } = req.body;
    const recipientValue = (Array.isArray(recipients) && recipients.length > 0) ? recipients : "ALL";

    const updated = await Notice.findByIdAndUpdate(
      req.params.id, 
      { title, description, recipients: recipientValue, meetingDate, meetingTime }, 
      { new: true }
    );
    
    const io = req.app.get("io");
    if (io) {
      io.emit("notice:updated", { noticeId: updated._id });
    }

    res.json({ message: "Updated", notice: updated });
  } catch (e) {
    console.error("Update Notice Error:", e);
    res.status(500).json({ message: "Error updating notice", error: e.message });
  }
});

/* ============================================================================
   🗑️ DELETE NOTICE
============================================================================ */
router.delete("/:id", protect, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    const userId = req.user._id;
    const isAdmin = req.user.role && (req.user.role.toLowerCase() === "admin" || req.user.role.toLowerCase() === "support-admin");
    const isOwner = notice.createdBy.equals(userId);

    if (isAdmin && notice.adminId && !notice.adminId.equals(userId)) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await Notice.findByIdAndDelete(req.params.id);
    const io = req.app.get("io");
    if (io) {
      io.emit("notice:updated", { noticeId: req.params.id });
    }
    res.json({ message: "Deleted successfully" });
  } catch (e) {
    console.error("Delete Error:", e);
    res.status(500).json({ message: "Error deleting notice" });
  }
});

/* ============================================================================
   ✅ MARK AS READ
============================================================================ */
router.put("/:id/read", protect, async (req, res) => {
  try {
    const noticeId = req.params.id;
    const employeeId = req.user._id;
    const notice = await Notice.findById(noticeId);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    if (!notice.readBy) notice.readBy = [];
    const isAlreadyRead = notice.readBy.some(r => r.employeeId?.toString() === employeeId.toString());

    if (!isAlreadyRead) {
      notice.readBy.push({ employeeId, readAt: new Date() });
      await notice.save();
    }
    res.json({ message: "Marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ============================================================================
   💬 REPLY ROUTES
============================================================================ */
router.post("/:id/reply", protect, upload.single("image"), async (req, res) => {
  try {
    const { message } = req.body;
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    let imageUrl = null;
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const uploadResponse = await cloudinary.uploader.upload(dataURI, { folder: "hrms_replies" });
      imageUrl = uploadResponse.secure_url;
    }

    const newReply = {
      employeeId: req.user._id,
      message: message || "",
      image: imageUrl,
      sentBy: 'Employee',
      repliedAt: new Date()
    };

    notice.replies.push(newReply);
    await notice.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("notice:reply:new", { noticeId: notice._id });
      io.emit("notice:updated", { noticeId: notice._id });
    }

    const updated = await Notice.findById(req.params.id)
      .populate("replies.employeeId", "name employeeId");
    res.status(201).json({ message: "Reply sent", reply: updated.replies[updated.replies.length - 1] });
  } catch (error) {
    res.status(500).json({ message: "Failed to reply" });
  }
});

router.post("/:id/admin-reply", protect, onlyAdmin, upload.single("image"), async (req, res) => {
  try {
    const { message, targetEmployeeId } = req.body;
    const notice = await Notice.findOne({ _id: req.params.id, adminId: req.user._id });
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    let imageUrl = null;
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const uploadResponse = await cloudinary.uploader.upload(dataURI, { folder: "hrms_replies" });
      imageUrl = uploadResponse.secure_url;
    }

    const newReply = {
      adminId: req.user._id,
      employeeId: targetEmployeeId,
      message: message || "",
      image: imageUrl,
      sentBy: 'Admin',
      repliedAt: new Date()
    };

    notice.replies.push(newReply);
    await notice.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("notice:reply:new", { noticeId: notice._id });
      io.emit("notice:updated", { noticeId: notice._id });
      if (targetEmployeeId) {
        io.to(`user_${targetEmployeeId.toString()}`).emit("notice:reply:new", { noticeId: notice._id });
      }
    }

    res.status(201).json({ message: "Reply sent" });
  } catch (error) {
    res.status(500).json({ message: "Failed to reply" });
  }
});

/* ============================================================================
   🗑️ DELETE REPLY
============================================================================ */
router.delete("/:id/reply/:replyId", protect, async (req, res) => {
  try {
    const { id, replyId } = req.params;
    const notice = await Notice.findById(id);
    if (!notice) return res.status(404).json({ message: "Notice not found" });

    const reply = notice.replies.id(replyId);
    if (!reply) return res.status(404).json({ message: "Reply not found" });

    const userId = req.user._id.toString();
    const isAdmin = req.user.role && (req.user.role.toLowerCase() === "admin" || req.user.role.toLowerCase() === "support-admin");
    const isReplyOwner = (reply.employeeId?.toString() === userId) || (reply.adminId?.toString() === userId);

    if (isAdmin && notice.adminId && !notice.adminId.equals(userId)) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    if (!isReplyOwner && !isAdmin) return res.status(403).json({ message: "Not authorized" });

    notice.replies.pull(replyId);
    await notice.save();
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete" });
  }
});

export default router;