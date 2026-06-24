const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const { getRedisOptions } = require("../redisConnection");
const logger = require("./logger").child({ module: "socketManager" });

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

    // Try to set up Redis adapter for cross-process communication
    await this.setupRedisAdapter();

    this.setupConnectionHandling();
  }

  async setupRedisAdapter() {
    try {
      const redisConfig = getRedisOptions();

      // Check if Redis is configured (host is set)
      if (!redisConfig.host) {
        logger.info("Redis not configured, using in-memory adapter for Socket.IO");
        return;
      }

      // Create Redis clients for pub/sub with proper error handling
      this.pubClient = new Redis({
        ...redisConfig,
        lazyConnect: true, // Don't connect immediately, we'll connect explicitly
        maxRetriesPerRequest: null, // Required for adapter
        enableReadyCheck: true,
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

      // Connect both clients and wait for them to be ready
      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect()
      ]);

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
      socket.on("authenticate", (data) => {
        const { userId, teamId } = data;
        if (!userId) {
          socket.emit("authenticated", { success: false, error: "User ID required" });
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
        // eslint-disable-next-line no-param-reassign
        socket.teamId = teamId;

        // Join team room for team-wide broadcasts
        if (teamId) {
          socket.join(`team:${teamId}`);
          this.addToRoom(`team:${teamId}`, socket.id);
        }

        // Join user room for private messages
        socket.join(`user:${userId}`);
        this.addToRoom(`user:${userId}`, socket.id);

        socket.emit("authenticated", { success: true });
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
