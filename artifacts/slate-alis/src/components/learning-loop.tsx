// A small, decorative diagram of the SLATE loop: information moving between a
// learner, a teacher and a parent, with SLATE at the centre. It is pure SVG and
// CSS — no images, no video — and the moving dashes are switched off under
// prefers-reduced-motion (see index.css). The meaning is carried by the labels,
// never by colour alone, and the whole figure is described in text for screen
// readers.

const NODES = [
  { key: 'learner', label: 'Learner', x: 40, y: 30 },
  { key: 'teacher', label: 'Teacher', x: 300, y: 30 },
  { key: 'parent', label: 'Parent', x: 170, y: 210 },
] as const;

export function LearningLoop({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 400 260" role="img" aria-labelledby="learning-loop-title learning-loop-desc" className="h-auto w-full">
        <title id="learning-loop-title">The SLATE loop</title>
        <desc id="learning-loop-desc">
          Information flows between a learner, a teacher and a parent through SLATE at the centre: a learner's work,
          a teacher's marking and class view, and a parent's plain-language summary.
        </desc>

        {/* Connections, drawn first so the nodes sit on top. Each line runs from
            a role box to the edge of the SLATE hub. */}
        <g fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5" opacity="0.85">
          <path className="flow-dash" d="M140 74 L170 104" />
          <path className="flow-dash" d="M304 74 L230 104" />
          <path className="flow-dash" d="M200 180 L220 208" />
        </g>

        {/* SLATE hub. */}
        <g>
          <circle cx="200" cy="134" r="46" fill="hsl(var(--primary))" />
          <text x="200" y="130" textAnchor="middle" className="display-face" fontSize="18" fontWeight="700" fill="hsl(var(--primary-foreground))">SLATE</text>
          <text x="200" y="148" textAnchor="middle" fontSize="9" letterSpacing="1.4" fill="hsl(var(--primary-foreground))" opacity="0.75">ONE LOOP</text>
        </g>

        {/* Role nodes. */}
        {NODES.map((node) => (
          <g key={node.key}>
            <rect x={node.x} y={node.y} width="104" height="44" rx="14" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
            <text x={node.x + 52} y={node.y + 27} textAnchor="middle" fontSize="13" fontWeight="700" fill="hsl(var(--card-foreground))">{node.label}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
        Learning, assessment, analysis and support travel the same loop.
      </figcaption>
    </figure>
  );
}
