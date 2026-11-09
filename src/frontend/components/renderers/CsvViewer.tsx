import React, { useState, useMemo, useRef } from 'react';
import {
  Table as TableIcon,
  Search,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Download,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SlidersHorizontal,
} from 'lucide-react';
import {
  parseCsv,
  compareCsvValues,
  autoDetectDelimiter,
  exportToCsv,
  exportToJson,
} from '../../utils/csvParser.js';

export const CsvViewer: React.FC<{
  filePath: string;
  content: string | null;
  projectId?: string;
}> = ({ filePath, content, projectId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Parsing options
  const [customDelimiter, setCustomDelimiter] = useState<string>('auto');
  const [hasHeaderRow, setHasHeaderRow] = useState<boolean>(true);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);

  // Filter state
  const [globalFilter, setGlobalFilter] = useState<string>('');
  const [isColumnFilterOpen, setIsColumnFilterOpen] = useState<boolean>(false);
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Copy feedback state
  const [copied, setCopied] = useState<boolean>(false);

  const fileName = filePath.split('/').pop() || filePath;
  const ext = filePath.split('.').pop()?.toUpperCase() || 'CSV';

  // 1. Parse raw text into 2D string array
  const rawRows = useMemo(() => {
    if (!content) return [];
    const delim = customDelimiter === 'auto' ? undefined : customDelimiter;
    return parseCsv(content, delim);
  }, [content, customDelimiter]);

  // Detected delimiter display string
  const detectedDelim = useMemo(() => {
    if (!content) return ',';
    return autoDetectDelimiter(content);
  }, [content]);

  // 2. Extract headers & data rows
  const { headers, dataRows } = useMemo(() => {
    if (rawRows.length === 0) {
      return { headers: [], dataRows: [] };
    }

    if (hasHeaderRow) {
      const headerList = rawRows[0].map((h, i) => (h && h.trim() ? h.trim() : `Column ${i + 1}`));
      const body = rawRows.slice(1);
      return { headers: headerList, dataRows: body };
    } else {
      const maxCols = rawRows[0]?.length || 0;
      const genericHeaders = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
      return { headers: genericHeaders, dataRows: rawRows };
    }
  }, [rawRows, hasHeaderRow]);

  // 3. Filter rows based on global search & column-level filters
  const filteredRows = useMemo(() => {
    const trimmedGlobal = globalFilter.trim().toLowerCase();
    const activeColumnFilters = Object.entries(columnFilters).filter(
      ([_, val]) => val && val.trim().length > 0
    );

    return dataRows.filter((row) => {
      // Global filter check
      if (trimmedGlobal) {
        const matchesGlobal = row.some((cell) => (cell ?? '').toLowerCase().includes(trimmedGlobal));
        if (!matchesGlobal) return false;
      }

      // Column filters check
      for (const [colIdxStr, filterVal] of activeColumnFilters) {
        const colIdx = Number(colIdxStr);
        const cell = row[colIdx] ?? '';
        if (!cell.toLowerCase().includes(filterVal.trim().toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }, [dataRows, globalFilter, columnFilters]);

  // 4. Sort filtered rows
  const sortedRows = useMemo(() => {
    if (sortColumn === null || sortDirection === null) {
      return filteredRows;
    }

    const rowsCopy = [...filteredRows];
    rowsCopy.sort((rowA, rowB) => {
      const valA = rowA[sortColumn] ?? '';
      const valB = rowB[sortColumn] ?? '';
      const diff = compareCsvValues(valA, valB);
      return sortDirection === 'asc' ? diff : -diff;
    });

    return rowsCopy;
  }, [filteredRows, sortColumn, sortDirection]);

  // 5. Pagination
  const totalRows = sortedRows.length;
  const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const displayedRows = useMemo(() => {
    if (pageSize === -1) return sortedRows;
    const start = (validCurrentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, validCurrentPage, pageSize]);

  // Handlers
  const handleSort = (colIndex: number) => {
    if (sortColumn !== colIndex) {
      setSortColumn(colIndex);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else if (sortDirection === 'desc') {
      setSortColumn(null);
      setSortDirection(null);
    }
    setCurrentPage(1);
  };

  const handleGlobalFilterChange = (val: string) => {
    setGlobalFilter(val);
    setCurrentPage(1);
  };

  const handleColumnFilterChange = (colIndex: number, val: string) => {
    setColumnFilters((prev) => ({
      ...prev,
      [colIndex]: val,
    }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setGlobalFilter('');
    setColumnFilters({});
    setSortColumn(null);
    setSortDirection(null);
    setCurrentPage(1);
  };

  const hasActiveFilters =
    globalFilter.trim().length > 0 ||
    Object.values(columnFilters).some((v) => v && v.trim().length > 0) ||
    sortColumn !== null;

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
  };

  const handleCopy = (format: 'csv' | 'json' = 'csv') => {
    const textToCopy =
      format === 'json'
        ? exportToJson(headers, sortedRows)
        : exportToCsv(headers, sortedRows, customDelimiter === 'auto' ? detectedDelim : customDelimiter);

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const startIndex = totalRows === 0 ? 0 : (validCurrentPage - 1) * pageSize + 1;
  const endIndex = pageSize === -1 ? totalRows : Math.min(validCurrentPage * pageSize, totalRows);

  return (
    <div
      ref={containerRef}
      dir="ltr"
      className="h-full w-full flex flex-col bg-slate-950 overflow-hidden select-text text-slate-200"
    >
      {/* Top Application Bar */}
      <div className="h-12 px-3 sm:px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 text-xs shrink-0 z-20">
        {/* Left: Badge & File Details */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold tracking-wide shrink-0">
            <TableIcon size={15} />
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 font-bold">
              {ext}
            </span>
          </span>
          <span className="font-mono text-slate-200 font-medium truncate" title={filePath}>
            {fileName}
          </span>
          <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0">
            {totalRows} {totalRows === 1 ? 'row' : 'rows'} • {headers.length} cols
          </span>
        </div>

        {/* Center / Right: Quick Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Global Search Input */}
          <div className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => handleGlobalFilterChange(e.target.value)}
              placeholder="Search table..."
              className="w-28 sm:w-44 md:w-56 h-7 pl-7 pr-6 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => handleGlobalFilterChange('')}
                className="absolute right-2 text-slate-400 hover:text-slate-200"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Column Filters Toggle */}
          <button
            type="button"
            onClick={() => setIsColumnFilterOpen((prev) => !prev)}
            title="Toggle Column Filters"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors border ${
              isColumnFilterOpen
                ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border-transparent'
            }`}
          >
            <Filter size={13} />
            <span className="hidden lg:inline">Filters</span>
          </button>

          {/* Options Dropdown / Selectors */}
          <div className="hidden sm:flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px]">
            <select
              value={customDelimiter}
              onChange={(e) => {
                setCustomDelimiter(e.target.value);
                setCurrentPage(1);
              }}
              title="CSV Delimiter"
              className="bg-transparent text-slate-300 px-1.5 py-0.5 focus:outline-none cursor-pointer"
            >
              <option value="auto" className="bg-slate-900">
                Auto ({detectedDelim === '\t' ? 'Tab' : detectedDelim})
              </option>
              <option value="," className="bg-slate-900">Comma (,)</option>
              <option value=";" className="bg-slate-900">Semicolon (;)</option>
              <option value="&#9;" className="bg-slate-900">Tab (\t)</option>
              <option value="|" className="bg-slate-900">Pipe (|)</option>
            </select>
          </div>

          {/* Toggle Header Row */}
          <button
            type="button"
            onClick={() => {
              setHasHeaderRow((prev) => !prev);
              setCurrentPage(1);
            }}
            title={hasHeaderRow ? 'Header row enabled (click to disable)' : 'Header row disabled (click to enable)'}
            className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors border ${
              hasHeaderRow
                ? 'bg-slate-800 text-slate-200 border-slate-700'
                : 'text-slate-400 hover:bg-slate-800 border-transparent'
            }`}
          >
            <SlidersHorizontal size={12} />
            <span className="text-[11px]">Header</span>
          </button>

          {/* Copy Table Button */}
          <button
            type="button"
            onClick={() => handleCopy('csv')}
            title="Copy Table as CSV"
            className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg text-xs transition-colors"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span className="hidden xl:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          {/* Download Button */}
          <button
            type="button"
            onClick={handleDownload}
            title="Download CSV"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Download size={14} />
          </button>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={handleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Filter Notice Bar if active */}
      {hasActiveFilters && (
        <div className="px-4 py-1.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400 font-medium">
              Filtered: {totalRows} of {dataRows.length} rows match
            </span>
            {sortColumn !== null && (
              <span className="text-slate-500 hidden sm:inline">
                • Sorted by <strong className="text-slate-300">{headers[sortColumn]}</strong> ({sortDirection?.toUpperCase()})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline flex items-center gap-1"
          >
            <X size={12} /> Clear all filters
          </button>
        </div>
      )}

      {/* Main Table Viewport */}
      <div className="flex-1 w-full overflow-auto relative">
        {dataRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
            <TableIcon size={36} className="text-slate-700 mb-2" />
            <p className="text-sm font-medium text-slate-400">No data found in this CSV file</p>
          </div>
        ) : displayedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
            <Filter size={32} className="text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-300">No rows match your filter</p>
            <p className="text-xs text-slate-500 mt-1 mb-3">Try adjusting your search criteria</p>
            <button
              onClick={handleClearFilters}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs text-slate-300">
            {/* Table Header */}
            <thead className="sticky top-0 bg-slate-900 text-slate-200 z-10 shadow-xs border-b border-slate-800">
              <tr>
                {/* Row Number Header */}
                <th className="py-2.5 px-3 w-12 text-center text-[11px] font-mono font-medium text-slate-500 border-r border-slate-800/80 bg-slate-900/90 select-none">
                  #
                </th>

                {/* Data Column Headers */}
                {headers.map((header, colIdx) => {
                  const isSorted = sortColumn === colIdx;
                  return (
                    <th
                      key={colIdx}
                      className="py-2 px-3 text-xs font-semibold text-slate-200 border-r border-slate-800/60 last:border-r-0 select-none group cursor-pointer hover:bg-slate-800/60 transition-colors"
                      onClick={() => handleSort(colIdx)}
                      title={`Click to sort by ${header}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{header}</span>
                        <span className="shrink-0 text-slate-500 group-hover:text-slate-300">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp size={13} className="text-indigo-400" />
                            ) : (
                              <ArrowDown size={13} className="text-indigo-400" />
                            )
                          ) : (
                            <ArrowUpDown size={12} className="opacity-40 group-hover:opacity-100" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>

              {/* Optional Column Filters Sub-Row */}
              {isColumnFilterOpen && (
                <tr className="bg-slate-950/80 border-t border-slate-800">
                  <th className="p-1.5 text-center text-slate-600 border-r border-slate-800">
                    <Filter size={11} className="mx-auto" />
                  </th>
                  {headers.map((header, colIdx) => (
                    <th key={colIdx} className="p-1.5 border-r border-slate-800/60 last:border-r-0">
                      <input
                        type="text"
                        value={columnFilters[colIdx] || ''}
                        onChange={(e) => handleColumnFilterChange(colIdx, e.target.value)}
                        placeholder={`Filter ${header}...`}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-6 px-2 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                      />
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {displayedRows.map((row, rowIdx) => {
                const actualRowNumber =
                  pageSize === -1
                    ? rowIdx + 1
                    : (validCurrentPage - 1) * pageSize + rowIdx + 1;

                return (
                  <tr
                    key={rowIdx}
                    className="hover:bg-slate-900/70 transition-colors even:bg-slate-950/40"
                  >
                    {/* Row Index */}
                    <td className="py-1.5 px-3 text-center text-slate-500 border-r border-slate-800/80 select-none bg-slate-950/60">
                      {actualRowNumber}
                    </td>

                    {/* Row Cells */}
                    {headers.map((_, colIdx) => {
                      const cellValue = row[colIdx] ?? '';
                      return (
                        <td
                          key={colIdx}
                          className="py-1.5 px-3 border-r border-slate-800/40 last:border-r-0 max-w-xs md:max-w-md truncate text-slate-300"
                          title={cellValue}
                        >
                          {cellValue}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="h-11 px-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0 z-20">
        {/* Left: Row Range Indicator */}
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-slate-200">{startIndex}</strong> to{' '}
            <strong className="text-slate-200">{endIndex}</strong> of{' '}
            <strong className="text-slate-200">{totalRows}</strong> rows
          </span>

          {/* Rows Per Page Selector */}
          <div className="hidden sm:flex items-center gap-1.5 ml-4 text-[11px]">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300 cursor-pointer focus:outline-none"
            >
              <option value="15">15</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="-1">All</option>
            </select>
          </div>
        </div>

        {/* Right: Page Navigation Controls */}
        {pageSize !== -1 && totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={validCurrentPage <= 1}
              title="First Page"
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <ChevronsLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={validCurrentPage <= 1}
              title="Previous Page"
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <ChevronLeft size={15} />
            </button>

            <span className="px-2 font-mono text-[11px] text-slate-300">
              Page {validCurrentPage} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={validCurrentPage >= totalPages}
              title="Next Page"
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={validCurrentPage >= totalPages}
              title="Last Page"
              className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 rounded transition-colors"
            >
              <ChevronsRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
