const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const jwt = require("jsonwebtoken");
const { getRedisOptions } = require("../redisConnection");
const settings = require("../settings");
const db = require("../models/models");
const logger = require("./logger").child({ module: "socketManager" });

// Verify a client-supplied auth token the same way the HTTP verifyToken
// middleware does (encryptionKey first, then the legacy secret) and return the
// user id it encodes, or null. The socket derives identity from this signed
// token instead of trusting a client-claimed userId — otherwise any logged-in
// user could emit authenticate with a victim's userId, join their room, and
// receive their private streamed AI answers and notifications. Blacklist
// revocation stays enforced at the HTTP layer; skipped here to avoid a DB
// round-trip on every (re)connect.
function verifyAuthToken(token) {
  if (!token || typeof token !== "string") return null;
  let decoded;
  try {
    decoded = jwt.verify(token, settings.encryptionKey);
  } catch (e) { /* fall through to the legacy secret */ }
  if (!decoded?.id) {
    try {
      decoded = jwt.verify(token, settings.secret);
    } catch (e) {
      decoded = null;
    }
  }
  return decoded?.id || null;
}

/**
 * Socket.IO Manager for Edison
 *
 * Handles real-time communication for AI orchestrations and other features.
 * Provides room-based isolation for teams/users and progress tracking.
 *
 * Uses Redis adapter for cross-process communication when Redis is available,
 * enabling proper scaling across multiple workers or nodes.
 */

class SocketManager {
  constructor() {
    this.io = null;
    this.activeConnections = new Map(); // userId -> Set<socketId> (one entry per open session)
    this.roomConnections = new Map(); // room -> Set of socket IDs
    this.pubClient = null;
    this.subClient = null;
  }

  async initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.VITE_APP_CLIENT_HOST || false,
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ["websocket", "polling"],
      // Add connection state recovery for better resilience
      pingTimeout: 60000,
      pingInterval: 25000,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      },
      path: "/api/socket.io"
    });

    // Register connection/auth handling FIRST so realtime auth never depends on
    // Redis being reachable. The default in-memory adapter is active from
    // construction, so clients can connect and authenticate immediately.
    this.setupConnectionHandling();

    // Attach the Redis adapter for cross-process delivery in the background.
    // This must never block or hang startup: if Redis is unreachable we log and
    // continue on the in-memory adapter (correct for a single-instance deploy).
    this.setupRedisAdapter().catch((err) => {
      logger.warn({ err }, "Redis adapter setup failed; continuing with in-memory adapter");
    });
  }

  async setupRedisAdapter() {
    try {
      const redisConfig = getRedisOptions();

      // Check if Redis is configured (host is set)
      if (!redisConfig.host) {
        logger.info("Redis not configured, using in-memory adapter for Socket.IO");
        return;
      }

      // Create Redis clients for pub/sub with proper error handling.
      // connectTimeout/commandTimeout are essential: without them a dead
      // endpoint that still accepts TCP (a stale ssh -L / kubectl port-forward,
      // or a DNS-up-but-service-down host) leaves the ready-check INFO waiting
      // forever, so connect() never settles and startup hangs. Bounding both
      // guarantees connect() rejects and the catch below falls back to memory.
      this.pubClient = new Redis({
        ...redisConfig,
        lazyConnect: true, // Don't connect immediately, we'll connect explicitly
        maxRetriesPerRequest: null, // Required for adapter
        enableReadyCheck: true,
        connectTimeout: 10000, // bound SYN-dropped / host-unreachable
        commandTimeout: 10000, // bound the ready-check INFO — the actual hang fix
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.subClient = this.pubClient.duplicate();

      // Set up error handlers before connecting
      this.pubClient.on("error", (err) => {
        logger.error({ err, client: "pub" }, "Socket.IO Redis client error");
      });

      this.subClient.on("error", (err) => {
        logger.error({ err, client: "sub" }, "Socket.IO Redis client error");
      });

      // Only log reconnection/ready events at debug level to avoid log spam
      if (process.env.DEBUG_REDIS) {
        this.pubClient.on("reconnecting", () => {
          logger.debug({ client: "pub" }, "Socket.IO Redis client reconnecting");
        });
        this.subClient.on("reconnecting", () => {
          logger.debug({ client: "sub" }, "Socket.IO Redis client reconnecting");
        });
        this.pubClient.on("ready", () => {
          logger.debug({ client: "pub" }, "Socket.IO Redis client ready");
        });
        this.subClient.on("ready", () => {
          logger.debug({ client: "sub" }, "Socket.IO Redis client ready");
        });
      }

      // Connect both clients and wait for them to be ready. Guard with an
      // overall deadline as belt-and-suspenders: even if a client-level timeout
      // is ever missed, startup can never wedge on a hung Redis handshake.
      const pubConnect = this.pubClient.connect();
      const subConnect = this.subClient.connect();
      // Attach no-op catches so that if the deadline below wins the race, the
      // still-pending connect() promises (which reject once we disconnect in the
      // catch) cannot surface as unhandled rejections.
      pubConnect.catch(() => {});
      subConnect.catch(() => {});

      let deadlineTimer;
      try {
        await Promise.race([
          Promise.all([pubConnect, subConnect]),
          new Promise((_, reject) => {
            deadlineTimer = setTimeout(
              () => reject(new Error("Redis adapter connect timed out")),
              8000
            );
          }),
        ]);
      } finally {
        clearTimeout(deadlineTimer);
      }

      // Use Redis adapter for cross-process communication with recommended options
      this.io.adapter(createAdapter(this.pubClient, this.subClient, {
        key: "socket.io",
        publishOnSpecificResponseChannel: true, // More efficient for multi-server setups
      }));

      logger.info("Socket.IO Redis adapter enabled for cross-process communication");
    } catch (error) {
      logger.warn({ err: error }, "Failed to set up Socket.IO Redis adapter, falling back to in-memory adapter");

      // Clean up clients if setup failed
      if (this.pubClient) {
        this.pubClient.disconnect();
        this.pubClient = null;
      }
      if (this.subClient) {
        this.subClient.disconnect();
        this.subClient = null;
      }
    }
  }

  setupConnectionHandling() {
    this.io.on("connection", (socket) => {
      // Authentication middleware
      socket.on("authenticate", async (data) => {
        // Derive the user id from the signed token — never trust a client-claimed
        // userId (that would let any logged-in user join another user's room).
        const userId = verifyAuthToken(data?.token);
        const { teamId } = data;
        if (!userId) {
          socket.emit("authenticated", { success: false, error: "Unauthorized" });
          return;
        }

        // Track every socket for this user (multiple tabs/devices). We do NOT
        // force-disconnect prior sockets: that would defeat multi-session sync
        // (e.g. notifications) and trigger a reconnect war between tabs. The
        // user:${userId} room below holds all of them, so emitToUser reaches
        // every session.
        if (!this.activeConnections.has(userId)) {
          this.activeConnections.set(userId, new Set());
        }
        this.activeConnections.get(userId).add(socket.id);
        // eslint-disable-next-line no-param-reassign
        socket.userId = userId;

        // Join user room for private messages. Safe unconditionally: the id came
        // from the verified token, so a socket can only ever join its own room.
        socket.join(`user:${userId}`);
        this.addToRoom(`user:${userId}`, socket.id);

        // Acknowledge auth now — the token alone proves identity, so this must
        // NOT wait on (or fail with) the app DB. The team-room join below is a
        // best-effort follow-up; if the DB is slow/down, private/user events
        // (AI streaming, per-user notifications) keep flowing regardless.
        socket.emit("authenticated", { success: true });

        // Join the team room only after confirming the user belongs to the team.
        // Membership isn't encoded in the token, so verify it against the app DB
        // — otherwise an authenticated user could receive another team's
        // broadcasts by asserting its id. A lookup failure degrades to "no team
        // room" rather than affecting auth. (A team broadcast in the brief window
        // before the join is missed; team events aren't latency-critical and the
        // client re-fetches on load.)
        if (teamId) {
          let isMember = false;
          try {
            const role = await db.TeamRole.findOne({
              where: { team_id: teamId, user_id: userId },
            });
            isMember = Boolean(role);
          } catch (err) {
            logger.warn({ err, userId, teamId }, "Socket team-membership check failed; skipping team room");
          }
          // The socket may have disconnected during the await; join() is then a
          // harmless no-op.
          if (isMember) {
            // eslint-disable-next-line no-param-reassign
            socket.teamId = teamId;
            socket.join(`team:${teamId}`);
            this.addToRoom(`team:${teamId}`, socket.id);
          }
        }
      });

      // Handle conversation room joining
      socket.on("join-conversation", (data) => {
        const { conversationId } = data;
        if (!conversationId) {
          return;
        }

        if (!socket.userId) {
          // Not authenticated yet, queue this for after authentication
          return;
        }

        socket.join(`conversation:${conversationId}`);
        this.addToRoom(`conversation:${conversationId}`, socket.id);
      });

      // Handle conversation room leaving
      socket.on("leave-conversation", (data) => {
        const { conversationId } = data;
        if (conversationId) {
          socket.leave(`conversation:${conversationId}`);
          this.removeFromRoom(`conversation:${conversationId}`, socket.id);
        }
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        // Clean up from rooms
        this.roomConnections.forEach((sockets) => {
          if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
          }
        });

        // Clean up active connections: remove just this socket and drop the
        // user entry only once they have no remaining sessions.
        if (socket.userId) {
          const userSockets = this.activeConnections.get(socket.userId);
          if (userSockets) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
              this.activeConnections.delete(socket.userId);
            }
          }
        }
      });
    });
  }

  addToRoom(room, socketId) {
    if (!this.roomConnections.has(room)) {
      this.roomConnections.set(room, new Set());
    }
    this.roomConnections.get(room).add(socketId);
  }

  removeFromRoom(room, socketId) {
    const roomSockets = this.roomConnections.get(room);
    if (roomSockets) {
      roomSockets.delete(socketId);
      if (roomSockets.size === 0) {
        this.roomConnections.delete(room);
      }
    }
  }

  // Emit progress events for AI orchestration
  emitProgress(conversationId, event, data = {}) {
    if (!this.io) return; // Skip if not initialized
    const room = `conversation:${conversationId}`;
    this.io.to(room).emit("ai-progress", {
      event,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Emit an incremental assistant text delta (or a { reset: true } turn
  // boundary) for live streaming in the UI. Sent to the USER's room (which is
  // always joined once authenticated) rather than the conversation room, so it
  // works even before the client has joined a brand-new conversation's room.
  // Payload: { conversationId, turnId, delta } or { conversationId, turnId, reset }.
  emitToken(userId, data = {}) {
    if (!this.io) return; // Skip if not initialized
    this.io.to(`user:${userId}`).emit("ai-token", data);
  }

  // Emit to specific user
  emitToUser(userId, event, data = {}) {
    if (!this.io) return; // Skip if not initialized
    const room = `user:${userId}`;
    this.io.to(room).emit(event, data);
  }

  // Emit to team
  emitToTeam(teamId, event, data = {}) {
    if (!this.io) return; // Skip if not initialized
    const room = `team:${teamId}`;
    this.io.to(room).emit(event, data);
  }

  // Get active connections count
  getActiveConnections() {
    return this.activeConnections.size;
  }

  // Get room connections count
  getRoomConnections(room) {
    const roomSockets = this.roomConnections.get(room);
    return roomSockets ? roomSockets.size : 0;
  }
}

// Export singleton instance
const socketManager = new SocketManager();
module.exports = socketManager;
