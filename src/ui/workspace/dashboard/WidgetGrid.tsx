"use client";

/**
 * Drag-and-drop, resizable chart grid (dnd-kit). Widgets sit on a 12-column
 * grid with 72 px rows and 12 px gaps and can be resized with the pointer or
 * the arrow keys; Compact mode shortens them. Order and sizes are stored per
 * widget in the workspace store.
 *
 * Rows are packed so the dashboard reads at a glance (packRows): each chart
 * gets at least the width its kind needs to stay legible (MIN_PX: a donut's
 * labels, a monthly trend's axis, a table's columns), measured against the
 * grid's real width; charts that don't fit on a row start the next one; and
 * the space left at the end of a row is shared out, so rows always fill the
 * width with no holes. Cards on a row share its tallest height, so their
 * edges line up. On a narrow screen every chart takes the full width.
 */
import * as React from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoveDiagonal2 } from "lucide-react";
import type { ChartSpec, LayoutMode } from "@/engine/charts/types";
import { packRows } from "./layout";
import { useWorkspace, type Widget } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { ChartCard } from "@/ui/charts/ChartCard";

const ROW = 72;
const GAP = 12;
function sizeFor(w: Widget, mode: LayoutMode): { w: number; h: number } {
  if (mode === "compact")
    return { w: Math.max(3, Math.min(12, w.w <= 4 ? 4 : w.w >= 12 ? 12 : 6)), h: Math.max(3, w.h - 1) };
  return { w: w.w, h: w.h };
}

function SortableWidget({
  widget,
  spec,
  mode,
  placed,
}: {
  widget: Widget;
  spec: ChartSpec;
  mode: LayoutMode;
  /** Span and height from packRows; the stored size while resizing. */
  placed: { w: number; h: number };
}) {
  const data = useWorkspace((s) => s.charts[spec.id]);
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });
  const [preview, setPreview] = React.useState<{ w: number; h: number } | null>(null);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const size = preview ?? placed;

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    const grid = el?.parentElement;
    if (!el || !grid) return;
    const colW = (grid.clientWidth - GAP * 11) / 12;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = sizeFor(widget, mode);
    let latest = start;
    const move = (ev: PointerEvent) => {
      const w = Math.max(3, Math.min(12, Math.round(start.w + (ev.clientX - startX) / (colW + GAP))));
      const h = Math.max(3, Math.min(9, Math.round(start.h + (ev.clientY - startY) / (ROW + GAP))));
      latest = { w, h };
      setPreview(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      updateWidget(widget.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeKey = (e: React.KeyboardEvent) => {
    const s = sizeFor(widget, mode);
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    updateWidget(widget.id, {
      w: Math.max(3, Math.min(12, s.w + (step[0] as number))),
      h: Math.max(3, Math.min(9, s.h + (step[1] as number))),
    });
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        ref.current = node;
      }}
      style={
        {
          "--w": size.w,
          gridRow: `span ${size.h} / span ${size.h}`,
          transform: CSS.Translate.toString(transform),
          transition,
          minHeight: size.h * ROW + (size.h - 1) * GAP,
        } as React.CSSProperties
      }
      className={cn(
        "group/widget relative col-span-12 sm:[grid-column:span_var(--w)/span_var(--w)]",
        isDragging && "z-30 opacity-90",
      )}
    >
      <ChartCard spec={spec} widget={widget} data={data} />
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${spec.title}`}
        className="no-print absolute top-3.5 -left-2.5 z-20 hidden h-7 w-5 cursor-grab place-items-center rounded-[6px] border border-border-strong bg-surface-2 text-fg-subtle opacity-0 shadow-card transition-opacity group-hover/widget:opacity-100 hover:text-fg focus-visible:opacity-100 active:cursor-grabbing md:grid"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
        aria-label={`Resize ${spec.title}: use arrow keys`}
        className="no-print absolute right-1 bottom-1 z-20 hidden size-6 cursor-nwse-resize place-items-center rounded-[6px] text-fg-subtle opacity-0 transition-opacity group-hover/widget:opacity-100 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 md:grid"
      >
        <MoveDiagonal2 className="size-3.5" aria-hidden />
      </button>
      {preview ? (
        <div className="pointer-events-none absolute inset-0 rounded-card border-2 border-dashed border-accent bg-accent-soft">
          <span className="font-figures absolute top-3 right-3 rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-2xs text-fg">
            {preview.w} × {preview.h}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function WidgetGrid({ specs, mode }: { specs: ChartSpec[]; mode: LayoutMode }) {
  const widgets = useWorkspace((s) => s.widgets);
  const moveWidget = useWorkspace((s) => s.moveWidget);
  const byId = new Map(specs.map((s) => [s.id, s]));
  const items = widgets.filter((w) => !w.hidden && byId.has(w.id) && byId.get(w.id)?.modes.includes(mode));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) moveWidget(String(e.active.id), String(e.over.id));
  };
  // The grid's real width decides how many columns each chart needs; it is
  // measured as it changes (window resizes, the filter rail opening).
  const [width, setWidth] = React.useState(0);
  const observer = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    observer.current.observe(node);
  }, []);
  if (!items.length) return null;
  const placed = new Map(
    packRows(
      items.map((w) => {
        const spec = byId.get(w.id) as ChartSpec;
        const s = sizeFor(w, mode);
        return { id: w.id, w: s.w, h: s.h, kind: w.kind ?? spec.kind };
      }),
      width,
    )
      .flat()
      .map((p) => [p.id, { w: p.span, h: p.h }]),
  );
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div ref={measure} className="grid grid-cols-12 gap-3" style={{ gridAutoRows: `${ROW}px` }}>
          {items.map((w) => (
            <SortableWidget
              key={w.id}
              widget={w}
              spec={byId.get(w.id) as ChartSpec}
              mode={mode}
              placed={placed.get(w.id) ?? sizeFor(w, mode)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
