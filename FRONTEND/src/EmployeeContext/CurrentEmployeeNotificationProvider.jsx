// src/EmployeeContext/CurrentEmployeeNotificationProvider.jsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { CurrentEmployeeNotificationContext } from "./CurrentEmployeeNotificationContext";
import api, {
  getNotifications,
  getNotices,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteAllNotifications, // ✅ BUG 1 FIX — clear from DB
} from "../api";
import { io } from "socket.io-client";

const SOCKET_URL =
  import.meta.env.MODE === "production"
    ? import.meta.env.VITE_API_URL_PRODUCTION
    : import.meta.env.VITE_API_URL_DEVELOPMENT || "http://localhost:5000";

// Load employee from SESSION STORAGE
const loadUser = () => {
  try {
    const raw = sessionStorage.getItem("hrmsUser");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const READ_NOTICE_KEY = "employee_read_notices";

const CurrentEmployeeNotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const [notices, setNotices] = useState([]);
  const [unreadNotices, setUnreadNotices] = useState(0);

  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [loggedUser] = useState(loadUser);

  // ✅ FEATURE 1 — bell toggle state for employee navbar
  const [bellOpen, setBellOpen] = useState(false);

  const [sound] = useState(() => new Audio("/notification.mp3"));
  const socketRef = useRef(null);

  const getUserId = () => (loggedUser ? String(loggedUser._id) : null);

  // ─── Notices helpers ──────────────────────────────────────────────────────
  const loadReadNoticeIds = () => {
    try { return JSON.parse(sessionStorage.getItem(READ_NOTICE_KEY)) || []; }
    catch { return []; }
  };
  const saveReadNoticeIds = (ids) =>
    sessionStorage.setItem(READ_NOTICE_KEY, JSON.stringify(ids));

  // ─── Load notifications ───────────────────────────────────────────────────
    
const loadNotifications = useCallback(async () => {
  try {
    const all = await getNotifications();
    

    // Backend already filters notifications for this employee
    const filtered = (Array.isArray(all) ? [...all] : []).sort(
      (a, b) =>
        new Date(b.date || b.createdAt) -
        new Date(a.date || a.createdAt)
    );

    setNotifications(filtered);
    setUnreadNotifications(
      filtered.filter((n) => !n.isRead).length
    );
  } catch (err) {
    console.error("❌ Error loading notifications:", err);
  }
}, [loggedUser]);

  // ─── Load notices ─────────────────────────────────────────────────────────
  const loadNotices = useCallback(async () => {
    try {
      const list = await getNotices();
      const currentId = getUserId();
      if (!Array.isArray(list) || !currentId) return;

      const validNotices = list.filter((n) => {
        if (!n?.title) return false;
        if (typeof n.title === "string" && n.title.startsWith("__SYSTEM_")) return false;
        if (Array.isArray(n.recipients) && n.recipients.length > 0) {
          const recIds = n.recipients.map((r) =>
            typeof r === "object" && r?._id ? String(r._id) : String(r)
          );
          if (!recIds.includes(String(currentId))) return false;
        }
        return true;
      });

      const mapped = validNotices.map((n) => {
        const isRead = Array.isArray(n.readBy) && n.readBy.some((record) => {
          const rId = typeof record.employeeId === "object" ? record.employeeId?._id : record.employeeId;
          return String(rId) === String(currentId);
        });

        const authorName = n.creatorModel === "Admin"
          ? "Admin"
          : (n.createdBy?.name || "Colleague");

        return {
          _id: `notice-doc-${n._id}`,
          noticeId: String(n._id),
          title: "Notice Board Announcement",
          message: `${authorName} posted an announcement: "${n.title}"`,
          type: "notice",
          date: n.date || n.createdAt,
          isRead: isRead,
          isNoticeDoc: true,
        };
      });

      mapped.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
      setNotices(mapped);
      setUnreadNotices(mapped.filter((n) => !n.isRead).length);
    } catch (err) {
      console.error("❌ Error loading notices:", err);
    }
  }, [loggedUser]);

  // ─── Combined Notifications (DB Notifications + Notice Announcements) ────
  const combinedNotifications = useMemo(() => {
    const combined = [...notifications];
    for (const n of notices) {
      const alreadyInNotifications = combined.some((dbN) =>
        dbN.type === "notice" && (
          String(dbN.noticeId) === String(n.noticeId) ||
          (n.title && (dbN.message?.includes(n.title) || dbN.title?.includes(n.title)))
        )
      );
      if (!alreadyInNotifications) {
        combined.push(n);
      }
    }
    combined.sort(
      (a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt)
    );
    return combined;
  }, [notifications, notices]);

  const totalUnreadCount = combinedNotifications.filter((n) => !n.isRead).length;

  // ─── Mark all notices read ────────────────────────────────────────────────
  const markAllNoticesRead = () => {
    for (const n of notices) {
      if (n.noticeId) {
        api.put(`/api/notices/${n.noticeId}/read`).catch(() => {});
      }
    }
    setNotices((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadNotices(0);
  };

  // ─── SOCKET CONNECTION — ✅ FEATURE 2: Real-time with authentication ──────
  useEffect(() => {
    if (!loggedUser?._id) return;

    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("📡 Employee socket connected:", socket.id);
      // ✅ FEATURE 2 — join private room so only this employee gets their events
      if (loggedUser?._id) {
        socket.emit("authenticate", loggedUser._id);
        console.log("🔐 Employee socket authenticated:", loggedUser._id);
      }
    });

    // ✅ FEATURE 2 — real-time: receives only this employee's targeted events
    socket.on("newNotification", (data) => {
      console.log("🔥 Employee real-time notification:", data);

      setNotifications((prev) => {
        // Deduplicate
        if (prev.some((n) => String(n._id) === String(data._id))) return prev;
        const updated = [data, ...prev];
        setUnreadNotifications(updated.filter((n) => !n.isRead).length);
        return updated;
      });

      // Play sound
      try {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      } catch {}

      // Toast popup
      const toastId = Date.now();
      setToasts((prev) => [
        { id: toastId, message: data.message, title: data.title, time: new Date() },
        ...prev,
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 4500);
    });

    socket.on("resignation:status_update", (data) => {
      console.log("🔥 Resignation update received:", data);
      
      // Play sound
      try {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      } catch {}

      // Toast popup
      const toastId = Date.now();
      setToasts((prev) => [
        { id: toastId, message: data.message, title: "Resignation Alert", time: new Date() },
        ...prev,
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 5000);

      // Refetch notifications to show the persistent one
      loadNotifications();
    });

    socket.on("newNotice", () => {
      console.log("📢 New notice broadcast received via socket");
      loadNotices();
      loadNotifications();
    });

    socket.on("notice:updated", () => {
      console.log("📢 Notice updated broadcast received via socket");
      loadNotices();
      loadNotifications();
    });

    socket.on("receive_message", () => {
      window.dispatchEvent(new Event("chatUnreadUpdated"));
    });

    socket.on("group_activity", () => {
      window.dispatchEvent(new Event("chatUnreadUpdated"));
    });

    socket.on("reconnect", () => {
      if (loggedUser?._id) socket.emit("authenticate", loggedUser._id);
    });

    return () => socket.disconnect();
  }, [loggedUser, sound, loadNotices, loadNotifications]);

  // ─── Mark single notification as read ────────────────────────────────────
  const markAsRead = async (id) => {
    try {
      const strId = String(id);
      const noticeItem = notices.find(
        (n) => String(n._id) === strId || String(n.noticeId) === strId
      );

      if (noticeItem) {
        await api.put(`/api/notices/${noticeItem.noticeId}/read`).catch(() => {});
        setNotices((prev) =>
          prev.map((n) =>
            String(n._id) === strId || String(n.noticeId) === strId
              ? { ...n, isRead: true }
              : n
          )
        );
      }

      if (!strId.startsWith("notice-doc-")) {
        await markNotificationAsRead(id).catch(() => {});
      }

      setNotifications((prev) =>
        prev.map((n) => (String(n._id) === strId ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error("❌ Failed to mark notification read:", err);
    }
  };

  // ─── Mark ALL notifications as read ──────────────────────────────────────
  const markAllAsRead = async () => {
    const hasUnread = combinedNotifications.some((n) => !n.isRead);
    if (!hasUnread) {
      console.log("ℹ️ Employee: no unread notifications — skipping");
      return;
    }
    try {
      for (const n of notices) {
        if (!n.isRead && n.noticeId) {
          api.put(`/api/notices/${n.noticeId}/read`).catch(() => {});
        }
      }
      setNotices((prev) => prev.map((n) => ({ ...n, isRead: true })));

      const hasUnreadDb = notifications.some((n) => !n.isRead);
      if (hasUnreadDb) {
        await markAllNotificationsAsRead().catch(() => {});
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    } catch (err) {
      console.error("❌ Failed to mark all notifications read:", err);
    }
  };

  // ─── Clear ALL notifications from DB ─────────────────────────────────────
  const clearAll = async () => {
    try {
      await deleteAllNotifications().catch(() => {});
      for (const n of notices) {
        if (!n.isRead && n.noticeId) {
          api.put(`/api/notices/${n.noticeId}/read`).catch(() => {});
        }
      }
      setNotifications([]);
      setNotices([]);
    } catch (err) {
      console.error("❌ Failed to clear all notifications:", err);
    }
  };

  // ─── Initial load & Periodic Sync (15s interval matching Sidebar) ────────
  useEffect(() => {
    if (!loggedUser?._id) {
      setNotifications([]);
      setNotices([]);
      setLoading(false);
      return;
    }

    (async () => {
      await loadNotifications();
      await loadNotices();
      setLoading(false);
    })();

    const interval = setInterval(() => {
      loadNotices();
      loadNotifications();
    }, 15000);

    return () => clearInterval(interval);
  }, [loggedUser, loadNotifications, loadNotices]);

  return (
    <CurrentEmployeeNotificationContext.Provider
      value={{
        notifications: combinedNotifications,
        unreadNotifications: totalUnreadCount,
        notices,
        unreadNotices,
        loading,
        markAsRead,
        markAllAsRead,
        markAllNoticesRead,
        clearAll,           // ✅ BUG 1
        loadNotifications,
        loadNotices,
        bellOpen,           // ✅ FEATURE 1
        setBellOpen,        // ✅ FEATURE 1
      }}
    >
      {children}

      {/* ── Toast Notifications ─────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              background: "linear-gradient(135deg, #059669, #10b981)",
              color: "#fff",
              padding: "12px 16px",
              borderRadius: "10px",
              boxShadow: "0px 6px 20px rgba(0,0,0,0.25)",
              minWidth: "260px",
              maxWidth: "340px",
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            {toast.title && (
              <div style={{ fontSize: "12px", opacity: 0.85, marginBottom: "4px" }}>
                🔔 {toast.title}
              </div>
            )}
            <div>{toast.message}</div>
            <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "4px" }}>
              {toast.time.toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </CurrentEmployeeNotificationContext.Provider>
  );
};

export default CurrentEmployeeNotificationProvider;
