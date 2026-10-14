"use client";

import { useLayoutEffect, useRef } from "react";

interface SelectionBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
const position = (box: SelectionBox) => `translate3d(${box.x}px, ${box.y}px, 0)`;
const counterPosition = (box: SelectionBox) => `translate3d(${-box.x}px, ${-box.y}px, 0)`;
interface InkItem { readonly source: HTMLElement; readonly item: HTMLSpanElement; readonly signature: string; }

/** One visual selection; only authored navigation ink is copied, never controls or pages. */
export function GlassSelection({ routeKey, targetSelector = '[aria-current="page"]', visualSelector = ".journey-glass-visual" }: Readonly<{ routeKey: string; targetSelector?: string; visualSelector?: string }>) {
  const lensRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const rimRef = useRef<HTMLSpanElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<SelectionBox | null>(null);
  const previousRoute = useRef(routeKey);
  const animationRef = useRef<Animation | null>(null);
  const effectsRef = useRef<Animation[]>([]);
  const inkItemsRef = useRef<InkItem[]>([]);

  useLayoutEffect(() => {
    const lens = lensRef.current, fill = fillRef.current, rim = rimRef.current, ink = inkRef.current;
    const container = lens?.parentElement;
    if (!lens || !container || !fill || !rim || !ink) return;
    const motion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
    const visuals = [...container.querySelectorAll<HTMLElement>(visualSelector)].filter((node) => !lens.contains(node));
    let inkItems = inkItemsRef.current;
    const cancel = () => { effectsRef.current.forEach((effect) => effect.cancel()); effectsRef.current = []; animationRef.current = null; };
    const relative = (rect: DOMRect, outer: DOMRect): SelectionBox => ({ x: rect.left - outer.left - container.clientLeft + container.scrollLeft, y: rect.top - outer.top - container.clientTop + container.scrollTop, width: rect.width, height: rect.height });

    const syncHover = () => {
      const hover = !motion?.matches && window.matchMedia?.("(hover:hover) and (pointer:fine) and (min-width:1024px)").matches;
      inkItems.forEach(({ source, item }) => { item.dataset.hovered = String(Boolean(hover && source.closest("a,button")?.matches(":hover"))); });
    };
    const refreshInk = (outer: DOMRect) => {
      const nextItems: InkItem[] = [];
      for (const source of visuals) {
        const rect = source.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const style = getComputedStyle(source);
        const matrix = style.transform && style.transform !== "none" && typeof DOMMatrixReadOnly !== "undefined" ? new DOMMatrixReadOnly(style.transform) : undefined;
        const width = rect.width / (matrix?.a || 1), height = rect.height / (matrix?.d || 1);
        const box = relative(rect, outer);
        const signature = [box.x, box.y, width, height, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, source.innerHTML].join("|");
        const cached = inkItems.find((entry) => entry.source === source && entry.signature === signature);
        if (cached) { nextItems.push(cached); continue; }
        const item = document.createElement("span");
        item.className = "journey-glass-ink-item";
        Object.assign(item.style, { left: `${box.x + (rect.width - width) / 2}px`, top: `${box.y + (rect.height - height) / 2}px`, width: `${width}px`, height: `${height}px`, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing });
        // These selectors address only shell-owned text/glyph/badge wrappers.
        for (const child of source.childNodes) item.append(child.cloneNode(true));
        item.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        const originalGlyphs = source.querySelectorAll("svg");
        item.querySelectorAll("svg").forEach((glyph, index) => {
          const glyphStyle = getComputedStyle(originalGlyphs[index]);
          glyph.style.width = glyphStyle.width;
          glyph.style.height = glyphStyle.height;
          glyph.style.color = "inherit";
        });
        nextItems.push({ source, item, signature });
      }
      // Retain rasterized ink across tabs; only changed badges/fonts/geometry rebuild it.
      if (nextItems.length !== inkItems.length || nextItems.some((entry, index) => entry.item !== inkItems[index].item)) ink.replaceChildren(...nextItems.map((entry) => entry.item));
      inkItems = inkItemsRef.current = nextItems;
      ink.style.width = `${container.clientWidth}px`;
      ink.style.height = `${container.clientHeight}px`;
      syncHover();
    };

    const measure = (animate: boolean) => {
      const target = container.querySelector<HTMLElement>(targetSelector);
      const outer = container.getBoundingClientRect(), rect = target?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height || !outer.width || !outer.height) {
        cancel(); previous.current = null;
        lens.dataset.ready = container.dataset.glassReady = "false";
        lens.dataset.moving = container.dataset.glassMoving = "false";
        return;
      }
      const box = relative(rect, outer);
      let start = previous.current;
      const running = animationRef.current && ["running", "paused"].includes(animationRef.current.playState);
      const startOpacity = running ? Number(getComputedStyle(fill).opacity) : 1;
      const startRim = running ? Number(getComputedStyle(rim).opacity) : .4;
      if (running) start = relative(lens.getBoundingClientRect(), outer);
      // Read the original navigation before writing the selection's geometry.
      refreshInk(outer);
      cancel();
      lens.style.transform = position(box);
      lens.style.width = `${box.width}px`; lens.style.height = `${box.height}px`;
      ink.style.transform = counterPosition(box);
      lens.dataset.ready = container.dataset.glassReady = "true";
      lens.dataset.moving = container.dataset.glassMoving = "false";
      previous.current = box;
      if (!animate || !start || motion?.matches || typeof lens.animate !== "function" || (Math.abs(start.x - box.x) < 1 && Math.abs(start.y - box.y) < 1 && Math.abs(start.width - box.width) < 1)) return;

      const horizontal = Math.abs(box.x - start.x) >= Math.abs(box.y - start.y);
      const duration = 560 + Math.min(100, Math.hypot(box.x - start.x, box.y - start.y) * .12);
      const frames: Keyframe[] = [], inkFrames: Keyframe[] = [];
      for (let index = 0; index <= 40; index++) {
        const t = index / 40;
        const spring = index === 40 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(11 * t);
        const flex = index === 40 ? 0 : (1 - Math.exp(-30 * t)) * Math.exp(-3 * t) * Math.sin(10 * t);
        const width = start.width + (box.width - start.width) * spring + box.width * (horizontal ? .6 : .16) * flex;
        const height = start.height + (box.height - start.height) * spring + box.height * (horizontal ? .16 : .6) * flex;
        const x = start.x + start.width / 2 + (box.x + box.width / 2 - start.x - start.width / 2) * spring - width / 2;
        const y = start.y + start.height / 2 + (box.y + box.height / 2 - start.y - start.height / 2) * spring - height / 2;
        const frame = { x: Math.max(0, Math.min(x, container.clientWidth - width)), y: Math.max(0, Math.min(y, container.clientHeight - height)), width, height };
        const scaleX = width / box.width, scaleY = height / box.height;
        // Fixed layout bounds: native transforms carry all travel and deformation.
        frames.push({ offset: t, transform: `${position(frame)} scale(${scaleX}, ${scaleY})` });
        // Undo both deformation and travel so the clipped glyphs stay stationary.
        inkFrames.push({ offset: t, transform: `scale(${1 / scaleX}, ${1 / scaleY}) ${counterPosition(frame)}` });
      }
      const timing = { duration, easing: "linear" };
      const animation = lens.animate(frames, timing);
      effectsRef.current = [animation, ink.animate(inkFrames, timing),
        // A dark translucent tint keeps white navigation ink readable throughout.
        fill.animate([{ opacity: startOpacity }, { offset: .12, opacity: .66 }, { offset: .66, opacity: .66 }, { offset: .9, opacity: 1 }, { opacity: 1 }], timing),
        rim.animate([{ opacity: startRim }, { offset: .12, opacity: 1 }, { offset: .66, opacity: 1 }, { opacity: .4 }], timing)];
      animationRef.current = animation;
      lens.dataset.moving = container.dataset.glassMoving = "true";
      animation.onfinish = () => { if (animationRef.current === animation) measure(false); };
    };

    measure(previousRoute.current !== routeKey);
    previousRoute.current = routeKey;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      if (!animationRef.current || !["running", "paused"].includes(animationRef.current.playState)) measure(false);
    }) : undefined;
    observer?.observe(container);
    const target = container.querySelector(targetSelector);
    if (target) observer?.observe(target);
    const mutation = typeof MutationObserver === "function" ? new MutationObserver(() => {
      if (animationRef.current) refreshInk(container.getBoundingClientRect()); else measure(false);
    }) : undefined;
    visuals.forEach((visual) => mutation?.observe(visual, { childList: true, characterData: true, subtree: true }));
    const snap = () => measure(false);
    motion?.addEventListener("change", snap); window.addEventListener("resize", snap);
    container.addEventListener("pointerover", syncHover); container.addEventListener("pointerout", syncHover);
    return () => {
      observer?.disconnect(); mutation?.disconnect(); motion?.removeEventListener("change", snap); window.removeEventListener("resize", snap);
      container.removeEventListener("pointerover", syncHover); container.removeEventListener("pointerout", syncHover);
    };
  }, [routeKey, targetSelector, visualSelector]);

  useLayoutEffect(() => () => { effectsRef.current.forEach((effect) => effect.cancel()); }, []);

  return <span aria-hidden="true" className="journey-glass-selection" data-slot="glass-selection" ref={lensRef}>
    <span className="journey-glass-fill" ref={fillRef} />
    <span className="journey-glass-rim" ref={rimRef} />
    <span className="journey-glass-ink" ref={inkRef} />
  </span>;
}
