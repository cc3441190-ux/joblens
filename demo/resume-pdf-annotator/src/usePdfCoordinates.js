import { useCallback, useMemo } from "react";

/**
 * 将 PDF 用户空间矩形（左下角为 (x,y)，高向上）转换为当前 viewport 下的 CSS 像素框。
 * 必须使用 viewport.convertToViewportPoint，禁止手写矩阵缩放。
 */
export function usePdfCoordinates(viewport) {
  const rectToCss = useCallback(
    (rect) => {
      if (!viewport || !rect) return null;

      const x0 = rect.x;
      const y0 = rect.y;
      const x1 = rect.x + rect.width;
      const y1 = rect.y + rect.height;

      const [vx0, vy0] = viewport.convertToViewportPoint(x0, y1);
      const [vx1, vy1] = viewport.convertToViewportPoint(x1, y0);

      const left = Math.min(vx0, vx1);
      const top = Math.min(vy0, vy1);
      const width = Math.abs(vx1 - vx0);
      const height = Math.abs(vy1 - vy0);

      return { left, top, width, height };
    },
    [viewport]
  );

  const convertPoint = useCallback(
    (x, y) => {
      if (!viewport) return null;
      const [vx, vy] = viewport.convertToViewportPoint(x, y);
      return { x: vx, y: vy };
    },
    [viewport]
  );

  return useMemo(
    () => ({
      rectToCss,
      convertPoint,
    }),
    [rectToCss, convertPoint]
  );
}
