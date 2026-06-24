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

const initialState = {
  aiModalOpen: false,
  feedbackModalOpen: false,
  sidebarCollapsed: getInitialSidebarState(),
  // Off-canvas sidebar drawer state for phones (< sm). Intentionally NOT
  // persisted to localStorage so the drawer always starts closed.
  mobileSidebarOpen: false,
  // When set, the Edison AI modal opens straight to this conversation (used by
  // notifications that deep-link back to a finished chat).
  aiPendingConversationId: null,
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    showAiModal: (state) => {
      state.aiModalOpen = true;
    },
    hideAiModal: (state) => {
      state.aiModalOpen = false;
    },
    toggleAiModal: (state) => {
      state.aiModalOpen = !state.aiModalOpen;
    },
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
    setAiPendingConversationId: (state, action) => {
      state.aiPendingConversationId = action.payload;
    },
  },
});

export const { showAiModal, hideAiModal, toggleAiModal, showFeedbackModal, hideFeedbackModal, toggleFeedbackModal, setSidebarCollapsed, toggleSidebar, openMobileSidebar, closeMobileSidebar, toggleMobileSidebar, setAiPendingConversationId } = uiSlice.actions;

export const selectAiModalOpen = (state) => state.ui.aiModalOpen;
export const selectFeedbackModalOpen = (state) => state.ui.feedbackModalOpen;
export const selectSidebarCollapsed = (state) => state.ui.sidebarCollapsed;
export const selectMobileSidebarOpen = (state) => state.ui.mobileSidebarOpen;
export const selectAiPendingConversationId = (state) => state.ui.aiPendingConversationId;

export default uiSlice.reducer;
