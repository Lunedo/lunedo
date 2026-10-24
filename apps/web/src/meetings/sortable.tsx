import {
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { classNames, HIT_AREA } from "@lunedo/ui";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function useSortableSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

export function useSortableAccessibility(nameOf: (id: UniqueIdentifier) => string): {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
} {
  const { t } = useTranslation();
  return {
    screenReaderInstructions: { draggable: t("meetings.drag.instructions") },
    announcements: {
      onDragStart: ({ active }) => t("meetings.drag.picked", { name: nameOf(active.id) }),
      onDragOver: ({ active, over }) =>
        over ? t("meetings.drag.over", { name: nameOf(active.id), target: nameOf(over.id) }) : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t("meetings.drag.dropped", { name: nameOf(active.id), target: nameOf(over.id) })
          : t("meetings.drag.cancelled", { name: nameOf(active.id) }),
      onDragCancel: ({ active }) => t("meetings.drag.cancelled", { name: nameOf(active.id) }),
    },
  };
}

export interface DropIndicator {
  overId: UniqueIdentifier;
  after: boolean;
}

function placement(event: DragOverEvent | DragEndEvent): DropIndicator | null {
  const { active, over } = event;
  if (!over || over.id === active.id) return null;
  const moving = active.rect.current.translated;
  if (Math.abs(event.delta.x) < over.rect.width / 2) return { overId: over.id, after: event.delta.y > 0 };
  const middle = moving ? moving.top + moving.height / 2 : 0;
  return { overId: over.id, after: middle > over.rect.top + over.rect.height / 2 };
}

export function useDropIndicator() {
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  return {
    indicator,
    onDragOver: (event: DragOverEvent) => setIndicator(placement(event)),
    finish: (event: DragEndEvent): DropIndicator | null => {
      setIndicator(null);
      return placement(event);
    },
    clear: () => setIndicator(null),
  };
}

export function DropLine({ show }: { show: boolean }) {
  return show ? <div aria-hidden="true" data-drop-line="" className="border-t-2 border-accent" /> : null;
}

export function useSortableItem(id: string, disabled: boolean) {
  const sortable = useSortable({ id, disabled });
  return {
    setNodeRef: sortable.setNodeRef,
    dragging: sortable.isDragging,
    handle: (label: string) => (
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={label}
        disabled={disabled}
        className={classNames(
          HIT_AREA,
          "flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 focus-visible:focus-ring active:cursor-grabbing disabled:hidden pointer-coarse:opacity-100",
        )}
      >
        <GripVertical aria-hidden="true" className="size-icon-sm" />
      </button>
    ),
  };
}
