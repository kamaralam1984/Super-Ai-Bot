import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const NODE_COUNT = 46;
const LINK_DISTANCE = 130;

/**
 * Ambient telemetry-grid background — drifting nodes that link when close,
 * plus a slow radar-style sweep. Reads --accent from the live theme each
 * frame so it never needs to know about light/dark itself. Skips the RAF
 * loop entirely under prefers-reduced-motion, per the accessibility
 * requirement — not just a slower version, genuinely static.
 */
export function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nodes: Node[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.6 + 0.6,
      });
    }

    const getAccentRgb = (): string => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      return raw || "224 145 61";
    };

    let sweepAngle = 0;
    let rafId = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const accent = getAccentRgb();

      // radar-style sweep, very faint, wide gradient wedge rotating slowly
      const cx = width * 0.5;
      const cy = height * 0.35;
      const sweepGradient = ctx.createConicGradient(sweepAngle, cx, cy);
      sweepGradient.addColorStop(0, `rgb(${accent} / 0)`);
      sweepGradient.addColorStop(0.02, `rgb(${accent} / 0.05)`);
      sweepGradient.addColorStop(0.05, `rgb(${accent} / 0)`);
      sweepGradient.addColorStop(1, `rgb(${accent} / 0)`);
      ctx.fillStyle = sweepGradient;
      ctx.fillRect(0, 0, width, height);

      // nodes + links
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!reduceMotion) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
        }

        for (let j = i + 1; j < nodes.length; j++) {
          const o = nodes[j];
          const dx = n.x - o.x;
          const dy = n.y - o.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DISTANCE) {
            const alpha = (1 - dist / LINK_DISTANCE) * 0.12;
            ctx.strokeStyle = `rgb(${accent} / ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(o.x, o.y);
            ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = `rgb(${accent} / 0.35)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduceMotion) {
        sweepAngle += 0.0026;
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-70" aria-hidden="true" />;
}
