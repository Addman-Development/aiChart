import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  getNotificationsApi,
  createNotificationApi,
  markNotificationReadApi,
  markAllNotificationsReadApi,
  removeNotificationApi,
  clearNotificationsApi,
} from "../api/notification";

// Server-backed notifications: persisted in Postgres and synced across a user's
// sessions/devices via Socket.IO. Thunks call the REST API; the socket-driven
// reducers (notificationReceived/Updated/Deleted/...) apply real-time updates
// pushed from the server. Surfaced in the TopNav bell.

const initialState = {
  items: [], // { id, type, title, message, meta, read, createdAt }
  loading: false,
  fetched: false,
  error: false,
};

// Insert-or-replace by id so the optimistic thunk result and the socket echo
// (the server also emits to the originating session) never duplicate a row.
const upsert = (items, notification) => {
  if (!notification?.id) return;
  const idx = items.findIndex((i) => i.id === notification.id);
  if (idx >= 0) items[idx] = notification;
  else items.unshift(notification);
};

export const getNotifications = createAsyncThunk(
  "notification/getNotifications",
  async ({ team_id }) => getNotificationsApi(team_id),
);

export const createNotification = createAsyncThunk(
  "notification/createNotification",
  async ({ team_id, ...data }) => createNotificationApi(team_id, data),
);

export const markNotificationRead = createAsyncThunk(
  "notification/markNotificationRead",
  async ({ team_id, id }) => markNotificationReadApi(team_id, id),
);

export const markAllNotificationsRead = createAsyncThunk(
  "notification/markAllNotificationsRead",
  async ({ team_id }) => {
    await markAllNotificationsReadApi(team_id);
    return { team_id };
  },
);

export const removeNotification = createAsyncThunk(
  "notification/removeNotification",
  async ({ team_id, id }) => {
    await removeNotificationApi(team_id, id);
    return { id };
  },
);

export const clearNotifications = createAsyncThunk(
  "notification/clearNotifications",
  async ({ team_id }) => {
    await clearNotificationsApi(team_id);
    return { team_id };
  },
);

export const notificationSlice = createSlice({
  name: "notification",
  initialState,
  reducers: {
    // Socket-driven updates (pushed from the server to all of the user's sessions)
    notificationReceived: (state, action) => { upsert(state.items, action.payload); },
    notificationUpdated: (state, action) => { upsert(state.items, action.payload); },
    notificationDeleted: (state, action) => {
      state.items = state.items.filter((i) => i.id !== action.payload?.id);
    },
    notificationsReadAll: (state, action) => {
      const teamId = action.payload?.team_id;
      state.items.forEach((i) => {
        if (teamId == null || `${i.team_id}` === `${teamId}`) i.read = true;
      });
    },
    notificationsCleared: (state, action) => {
      const teamId = action.payload?.team_id;
      state.items = teamId == null
        ? []
        : state.items.filter((i) => `${i.team_id}` !== `${teamId}`);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getNotifications.pending, (state) => { state.loading = true; state.error = false; })
      .addCase(getNotifications.fulfilled, (state, action) => {
        state.loading = false;
        state.fetched = true;
        state.items = Array.isArray(action.payload) ? action.payload : [];
      })
      .addCase(getNotifications.rejected, (state) => {
        state.loading = false;
        state.error = true;
      })
      .addCase(createNotification.fulfilled, (state, action) => { upsert(state.items, action.payload); })
      .addCase(markNotificationRead.fulfilled, (state, action) => { upsert(state.items, action.payload); })
      .addCase(markAllNotificationsRead.fulfilled, (state) => {
        state.items.forEach((i) => { i.read = true; });
      })
      .addCase(removeNotification.fulfilled, (state, action) => {
        state.items = state.items.filter((i) => i.id !== action.payload?.id);
      })
      .addCase(clearNotifications.fulfilled, (state) => { state.items = []; });
  },
});

export const {
  notificationReceived,
  notificationUpdated,
  notificationDeleted,
  notificationsReadAll,
  notificationsCleared,
} = notificationSlice.actions;

export const selectNotifications = (state) => state.notification.items;
export const selectUnreadCount = (state) => state.notification.items.filter((i) => !i.read).length;

export default notificationSlice.reducer;
