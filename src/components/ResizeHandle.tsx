import { useRef, type PointerEvent as ReactPointerEvent } from "react";

interface Props {
  vertical?: boolean;
  value: number;
  onChange: (value: number) => void;
  label: string;
  reverse?: boolean;
  min?: number;
  max?: number;
}

// 마우스와 키보드로 두 영역 사이의 비율을 조절한다.
export function ResizeHandle({
  vertical,
  value,
  onChange,
  label,
  reverse,
  min = 25,
  max = 70,
}: Props) {
  const dragging = useRef(false);

  // 드래그 시작점의 영역 크기를 기준으로 분할 비율을 계산한다.
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.current = true;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const parent = element.parentElement!.getBoundingClientRect();
    const initial = vertical ? event.clientY : event.clientX;
    const size = vertical ? parent.height : parent.width;
    const initialValue = value;
    // 포인터의 이동량을 퍼센트로 바꿔 유효 범위에 적용한다.
    element.onpointermove = (e) => {
      if (!dragging.current) return;
      const delta =
        (((vertical ? e.clientY : e.clientX) - initial) / size) * 100;
      onChange(
        Math.min(max, Math.max(min, initialValue + delta * (reverse ? -1 : 1))),
      );
    };
    element.onpointerup = () => {
      dragging.current = false;
      element.onpointermove = null;
    };
    element.onpointercancel = () => {
      dragging.current = false;
      element.onpointermove = null;
    };
  }

  return (
    <div
      className={`resize-handle ${vertical ? "horizontal" : "vertical"}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={startDrag}
      onDoubleClick={() => onChange(50)}
      onKeyDown={(e) => {
        const decrease = e.key === (vertical ? "ArrowUp" : "ArrowLeft");
        const increase = e.key === (vertical ? "ArrowDown" : "ArrowRight");
        if (decrease || increase) {
          e.preventDefault();
          onChange(
            Math.min(
              max,
              Math.max(min, value + (decrease ? -2 : 2) * (reverse ? -1 : 1)),
            ),
          );
        }
      }}
    >
      <span />
    </div>
  );
}
