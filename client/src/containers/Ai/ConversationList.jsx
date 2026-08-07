import React from "react"
import PropTypes from "prop-types"
import {
  Button, Input, Checkbox, Spinner, Divider, Popover, PopoverTrigger, PopoverContent, Badge,
  Tooltip,
} from "@heroui/react"
import {
  LuSearch, LuChevronDown, LuListChecks, LuX, LuArchive, LuArchiveRestore, LuTrash2, LuMessageSquare,
  LuFilter, LuStar, LuPlus,
} from "react-icons/lu"

import { cn } from "../../modules/utils";
import ConversationListItem from "./ConversationListItem";

const SCROLL = "flex flex-col flex-1 min-h-0 gap-2 px-2 overflow-y-auto border-r border-divider py-4";

/** One checkbox row in the filter popover, with its matching count. */
function FilterOption({
  label, count, isSelected, onValueChange,
}) {
  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <Checkbox
        size="sm"
        isSelected={isSelected}
        onValueChange={onValueChange}
        classNames={{ label: "text-sm" }}
      >
        {label}
      </Checkbox>
      <span className="text-xs text-foreground-400 tabular-nums">{count}</span>
    </div>
  );
}

FilterOption.propTypes = {
  label: PropTypes.string.isRequired,
  count: PropTypes.number.isRequired,
  isSelected: PropTypes.bool.isRequired,
  onValueChange: PropTypes.func.isRequired,
};

/**
 * The conversation history list for the Edison page's left rail: a multiselect
 * filter dropdown (status + starred + "select multiple"), title search, and
 * offset pagination via "Load more". All state is owned by AiPage.
 */
function ConversationList({
  conversations, activeConversationId = null, listState, selection, rowActions,
  footer = null, onNewConversation,
}) {
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const trimmedSearch = listState.search.trim();
  const isEmpty = conversations.length === 0;
  const allLoadedSelected = conversations.length > 0
    && conversations.every((c) => selection.ids.has(c.id));

  // Badge count reflects only filters the user changed from the default
  // (active-only, unstarred), so the common case shows no badge at all.
  const activeFilterCount = (listState.statuses.includes("archived") ? 1 : 0)
    + (listState.statuses.includes("active") ? 0 : 1)
    + (listState.starredOnly ? 1 : 0);

  const bulkBar = (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-foreground-500 text-center">
        {`${selection.ids.size} selected`}
      </div>
      {/*
        Both archive verbs are offered rather than one picked from the current
        tab: with Active and Archived viewable together, a selection can span
        both states and there's no single correct verb to infer.
      */}
      <div className="flex flex-row items-center gap-1">
        <Tooltip content="Archive selected" size="sm">
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            className="flex-1 min-w-11 h-11 sm:min-w-8 sm:h-8"
            aria-label="Archive selected conversations"
            isDisabled={selection.ids.size === 0 || selection.isBusy}
            onPress={selection.onBulkArchive}
          >
            <LuArchive size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Restore selected" size="sm">
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            className="flex-1 min-w-11 h-11 sm:min-w-8 sm:h-8"
            aria-label="Restore selected conversations"
            isDisabled={selection.ids.size === 0 || selection.isBusy}
            onPress={selection.onBulkUnarchive}
          >
            <LuArchiveRestore size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Delete selected" size="sm">
          <Button
            isIconOnly
            size="sm"
            color="danger"
            variant="flat"
            className="flex-1 min-w-11 h-11 sm:min-w-8 sm:h-8"
            aria-label="Delete selected conversations"
            isDisabled={selection.ids.size === 0 || selection.isBusy}
            onPress={selection.onRequestBulkDelete}
          >
            <LuTrash2 size={14} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  const header = (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <div className="flex flex-row items-center gap-1">
        <Input
          size="sm"
          placeholder="Search conversations"
          aria-label="Search conversations by title"
          value={listState.search}
          onValueChange={listState.onSearchChange}
          startContent={<LuSearch size={14} className="text-foreground-400" />}
          endContent={listState.isSearching ? <Spinner size="sm" /> : null}
          isClearable
          onClear={() => listState.onSearchChange("")}
          classNames={{ inputWrapper: "h-11 sm:h-8", input: "text-sm" }}
          className="flex-1"
        />

        {/*
          One dropdown replaces the old Active/Archived tabs AND the separate
          multi-select toggle. A Popover of real checkboxes rather than a
          selectionMode="multiple" DropdownMenu, because "Select multiple…" is an
          action rather than a filter and mixing the two fights react-aria's
          selection model.
        */}
        {selection.mode ? (
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            color="primary"
            aria-label="Cancel selection"
            className="shrink-0 min-w-11 h-11 sm:min-w-8 sm:h-8"
            onPress={selection.onToggleMode}
          >
            <LuX size={16} />
          </Button>
        ) : (
          <Popover placement="bottom-end" isOpen={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger>
              <Button
                isIconOnly
                size="sm"
                variant={activeFilterCount > 0 ? "flat" : "light"}
                color={activeFilterCount > 0 ? "primary" : "default"}
                aria-label="Filter conversations"
                className="shrink-0 min-w-11 h-11 sm:min-w-8 sm:h-8"
              >
                <Badge
                  content={activeFilterCount}
                  size="sm"
                  color="primary"
                  isInvisible={activeFilterCount === 0}
                  classNames={{ badge: "text-[9px] h-3.5 min-w-3.5" }}
                >
                  <LuFilter size={16} />
                </Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60 px-3 py-2">
              <div className="flex flex-col gap-2 w-full">
                <div className="text-xs font-medium text-foreground-500">Show</div>
                <FilterOption
                  label="Active"
                  count={listState.activeCount}
                  isSelected={listState.statuses.includes("active")}
                  onValueChange={(checked) => listState.onToggleStatus("active", checked)}
                />
                <FilterOption
                  label="Archived"
                  count={listState.archivedCount}
                  isSelected={listState.statuses.includes("archived")}
                  onValueChange={(checked) => listState.onToggleStatus("archived", checked)}
                />
                <Divider />
                <FilterOption
                  label="Starred only"
                  count={listState.starredCount}
                  isSelected={listState.starredOnly}
                  onValueChange={listState.onToggleStarredOnly}
                />
                <Divider />
                <Button
                  size="sm"
                  variant="light"
                  fullWidth
                  className="justify-start h-9"
                  startContent={<LuListChecks size={16} />}
                  onPress={() => { setFiltersOpen(false); selection.onToggleMode(); }}
                >
                  Select multiple…
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {selection.mode && (
        <div className="flex flex-row items-center justify-between gap-2">
          <Checkbox
            size="sm"
            isSelected={allLoadedSelected}
            isIndeterminate={selection.ids.size > 0 && !allLoadedSelected}
            onValueChange={selection.onToggleAllLoaded}
            isDisabled={isEmpty}
            classNames={{ label: "text-xs text-foreground-500" }}
          >
            {`Select all (${conversations.length})`}
          </Checkbox>
          {listState.hasMore && allLoadedSelected && (
            <span className="text-[10px] text-foreground-400">Load more to select the rest</span>
          )}
        </div>
      )}

    </div>
  );

  const emptyState = () => {
    if (listState.isLoading) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Spinner size="sm" />
          <div className="text-xs text-foreground-500">Loading conversations...</div>
        </div>
      );
    }

    if (trimmedSearch) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
          <LuSearch size={20} className="text-foreground-400" />
          <div className="text-sm text-foreground-500">
            {`No conversations match "${trimmedSearch}"`}
          </div>
          <Button size="sm" variant="light" onPress={() => listState.onSearchChange("")}>
            Clear search
          </Button>
        </div>
      );
    }

    // The message names whichever filter is responsible for the list being
    // empty, so "nothing here" is never a dead end.
    if (listState.starredOnly) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
          <LuStar size={20} className="text-foreground-400" />
          <div className="text-sm text-foreground-500">
            No starred conversations. Star one to pin it to the top of the list.
          </div>
        </div>
      );
    }

    const archivedOnly = listState.statuses.includes("archived")
      && !listState.statuses.includes("active");

    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
        {archivedOnly
          ? <LuArchive size={20} className="text-foreground-400" />
          : <LuMessageSquare size={20} className="text-foreground-400" />}
        <div className="text-sm text-foreground-500">
          {archivedOnly
            ? "Nothing archived yet. Archived conversations are hidden from Active but never deleted."
            : "No conversations yet. Ask Edison something to get started."}
        </div>
      </div>
    );
  };

  return (
    <>
      {header}
      <div
        // pb clears the absolutely-positioned footer, which now holds the New
        // Conversation button (or the bulk bar) plus the token total.
        className={cn(SCROLL, "pb-24")}
      >
        {isEmpty ? emptyState() : conversations.map((conv) => (
          <ConversationListItem
            key={conv.id}
            conversation={conv}
            isActive={`${conv.id}` === `${activeConversationId}`}
            selectionMode={selection.mode}
            isSelected={selection.ids.has(conv.id)}
            onToggleSelect={selection.onToggle}
            onToggleStar={rowActions.onToggleStar}
            isRenaming={rowActions.renamingConversationId === conv.id}
            renameValue={rowActions.renameValue}
            onRenameValueChange={rowActions.onRenameValueChange}
            onConfirmRename={rowActions.onConfirmRename}
            onCancelRename={rowActions.onCancelRename}
            onSelect={rowActions.onSelect}
            onStartRename={rowActions.onStartRename}
            onFork={rowActions.onFork}
            onShare={rowActions.onShare}
            onArchive={rowActions.onArchive}
            onUnarchive={rowActions.onUnarchive}
            onRequestDelete={rowActions.onRequestDelete}
          />
        ))}

        {/* Last child of the scroll area, so it never fights the sticky footer. */}
        {listState.hasMore && (
          <Button
            fullWidth
            size="sm"
            variant="light"
            className="h-11 sm:h-8 shrink-0"
            isLoading={listState.isLoadingMore}
            onPress={listState.onLoadMore}
            endContent={!listState.isLoadingMore ? <LuChevronDown size={14} /> : null}
          >
            {`Load more (${conversations.length} of ${listState.total})`}
          </Button>
        )}
      </div>

      {/*
        Sticky bottom slot: New Conversation lives here (with the team token
        total beneath it), and the bulk action bar takes it over while selecting.
      */}
      <div className="absolute bottom-0 left-0 right-0 p-2 border-r border-t border-divider bg-content2">
        {selection.mode ? bulkBar : (
          <div className="flex flex-col gap-1">
            <Button
              color="primary"
              size="sm"
              className="h-11 sm:h-9"
              startContent={<LuPlus size={18} />}
              onPress={onNewConversation}
              fullWidth
            >
              New Conversation
            </Button>
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

ConversationList.propTypes = {
  conversations: PropTypes.array.isRequired,
  activeConversationId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),

  listState: PropTypes.shape({
    statuses: PropTypes.arrayOf(PropTypes.oneOf(["active", "archived"])).isRequired,
    starredOnly: PropTypes.bool.isRequired,
    search: PropTypes.string.isRequired,
    activeCount: PropTypes.number.isRequired,
    archivedCount: PropTypes.number.isRequired,
    starredCount: PropTypes.number.isRequired,
    total: PropTypes.number.isRequired,
    isLoading: PropTypes.bool,
    isLoadingMore: PropTypes.bool,
    isSearching: PropTypes.bool,
    hasMore: PropTypes.bool,
    onToggleStatus: PropTypes.func.isRequired,
    onToggleStarredOnly: PropTypes.func.isRequired,
    onSearchChange: PropTypes.func.isRequired,
    onLoadMore: PropTypes.func.isRequired,
  }).isRequired,

  selection: PropTypes.shape({
    mode: PropTypes.bool.isRequired,
    ids: PropTypes.instanceOf(Set).isRequired,
    isBusy: PropTypes.bool,
    onToggleMode: PropTypes.func.isRequired,
    onToggle: PropTypes.func.isRequired,
    onToggleAllLoaded: PropTypes.func.isRequired,
    onBulkArchive: PropTypes.func.isRequired,
    onBulkUnarchive: PropTypes.func.isRequired,
    onRequestBulkDelete: PropTypes.func.isRequired,
  }).isRequired,

  rowActions: PropTypes.shape({
    onSelect: PropTypes.func.isRequired,
    onStartRename: PropTypes.func.isRequired,
    onCancelRename: PropTypes.func.isRequired,
    onConfirmRename: PropTypes.func.isRequired,
    onRenameValueChange: PropTypes.func.isRequired,
    renamingConversationId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    renameValue: PropTypes.string,
    onFork: PropTypes.func.isRequired,
    onShare: PropTypes.func.isRequired,
    onArchive: PropTypes.func.isRequired,
    onUnarchive: PropTypes.func.isRequired,
    onToggleStar: PropTypes.func.isRequired,
    onRequestDelete: PropTypes.func.isRequired,
  }).isRequired,

  // Sits under the New Conversation button in the sticky footer slot.
  footer: PropTypes.node,
  onNewConversation: PropTypes.func.isRequired,
};

export default ConversationList;
