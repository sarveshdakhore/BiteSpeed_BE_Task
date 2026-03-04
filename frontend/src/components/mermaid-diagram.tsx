import { useEffect, useRef, useState } from 'react';
import type mermaidType from 'mermaid';

import { cn } from '../lib/utils';

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

let initialized = false;
let mermaidModulePromise: Promise<typeof mermaidType> | null = null;

async function getMermaid(): Promise<typeof mermaidType> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => module.default);
  }

  return mermaidModulePromise;
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const render = async (): Promise<void> => {
      if (!containerRef.current) {
        return;
      }

      try {
        const mermaid = await getMermaid();
        if (!initialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'neutral',
          });
          initialized = true;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);
        containerRef.current.innerHTML = svg;
        setError(null);
      } catch (diagramError) {
        setError('Unable to render flowchart');
      }
    };

    void render();
  }, [chart]);

  return (
    <div className={cn('rounded-xl border border-border bg-card/70 p-4', className)}>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div ref={containerRef} className="mermaid overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />
      )}
    </div>
  );
}
