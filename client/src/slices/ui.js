import { createSlice } from "@reduxjs/toolkit";

// Load initial sidebar state from localStorage
const getInitialSidebarState = () => {
  try {
    const stored = window.localStorage.getItem("_cb_sidebar_state");
    if (stored !== null) {
      return stored === "true";
    }
  } catch (error) {
    console.error("Error reading sidebar state from localStorage:", error);
  }
  return false; // Default to expanded (not collapsed)
};

// NOTE: the Edison chat used to live here as `aiModalOpen` +
// `aiPendingConversationId`. It's a route now (/edison/:conversationId), so the
// URL carries both "is it open" and "which conversation" — see modules/edisonNav.
const initialState = {
  feedbackModalOpen: false,
  sidebarCollapsed: getInitialSidebarState(),
  // Off-canvas sidebar drawer state for phones (< sm). Intentionally NOT
  // persisted to localStorage so the drawer always starts closed.
  mobileSidebarOpen: false,
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    showFeedbackModal: (state) => {
      state.feedbackModalOpen = true;
    },
    hideFeedbackModal: (state) => {
      state.feedbackModalOpen = false;
    },
    toggleFeedbackModal: (state) => {
      state.feedbackModalOpen = !state.feedbackModalOpen;
    },
    setSidebarCollapsed: (state, action) => {
      state.sidebarCollapsed = action.payload;
      try {
        window.localStorage.setItem("_cb_sidebar_state", String(action.payload));
      } catch (error) {
        console.error("Error saving sidebar state to localStorage:", error);
      }
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try {
        window.localStorage.setItem("_cb_sidebar_state", String(state.sidebarCollapsed));
      } catch (error) {
        console.error("Error saving sidebar state to localStorage:", error);
      }
    },
    openMobileSidebar: (state) => {
      state.mobileSidebarOpen = true;
    },
    closeMobileSidebar: (state) => {
      state.mobileSidebarOpen = false;
    },
    toggleMobileSidebar: (state) => {
      state.mobileSidebarOpen = !state.mobileSidebarOpen;
    },
  },
});

export const { showFeedbackModal, hideFeedbackModal, toggleFeedbackModal, setSidebarCollapsed, toggleSidebar, openMobileSidebar, closeMobileSidebar, toggleMobileSidebar } = uiSlice.actions;

export const selectFeedbackModalOpen = (state) => state.ui.feedbackModalOpen;
export const selectSidebarCollapsed = (state) => state.ui.sidebarCollapsed;
export const selectMobileSidebarOpen = (state) => state.ui.mobileSidebarOpen;

export default uiSlice.reducer;
