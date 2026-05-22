import React, { useEffect, useMemo, useState } from "react";
import { useFilters, useGlobalFilter, usePagination, useSortBy, useTable } from "react-table";
import PropTypes from "prop-types";
import {
  Dropdown, Spacer, Link as LinkNext, Table, Popover, Pagination, Chip,
  TableHeader, TableColumn, TableBody, TableRow, TableCell, PopoverTrigger,
  PopoverContent,
  DropdownTrigger,
  DropdownMenu,
  Button,
  DropdownItem,
  Input,
  Progress,
  Tooltip,
  Image,
} from "@heroui/react";
import {
  LuChevronDown, LuChevronUp, LuChevronsUpDown, LuExpand, LuFilter, LuSearch, LuX,
} from "react-icons/lu";

import Row from "../../../../components/Row";
import Text from "../../../../components/Text";

function ColumnFilterPopover({ column }) {
  const value = column.filterValue || "";
  return (
    <Popover placement="bottom" aria-label={`Filter ${column.id}`}>
      <PopoverTrigger>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label={`Filter ${column.id}`}
          className={`min-w-6 w-6 h-6 ${value ? "text-primary" : "text-foreground-400"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <LuFilter size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col gap-2 p-2 w-64">
          <Text className="text-xs text-foreground-500">{`Filter ${column.id}`}</Text>
          <Input
            size="sm"
            variant="bordered"
            value={value}
            placeholder="Contains..."
            onChange={(e) => column.setFilter(e.target.value || undefined)}
            onClick={(e) => e.stopPropagation()}
            endContent={value && (
              <Button isIconOnly size="sm" variant="light" onPress={() => column.setFilter(undefined)} aria-label="Clear filter">
                <LuX size={14} />
              </Button>
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

ColumnFilterPopover.propTypes = {
  column: PropTypes.object.isRequired,
};

const paginationOptions = [5, 10, 20, 30, 40, 50].map((pageSize) => ({
  key: pageSize,
  value: pageSize,
  text: `Show ${pageSize}`,
}));

// Add URL detection function
const isUrl = (str) => {
  if (typeof str !== "string") return false;
  
  // Check for common URL patterns
  const urlPatterns = [
    /^https?:\/\//i,  // http:// or https://
    /^www\./i,        // www.
    /^ftp:\/\//i,     // ftp://
    /^mailto:/i,      // mailto:
  ];

  // Check if string matches any URL pattern
  if (urlPatterns.some(pattern => pattern.test(str))) {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
  
  return false;
};

// Add long text detection function
const isLongText = (str) => {
  if (typeof str !== "string") return false;
  return str.length > 50; // Consider text longer than 50 characters as "long" for text-sm in 300px width
};

// Add text rendering rules
const renderCellContent = (value, columnKey, columnsFormatting) => {
  // 1) Compute base content (type-aware rendering)
  let baseContent = value;

  if (value === true || value === false) {
    baseContent = `${value}`;
  } else if (typeof value === "string") {
    if (isUrl(value)) {
      // Check if column format is button - if so, render as button instead of link
      const columnConfig = columnsFormatting?.[columnKey];
      if (columnConfig?.display?.format === "button") {
        const buttonSettings = columnConfig.display.button || { color: "primary", variant: "solid" };
        baseContent = (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
            <Button
              size="sm"
              color={buttonSettings.color || "primary"}
              variant={buttonSettings.variant || "solid"}
            >
              {buttonSettings.text || "View"}
            </Button>
          </a>
        );
      } else {
        baseContent = (
          <LinkNext
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            {value}
          </LinkNext>
        );
      }
    } else if (isLongText(value)) {
      baseContent = (
        <div className="flex flex-row items-center gap-1">
          <Popover>
            <PopoverTrigger>
              <Button isIconOnly variant="flat" size="sm">
                <LuExpand size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="p-4 max-w-[500px] max-h-[300px] overflow-auto">
                <div className="flex justify-between items-center mb-2">
                  <Text className="text-sm font-medium">Full Text</Text>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => navigator.clipboard.writeText(value)}
                  >
                    Copy
                  </Button>
                </div>
                <pre className="text-sm whitespace-pre-wrap">{value}</pre>
              </div>
            </PopoverContent>
          </Popover>
          <span>{value}</span>
        </div>
      );
    }
  }

  // 2) Apply mapping wrapper if configured and rule with color matches
  const columnConfig = columnsFormatting?.[columnKey];
  if (
    columnConfig?.display?.format === "mapping"
    && Array.isArray(columnConfig.display.rules)
  ) {
    const matchRule = columnConfig.display.rules.find((rule) => (
      (rule?.label === value || rule?.value === value) && !!rule?.color
    ));

    if (matchRule) {
      return (
        <Chip size="sm" radius="sm" variant="flat" style={{ backgroundColor: matchRule.color, color: "#fff" }}>
          {baseContent}
        </Chip>
      );
    }
  }

  if (columnConfig?.display?.format === "image" && value) {
    if (columnConfig.display?.image?.variant === "inline") {
      return (
        <div style={{ width: `${columnConfig.display?.image?.size}px` }}>
          <Image
            src={value}
            alt="Image"
            width={columnConfig.display?.image?.size}
            height="auto"
            className="object-contain"
          />
        </div>
      );
    } else if (columnConfig.display?.image?.variant === "popup") {
      return (
        <Popover>
          <PopoverTrigger>
            <Button variant="flat" size="sm">
              <Image src={value} alt="Image" width={columnConfig.display?.image?.size} height="auto" className="object-contain" />
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <Image
              src={value}
              alt="Image"
              className="object-contain max-w-lg"
            />
          </PopoverContent>
        </Popover>
      );
    }
  }

  if (columnConfig?.display?.format === "progress") {
    return (
      <Tooltip content={`${value} / ${columnConfig.display.progress.max}`}>
        <Progress
          aria-label="Progress"
          value={value}
          maxValue={columnConfig.display.progress.max}
        />
      </Tooltip>
    );
  }

  return baseContent;
};

function TableComponent({
  columns, data, embedded = false, dataset, defaultRowsPerPage = 10,
  searchEnabled = true, filterEnabled = true, sortEnabled = true,
}) {
  const columnsFormatting = dataset?.configuration?.columnsFormatting;
  const [searchInput, setSearchInput] = useState("");

  const defaultColumn = useMemo(() => ({
    Filter: () => null,
    filter: (rows, columnIds, filterValue) => {
      const needle = String(filterValue ?? "").toLowerCase();
      if (!needle) return rows;
      const [columnId] = columnIds;
      return rows.filter((row) => {
        const cell = row.values?.[columnId];
        if (cell === null || cell === undefined) return false;
        return String(cell).toLowerCase().includes(needle);
      });
    },
  }), []);

  const globalFilterFn = useMemo(() => (rows, _columnIds, filterValue) => {
    const needle = String(filterValue ?? "").toLowerCase().trim();
    if (!needle) return rows;
    return rows.filter((row) => (
      Object.values(row.values || {}).some((v) => {
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(needle);
      })
    ));
  }, []);

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    page,
    prepareRow,
    pageCount,
    gotoPage,
    setPageSize,
    setGlobalFilter,
    state: { pageSize, globalFilter },
    rows: filteredRows,
  } = useTable({
    columns,
    data,
    defaultColumn,
    globalFilter: globalFilterFn,
    initialState: { pageIndex: 0, pageSize: defaultRowsPerPage }
  },
  useFilters,
  useGlobalFilter,
  useSortBy,
  usePagination);

  useEffect(() => {
    setPageSize(defaultRowsPerPage);
  }, [defaultRowsPerPage]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setGlobalFilter(searchInput || undefined);
      gotoPage(0);
    }, 200);
    return () => clearTimeout(handle);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasHeaders = headerGroups
    && headerGroups[headerGroups.length - 1]
    && headerGroups[headerGroups.length - 1].headers;

  return (
    <div style={styles.mainBody(embedded)} className="flex flex-col h-full min-h-0">
      {hasHeaders && searchEnabled && (
        <Row align="center" className="gap-2 mb-2">
          <Input
            size="sm"
            variant="bordered"
            placeholder="Search table..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            startContent={<LuSearch size={14} className="text-foreground-400" />}
            endContent={searchInput && (
              <Button isIconOnly size="sm" variant="light" onPress={() => setSearchInput("")} aria-label="Clear search">
                <LuX size={14} />
              </Button>
            )}
            className="max-w-[280px]"
            aria-label="Search table"
          />
          {(globalFilter || searchInput) && (
            <Chip size="sm" variant="flat" color="primary" radius="sm">
              {`${filteredRows.length} of ${data.length}`}
            </Chip>
          )}
        </Row>
      )}

      {!hasHeaders && (
        <Text i>No results in this table</Text>
      )}

      {hasHeaders && (
        <>
          <Table
            aria-label="Table data"
            {...getTableProps()}
            isStriped
            shadow="none"
            isHeaderSticky
            classNames={{
              base: "flex-1 min-h-0",
              wrapper: "bg-content1 max-h-full overflow-auto p-0",
              thead: "[&>tr]:first:shadow-none",
              th: "sticky top-0 z-20 bg-content2 backdrop-blur",
            }}
            bottomContent={(
              <div>
                <Row align="center">
                  <Pagination
                    total={pageCount}
                    initialPage={1}
                    onChange={(page) => {
                      gotoPage(page - 1);
                    }}
                    size="sm"
                    aria-label="Pagination"
                  />
                  <Spacer x={0.5} />
                  <Dropdown aria-label="Select a page size">
                    <DropdownTrigger>
                      <Button variant="bordered" size="sm" endContent={<LuChevronDown size={16} />}>
                        {paginationOptions.find((option) => option.value === pageSize).text}
                      </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                      variant="bordered"
                      selectionMode="single"
                      selectedKeys={[`${pageSize}`]}
                      onSelectionChange={(selection) => {
                        setPageSize(Number(Object.values(selection)[0]));
                      }}
                    >
                      {paginationOptions.map((option) => (
                        <DropdownItem key={`${option.value}`} textValue={option.text}>
                          <Text>{option.text}</Text>
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  </Dropdown>
                </Row>
              </div>
            )}
          >
            <TableHeader>
              {headerGroups[headerGroups.length - 1].headers.map((column) => {
                const sortToggleProps = column.getSortByToggleProps();
                return (
                  <TableColumn
                    key={column.getHeaderProps(sortToggleProps).key}
                    style={{ whiteSpace: "unset" }}
                    className={"pl-6 pr-2 max-w-[400px]"}
                  >
                    <div className="flex flex-row items-center gap-1">
                      {sortEnabled ? (
                        <LinkNext
                          className="text-sm cursor-pointer hover:text-secondary select-none flex-1"
                          onClick={(e) => {
                            e.preventDefault();
                            sortToggleProps.onClick(e);
                          }}
                          title="Click to sort"
                        >
                          <Text className={"text-foreground-500"}>
                            {typeof column.render("Header") === "object"
                              ? column.render("Header") : column.render("Header").replace("__cb_group", "")}
                          </Text>
                        </LinkNext>
                      ) : (
                        <Text className={"text-foreground-500 text-sm flex-1"}>
                          {typeof column.render("Header") === "object"
                            ? column.render("Header") : column.render("Header").replace("__cb_group", "")}
                        </Text>
                      )}
                      {sortEnabled && (
                        <button
                          type="button"
                          aria-label={`Sort ${column.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            sortToggleProps.onClick(e);
                          }}
                          className={`p-0.5 rounded-full hover:bg-content3 ${column.isSorted ? "text-primary" : "text-foreground-300"}`}
                        >
                          {column.isSorted
                            ? (column.isSortedDesc ? <LuChevronDown size={14} /> : <LuChevronUp size={14} />)
                            : <LuChevronsUpDown size={14} />}
                        </button>
                      )}
                      {filterEnabled && column.canFilter && <ColumnFilterPopover column={column} />}
                    </div>
                  </TableColumn>
                );
              })}
            </TableHeader>
            <TableBody {...getTableBodyProps()}>
              {page.length < 1 && (
                <TableRow>
                  <TableCell key="noresult">No Results</TableCell>
                </TableRow>
              )}
              {page.map((row) => {
                prepareRow(row);
                return (
                  <TableRow key={row.getRowProps().key} {...(() => { const { key, ...rest } = row.getRowProps(); return rest; })()}>
                    {row.cells.map((cell, cellIndex) => {
                      // identify collections to render them differently
                      const cellObj = cell.render("Cell");
                      // console.log("cellObj.key", cellObj.props.column.Header);

                      const isObject = (cellObj.props.value && cellObj.props.value.indexOf && cellObj.props.value.indexOf("__cb_object") > -1) || false;
                      const isArray = (cellObj.props.value && cellObj.props.value.indexOf && cellObj.props.value.indexOf("__cb_array") > -1) || false;
                      const objDetails = (isObject || isArray)
                        && JSON.parse(cellObj.props.value.replace("__cb_object", "").replace("__cb_array", ""));

                      // this is to check if the object has only one key
                      // to display the value directly
                      const isShort = isObject && Object.keys(objDetails).length === 1;

                      return (
                        <TableCell
                          key={`${row.id}-${cell.column.id || cellIndex}`}
                          {...(() => { const { key, ...rest } = cell.getCellProps(); return rest; })()}
                          className={"max-w-[300px] pr-10 pl-10 truncate"}
                          css={{
                            userSelect: "text",
                            borderRight: cellIndex === row.cells.length - 1 ? "none" : "$accents3 solid 1px",
                          }}
                          title={cellObj.props.value}
                        >
                          {(!isObject && !isArray) && (
                            <div
                              title={cellObj.props.value}
                              className="text-sm truncate"
                            >
                              <span
                                style={{ cursor: "text", WebkitUserSelect: "text", whiteSpace: "nowrap" }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                role="presentation"
                              >
                                {(() => {
                                  const accessorKey = cell?.column?.id || cell?.column?.accessor || cell?.column?.Header;
                                  return renderCellContent(cellObj.props.value, accessorKey, columnsFormatting);
                                })()}
                              </span>
                            </div>
                          )}
                          {(isObject || isArray) && (
                            <Popover aria-label="Object details">
                              <PopoverTrigger>
                                <LinkNext>
                                  <Chip color="primary" variant={"flat"}>{(isShort && `${Object.values(objDetails)[0]}`) || "Collection"}</Chip>
                                </LinkNext>
                              </PopoverTrigger>
                              <PopoverContent>
                                <pre><code>{JSON.stringify(objDetails, null, 4)}</code></pre>
                              </PopoverContent>
                            </Popover>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
        )}
    </div>
  );
}

const styles = {
  mainBody: (embedded) => ({
    paddingBottom: embedded ? 30 : 0,
  }),
  table: {
    tableLayout: "auto",
  },
  itemsDropdown: {
    maxWidth: 200,
  }
};

TableComponent.propTypes = {
  columns: PropTypes.array.isRequired,
  data: PropTypes.array.isRequired,
  embedded: PropTypes.bool,
  dataset: PropTypes.object.isRequired,
  defaultRowsPerPage: PropTypes.number,
  searchEnabled: PropTypes.bool,
  filterEnabled: PropTypes.bool,
  sortEnabled: PropTypes.bool,
};

export default TableComponent;
