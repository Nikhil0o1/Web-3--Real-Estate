/**
 * Stripe-style animated gradient mesh — a fixed-position layer of five large
 * blurred radial blobs that slowly drift on independent CSS keyframe loops.
 * Sits behind all content (z-index: -1), pointer-events disabled.
 *
 * The blobs, durations, colors, and overall opacity are all driven by CSS
 * variables defined in globals.css (--mesh-1 … --mesh-5, --mesh-opacity,
 * --mesh-blur), so light/dark mode automatically retune the look.
 */
export function BackgroundMesh() {
  return (
    <div className="bg-mesh" aria-hidden="true">
      <span className="bg-mesh__blob bg-mesh__blob--1" />
      <span className="bg-mesh__blob bg-mesh__blob--2" />
      <span className="bg-mesh__blob bg-mesh__blob--3" />
      <span className="bg-mesh__blob bg-mesh__blob--4" />
      <span className="bg-mesh__blob bg-mesh__blob--5" />
    </div>
  );
}
