import { useEffect, useRef, useCallback } from "react";

import { API_HOST } from "../config/settings";
import { getAuthToken } from "../modules/auth";

/**
 * Hook that adds Copilot-style ghost text suggestions to an Ace editor.
 *
 * - Triggers after the user pauses typing (debounce)
 * - Calls the completeQuery endpoint for AI suggestions
 * - Renders suggestion as faded ghost text after the cursor
 * - Tab accepts the suggestion, Escape or typing dismisses it
 *
 * @param {Object} editor - Ace editor instance
 * @param {Object} options
 * @param {string} options.teamId - team ID for API calls
 * @param {string} options.datasetId - dataset ID for API calls
 * @param {string|number} options.dataRequestId - data request ID for API calls
 * @param {boolean} options.enabled - whether AI suggestions are enabled
 * @param {number} options.debounceMs - debounce delay in ms (default 800)
 */
export default function useAiGhostText(editor, {
  teamId, datasetId, dataRequestId, enabled = true, debounceMs = 800,
} = {}) {
  const ghostTextRef = useRef(null); // { text, row, column, widgetId }
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const styleInjectedRef = useRef(false);

  // Inject ghost text CSS once
  useEffect(() => {
    if (styleInjectedRef.current) return;
    styleInjectedRef.current = true;
    const style = document.createElement("style");
    style.id = "ace-ghost-text-styles";
    style.textContent = `
      .ace_ghost-text {
        color: rgba(128, 128, 128, 0.5) !important;
        font-style: italic;
        pointer-events: none;
      }
      .ace_ghost-text-line {
        opacity: 0.45;
        font-style: italic;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }, []);

  const clearGhostText = useCallback(() => {
    if (!editor || !ghostTextRef.current) return;
    const session = editor.getSession();
    if (ghostTextRef.current.widgetId !== undefined) {
      session.widgetManager?.removeLineWidget?.(ghostTextRef.current.widget);
    }
    if (ghostTextRef.current.markerId) {
      session.removeMarker(ghostTextRef.current.markerId);
    }
    // Remove ghost line content
    if (ghostTextRef.current.ghostElement) {
      ghostTextRef.current.ghostElement.remove();
    }
    ghostTextRef.current = null;
    // Remove inline ghost text by resetting line
    editor.renderer.updateFull(true);
  }, [editor]);

  const showGhostText = useCallback((text, row, column) => {
    if (!editor || !text) return;
    clearGhostText();

    const lines = text.split("\n");
    const firstLine = lines[0];
    const remainingLines = lines.slice(1);

    // Create a ghost text element positioned after cursor
    const renderer = editor.renderer;
    const cursorPos = renderer.textToScreenCoordinates(row, column);

    const container = editor.container;
    const ghostEl = document.createElement("div");
    ghostEl.className = "ace_ghost-text";
    ghostEl.style.position = "absolute";
    ghostEl.style.left = `${cursorPos.pageX - container.getBoundingClientRect().left}px`;
    ghostEl.style.top = `${cursorPos.pageY - container.getBoundingClientRect().top}px`;
    ghostEl.style.height = `${renderer.lineHeight}px`;
    ghostEl.style.lineHeight = `${renderer.lineHeight}px`;
    ghostEl.style.fontSize = `${renderer.characterWidth ? "inherit" : "12px"}`;
    ghostEl.style.fontFamily = "monospace";
    ghostEl.style.whiteSpace = "pre";
    ghostEl.style.zIndex = "3";
    ghostEl.textContent = firstLine;

    // Add remaining lines below
    remainingLines.forEach((line, i) => {
      const lineEl = document.createElement("div");
      lineEl.className = "ace_ghost-text-line";
      lineEl.style.position = "absolute";
      lineEl.style.left = `${renderer.$padding || 0}px`;
      lineEl.style.top = `${cursorPos.pageY - container.getBoundingClientRect().top + (renderer.lineHeight * (i + 1))}px`;
      lineEl.style.height = `${renderer.lineHeight}px`;
      lineEl.style.lineHeight = `${renderer.lineHeight}px`;
      lineEl.style.fontFamily = "monospace";
      lineEl.style.whiteSpace = "pre";
      lineEl.style.zIndex = "3";
      lineEl.style.color = "rgba(128, 128, 128, 0.5)";
      lineEl.style.fontStyle = "italic";
      lineEl.textContent = line;
      ghostEl.appendChild(lineEl);
    });

    container.querySelector(".ace_scroller").appendChild(ghostEl);

    ghostTextRef.current = {
      text,
      row,
      column,
      ghostElement: ghostEl,
    };
  }, [editor, clearGhostText]);

  const acceptGhostText = useCallback(() => {
    if (!editor || !ghostTextRef.current) return false;

    const { text, row, column } = ghostTextRef.current;
    clearGhostText();

    // Insert the suggestion text at cursor position
    const session = editor.getSession();
    session.insert({ row, column }, text);

    return true;
  }, [editor, clearGhostText]);

  const fetchCompletion = useCallback(async () => {
    if (!editor || !enabled || !teamId || !datasetId || !dataRequestId) return;

    const cursorPos = editor.getCursorPosition();
    const session = editor.getSession();
    const value = session.getValue();

    // Don't suggest on empty editor or very short content
    if (!value || value.trim().length < 3) return;

    // Calculate character offset from row/col
    const lines = value.split("\n");
    let charOffset = 0;
    for (let i = 0; i < cursorPos.row; i++) {
      charOffset += lines[i].length + 1;
    }
    charOffset += cursorPos.column;

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = `${API_HOST}/team/${teamId}/datasets/${datasetId}/dataRequests/${dataRequestId}/completeQuery`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          currentQuery: value,
          cursorPosition: charOffset,
        }),
        signal: controller.signal,
      });

      if (!response.ok) return;
      const data = await response.json();

      if (data.completion && data.completion.length > 0) {
        // Only show if cursor hasn't moved since we started
        const newPos = editor.getCursorPosition();
        if (newPos.row === cursorPos.row && newPos.column === cursorPos.column) {
          showGhostText(data.completion, cursorPos.row, cursorPos.column);
        }
      }
    } catch (e) {
      // Silently ignore aborts and errors
    }
  }, [editor, enabled, teamId, datasetId, dataRequestId, showGhostText]);

  // Main effect: attach editor event handlers
  useEffect(() => {
    if (!editor || !enabled) return;

    const onChange = () => {
      clearGhostText();

      // Cancel pending request
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      // Debounce new request
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        fetchCompletion();
      }, debounceMs);
    };

    const onCursorChange = () => {
      // If there's ghost text and cursor moved away from it, dismiss
      if (ghostTextRef.current) {
        const pos = editor.getCursorPosition();
        if (pos.row !== ghostTextRef.current.row || pos.column !== ghostTextRef.current.column) {
          clearGhostText();
        }
      }
    };

    // Tab to accept ghost text
    const onKeyDown = (e) => {
      if (ghostTextRef.current) {
        if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          acceptGhostText();
          return;
        }
        if (e.key === "Escape") {
          clearGhostText();
          return;
        }
      }
    };

    const session = editor.getSession();
    session.on("change", onChange);
    editor.selection.on("changeCursor", onCursorChange);
    editor.container.addEventListener("keydown", onKeyDown, true);

    return () => {
      session.off("change", onChange);
      editor.selection.off("changeCursor", onCursorChange);
      editor.container.removeEventListener("keydown", onKeyDown, true);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
      clearGhostText();
    };
  }, [editor, enabled, debounceMs, fetchCompletion, clearGhostText, acceptGhostText]);
}
