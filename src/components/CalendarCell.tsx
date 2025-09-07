import React, { memo } from 'react';

interface CalendarCellProps {
  iso: string;
  rowIdx: number;
  objective: { id: string; name: string; color: string; archived?: boolean } | null;
  isVisible: boolean;
  completed: boolean;
  showObjectiveNames: boolean;
  tickColor: string;
  onMouseDown: (iso: string, rowIdx: number, e: React.MouseEvent) => void;
  onMouseEnter: (iso: string, rowIdx: number) => void;
  onTouchStart: (iso: string, rowIdx: number) => void;
  onTouchMove: (e: React.TouchEvent) => void;
}

const CalendarCell = memo(({
  iso,
  rowIdx,
  objective,
  isVisible,
  completed,
  showObjectiveNames,
  tickColor,
  onMouseDown,
  onMouseEnter,
  onTouchStart,
  onTouchMove
}: CalendarCellProps) => {
  const titleText = objective && isVisible
    ? 'Alt-drag to toggle done'
    : 'Paint';

  // Pre-calculate styles to avoid recreating objects
  const cellBackground = objective && isVisible ? `${objective.color}22` : undefined;
  const innerBackground = objective?.color;
  
  // Use CSS classes for completion pattern instead of inline styles
  const completionClass = completed ? 'cell-completed' : '';

  return (
    <div
      className={`calendar-cell ${completionClass}`}
      onMouseDown={(e) => onMouseDown(iso, rowIdx, e)}
      onMouseEnter={() => onMouseEnter(iso, rowIdx)}
      onTouchStart={() => onTouchStart(iso, rowIdx)}
      onTouchMove={onTouchMove}
      data-rowidx={rowIdx}
      data-iso={iso}
      style={cellBackground ? { backgroundColor: cellBackground } : undefined}
      title={titleText}
    >
      {objective && isVisible && (
        <div 
          className="cell-inner"
          style={{ backgroundColor: innerBackground }}
          data-tick-color={completed ? tickColor : undefined}
        >
          {showObjectiveNames && (
            <div className="cell-label">
              {objective.name}
            </div>
          )}
        </div>
      )}
      {(!objective || !isVisible) && (
        <div className="cell-hint">paint</div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for better performance
  return (
    prevProps.iso === nextProps.iso &&
    prevProps.rowIdx === nextProps.rowIdx &&
    prevProps.objective?.id === nextProps.objective?.id &&
    prevProps.objective?.color === nextProps.objective?.color &&
    prevProps.objective?.name === nextProps.objective?.name &&
    prevProps.isVisible === nextProps.isVisible &&
    prevProps.completed === nextProps.completed &&
    prevProps.showObjectiveNames === nextProps.showObjectiveNames &&
    prevProps.tickColor === nextProps.tickColor
  );
});

CalendarCell.displayName = 'CalendarCell';

export default CalendarCell;