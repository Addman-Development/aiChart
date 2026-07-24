import { io } from "socket.io-client";
import { API_HOST } from "../config/settings";
import { getAuthToken } from "./auth";

// API_HOST carries the API's explicit mount path (e.g. "/api"); the gateway
// forwards it to the server untouched. io() treats a URL pathname as a
// namespace, so split the origin from the path and append socket.io to the
// mount path so the browser connects to "<origin>/<mount>/socket.io".
let _socketOrigin = API_HOST;
let _socketPath = "/socket.io";
try {
  const url = new URL(API_HOST);
  _socketOrigin = url.origin;
  if (url.pathname && url.pathname !== "/") {
    const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    _socketPath = `${base}/socket.io`;
  }
} catch { /* keep defaults */ }

/**
 * Singleton Socket.IO client for Edison AI
 * Handles connection, authentication, and room management
 */
class SocketClient {
  constructor() {
    this.socket = null;
    this.isAuthenticated = false;
    this.userId = null;
    this.teamId = null;
    this.listeners = new Map(); // Track all event listeners for cleanup
    this.conversationRooms = new Set(); // Track joined conversation rooms
  }

  /**
   * Initialize socket connection with authentication
   * @param {number} userId - User ID
   * @param {number} teamId - Team ID
   * @returns {Promise<void>}
   */
  async connect(userId, teamId) {
    // Reuse a healthy, authenticated connection for the same credentials.
    if (this.socket?.connected && this.isAuthenticated && this.userId === userId && this.teamId === teamId) {
      return Promise.resolve();
    }

    // Otherwise tear down any existing socket before creating a new one:
    // io(..., { forceNew: true }) below would orphan it, leaking a client that
    // keeps reconnecting in the background.
    if (this.socket) {
      this.disconnect();
    }

    this.userId = userId;
    this.teamId = teamId;

    return new Promise((resolve, reject) => {
      // `settled` gates the returned promise so the persistent socket handlers
      // below (which also run on every later reconnect) can only resolve/reject
      // the *initial* connect once.
      let settled = false;
      let authTimer = null;

      const clearAuthTimer = () => {
        if (authTimer) {
          clearTimeout(authTimer);
          authTimer = null;
        }
      };
      const fail = (error) => {
        clearAuthTimer();
        if (settled) return;
        settled = true;
        // Do NOT close the socket here: socket.io keeps retrying in the
        // background, so realtime can still recover for callers that ignore
        // this rejection (e.g. the notifications bell) even though the initial
        // attempt is reported as failed.
        reject(error);
      };
      const succeed = () => {
        clearAuthTimer();
        this.isAuthenticated = true;
        if (settled) return;
        settled = true;
        resolve();
      };

      this.socket = io(_socketOrigin, {
        withCredentials: true,
        transports: ["websocket", "polling"], // Allow fallback for production
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        autoConnect: true,
        path: _socketPath,
        upgrade: true,
        rememberUpgrade: true,
        forceNew: true,
      });

      // Fires on the initial connection AND on every reconnection (the
      // manager-level "reconnect" event is NOT forwarded to the socket in
      // socket.io-client v4), so re-auth and room-rejoin must live here.
      this.socket.on("connect", () => {
        // Bound only the auth round-trip, and only for the initial connect:
        // transport is up, we are now waiting on the server's "authenticated".
        if (!settled && !authTimer) {
          authTimer = setTimeout(() => {
            const error = new Error(
              "Socket authentication timeout: connected but the server never authenticated"
            );
            error.code = "SOCKET_AUTH_TIMEOUT";
            fail(error);
          }, 10000);
        }

        // Pass the signed auth token so the server derives our identity from it
        // rather than trusting the client-supplied userId (prevents joining
        // another user's private room). userId/teamId stay for room membership.
        this.socket.emit("authenticate", { userId, teamId, token: getAuthToken() });

        // Rejoin any conversation rooms (a no-op on the first connect, since
        // none are joined yet; essential after a reconnect).
        this.conversationRooms.forEach((conversationId) => {
          this.socket.emit("join-conversation", { conversationId });
        });
      });

      // Server's authentication result. Kept as `on` (not `once`) so state stays
      // correct across reconnections.
      this.socket.on("authenticated", (res) => {
        if (res && res.success === false) {
          this.isAuthenticated = false;
          const error = new Error(res.error || "Socket authentication rejected by server");
          error.code = "SOCKET_AUTH_REJECTED";
          fail(error);
          return;
        }
        succeed();
      });

      // Transport-level failure: cannot reach the server, or the handshake/CORS
      // was rejected. Distinct from an auth timeout so field logs are legible.
      this.socket.on("connect_error", (err) => {
        if (settled) return; // ignore transient errors during later reconnects
        const error = new Error(`Socket transport failed: ${err?.message || err}`);
        error.code = "SOCKET_CONNECT_ERROR";
        error.cause = err;
        fail(error);
      });

      // Handle disconnection
      this.socket.on("disconnect", (reason) => {
        this.isAuthenticated = false;
        // If server disconnected us, try to reconnect
        if (reason === "io server disconnect") {
          this.socket.connect();
        }
      });
    });
  }

  /**
   * Disconnect socket
   */
  disconnect() {
    if (this.socket) {
      // Remove all listeners
      this.listeners.forEach((handler, event) => {
        this.socket.off(event, handler);
      });
      this.listeners.clear();
      this.conversationRooms.clear();
      
      this.socket.disconnect();
      this.socket = null;
      this.isAuthenticated = false;
    }
  }

  /**
   * Join a conversation room
   * @param {number} conversationId - Conversation ID
   */
  joinConversation(conversationId) {
    if (!this.socket || !this.isAuthenticated) {
      console.warn("Cannot join conversation: socket not authenticated");
      return;
    }

    this.socket.emit("join-conversation", { conversationId });
    this.conversationRooms.add(conversationId);
  }

  /**
   * Leave a conversation room
   * @param {number} conversationId - Conversation ID
   */
  leaveConversation(conversationId) {
    if (!this.socket) return;

    this.socket.emit("leave-conversation", { conversationId });
    this.conversationRooms.delete(conversationId);
  }

  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  on(event, handler) {
    if (!this.socket) {
      console.warn("Cannot add listener: socket not initialized");
      return;
    }

    this.socket.on(event, handler);
    this.listeners.set(event + handler.toString(), handler);
  }

  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  off(event, handler) {
    if (!this.socket) return;

    this.socket.off(event, handler);
    this.listeners.delete(event + handler.toString());
  }

  /**
   * Check if socket is connected and authenticated
   * @returns {boolean}
   */
  isReady() {
    return this.socket?.connected && this.isAuthenticated;
  }
}

// Export singleton instance
const socketClient = new SocketClient();
export default socketClient;

