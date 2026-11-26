import React, { useState, useEffect, useContext, useRef, useCallback, useMemo } from "react";
import { AuthContext } from "../context/AuthContext";
import api, { getEmployees } from "../api";
import { motion, AnimatePresence } from "framer-motion";
import EmojiPicker from 'emoji-picker-react';
import toast, { Toaster } from 'react-hot-toast';
import { io } from 'socket.io-client';
import {
  FaSearch, FaUsers, FaPaperPlane, FaSmile, FaSpinner,
  FaEllipsisV, FaRegEdit, FaTimes, FaComments,
  FaEllipsisH, FaCheckDouble, FaCheck,
  FaCommentDots, FaPen, FaTrash, FaArrowLeft,
  FaPaperclip, FaPlus, FaFileAlt, FaFilePdf, FaDownload,
  FaImage, FaUserFriends, FaCircle, FaUserPlus, FaEraser, FaSignOutAlt
} from "react-icons/fa";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.MODE === "production"
    ? import.meta.env.VITE_API_URL_PRODUCTION
    : import.meta.env.VITE_API_URL_DEVELOPMENT) ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000";

const POLL_INTERVAL = 3000;

const sameId = (a, b) => !!a && !!b && a.toString() === b.toString();

const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const formatLastSeen = (timestamp) => {
  if (!timestamp) return "Last seen recently";
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "Last seen recently";
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Last seen just now";

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isToday) return `Last seen today at ${timeStr}`;
  if (isYesterday) return `Last seen yesterday at ${timeStr}`;
  return `Last seen on ${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
};

const formatSystemActionText = (item, myId, myNameRaw) => {
  if (!item) return "";
  const rawText = typeof item === "string" ? item : (item.message || item.text || "");
  if (!rawText) return "";

  const myIdStr = myId ? myId.toString() : "";
  let myName = (myNameRaw || "").trim().toLowerCase();
  if (!myName) {
    try {
      const rawU = sessionStorage.getItem("hrmsUser");
      if (rawU) {
        const parsed = JSON.parse(rawU);
        myName = (parsed.name || parsed.fullName || "").trim().toLowerCase();
      }
    } catch (_) {}
  }

  // Explicit performer metadata if available
  const explicitPerformerId = item.performer?.userId?.toString() || item.performerId?.toString();
  const explicitPerformerName = item.performer?.name || item.performerName || "";
  const targetUsers = Array.isArray(item.targetUsers) ? item.targetUsers : [];

  // Match "X added Y to the group" or "X added Y"
  const addMatch = rawText.match(/^(.+?)\s+added\s+(.+?)(?:\s+to the group)?$/i);
  if (addMatch) {
    const rawAdder = addMatch[1].trim();
    const adderName = rawAdder || explicitPerformerName;
    const parsedAdded = targetUsers.length > 0 ? targetUsers.map(u => u.name || "Member").join(", ") : addMatch[2].trim();

    const adderLower = adderName.toLowerCase();
    const isAdder = adderLower === "you" || (myName && adderLower === myName) || (
      explicitPerformerId && myIdStr && explicitPerformerId === myIdStr && (adderLower === "you" || !rawAdder || (myName && adderLower === myName))
    );

    const isAdded = targetUsers.some(u => (u.userId && u.userId.toString() === myIdStr) || (u.name && u.name.trim().toLowerCase() === myName)) ||
                    (myName && parsedAdded.toLowerCase().split(", ").some(n => n.trim().toLowerCase() === myName)) ||
                    parsedAdded.toLowerCase() === "you";

    if (isAdder) {
      return `You added ${parsedAdded} to the group`;
    }
    if (isAdded) {
      return `You were added by ${adderName} to the group`;
    }
    return `${adderName} added ${parsedAdded} to the group`;
  }

  // Match "X left the group"
  const leaveMatch = rawText.match(/^(.+?)\s+left the group$/i);
  if (leaveMatch) {
    const parsedLeaver = leaveMatch[1].trim();
    const leaverLower = parsedLeaver.toLowerCase();

    // Check if the leaver is ME:
    // 1. Text literally says "You"
    // 2. Parsed leaver text matches my name
    // 3. Explicit performer ID matches my ID AND the parsed leaver text does NOT name someone else
    const isDirectMatch = leaverLower === "you" || (myName && leaverLower === myName);
    const isPerformerMatch = explicitPerformerId && myIdStr && explicitPerformerId === myIdStr && (
      leaverLower === "you" || leaverLower === "a member" || (myName && leaverLower === myName)
    );

    if (isDirectMatch || isPerformerMatch) {
      return "You left the group";
    }
    return `${parsedLeaver} left the group`;
  }

  return rawText;
};

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

const ConnectWithEmployee = () => {
  const { user } = useContext(AuthContext);
  const currentUserId = user?.actualId || user?._id || user?.id;

  // ── Navigation & Tabs ────────────────────────────────────────────────────
  const [chatMode, setChatMode] = useState("direct"); // "direct" | "groups"
  const [activeTab, setActiveTab] = useState("all"); // "all" | "management" | "colleagues"

  // ── Contacts & Direct Chats ──────────────────────────────────────────────
  const [contacts, setContacts] = useState([]);
  const [chatList, setChatList] = useState([]);
  const [selectedChatUser, setSelectedChatUser] = useState(null);

  // ── Groups (Teams Style) ─────────────────────────────────────────────────
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [newGroupMemberIds, setNewGroupMemberIds] = useState(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupSearchTerm, setGroupSearchTerm] = useState("");

  // ── Header Menu & Info Modals ────────────────────────────────────────────
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isGroupInfoModalOpen, setIsGroupInfoModalOpen] = useState(false);
  const [isDirectProfileModalOpen, setIsDirectProfileModalOpen] = useState(false);
  const [deleteTargetMsg, setDeleteTargetMsg] = useState(null);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState(new Set());
  const [addingMembers, setAddingMembers] = useState(false);
  const [addMemberSearchTerm, setAddMemberSearchTerm] = useState("");
  const headerMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setIsHeaderMenuOpen(false);
      }
    };
    if (isHeaderMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isHeaderMenuOpen]);

  // ── Presence & Typing ────────────────────────────────────────────────────
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [groupTypingUsers, setGroupTypingUsers] = useState({}); // userId -> userName

  // ── Active Chat State ────────────────────────────────────────────────────
  const [directMessages, setDirectMessages] = useState([]);
  const [directMsgText, setDirectMsgText] = useState("");
  const [directSearchTerm, setDirectSearchTerm] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Live ticking clock to re-render relative timestamps in real time
  const [, setClockTick] = useState(Date.now());

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setClockTick(Date.now());
    }, 20000); // ticks every 20 seconds
    return () => clearInterval(clockInterval);
  }, []);

  // ── File Attachments ─────────────────────────────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [downloadingAttachmentKey, setDownloadingAttachmentKey] = useState(null);
  const fileInputRef = useRef(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const directChatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const sidebarContainerRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const selectedChatUserRef = useRef(null);
  const selectedGroupRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const directMessagesRef = useRef([]);
  const chatListRef = useRef([]);
  const groupsRef = useRef([]);
  const pollTimerRef = useRef(null);
  const isSendingRef = useRef(false);

  useEffect(() => { selectedChatUserRef.current = selectedChatUser; }, [selectedChatUser]);
  useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);
  useEffect(() => { directMessagesRef.current = directMessages; }, [directMessages]);
  useEffect(() => { chatListRef.current = chatList; }, [chatList]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { isSendingRef.current = sendingMessage; }, [sendingMessage]);

  // ── Sound Notification ───────────────────────────────────────────────────
  const playNotificationSound = useCallback(() => {
    try {
      const a = new Audio("/notification.mp3");
      a.volume = 0.5;
      a.play().catch(() => {});
    } catch (_) {}
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SILENT BACKGROUND POLL
  // ─────────────────────────────────────────────────────────────────────────
  const silentPollMessages = useCallback(async () => {
    if (isSendingRef.current) return;

    if (selectedChatUserRef.current) {
      const peer = selectedChatUserRef.current;
      try {
        const { data: fresh } = await api.get(`/api/chat/history/${peer._id}`);
        if (!fresh || !Array.isArray(fresh)) return;

        const current = directMessagesRef.current;
        const currentIds = new Set(current.map(m => m._id?.toString()));
        const newMsgs = fresh.filter(m => {
          if (currentIds.has(m._id?.toString())) return false;
          if (m._id?.toString().startsWith("temp_")) return false;
          if ((m.isSystem || m.messageType === "system") && current.some(c => (c.isSystem || c.messageType === "system") && c.message === m.message)) {
            return false;
          }
          return true;
        });

        if (newMsgs.length > 0) {
          setDirectMessages(prev => {
            const existingIds = new Set(prev.map(m => m._id?.toString()));
            const toAdd = fresh.filter(m => {
              if (existingIds.has(m._id?.toString())) return false;
              if (m._id?.toString().startsWith("temp_")) return false;
              if ((m.isSystem || m.messageType === "system") && prev.some(p => (p.isSystem || p.messageType === "system") && p.message === m.message)) {
                return false;
              }
              return true;
            });
            if (toAdd.length === 0) return prev;
            return [...prev, ...toAdd];
          });
          playNotificationSound();
        }
      } catch (_) {}
    } else if (selectedGroupRef.current) {
      const grp = selectedGroupRef.current;
      try {
        const { data: fresh } = await api.get(`/api/chat/groups/${grp._id}/history`);
        if (!fresh || !Array.isArray(fresh)) return;

        const current = directMessagesRef.current;
        const currentIds = new Set(current.map(m => m._id?.toString()));
        const newMsgs = fresh.filter(m => {
          if (currentIds.has(m._id?.toString())) return false;
          if (m._id?.toString().startsWith("temp_")) return false;
          if ((m.isSystem || m.messageType === "system") && current.some(c => (c.isSystem || c.messageType === "system") && c.message === m.message)) {
            return false;
          }
          return true;
        });

        if (newMsgs.length > 0) {
          setDirectMessages(prev => {
            const existingIds = new Set(prev.map(m => m._id?.toString()));
            const toAdd = fresh.filter(m => {
              if (existingIds.has(m._id?.toString())) return false;
              if (m._id?.toString().startsWith("temp_")) return false;
              if ((m.isSystem || m.messageType === "system") && prev.some(p => (p.isSystem || p.messageType === "system") && p.message === m.message)) {
                return false;
              }
              return true;
            });
            if (toAdd.length === 0) return prev;
            return [...prev, ...toAdd];
          });
          playNotificationSound();
        }
      } catch (_) {}
    }
  }, [playNotificationSound]);

  const silentPollChatList = useCallback(async () => {
    try {
      const { data } = await api.get("/api/chat/users");
      if (!data || !Array.isArray(data)) return;

      const current = chatListRef.current;
      const hasChanges = data.some(d => {
        const existing = current.find(c => sameId(c._id, d._id));
        return !existing ||
          existing.lastMessage !== d.lastMessage ||
          existing.unreadCount !== d.unreadCount;
      });

      if (hasChanges) {
        setChatList(prev => {
          const activePeer = selectedChatUserRef.current;
          return data.map(d => {
            if (activePeer && sameId(d._id, activePeer._id)) {
              if (d.lastSeen && d.lastSeen !== activePeer.lastSeen) {
                setSelectedChatUser(curr => (curr ? { ...curr, lastSeen: d.lastSeen } : curr));
              }
              return { ...d, unreadCount: 0 };
            }
            return d;
          });
        });
        const total = data.reduce((a, c) => {
          const activePeer = selectedChatUserRef.current;
          if (activePeer && sameId(c._id, activePeer._id)) return a;
          return a + (c.unreadCount || 0);
        }, 0);
        setTotalUnreadCount(total);
      }
    } catch (_) {}
  }, []);

  const silentPollGroups = useCallback(async () => {
    try {
      const { data } = await api.get("/api/chat/groups");
      if (!data || !Array.isArray(data)) return;

      const activeGroup = selectedGroupRef.current;
      setGroups(prev => {
        return data.map(d => {
          if (activeGroup && sameId(d._id, activeGroup._id)) {
            return { ...d, unreadCount: 0 };
          }
          return d;
        });
      });
    } catch (_) {}
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      await silentPollMessages();
      await silentPollChatList();
      await silentPollGroups();
    }, POLL_INTERVAL);
  }, [silentPollMessages, silentPollChatList, silentPollGroups]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    startPolling();
    return () => stopPolling();
  }, [currentUserId, startPolling, stopPolling]);

  // ─────────────────────────────────────────────────────────────────────────
  // SOCKET CONNECTION & EVENT HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return;

    const token =
      sessionStorage.getItem("token") ||
      sessionStorage.getItem("authToken") || "";

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      upgrade: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      auth: { token },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("authenticate", currentUserIdRef.current);
      socket.emit("presence:get_online", (activeIds) => {
        if (Array.isArray(activeIds)) {
          setOnlineUserIds(new Set(activeIds.map(id => id.toString())));
        }
      });
      // Re-join active group room if already selected
      if (selectedGroupRef.current) {
        socket.emit("join_group", selectedGroupRef.current._id);
      }
    });

    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));

    // Online / Offline presence broadcast
    socket.on("presence:status", ({ userId, isOnline, lastSeen }) => {
      if (!userId) return;
      const uid = userId.toString();
      setOnlineUserIds(prev => {
        const next = new Set(prev);
        if (isOnline) next.add(uid);
        else next.delete(uid);
        return next;
      });

      if (!isOnline && lastSeen) {
        setContacts(prev => prev.map(c => sameId(c._id, uid) ? { ...c, lastSeen, lastMessageTime: lastSeen, isOnline: false } : c));
        setChatList(prev => prev.map(c => sameId(c._id, uid) ? { ...c, lastSeen, lastMessageTime: lastSeen, isOnline: false } : c));
        if (sameId(selectedChatUserRef.current?._id, uid)) {
          setSelectedChatUser(curr => curr ? { ...curr, lastSeen, lastMessageTime: lastSeen, isOnline: false } : curr);
        }
      } else if (isOnline) {
        setContacts(prev => prev.map(c => sameId(c._id, uid) ? { ...c, isOnline: true } : c));
        setChatList(prev => prev.map(c => sameId(c._id, uid) ? { ...c, isOnline: true } : c));
        if (sameId(selectedChatUserRef.current?._id, uid)) {
          setSelectedChatUser(curr => curr ? { ...curr, isOnline: true } : curr);
        }
      }
    });

    // 1-on-1 Message received
    socket.on("receive_message", (msg) => {
      const senderId = msg.sender?._id ?? msg.sender;
      const activePeer = selectedChatUserRef.current;
      const messageTime = msg.createdAt || new Date().toISOString();

      if (activePeer && sameId(senderId, activePeer._id)) {
        setDirectMessages(prev => {
          if (prev.some(m => sameId(m._id, msg._id))) return prev;
          return [...prev, msg];
        });
        setSelectedChatUser(curr => curr ? {
          ...curr,
          lastSeen: messageTime,
          lastMessageTime: messageTime,
          isOnline: true,
        } : curr);
        api.put(`/api/chat/read/${senderId.toString()}`).catch(() => {});
      } else {
        setChatList(prev => prev.map(u =>
          sameId(u._id, senderId)
            ? { ...u, unreadCount: (u.unreadCount || 0) + 1, lastMessage: msg.message || "📎 Attachment", lastMessageTime: messageTime, lastSeen: messageTime }
            : u
        ));
        setTotalUnreadCount(c => c + 1);
        playNotificationSound();
      }

      window.dispatchEvent(new Event("chatUnreadUpdated"));

      setContacts(prev => prev.map(c =>
        sameId(c._id, senderId)
          ? { ...c, lastSeen: messageTime, lastMessageTime: messageTime, isOnline: true }
          : c
      ));

      setChatList(prev => {
        const sid = senderId?.toString();
        const filtered = prev.filter(u => u._id?.toString() !== sid);
        const existing = prev.find(u => u._id?.toString() === sid)
          || { _id: sid, name: msg.sender?.name || "Unknown" };
        return [{
          ...existing,
          lastMessage: msg.message || "📎 Attachment",
          lastMessageTime: messageTime,
          lastSeen: messageTime,
          isOnline: true,
        }, ...filtered];
      });
    });

    // Group Message received
    socket.on("receive_group_message", (msg) => {
      const activeGroup = selectedGroupRef.current;
      const groupId = msg.groupId?.toString();

      if (activeGroup && sameId(activeGroup._id, groupId)) {
        setDirectMessages(prev => {
          if (prev.some(m => sameId(m._id, msg._id))) return prev;
          if ((msg.isSystem || msg.messageType === "system") && prev.some(m => (m.isSystem || m.messageType === "system") && m.message === msg.message)) {
            return prev;
          }
          return [...prev, msg];
        });
      } else {
        const isSentByMe = sameId(msg.sender?._id ?? msg.sender, currentUserIdRef.current);
        setGroups(prev => prev.map(g =>
          sameId(g._id, groupId)
            ? {
                ...g,
                unreadCount: isSentByMe ? (g.unreadCount || 0) : (g.unreadCount || 0) + 1,
                lastMessage: {
                  text: msg.message || "📎 Attachment",
                  senderName: msg.sender?.name || "Member",
                  timestamp: msg.createdAt,
                },
              }
            : g
        ));
      }

      window.dispatchEvent(new Event("chatUnreadUpdated"));
    });

    // New Group created
    socket.on("group_created", (newGroup) => {
      setGroups(prev => {
        if (prev.some(g => sameId(g._id, newGroup._id))) return prev;
        return [newGroup, ...prev];
      });
      toast.success(`Added to group: ${newGroup.name}`, { icon: "👥" });
    });

    // Group activity ping (delivered to every member in real time)
    socket.on("group_activity", ({ groupId, lastMessage, senderId }) => {
      const activeGroup = selectedGroupRef.current;
      const isViewingThisGroup = activeGroup && sameId(activeGroup._id, groupId);
      const isSentByMe = senderId && sameId(senderId, currentUserIdRef.current);

      setGroups(prev => prev.map(g => {
        if (!sameId(g._id, groupId)) return g;
        const shouldIncrement = !isViewingThisGroup && !isSentByMe;
        return {
          ...g,
          lastMessage: lastMessage || g.lastMessage,
          unreadCount: shouldIncrement ? (g.unreadCount || 0) + 1 : (isViewingThisGroup ? 0 : (g.unreadCount || 0)),
        };
      }));
      window.dispatchEvent(new Event("chatUnreadUpdated"));
    });

    // Group deleted
    socket.on("group_deleted", ({ groupId }) => {
      setGroups(prev => prev.filter(g => !sameId(g._id, groupId)));
      if (selectedGroupRef.current && sameId(selectedGroupRef.current._id, groupId)) {
        setSelectedGroup(null);
      }
      toast("Group was deleted", { icon: "ℹ️" });
    });

    // Group updated (e.g. new members added)
    socket.on("group_updated", (updatedGroup) => {
      setGroups(prev => prev.map(g => sameId(g._id, updatedGroup._id) ? updatedGroup : g));
      if (selectedGroupRef.current && sameId(selectedGroupRef.current._id, updatedGroup._id)) {
        setSelectedGroup(updatedGroup);
      }
    });

    // Group chat cleared
    socket.on("group_chat_cleared", ({ groupId }) => {
      const grp = selectedGroupRef.current;
      if (grp && sameId(grp._id, groupId)) {
        setDirectMessages([]);
      }
      setGroups(prev => prev.map(g => sameId(g._id, groupId) ? { ...g, lastMessage: { text: "", senderName: "", timestamp: null }, unreadCount: 0 } : g));
    });

    // Direct chat cleared (only clear for the user who initiated the clear)
    socket.on("chat_cleared", ({ clearedBy, peerId }) => {
      if (sameId(clearedBy, currentUserIdRef.current)) {
        const activePeer = selectedChatUserRef.current;
        if (activePeer && sameId(activePeer._id, peerId)) {
          setDirectMessages([]);
        }
        setChatList(prev => prev.map(c => sameId(c._id, peerId) ? { ...c, lastMessage: "", lastMessageTime: null, unreadCount: 0 } : c));
      }
    });

    // Read Receipts
    socket.on("messages_read", () => {
      setDirectMessages(prev => prev.map(m => {
        const sid = m.sender?._id ?? m.sender;
        return sameId(sid, currentUserIdRef.current) ? { ...m, isRead: true } : m;
      }));
    });

    // Message Edited
    socket.on("message_edited", ({ messageId, newMessage }) => {
      setDirectMessages(prev => prev.map(m =>
        sameId(m._id, messageId) ? { ...m, message: newMessage, isEdited: true } : m
      ));
    });

    // Message Deleted (handles Delete for me vs Delete for everyone)
    socket.on("message_deleted", ({ messageId, deleteType, deletedForMe, deletedForEveryone, deletedBy }) => {
      setDirectMessages(prev => prev.map(m => {
        if (!sameId(m._id, messageId)) return m;
        if (deleteType === "for_me" || deletedForMe) {
          return {
            ...m,
            deletedForMe: true,
            message: "Deleted for you",
            attachments: [],
            reactions: [],
          };
        }
        if (deleteType === "for_everyone" || deletedForEveryone) {
          const isMe = sameId(deletedBy?.userId, currentUserIdRef.current);
          return {
            ...m,
            deletedForEveryone: true,
            deletedBy,
            message: isMe ? "Deleted for everyone" : `${deletedBy?.userName || "This person"} deleted this message`,
            attachments: [],
            reactions: [],
          };
        }
        return {
          ...m,
          deletedForEveryone: true,
          message: "This message was deleted",
          attachments: [],
          reactions: [],
        };
      }));
    });

    // Message Reaction toggled
    socket.on("message_reacted", ({ messageId, reactions }) => {
      setDirectMessages(prev => prev.map(m =>
        sameId(m._id, messageId) ? { ...m, reactions } : m
      ));
    });

    // 1-on-1 Typing
    socket.on("user_typing", ({ userId }) => {
      const peer = selectedChatUserRef.current;
      if (peer && sameId(userId, peer._id)) {
        setTypingUsers(prev => new Set([...prev, userId?.toString()]));
      }
    });

    socket.on("user_stopped_typing", ({ userId }) => {
      setTypingUsers(prev => {
        const s = new Set(prev);
        s.delete(userId?.toString());
        return s;
      });
    });

    // Group Typing
    socket.on("group_user_typing", ({ groupId, userId, userName }) => {
      const grp = selectedGroupRef.current;
      if (grp && sameId(grp._id, groupId) && !sameId(userId, currentUserIdRef.current)) {
        setGroupTypingUsers(prev => ({ ...prev, [userId]: userName }));
      }
    });

    socket.on("group_user_stopped_typing", ({ groupId, userId }) => {
      const grp = selectedGroupRef.current;
      if (grp && sameId(grp._id, groupId)) {
        setGroupTypingUsers(prev => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUserId, playNotificationSound]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isChatLoading && !isSwitchingUser && directChatEndRef.current) {
      setTimeout(() => directChatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [directMessages, isChatLoading, isSwitchingUser]);

  // ── Typing Handlers ──────────────────────────────────────────────────────
  const handleTyping = useCallback((text) => {
    setDirectMsgText(text);
    if (!socketRef.current) return;

    if (selectedChatUser) {
      if (text.trim()) {
        socketRef.current.emit("typing_start", {
          receiverId: selectedChatUser._id,
          senderId: currentUserId,
          senderName: user?.name,
        });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          socketRef.current?.emit("typing_stop", {
            receiverId: selectedChatUser._id,
            senderId: currentUserId,
          });
        }, 3000);
      } else {
        clearTimeout(typingTimeoutRef.current);
        socketRef.current.emit("typing_stop", {
          receiverId: selectedChatUser._id,
          senderId: currentUserId,
        });
      }
    } else if (selectedGroup) {
      if (text.trim()) {
        socketRef.current.emit("group_typing_start", {
          groupId: selectedGroup._id,
          senderId: currentUserId,
          senderName: user?.name,
        });
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          socketRef.current?.emit("group_typing_stop", {
            groupId: selectedGroup._id,
            senderId: currentUserId,
          });
        }, 3000);
      } else {
        clearTimeout(typingTimeoutRef.current);
        socketRef.current.emit("group_typing_stop", {
          groupId: selectedGroup._id,
          senderId: currentUserId,
        });
      }
    }
  }, [selectedChatUser, selectedGroup, currentUserId, user]);

  // ── Data Fetchers ────────────────────────────────────────────────────────
  const fetchContacts = useCallback(async () => {
    try {
      const { data } = await api.get("/api/chat/contacts");
      if (Array.isArray(data)) {
        setContacts(data.filter(c => !sameId(c._id, currentUserId)));
        const onlineIds = data.filter(c => c.isOnline).map(c => c._id.toString());
        if (onlineIds.length > 0) {
          setOnlineUserIds(prev => new Set([...prev, ...onlineIds]));
        }
      } else {
        const fallback = await getEmployees();
        setContacts(fallback.filter(e => e.isActive !== false && !sameId(e._id, currentUserId)));
      }
    } catch (err) {
      console.error("fetchContacts error:", err);
      try {
        const fallback = await getEmployees();
        setContacts(fallback.filter(e => e.isActive !== false && !sameId(e._id, currentUserId)));
      } catch (_) {}
    }
  }, [currentUserId]);

  const fetchChatList = useCallback(async () => {
    try {
      const { data } = await api.get("/api/chat/users");
      setChatList(data || []);
      setTotalUnreadCount(data.reduce((a, c) => a + (c.unreadCount || 0), 0));
    } catch (err) {
      console.error("fetchChatList:", err);
    } finally {
      setIsListLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await api.get("/api/chat/groups");
      if (Array.isArray(data)) {
        setGroups(data);
      }
    } catch (err) {
      console.error("fetchGroups error:", err);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
    fetchChatList();
    fetchGroups();
  }, [fetchContacts, fetchChatList, fetchGroups]);

  const markMessagesAsRead = useCallback(async (senderId) => {
    if (!senderId) return;
    try {
      await api.put(`/api/chat/read/${senderId}`);
      setChatList(prev => prev.map(u => sameId(u._id, senderId) ? { ...u, unreadCount: 0 } : u));
      setTotalUnreadCount(prev => {
        const u = chatListRef.current.find(x => sameId(x._id, senderId));
        return u ? Math.max(0, prev - (u.unreadCount || 0)) : prev;
      });
      window.dispatchEvent(new Event("chatUnreadUpdated"));
    } catch (err) {
      console.error("markMessagesAsRead:", err);
    }
  }, []);

  const fetchDirectMessages = useCallback(async (peer, silent = true) => {
    if (!peer) return;
    if (!silent) { setIsChatLoading(true); setDirectMessages([]); }
    try {
      const { data } = await api.get(`/api/chat/history/${peer._id}`);
      if (sameId(selectedChatUserRef.current?._id, peer._id)) {
        setDirectMessages(data || []);
      }
    } catch (err) {
      console.error("fetchDirectMessages:", err);
      if (!silent) toast.error("Failed to load messages");
    } finally {
      setIsChatLoading(false);
    }
  }, []);

  const fetchGroupMessages = useCallback(async (group, silent = true) => {
    if (!group) return;
    if (!silent) { setIsChatLoading(true); setDirectMessages([]); }
    try {
      const { data } = await api.get(`/api/chat/groups/${group._id}/history`);
      if (sameId(selectedGroupRef.current?._id, group._id)) {
        const unique = [];
        const seenIds = new Set();
        const seenSystem = new Set();
        for (const m of (data || [])) {
          const idStr = m._id?.toString();
          if (idStr && seenIds.has(idStr)) continue;
          if (idStr) seenIds.add(idStr);
          if (m.isSystem || m.messageType === "system" || m.senderName === "System") {
            const sKey = `${(m.message || "").trim()}_${m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 16) : ""}`;
            if (seenSystem.has(sKey)) continue;
            seenSystem.add(sKey);
          }
          unique.push(m);
        }
        setDirectMessages(unique);
      }
      setGroups(prev => prev.map(g => sameId(g._id, group._id) ? { ...g, unreadCount: 0 } : g));
      api.put(`/api/chat/groups/${group._id}/read`).catch(() => {});
      window.dispatchEvent(new Event("chatUnreadUpdated"));
    } catch (err) {
      console.error("fetchGroupMessages:", err);
      if (!silent) toast.error("Failed to load group messages");
    } finally {
      setIsChatLoading(false);
    }
  }, []);

  // ── Switch To Direct Chat ────────────────────────────────────────────────
  const handleUserSwitch = useCallback(async (emp) => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    if (sameId(selectedChatUserRef.current?._id, emp._id) || isSwitchingUser) return;

    if (selectedGroupRef.current && socketRef.current) {
      socketRef.current.emit("leave_group", selectedGroupRef.current._id);
    }

    setIsSwitchingUser(true);
    setSelectedGroup(null);
    const contactMatch = contacts.find(c => sameId(c._id, emp._id));
    const effectiveLastSeen =
      emp.lastSeen ||
      contactMatch?.lastSeen ||
      emp.lastMessageTime ||
      emp.updatedAt;

    const mergedUser = {
      ...(contactMatch || {}),
      ...emp,
      lastSeen: effectiveLastSeen,
    };
    setSelectedChatUser(mergedUser);
    setDirectSearchTerm("");
    setEditingMessageId(null);
    setDirectMsgText("");
    setAttachedFiles([]);
    setOpenMenuId(null);
    setTypingUsers(new Set());
    setDirectMessages([]);

    await markMessagesAsRead(emp._id);
    await fetchDirectMessages(emp, false);

    setChatList(prev => {
      if (prev.find(u => sameId(u._id, emp._id))) return prev;
      return [emp, ...prev];
    });

    setIsSwitchingUser(false);
  }, [isSwitchingUser, markMessagesAsRead, fetchDirectMessages]);

  // ── Switch To Group Chat ─────────────────────────────────────────────────
  const handleGroupSwitch = useCallback(async (group) => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    if (sameId(selectedGroupRef.current?._id, group._id) || isSwitchingUser) return;

    if (selectedGroupRef.current && socketRef.current) {
      socketRef.current.emit("leave_group", selectedGroupRef.current._id);
    }

    setIsSwitchingUser(true);
    setSelectedChatUser(null);
    setSelectedGroup(group);
    setGroups(prev => prev.map(g =>
      sameId(g._id, group._id) ? { ...g, unreadCount: 0 } : g
    ));
    setDirectSearchTerm("");
    setEditingMessageId(null);
    setDirectMsgText("");
    setAttachedFiles([]);
    setOpenMenuId(null);
    setGroupTypingUsers({});
    setDirectMessages([]);

    if (socketRef.current) {
      socketRef.current.emit("join_group", group._id);
    }

    await fetchGroupMessages(group, false);
    setIsSwitchingUser(false);
  }, [isSwitchingUser, fetchGroupMessages]);

  // ── Create Group Action ──────────────────────────────────────────────────
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error("Please enter a group name");
      return;
    }
    if (newGroupMemberIds.size === 0) {
      toast.error("Please select at least one colleague");
      return;
    }

    setCreatingGroup(true);
    try {
      const { data } = await api.post("/api/chat/groups", {
        name: newGroupName.trim(),
        description: newGroupDescription.trim(),
        memberIds: Array.from(newGroupMemberIds),
      });

      setGroups(prev => {
        if (prev.some(g => sameId(g._id, data._id))) return prev;
        return [data, ...prev];
      });
      setIsGroupModalOpen(false);
      setNewGroupName("");
      setNewGroupDescription("");
      setNewGroupMemberIds(new Set());
      toast.success("Group created successfully!", { icon: "🎉" });
      handleGroupSwitch(data);
    } catch (err) {
      console.error("handleCreateGroup error:", err);
      toast.error(err.response?.data?.error || "Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  };

  const isSelectedGroupAdmin = useMemo(() => {
    if (!selectedGroup || !currentUserId) return false;
    if (sameId(selectedGroup.createdBy, currentUserId)) return true;
    if (Array.isArray(selectedGroup.members)) {
      return selectedGroup.members.some(
        m => sameId(m.userId?._id || m.userId, currentUserId) && m.role === "admin"
      );
    }
    return false;
  }, [selectedGroup, currentUserId]);

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm("Are you sure you want to delete this group?")) return;
    try {
      await api.delete(`/api/chat/groups/${groupId}`);
      setGroups(prev => prev.filter(g => !sameId(g._id, groupId)));
      if (selectedGroup && sameId(selectedGroup._id, groupId)) {
        setSelectedGroup(null);
      }
      window.dispatchEvent(new Event("chatUnreadUpdated"));
      toast.success("Group deleted successfully");
    } catch (err) {
      console.error("handleDeleteGroup error:", err);
      toast.error(err.response?.data?.error || "Failed to delete group");
    }
  };

  const handleLeaveGroup = async (groupId) => {
    if (!window.confirm("Are you sure you want to leave this group?")) return;
    try {
      try {
        await api.post(`/api/chat/groups/${groupId}/leave`);
      } catch (postErr) {
        await api.delete(`/api/chat/groups/${groupId}/leave`);
      }
      setGroups(prev => prev.filter(g => !sameId(g._id, groupId)));
      if (selectedGroup && sameId(selectedGroup._id, groupId)) {
        setSelectedGroup(null);
        setDirectMessages([]);
      }
      window.dispatchEvent(new Event("chatUnreadUpdated"));
      toast.success("You have left the group");
    } catch (err) {
      console.error("handleLeaveGroup error:", err);
      toast.error(err.response?.data?.error || "Failed to leave group");
    }
  };

  const handleClearDirectChat = async () => {
    if (!selectedChatUser) return;
    if (!window.confirm(`Are you sure you want to clear your chat history with ${selectedChatUser.name}?`)) return;
    try {
      try {
        await api.delete(`/api/chat/history/${selectedChatUser._id}/clear`);
      } catch (delErr) {
        // Fallback to POST in case DELETE route or proxy is blocked
        await api.post(`/api/chat/history/${selectedChatUser._id}/clear`);
      }
      setDirectMessages([]);
      setChatList(prev => prev.map(c => sameId(c._id, selectedChatUser._id) ? { ...c, lastMessage: "", lastMessageTime: null, unreadCount: 0 } : c));
      window.dispatchEvent(new Event("chatUnreadUpdated"));
      toast.success("Chat cleared for you");
    } catch (err) {
      console.error("Clear chat error:", err);
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to clear chat";
      toast.error(msg);
    }
  };

  const handleClearGroupChat = async () => {
    if (!selectedGroup) return;
    if (!window.confirm(`Are you sure you want to clear your chat history for "${selectedGroup.name}"?`)) return;
    try {
      try {
        await api.delete(`/api/chat/groups/${selectedGroup._id}/clear`);
      } catch (delErr) {
        // Fallback to POST in case DELETE route or proxy is blocked
        await api.post(`/api/chat/groups/${selectedGroup._id}/clear`);
      }
      setDirectMessages([]);
      setGroups(prev => prev.map(g => sameId(g._id, selectedGroup._id) ? { ...g, lastMessage: { text: "", senderName: "", timestamp: null }, unreadCount: 0 } : g));
      window.dispatchEvent(new Event("chatUnreadUpdated"));
      toast.success("Chat cleared for you");
    } catch (err) {
      console.error("Clear group chat error:", err);
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to clear group chat";
      toast.error(msg);
    }
  };

  const handleAddMembers = async () => {
    if (!selectedGroup) return;
    if (addMemberIds.size === 0) {
      toast.error("Please select at least one colleague to add");
      return;
    }
    setAddingMembers(true);
    try {
      const { data } = await api.post(`/api/chat/groups/${selectedGroup._id}/members`, {
        memberIds: Array.from(addMemberIds),
      });
      const updatedGroup = data.group;
      setSelectedGroup(updatedGroup);
      setGroups(prev => prev.map(g => sameId(g._id, updatedGroup._id) ? updatedGroup : g));
      setIsAddMemberModalOpen(false);
      setAddMemberIds(new Set());
      setAddMemberSearchTerm("");
      toast.success("Colleagues added to group!", { icon: "🎉" });
    } catch (err) {
      console.error("Add members error:", err);
      toast.error(err.response?.data?.error || "Failed to add members");
    } finally {
      setAddingMembers(false);
    }
  };

  const toggleAddMemberSelection = (id) => {
    setAddMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMemberSelection = (id) => {
    setNewGroupMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── File Upload Handler ──────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("File size cannot exceed 25MB");
      return;
    }

    setIsUploadingFile(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data } = await api.post("/api/chat/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setAttachedFiles(prev => [...prev, data]);
      toast.success("File attached", { icon: "📎" });
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(err.response?.data?.error || "Failed to upload file");
    } finally {
      setIsUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = async (att, attachmentKey) => {
    if (!att?.url || downloadingAttachmentKey === attachmentKey) return;
    setDownloadingAttachmentKey(attachmentKey);
    try {
      const fileName = att.fileName || "document";
      const response = await api.get("/api/chat/download", {
        params: { url: att.url, fileName },
        responseType: "blob",
      });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      let errMsg = "Failed to download file";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          errMsg = parsed.error || parsed.message || errMsg;
        } catch {
          // ignore non-JSON blob errors
        }
      } else if (err.response?.data?.error || err.response?.data?.message) {
        errMsg = err.response.data.error || err.response.data.message;
      }
      console.error("Download attachment error:", err.response?.status, errMsg, err);
      toast.error(errMsg);
    } finally {
      setDownloadingAttachmentKey(null);
    }
  };

  const removeAttachment = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // ── Send Message ─────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    const hasText = !!directMsgText.trim();
    const hasAttachments = attachedFiles.length > 0;

    if ((!hasText && !hasAttachments) || (!selectedChatUser && !selectedGroup) || isSendingRef.current || sendingMessage) return;

    // Synchronous lock to prevent any rapid repeat/double enter
    isSendingRef.current = true;
    const messageToSend = directMsgText.trim();
    const attachmentsToSend = [...attachedFiles];

    setDirectMsgText("");
    setAttachedFiles([]);
    setShowEmojiPicker(false);
    setSendingMessage(true);

    const tempId = `temp_${Date.now()}`;
    const optimisticMsg = {
      _id: tempId,
      message: messageToSend,
      attachments: attachmentsToSend,
      sender: { _id: currentUserId, name: user?.name },
      createdAt: new Date().toISOString(),
      isPending: true,
      isSending: true,
      isRead: false,
    };

    if (selectedChatUser) {
      optimisticMsg.receiver = selectedChatUser._id;
      socketRef.current?.emit("typing_stop", {
        receiverId: selectedChatUser._id,
        senderId: currentUserId,
      });
      setDirectMessages(prev => [...prev, optimisticMsg]);

      setChatList(prev => {
        const filtered = prev.filter(u => !sameId(u._id, selectedChatUser._id));
        return [{
          ...selectedChatUser,
          lastMessage: messageToSend || (attachmentsToSend.length ? "📎 Attachment" : ""),
          lastMessageTime: new Date().toISOString(),
        }, ...filtered];
      });

      try {
        if (editingMessageId) {
          await api.put(`/api/chat/${editingMessageId}`, { message: messageToSend });
          setEditingMessageId(null);
          setDirectMessages(prev => prev.filter(m => m._id !== tempId));
          await fetchDirectMessages(selectedChatUser, true);
        } else {
          const { data } = await api.post("/api/chat/send", {
            receiverId: selectedChatUser._id,
            message: messageToSend,
            attachments: attachmentsToSend,
          });
          setDirectMessages(prev => {
            const alreadyExists = prev.some(m => sameId(m._id, data._id));
            if (alreadyExists) {
              return prev.filter(m => m._id !== tempId);
            }
            return prev.map(m => m._id === tempId ? { ...data, isSending: false, isPending: false } : m);
          });
        }
      } catch (err) {
        console.error("handleSendMessage error:", err);
        toast.error("Failed to send message");
        setDirectMessages(prev => prev.filter(m => m._id !== tempId));
      } finally {
        setSendingMessage(false);
        setTimeout(() => {
          isSendingRef.current = false;
        }, 300);
      }
    } else if (selectedGroup) {
      optimisticMsg.groupId = selectedGroup._id;
      socketRef.current?.emit("group_typing_stop", {
        groupId: selectedGroup._id,
        senderId: currentUserId,
      });
      setDirectMessages(prev => [...prev, optimisticMsg]);

      setGroups(prev => prev.map(g =>
        sameId(g._id, selectedGroup._id)
          ? {
              ...g,
              lastMessage: {
                text: messageToSend || (attachmentsToSend.length ? "📎 Attachment" : ""),
                senderName: user?.name || "You",
                timestamp: new Date().toISOString(),
              },
            }
          : g
      ));

      try {
        const { data } = await api.post(`/api/chat/groups/${selectedGroup._id}/send`, {
          message: messageToSend,
          attachments: attachmentsToSend,
        });
        setDirectMessages(prev => {
          const alreadyExists = prev.some(m => sameId(m._id, data._id));
          if (alreadyExists) {
            return prev.filter(m => m._id !== tempId);
          }
          return prev.map(m => m._id === tempId ? { ...data, isSending: false, isPending: false } : m);
        });
      } catch (err) {
        console.error("handleGroupSendMessage error:", err);
        toast.error("Failed to send message");
        setDirectMessages(prev => prev.filter(m => m._id !== tempId));
      } finally {
        setSendingMessage(false);
        setTimeout(() => {
          isSendingRef.current = false;
        }, 300);
      }
    }
  }, [
    directMsgText, attachedFiles, selectedChatUser, selectedGroup,
    sendingMessage, editingMessageId, currentUserId, user, fetchDirectMessages
  ]);

  // ── Reaction Toggle ──────────────────────────────────────────────────────
  const handleToggleReaction = async (messageId, emoji) => {
    try {
      // Optimistic reaction update
      setDirectMessages(prev => prev.map(m => {
        if (!sameId(m._id, messageId)) return m;
        const currentReactions = m.reactions || [];
        const existingIdx = currentReactions.findIndex(
          r => sameId(r.userId, currentUserId) && r.emoji === emoji
        );
        let updated;
        if (existingIdx > -1) {
          updated = currentReactions.filter((_, i) => i !== existingIdx);
        } else {
          updated = [...currentReactions, { userId: currentUserId, userName: user?.name, emoji }];
        }
        return { ...m, reactions: updated };
      }));

      await api.post(`/api/chat/messages/${messageId}/react`, { emoji });
    } catch (err) {
      console.error("Reaction error:", err);
    }
  };

  const startEditing = useCallback((msg) => {
    setEditingMessageId(msg._id);
    setDirectMsgText(msg.message);
    setOpenMenuId(null);
  }, []);

  const confirmDeleteMessage = useCallback((msg) => {
    setDeleteTargetMsg(msg);
    setOpenMenuId(null);
  }, []);

  const executeDeleteMessage = useCallback(async (msgId, deleteType = "for_everyone") => {
    setDeleteTargetMsg(null);

    // Optimistic UI update
    setDirectMessages((prev) =>
      prev.map((m) => {
        if (!sameId(m._id, msgId)) return m;
        if (deleteType === "for_me") {
          return {
            ...m,
            deletedForMe: true,
            message: "Deleted for you",
            attachments: [],
            reactions: [],
          };
        }
        return {
          ...m,
          deletedForEveryone: true,
          deletedBy: { userId: currentUserId, userName: user?.name || "You" },
          message: "Deleted for everyone",
          attachments: [],
          reactions: [],
        };
      })
    );

    try {
      try {
        await api.delete(`/api/chat/${msgId}?deleteType=${deleteType}`);
      } catch (delErr) {
        await api.post(`/api/chat/${msgId}/delete`, { deleteType });
      }
      toast.success(deleteType === "for_me" ? "Deleted for you" : "Deleted for everyone");
    } catch (err) {
      console.error("Delete message error:", err);
      toast.error(err.response?.data?.error || "Failed to delete message");
    }
  }, [currentUserId, user]);

  const handleEmojiClick = (emojiData) => {
    setDirectMsgText(prev => prev + emojiData.emoji);
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    if (e.key === "Escape") {
      setEditingMessageId(null);
      setDirectMsgText("");
      setShowEmojiPicker(false);
    }
  }, [handleSendMessage]);

  useEffect(() => {
    const close = () => setOpenMenuId(null);
    if (openMenuId) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── Date Grouping ────────────────────────────────────────────────────────
  const formatMessageDate = (d) => {
    const date = new Date(d);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const groupedMessages = useMemo(() => {
    const g = {};
    const seenIds = new Set();
    directMessages.forEach(m => {
      const mid = m._id?.toString();
      if (mid && !mid.startsWith("temp_")) {
        if (seenIds.has(mid)) return;
        seenIds.add(mid);
      }
      const k = formatMessageDate(m.createdAt);
      if (!g[k]) g[k] = [];
      g[k].push(m);
    });
    return g;
  }, [directMessages]);

  // ── Filtered Contacts ────────────────────────────────────────────────────
  const displayList = useMemo(() => {
    const term = directSearchTerm.toLowerCase();
    let pool = [];

    if (activeTab === "all") {
      const chatUserIds = new Set(chatList.map(c => c._id?.toString()));
      const remainingContacts = contacts.filter(c => !chatUserIds.has(c._id?.toString()));
      pool = [...chatList, ...remainingContacts];
    } else if (activeTab === "management") {
      pool = contacts.filter(c => c.role === "manager" || c.role === "admin");
    } else if (activeTab === "colleagues") {
      pool = contacts.filter(c => c.role === "employee");
    }

    if (term) {
      pool = pool.filter(e =>
        e.name?.toLowerCase().includes(term) ||
        e.employeeId?.toLowerCase().includes(term) ||
        e.department?.toLowerCase().includes(term) ||
        e.positionName?.toLowerCase().includes(term)
      );
    }

    return [...pool].sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0));
  }, [directSearchTerm, activeTab, chatList, contacts]);

  // ── Filtered Groups ──────────────────────────────────────────────────────
  const displayGroups = useMemo(() => {
    const seen = new Set();
    const uniqueGroups = groups.filter(g => {
      const id = g._id ? g._id.toString() : null;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const term = directSearchTerm.toLowerCase();
    if (!term) return uniqueGroups;
    return uniqueGroups.filter(g =>
      g.name?.toLowerCase().includes(term) ||
      g.description?.toLowerCase().includes(term)
    );
  }, [groups, directSearchTerm]);

  // ── Filtered Modal Contacts for New Group ────────────────────────────────
  const modalContacts = useMemo(() => {
    const term = groupSearchTerm.toLowerCase();
    if (!term) return contacts;
    return contacts.filter(c =>
      c.name?.toLowerCase().includes(term) ||
      c.employeeId?.toLowerCase().includes(term) ||
      c.department?.toLowerCase().includes(term)
    );
  }, [contacts, groupSearchTerm]);

  // ── Filtered Contacts for Adding to Existing Group ────────────────────────
  const addMemberFilteredContacts = useMemo(() => {
    if (!selectedGroup) return [];
    const existingMemberIds = new Set(
      (selectedGroup.members || []).map(m => (m.userId?._id || m.userId)?.toString())
    );
    const nonMembers = contacts.filter(c => !existingMemberIds.has(c._id?.toString()));
    const term = addMemberSearchTerm.toLowerCase();
    if (!term) return nonMembers;
    return nonMembers.filter(c =>
      c.name?.toLowerCase().includes(term) ||
      c.employeeId?.toLowerCase().includes(term) ||
      c.department?.toLowerCase().includes(term)
    );
  }, [contacts, selectedGroup, addMemberSearchTerm]);

  // Total unread for groups
  const totalGroupUnread = useMemo(() => {
    return groups.reduce((acc, g) => acc + (g.unreadCount || 0), 0);
  }, [groups]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex w-full h-full min-h-[580px] bg-white font-sans overflow-hidden rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-sm relative z-20">
      <Toaster position="top-right" toastOptions={{ style: { background: "#1e293b", color: "#fff", fontSize: "12px", padding: "8px 16px" } }} />

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <div className={`${isSidebarOpen ? "w-full md:w-80 flex" : "hidden md:flex md:w-80"} flex-col border-r border-slate-200 bg-white h-full z-50 transition-all duration-300 overflow-hidden`}>
        {/* Header with Title and Mode Switcher */}
        <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex-shrink-0 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shadow-lg backdrop-blur-sm">
                <FaComments className="text-white" size={18} />
              </div>
              <div>
                <h2 className="font-black text-lg tracking-tight">ChatHub</h2>
                <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${socketConnected ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-300" : "bg-slate-400"}`} />
                  {socketConnected ? "Connected" : "Syncing"}
                </p>
              </div>
            </div>

            {/* Top Create Group shortcut if in groups mode */}
            {chatMode === "groups" && (
              <button
                onClick={() => setIsGroupModalOpen(true)}
                className="bg-white/20 hover:bg-white/30 text-white p-2 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm"
                title="Create New Group"
              >
                <FaPlus size={12} />
                <span>New</span>
              </button>
            )}
          </div>

          {/* Primary Mode Toggle: Direct Messages vs Teams/Groups */}
          <div className="grid grid-cols-2 gap-1 bg-black/20 p-1 rounded-xl text-center mb-3">
            <button
              onClick={() => setChatMode("direct")}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                chatMode === "direct" ? "bg-white text-blue-700 shadow-md" : "text-blue-100 hover:text-white"
              }`}
            >
              <FaComments size={13} />
              <span>Direct</span>
              {totalUnreadCount > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                  {totalUnreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setChatMode("groups")}
              className={`py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                chatMode === "groups" ? "bg-white text-blue-700 shadow-md" : "text-blue-100 hover:text-white"
              }`}
            >
              <FaUserFriends size={13} />
              <span>Teams</span>
              {totalGroupUnread > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                  {totalGroupUnread}
                </span>
              )}
            </button>
          </div>

          {/* Search bar */}
          <div className="relative group mb-2">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-200 group-focus-within:text-white transition-colors" size={13} />
            <input
              className="w-full pl-9 pr-4 py-2 bg-white/10 border border-white/20 rounded-xl text-xs outline-none placeholder:text-blue-100 text-white focus:bg-white/15 focus:border-white/30 transition-all"
              placeholder={chatMode === "direct" ? "Search colleagues..." : "Search teams & groups..."}
              value={directSearchTerm}
              onChange={e => setDirectSearchTerm(e.target.value)}
            />
            {directSearchTerm && (
              <button onClick={() => setDirectSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-200 hover:text-white">
                <FaTimes size={11} />
              </button>
            )}
          </div>

          {/* Secondary Sub-tabs for Direct Mode */}
          {chatMode === "direct" && (
            <div className="grid grid-cols-3 gap-1 bg-white/15 p-1 rounded-xl text-center">
              <button
                onClick={() => setActiveTab("all")}
                className={`py-1 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === "all" ? "bg-white text-blue-700 shadow-sm" : "text-blue-100 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab("management")}
                className={`py-1 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === "management" ? "bg-white text-blue-700 shadow-sm" : "text-blue-100 hover:text-white"
                }`}
              >
                Manager/Admin
              </button>
              <button
                onClick={() => setActiveTab("colleagues")}
                className={`py-1 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === "colleagues" ? "bg-white text-blue-700 shadow-sm" : "text-blue-100 hover:text-white"
                }`}
              >
                Staff
              </button>
            </div>
          )}
        </div>

        {/* List Body */}
        <div ref={sidebarContainerRef} className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0 }}>
          <div className="px-2.5 py-2">
            {chatMode === "direct" ? (
              // ── DIRECT CHATS LIST ──
              isListLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 py-10">
                  <FaSpinner className="animate-spin text-blue-600" size={20} />
                  <span className="text-xs font-semibold uppercase tracking-widest">Loading contacts...</span>
                </div>
              ) : displayList.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-slate-400 p-4 text-center py-10">
                  <FaUsers className="text-slate-300 mb-2" size={32} />
                  <p className="text-sm font-bold text-slate-600">
                    {directSearchTerm ? "No colleagues found" : "No conversations yet"}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {directSearchTerm ? "Try a different name" : "Search to connect with anyone in your company"}
                  </p>
                </div>
              ) : (
                displayList.map(emp => {
                  const isActive = selectedChatUser && sameId(selectedChatUser._id, emp._id);
                  const isOnline = onlineUserIds.has(emp._id?.toString());

                  return (
                    <div
                      key={emp._id}
                      onClick={() => handleUserSwitch(emp)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer mb-1.5 transition-all duration-200 ${
                        isActive
                          ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200"
                          : "hover:bg-slate-50 border border-transparent hover:border-slate-100"
                      } ${isSwitchingUser ? "pointer-events-none opacity-70" : ""}`}
                    >
                      {/* Avatar with WhatsApp Online Badge */}
                      <div className="relative flex-shrink-0">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm ${
                            isActive
                              ? "bg-white/20 border-2 border-white/30 text-white"
                              : "bg-gradient-to-tr from-blue-500 to-indigo-600 text-white shadow-sm"
                          }`}
                        >
                          {emp.name?.charAt(0)?.toUpperCase()}
                        </div>
                        {/* Glowing Presence Dot */}
                        {isOnline ? (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm ring-1 ring-emerald-400"
                            title="Online"
                          />
                        ) : (
                          <span
                            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-slate-300 border-2 border-white rounded-full shadow-xs"
                            title="Offline"
                          />
                        )}
                      </div>

                      {/* Content Info */}
                      <div className="flex-1 overflow-hidden min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <p className={`text-sm font-bold truncate ${isActive ? "text-white" : "text-slate-800"}`}>
                              {emp.name}
                            </p>
                            {emp.role === "admin" && (
                              <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase ${isActive ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700"}`}>
                                Admin
                              </span>
                            )}
                            {emp.role === "manager" && (
                              <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase ${isActive ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"}`}>
                                Manager
                              </span>
                            )}
                            {emp.role === "employee" && (
                              <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase ${isActive ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700"}`}>
                                Staff
                              </span>
                            )}
                          </div>
                          <span className={`text-[10px] font-medium flex-shrink-0 ml-1 ${isActive ? "text-blue-100" : "text-slate-400"}`}>
                            {emp.lastMessageTime ? new Date(emp.lastMessageTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                        <p className={`text-xs truncate font-medium ${isActive ? "text-blue-100 opacity-90" : "text-slate-500"}`}>
                          {emp.lastMessage || emp.positionName || emp.department || emp.employeeId || "Start connecting"}
                        </p>
                      </div>

                      {/* Unread Pill */}
                      {(emp.unreadCount || 0) > 0 && !isActive && (
                        <span className="bg-emerald-500 text-white text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0 shadow-sm">
                          {emp.unreadCount > 9 ? "9+" : emp.unreadCount}
                        </span>
                      )}
                    </div>
                  );
                })
              )
            ) : (
              // ── GROUPS (TEAMS) LIST ──
              <div className="space-y-1.5">
                <button
                  onClick={() => setIsGroupModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-2xl font-bold text-xs transition-all shadow-xs mb-3"
                >
                  <FaPlus size={12} />
                  <span>Create New Team / Group</span>
                </button>

                {displayGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-slate-400 p-4 text-center py-10">
                    <FaUserFriends className="text-slate-300 mb-2" size={32} />
                    <p className="text-sm font-bold text-slate-600">No teams or groups yet</p>
                    <p className="text-xs text-slate-400 mt-1">Create a group to collaborate with your team</p>
                  </div>
                ) : (
                  displayGroups.map(grp => {
                    const isActive = selectedGroup && sameId(selectedGroup._id, grp._id);
                    return (
                      <div
                        key={grp._id}
                        onClick={() => handleGroupSwitch(grp)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer mb-1.5 transition-all duration-200 ${
                          isActive
                            ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200"
                            : "hover:bg-slate-50 border border-transparent hover:border-slate-100"
                        } ${isSwitchingUser ? "pointer-events-none opacity-70" : ""}`}
                      >
                        {/* Group Avatar */}
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                            isActive
                              ? "bg-white/20 border-2 border-white/30 text-white"
                              : "bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-sm"
                          }`}
                        >
                          {grp.name?.charAt(0)?.toUpperCase()}
                        </div>

                        {/* Content Info */}
                        <div className="flex-1 overflow-hidden min-w-0">
                          <div className="flex justify-between items-center mb-0.5">
                            <div className="flex items-center gap-1.5 truncate">
                              <p className={`text-sm font-bold truncate ${isActive ? "text-white" : "text-slate-800"}`}>
                                {grp.name}
                              </p>
                              <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase ${isActive ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"}`}>
                                Group
                              </span>
                            </div>
                            <span className={`text-[10px] font-medium flex-shrink-0 ml-1 ${isActive ? "text-indigo-100" : "text-slate-400"}`}>
                              {grp.lastMessage?.timestamp ? new Date(grp.lastMessage.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                            </span>
                          </div>
                          <p className={`text-xs truncate font-medium ${isActive ? "text-indigo-100 opacity-90" : "text-slate-500"}`}>
                            {(() => {
                              if (!grp.lastMessage?.text) return `${grp.members?.length || 0} members`;
                              const isSystemMsg = grp.lastMessage.senderName === "System" || grp.lastMessage.isSystem || grp.lastMessage.systemAction;
                              if (isSystemMsg) {
                                return formatSystemActionText(grp.lastMessage, currentUserId, user?.name);
                              }
                              const senderPrefix = grp.lastMessage.senderName ? grp.lastMessage.senderName.split(' ')[0] + ': ' : '';
                              return `${senderPrefix}${grp.lastMessage.text}`;
                            })()}
                          </p>
                        </div>

                        {/* Unread Pill */}
                        {(grp.unreadCount || 0) > 0 && !isActive && (
                          <span className="bg-emerald-500 text-white text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0 shadow-sm">
                            {grp.unreadCount > 9 ? "9+" : grp.unreadCount}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CHAT AREA ───────────────────────────────────────────────────── */}
      <div className={`${!isSidebarOpen ? "flex w-full" : "hidden md:flex flex-1"} flex-col h-full bg-slate-50 relative overflow-hidden`}>
        {selectedChatUser || selectedGroup ? (
          <>
            {/* Chat Top Header */}
            <header className="h-16 flex items-center justify-between px-4 md:px-6 border-b border-slate-200 bg-white/90 backdrop-blur-md shadow-xs z-40 flex-shrink-0">
              <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
                {/* Mobile Back Button */}
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="md:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <FaArrowLeft size={16} />
                </button>

                {selectedChatUser ? (
                  // 1-on-1 Header Avatar
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center rounded-2xl font-black text-base shadow-sm">
                      {selectedChatUser.name?.charAt(0)?.toUpperCase()}
                    </div>
                    {onlineUserIds.has(selectedChatUser._id?.toString()) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full ring-1 ring-emerald-400" />
                    )}
                  </div>
                ) : (
                  // Group Header Avatar
                  <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-indigo-600 to-purple-700 text-white flex items-center justify-center rounded-2xl font-black text-base shadow-sm flex-shrink-0">
                    {selectedGroup?.name?.charAt(0)?.toUpperCase()}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm md:text-base font-black text-slate-800 truncate leading-tight">
                      {selectedChatUser ? selectedChatUser.name : selectedGroup?.name}
                    </h3>
                    {selectedChatUser && (
                      <>
                        {selectedChatUser.role === "admin" && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-purple-100 text-purple-700">Admin</span>
                        )}
                        {selectedChatUser.role === "manager" && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-700">Manager</span>
                        )}
                        {selectedChatUser.role === "employee" && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">Staff</span>
                        )}
                      </>
                    )}
                    {selectedGroup && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-indigo-100 text-indigo-700">
                        {selectedGroup.members?.length || 0} members
                      </span>
                    )}
                  </div>

                  {/* Presence / WhatsApp-style Last Seen / Typing status */}
                  <div className="flex items-center gap-2">
                    {selectedChatUser ? (
                      typingUsers.has(selectedChatUser._id?.toString()) ? (
                        <span className="text-xs text-blue-600 font-bold tracking-wide animate-pulse">typing...</span>
                      ) : onlineUserIds.has(selectedChatUser._id?.toString()) ? (
                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Online
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-500 truncate">
                          {formatLastSeen(selectedChatUser.lastSeen || selectedChatUser.lastMessageTime || selectedChatUser.updatedAt)}
                        </span>
                      )
                    ) : (
                      Object.keys(groupTypingUsers).length > 0 ? (
                        <span className="text-xs text-indigo-600 font-bold tracking-wide animate-pulse">
                          {Object.values(groupTypingUsers).join(", ")} {Object.keys(groupTypingUsers).length === 1 ? "is" : "are"} typing...
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-500 truncate">
                          {selectedGroup?.members?.map(m => m.user?.name?.split(' ')[0] || "Member").slice(0, 4).join(", ")}
                          {(selectedGroup?.members?.length || 0) > 4 ? ` +${selectedGroup.members.length - 4} more` : ""}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>

              <div className="relative flex items-center gap-2" ref={headerMenuRef}>
                <button
                  onClick={() => setIsHeaderMenuOpen(prev => !prev)}
                  className={`p-2 rounded-xl transition-all ${
                    isHeaderMenuOpen
                      ? "text-indigo-600 bg-indigo-50"
                      : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  }`}
                  title="Options"
                >
                  <FaEllipsisH size={16} />
                </button>

                {isHeaderMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-1.5 z-50 animate-in fade-in duration-150">
                    {selectedGroup ? (
                      <>
                        <button
                          onClick={() => {
                            setIsHeaderMenuOpen(false);
                            setIsGroupInfoModalOpen(true);
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                        >
                          <FaUserFriends className="text-indigo-600" size={14} />
                          <span>Group Info & Members</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsHeaderMenuOpen(false);
                            setAddMemberIds(new Set());
                            setAddMemberSearchTerm("");
                            setIsAddMemberModalOpen(true);
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                        >
                          <FaUserPlus className="text-emerald-600" size={14} />
                          <span>Add Member</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsHeaderMenuOpen(false);
                            handleClearGroupChat();
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-100"
                        >
                          <FaEraser className="text-amber-500" size={13} />
                          <span>Clear Chat</span>
                        </button>
                        {isSelectedGroupAdmin ? (
                          <button
                            onClick={() => {
                              setIsHeaderMenuOpen(false);
                              handleDeleteGroup(selectedGroup._id);
                            }}
                            className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors border-t border-slate-100"
                          >
                            <FaTrash className="text-red-500" size={12} />
                            <span>Delete Group</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setIsHeaderMenuOpen(false);
                              handleLeaveGroup(selectedGroup._id);
                            }}
                            className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors border-t border-slate-100"
                          >
                            <FaSignOutAlt className="text-rose-500" size={12} />
                            <span>Leave Group</span>
                          </button>
                        )}
                      </>
                    ) : selectedChatUser ? (
                      <>
                        <button
                          onClick={() => {
                            setIsHeaderMenuOpen(false);
                            setIsDirectProfileModalOpen(true);
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
                        >
                          <FaUsers className="text-blue-600" size={14} />
                          <span>View Contact Info</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsHeaderMenuOpen(false);
                            handleClearDirectChat();
                          }}
                          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors border-t border-slate-100"
                        >
                          <FaEraser className="text-amber-500" size={13} />
                          <span>Clear Chat</span>
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </header>

            {/* Chat Messages Body */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto bg-slate-50/70 custom-scrollbar p-3 md:p-6" style={{ minHeight: 0 }}>
              {isSwitchingUser || isChatLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    {isSwitchingUser ? "Loading chat..." : "Syncing history"}
                  </p>
                </div>
              ) : directMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                  <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mb-4 shadow-sm border border-slate-100">
                    <FaComments className="text-blue-500" size={26} />
                  </div>
                  <h3 className="text-base font-black text-slate-800 mb-1">
                    {selectedChatUser ? "Direct Conversation" : `Welcome to ${selectedGroup?.name}`}
                  </h3>
                  <p className="text-xs font-medium text-slate-400 max-w-xs">
                    {selectedChatUser
                      ? `Say hello to ${selectedChatUser.name.split(' ')[0]} to start connecting.`
                      : "Start exchanging ideas, files, and project updates with the team."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedMessages).map(([date, msgs]) => (
                    <div key={date} className="space-y-3">
                      {/* Date Divider */}
                      <div className="flex justify-center py-2">
                        <span className="bg-white text-slate-500 text-[10px] font-black px-3.5 py-1 rounded-full uppercase tracking-wider shadow-xs border border-slate-200/60">
                          {date}
                        </span>
                      </div>

                      {msgs.map((msg, index) => {
                        const isMe = sameId(msg.sender?._id ?? msg.sender, currentUserId);
                        const isMenuOpen = openMenuId === msg._id;
                        const isPending = msg.isPending || msg.isSending;
                        const reactions = msg.reactions || [];
                        const isDeleted = msg.deletedForMe || msg.deletedForEveryone;
                        const isSystem = msg.isSystem || msg.messageType === "system" || msg.senderName === "System" || msg.systemAction;

                        if (isSystem) {
                          const displayText = formatSystemActionText(msg, currentUserId, user?.name);
                          return (
                            <div key={msg._id || index} className="flex justify-center my-2.5 w-full">
                              <div className="bg-slate-100/95 text-slate-600 text-xs font-semibold px-4 py-1.5 rounded-full shadow-xs border border-slate-200/80 inline-flex items-center gap-2 max-w-[85%] text-center">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                                <span>{displayText}</span>
                                <span className="text-[10px] text-slate-400 font-normal ml-0.5">
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg._id || index}
                            className={`flex w-full group/msg ${isMe ? "justify-end" : "justify-start"}`}
                          >
                            <div className={`max-w-[85%] md:max-w-[70%] relative ${isMe ? "ml-auto" : ""}`}>
                              <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                                {/* Sender name & role in Group chats */}
                                {!isMe && selectedGroup && (
                                  <div className="flex items-center gap-1.5 mb-1 ml-1">
                                    <span className="text-[11px] font-bold text-slate-700">
                                      {msg.sender?.name || "Colleague"}
                                    </span>
                                    {msg.senderModel === "Admin" || msg.sender?.role === "admin" ? (
                                      <span className="text-[8px] font-black px-1.5 py-0.2 rounded uppercase bg-purple-100 text-purple-700">
                                        Admin
                                      </span>
                                    ) : msg.senderModel === "SupportAdmin" || msg.sender?.role === "manager" ? (
                                      <span className="text-[8px] font-black px-1.5 py-0.2 rounded uppercase bg-emerald-100 text-emerald-700">
                                        Manager
                                      </span>
                                    ) : null}
                                  </div>
                                )}

                                <div className="relative group/bubble">
                                  {/* WhatsApp-Style Hover Reaction Picker Bar */}
                                  {!isPending && !isDeleted && (
                                    <div
                                      className={`absolute -top-9 ${
                                        isMe ? "right-2" : "left-2"
                                      } hidden group-hover/bubble:flex items-center gap-1 bg-white border border-slate-200/90 shadow-lg rounded-full px-2 py-1 z-30 transition-all animate-slide-up`}
                                    >
                                      {QUICK_REACTIONS.map(emoji => (
                                        <button
                                          key={emoji}
                                          onClick={() => handleToggleReaction(msg._id, emoji)}
                                          className="text-base hover:scale-130 transition-transform px-1 py-0.5 rounded-full hover:bg-slate-100"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Bubble Body */}
                                  {isDeleted ? (
                                    <div
                                      className={`px-4 py-2.5 rounded-2xl shadow-xs transition-all relative ${
                                        isMe
                                          ? "bg-slate-100/90 text-slate-500 border border-slate-200/80 rounded-tr-none italic"
                                          : "bg-slate-100/90 text-slate-500 border border-slate-200/80 rounded-tl-none italic"
                                      }`}
                                    >
                                      <p className="text-xs font-medium flex items-center gap-1.5 select-none">
                                        <FaTrash className="text-slate-400 flex-shrink-0" size={10} />
                                        <span>
                                          {msg.deletedForMe
                                            ? "Deleted for you"
                                            : isMe
                                            ? "Deleted for everyone"
                                            : `${msg.deletedBy?.userName || "This person"} deleted this message`}
                                        </span>
                                      </p>
                                      <div className="flex items-center justify-end gap-1 mt-1 text-slate-400 not-italic">
                                        <span className="text-[10px] font-medium tracking-tight">
                                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div
                                      className={`px-4 py-2.5 rounded-2xl shadow-xs transition-all relative ${
                                        isMe
                                          ? "bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-tr-none shadow-blue-100"
                                          : "bg-white text-slate-800 border border-slate-200/80 rounded-tl-none"
                                      } ${isPending ? "opacity-75" : ""}`}
                                    >
                                      {/* Text message */}
                                      {msg.message && (
                                        <p className="text-sm font-normal leading-relaxed whitespace-pre-wrap break-words">
                                          {msg.message}
                                        </p>
                                      )}

                                      {/* Attachments rendering */}
                                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                        <div className="space-y-2 mt-2">
                                          {msg.attachments.map((att, i) => (
                                            <div key={i} className="rounded-xl overflow-hidden">
                                              {att.fileType === "image" ? (
                                                <a href={att.url} target="_blank" rel="noopener noreferrer">
                                                  <img
                                                    src={att.url}
                                                    alt={att.fileName || "attachment"}
                                                    className="max-h-60 rounded-xl object-cover hover:opacity-95 transition-opacity border border-black/10"
                                                  />
                                                </a>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => handleDownloadAttachment(att, `${msg._id}-${i}`)}
                                                  disabled={downloadingAttachmentKey === `${msg._id}-${i}`}
                                                  className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl transition-colors cursor-pointer disabled:opacity-70 ${
                                                    isMe
                                                      ? "bg-white/15 hover:bg-white/25 text-white"
                                                      : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                                                  }`}
                                                >
                                                  <div className="p-2 rounded-lg bg-blue-500 text-white">
                                                    <FaFileAlt size={16} />
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold truncate">{att.fileName || "Download Document"}</p>
                                                    {att.fileSize > 0 && (
                                                      <p className="text-[10px] opacity-75">{formatFileSize(att.fileSize)}</p>
                                                    )}
                                                  </div>
                                                  {downloadingAttachmentKey === `${msg._id}-${i}` ? (
                                                    <FaSpinner size={13} className="animate-spin opacity-75" />
                                                  ) : (
                                                    <FaDownload size={13} className="opacity-75" />
                                                  )}
                                                </button>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Timestamp & Double Ticks */}
                                      <div
                                        className={`flex items-center justify-end gap-1.5 mt-1.5 ${
                                          isMe ? "text-blue-100" : "text-slate-400"
                                        }`}
                                      >
                                        {msg.isEdited && (
                                          <span className="text-[9px] font-bold uppercase tracking-tighter opacity-70">
                                            Edited ·
                                          </span>
                                        )}
                                        <span className="text-[10px] font-medium tracking-tight">
                                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                        {isMe && (
                                          isPending ? (
                                            <div className="w-2.5 h-2.5 border border-blue-200 border-t-white rounded-full animate-spin" />
                                          ) : (
                                            // WhatsApp Cyan Double Ticks when Read
                                            <FaCheckDouble
                                              className={`text-[11px] ${
                                                msg.isRead ? "text-cyan-300" : "opacity-40"
                                              }`}
                                              title={msg.isRead ? "Read" : "Delivered"}
                                            />
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Emoji Reaction Badges Pill */}
                                  {reactions.length > 0 && !isDeleted && (
                                    <div
                                      className={`flex items-center gap-1 mt-1 flex-wrap ${
                                        isMe ? "justify-end" : "justify-start"
                                      }`}
                                    >
                                      {Object.entries(
                                        reactions.reduce((acc, r) => {
                                          acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                          return acc;
                                        }, {})
                                      ).map(([emoji, count]) => {
                                        const myReaction = reactions.some(
                                          r => sameId(r.userId, currentUserId) && r.emoji === emoji
                                        );
                                        return (
                                          <button
                                            key={emoji}
                                            onClick={() => handleToggleReaction(msg._id, emoji)}
                                            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border shadow-xs transition-transform active:scale-90 ${
                                              myReaction
                                                ? "bg-blue-50 border-blue-200 text-blue-700 font-bold"
                                                : "bg-white border-slate-200 text-slate-700 font-medium"
                                            }`}
                                            title={`${reactions.filter(r => r.emoji === emoji).map(r => r.userName).join(", ")}`}
                                          >
                                            <span>{emoji}</span>
                                            {count > 1 && <span>{count}</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Context Menu for messages */}
                                  {!isPending && !isDeleted && (
                                    <div className={`absolute top-1/2 ${isMe ? "-left-8" : "-right-8"} -translate-y-1/2 ${isMenuOpen ? "opacity-100 z-40" : "opacity-0 group-hover/bubble:opacity-100"} transition-all flex flex-col gap-1`}>
                                      <button
                                        onClick={e => {
                                          e.stopPropagation();
                                          setOpenMenuId(isMenuOpen ? null : msg._id);
                                        }}
                                        className="w-7 h-7 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 shadow-sm hover:text-blue-600 transition-all"
                                      >
                                        <FaEllipsisV size={9} />
                                      </button>
                                      {isMenuOpen && (
                                        <div
                                          className={`absolute ${isMe ? "right-8" : "left-8"} top-0 bg-white border border-slate-200 shadow-xl rounded-2xl py-1.5 z-50 w-28 animate-fade-in`}
                                          onClick={e => e.stopPropagation()}
                                        >
                                          {isMe && (
                                            <button
                                              onClick={() => startEditing(msg)}
                                              className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors uppercase whitespace-nowrap"
                                            >
                                              <FaPen size={9} /> Edit
                                            </button>
                                          )}
                                          <button
                                            onClick={() => confirmDeleteMessage(msg)}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-red-600 hover:bg-red-50 transition-colors uppercase whitespace-nowrap"
                                          >
                                            <FaTrash size={9} /> Delete
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={directChatEndRef} />
                </div>
              )}
            </div>

            {/* Chat Footer with Input Bar & Attachments */}
            <footer className="p-3 md:p-4 bg-white border-t border-slate-200/80 shadow-xs flex-shrink-0">
              {/* Editing Banner */}
              {editingMessageId && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center justify-between bg-blue-50 px-3.5 py-2 rounded-xl border border-blue-200 animate-slide-up">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                      <FaPen size={9} />
                    </div>
                    <span className="text-[11px] font-bold text-blue-900">Editing Message</span>
                  </div>
                  <button
                    onClick={() => { setEditingMessageId(null); setDirectMsgText(""); }}
                    className="p-1 rounded-full hover:bg-white text-blue-500 transition-colors"
                  >
                    <FaTimes size={12} />
                  </button>
                </div>
              )}

              {/* Attachment Previews */}
              {attachedFiles.length > 0 && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 overflow-x-auto py-1">
                  {attachedFiles.map((att, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl text-xs text-slate-700 shadow-xs"
                    >
                      <FaPaperclip size={11} className="text-blue-600" />
                      <span className="max-w-[150px] truncate font-medium">{att.fileName}</span>
                      <button
                        onClick={() => removeAttachment(i)}
                        className="text-slate-400 hover:text-red-500 ml-1"
                      >
                        <FaTimes size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Main Input Row */}
              <div className="max-w-4xl mx-auto flex items-end gap-2 bg-slate-100 rounded-2xl px-2 py-1.5 border border-slate-200 focus-within:bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                {/* Paperclip Button for File / Image Attachments */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.txt"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile}
                  className="p-2.5 rounded-xl text-slate-500 hover:text-blue-600 hover:bg-white transition-all disabled:opacity-50"
                  title="Attach file or image"
                >
                  {isUploadingFile ? (
                    <FaSpinner className="animate-spin text-blue-600" size={17} />
                  ) : (
                    <FaPaperclip size={17} />
                  )}
                </button>

                {/* Emoji Picker Button */}
                <div className="relative">
                  {showEmojiPicker && (
                    <div className="absolute bottom-14 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden border border-slate-200 animate-fade-in">
                      <EmojiPicker
                        onEmojiClick={handleEmojiClick}
                        width={window.innerWidth < 768 ? 280 : 330}
                        height={380}
                        searchDisabled={false}
                        skinTonesDisabled
                        previewConfig={{ showPreview: false }}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => setShowEmojiPicker(v => !v)}
                    className={`p-2.5 rounded-xl transition-all ${
                      showEmojiPicker
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-500 hover:text-blue-600 hover:bg-white"
                    }`}
                    title="Insert emoji"
                  >
                    <FaSmile size={18} />
                  </button>
                </div>

                {/* Textarea Input */}
                <textarea
                  className="flex-1 bg-transparent outline-none resize-none text-sm py-2 px-2 text-slate-800 placeholder:text-slate-400 min-h-[40px] max-h-32"
                  rows={1}
                  placeholder={
                    selectedChatUser
                      ? `Message ${selectedChatUser.name.split(' ')[0]}...`
                      : `Message ${selectedGroup?.name}...`
                  }
                  value={directMsgText}
                  onChange={e => handleTyping(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sendingMessage || isSwitchingUser || isChatLoading}
                />

                {/* Send Button */}
                <button
                  onClick={handleSendMessage}
                  disabled={
                    (!directMsgText.trim() && attachedFiles.length === 0) ||
                    sendingMessage ||
                    isSwitchingUser ||
                    isChatLoading
                  }
                  className={`p-3 rounded-xl transition-all flex items-center justify-center flex-shrink-0 ${
                    (directMsgText.trim() || attachedFiles.length > 0) &&
                    !sendingMessage &&
                    !isSwitchingUser &&
                    !isChatLoading
                      ? "bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-md shadow-blue-200 hover:shadow-lg active:scale-95"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                  title="Send message"
                >
                  {sendingMessage ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : editingMessageId ? (
                    <FaCheck size={15} />
                  ) : (
                    <FaPaperPlane size={15} />
                  )}
                </button>
              </div>
            </footer>
          </>
        ) : (
          // Empty State
          <div className={`${!isSidebarOpen ? "flex" : "hidden md:flex"} flex-1 flex-col items-center justify-center bg-white h-full p-6`}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center max-w-sm text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl shadow-xl shadow-blue-100 flex items-center justify-center mb-6 text-white">
                <FaUsers size={36} />
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Team Conversations</h3>
              <p className="text-xs text-slate-500 mb-8 leading-relaxed">
                Connect in real-time with colleagues across your company. Share messages, files, and collaborate in Microsoft Teams-style groups.
              </p>
              <div className="space-y-2 w-full text-left">
                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-slate-700">Real-Time Online Presence & Last Seen</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <FaUserFriends className="text-indigo-600" size={14} />
                  <span className="text-xs font-bold text-slate-700">Teams-style Multi-role Group Conversations</span>
                </div>
                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <FaCheckDouble className="text-cyan-500" size={14} />
                  <span className="text-xs font-bold text-slate-700">Instant Read Receipts & Emoji Reactions</span>
                </div>
              </div>

              <button
                onClick={() => setIsSidebarOpen(true)}
                className="md:hidden mt-6 w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-xs uppercase tracking-wider shadow-md"
              >
                Open Contacts & Teams
              </button>
            </motion.div>
          </div>
        )}
      </div>

      {/* ── CREATE GROUP MODAL (TEAMS STYLE) ─────────────────────────────── */}
      <AnimatePresence>
        {isGroupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <FaUserFriends size={18} />
                  </div>
                  <div>
                    <h3 className="font-black text-base">Create Team / Group</h3>
                    <p className="text-[11px] text-indigo-100 font-medium">Add members and start collaborating</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsGroupModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                >
                  <FaTimes size={14} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Design Team, Project Alpha, Support Hub"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="What is this group for?"
                    value={newGroupDescription}
                    onChange={e => setNewGroupDescription(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Select Members ({newGroupMemberIds.size})
                    </label>
                    {newGroupMemberIds.size > 0 && (
                      <button
                        onClick={() => setNewGroupMemberIds(new Set())}
                        className="text-[11px] font-bold text-indigo-600 hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Search members in modal */}
                  <div className="relative mb-2">
                    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                    <input
                      type="text"
                      placeholder="Filter members..."
                      value={groupSearchTerm}
                      onChange={e => setGroupSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-indigo-400"
                    />
                  </div>

                  {/* Member selection checklist */}
                  <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-2xl p-1.5 space-y-1 custom-scrollbar">
                    {modalContacts.length === 0 ? (
                      <p className="text-center text-xs text-slate-400 py-4">No colleagues found</p>
                    ) : (
                      modalContacts.map(c => {
                        const isChecked = newGroupMemberIds.has(c._id);
                        return (
                          <div
                            key={c._id}
                            onClick={() => toggleMemberSelection(c._id)}
                            className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                              isChecked ? "bg-indigo-50 border border-indigo-200/60" : "hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                                {c.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div className="truncate">
                                <p className="text-xs font-bold text-slate-800 truncate">{c.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">{c.positionName || c.department || c.employeeId}</p>
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsGroupModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={creatingGroup || !newGroupName.trim() || newGroupMemberIds.size === 0}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-200 transition-all flex items-center gap-2"
                >
                  {creatingGroup ? (
                    <>
                      <FaSpinner className="animate-spin" size={12} />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Group</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── ADD MEMBER TO GROUP MODAL ───────────────────────── */}
        {isAddMemberModalOpen && selectedGroup && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Modal Header */}
              <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <FaUserPlus size={18} />
                  </div>
                  <div>
                    <h3 className="font-black text-base">Add Members</h3>
                    <p className="text-[11px] text-emerald-100 font-medium">Add colleagues to {selectedGroup.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAddMemberModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                >
                  <FaTimes size={14} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                {/* Search */}
                <div className="relative">
                  <FaSearch className="absolute left-3 top-2.5 text-slate-400" size={12} />
                  <input
                    type="text"
                    placeholder="Search colleagues to add..."
                    value={addMemberSearchTerm}
                    onChange={(e) => setAddMemberSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-emerald-500 transition-all font-medium"
                  />
                </div>

                {/* Colleagues list */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Available Colleagues
                    </p>
                    <span className="text-[11px] font-bold text-emerald-600">
                      {addMemberIds.size} selected
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-2xl p-1.5 space-y-1 custom-scrollbar">
                    {addMemberFilteredContacts.length === 0 ? (
                      <p className="text-center text-xs text-slate-400 py-6">
                        {addMemberSearchTerm ? "No colleagues match your search" : "All colleagues are already in this group"}
                      </p>
                    ) : (
                      addMemberFilteredContacts.map((c) => {
                        const isChecked = addMemberIds.has(c._id);
                        return (
                          <div
                            key={c._id}
                            onClick={() => toggleAddMemberSelection(c._id)}
                            className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                              isChecked ? "bg-emerald-50 border border-emerald-200/60" : "hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                                {c.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div className="truncate">
                                <p className="text-xs font-bold text-slate-800 truncate">{c.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">{c.positionName || c.department || c.employeeId}</p>
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsAddMemberModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMembers}
                  disabled={addingMembers || addMemberIds.size === 0}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-200 transition-all flex items-center gap-2"
                >
                  {addingMembers ? (
                    <>
                      <FaSpinner className="animate-spin" size={12} />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <span>Add to Group ({addMemberIds.size})</span>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── GROUP INFO & MEMBERS MODAL ───────────────────────── */}
        {isGroupInfoModalOpen && selectedGroup && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center font-black text-lg">
                    {selectedGroup.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-black text-lg">{selectedGroup.name}</h3>
                    <p className="text-xs text-indigo-100">{selectedGroup.members?.length || 0} members</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsGroupInfoModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                >
                  <FaTimes size={14} />
                </button>
              </div>

              {selectedGroup.description && (
                <div className="px-5 pt-4 pb-1">
                  <p className="text-xs text-slate-500 font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                    {selectedGroup.description}
                  </p>
                </div>
              )}

              <div className="p-5 space-y-2 overflow-y-auto flex-1 custom-scrollbar">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Members ({selectedGroup.members?.length || 0})
                  </p>
                  <button
                    onClick={() => {
                      setIsGroupInfoModalOpen(false);
                      setAddMemberIds(new Set());
                      setAddMemberSearchTerm("");
                      setIsAddMemberModalOpen(true);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FaUserPlus size={12} />
                    <span>Add Member</span>
                  </button>
                </div>
                <div className="space-y-1.5">
                  {selectedGroup.members?.map((m, idx) => {
                    const memberId = m.userId?._id || m.userId;
                    const isOnline = onlineUserIds.has(memberId?.toString());
                    const isCreator = sameId(selectedGroup.createdBy, memberId);
                    return (
                      <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100/80">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white font-bold flex items-center justify-center text-xs">
                              {m.user?.name?.charAt(0)?.toUpperCase() || "M"}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? "bg-emerald-500" : "bg-slate-300"}`} />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">
                              {m.user?.name || "Member"} {sameId(memberId, currentUserId) ? "(You)" : ""}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {m.user?.positionName || m.user?.department || m.user?.employeeId || "Team Member"}
                            </p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${m.role === "admin" || isCreator ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                          {m.role === "admin" || isCreator ? "Admin" : "Member"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                {isSelectedGroupAdmin ? (
                  <button
                    onClick={() => {
                      setIsGroupInfoModalOpen(false);
                      handleDeleteGroup(selectedGroup._id);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 transition-colors flex items-center gap-1.5"
                  >
                    <FaTrash size={11} />
                    <span>Delete Group</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsGroupInfoModalOpen(false);
                      handleLeaveGroup(selectedGroup._id);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors flex items-center gap-1.5"
                  >
                    <FaSignOutAlt size={11} />
                    <span>Leave Group</span>
                  </button>
                )}
                <button
                  onClick={() => setIsGroupInfoModalOpen(false)}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-all shadow-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── DIRECT CONTACT INFO MODAL ───────────────────────── */}
        {isDirectProfileModalOpen && selectedChatUser && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-slate-100 overflow-hidden flex flex-col"
            >
              <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-center relative">
                <button
                  onClick={() => setIsDirectProfileModalOpen(false)}
                  className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
                >
                  <FaTimes size={14} />
                </button>
                <div className="w-16 h-16 rounded-2xl bg-white/20 mx-auto mb-3 flex items-center justify-center text-2xl font-black border-2 border-white/30">
                  {selectedChatUser.name?.charAt(0)?.toUpperCase()}
                </div>
                <h3 className="font-black text-lg">{selectedChatUser.name}</h3>
                <p className="text-xs text-blue-100 font-medium mt-0.5">
                  {selectedChatUser.positionName || selectedChatUser.department || selectedChatUser.role}
                </p>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[11px] font-semibold mt-2">
                  <span className={`w-2 h-2 rounded-full ${onlineUserIds.has(selectedChatUser._id?.toString()) ? "bg-emerald-400" : "bg-slate-300"}`} />
                  <span>{onlineUserIds.has(selectedChatUser._id?.toString()) ? "Online" : formatLastSeen(selectedChatUser.lastSeen)}</span>
                </div>
              </div>

              <div className="p-5 space-y-3">
                {selectedChatUser.employeeId && (
                  <div className="flex justify-between items-center text-xs py-1.5 border-b border-slate-100">
                    <span className="font-semibold text-slate-500">Employee ID</span>
                    <span className="font-bold text-slate-800">{selectedChatUser.employeeId}</span>
                  </div>
                )}
                {selectedChatUser.department && (
                  <div className="flex justify-between items-center text-xs py-1.5 border-b border-slate-100">
                    <span className="font-semibold text-slate-500">Department</span>
                    <span className="font-bold text-slate-800">{selectedChatUser.department}</span>
                  </div>
                )}
                {selectedChatUser.email && (
                  <div className="flex justify-between items-center text-xs py-1.5 border-b border-slate-100">
                    <span className="font-semibold text-slate-500">Email</span>
                    <span className="font-bold text-slate-800 truncate max-w-[200px]">{selectedChatUser.email}</span>
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
                <button
                  onClick={() => setIsDirectProfileModalOpen(false)}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-all shadow-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── DELETE MESSAGE MODAL (Delete for me vs Delete for everyone) ── */}
        {deleteTargetMsg && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl max-w-xs w-full border border-slate-100 p-6 flex flex-col text-center"
            >
              <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-rose-100">
                <FaTrash size={18} />
              </div>
              <h3 className="text-base font-black text-slate-800 mb-1">Delete Message?</h3>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                Choose how you want to delete this message.
              </p>

              <div className="flex flex-col gap-2">
                {/* Delete for everyone option: available if sender or admin */}
                {(sameId(deleteTargetMsg.sender?._id ?? deleteTargetMsg.sender, currentUserId) || isSelectedGroupAdmin || user?.role === "admin") && (
                  <button
                    onClick={() => executeDeleteMessage(deleteTargetMsg._id, "for_everyone")}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-md shadow-rose-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FaTrash size={11} />
                    <span>Delete for everyone</span>
                  </button>
                )}

                {/* Delete for me option: always available */}
                <button
                  onClick={() => executeDeleteMessage(deleteTargetMsg._id, "for_me")}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Delete for me</span>
                </button>

                {/* Cancel button */}
                <button
                  onClick={() => setDeleteTargetMsg(null)}
                  className="w-full py-2 px-4 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-600 transition-all mt-1 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.2s ease-out forwards; }
        
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in { animation: fade-in 0.2s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default ConnectWithEmployee;
