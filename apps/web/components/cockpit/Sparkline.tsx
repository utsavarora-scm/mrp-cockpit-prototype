'use client';

/**
 * A bare sparkline.
 *
 * Inline SVG rather than a chart library: these appear dozens at a time inside
 * table rows and KPI tiles, where a full chart runtime per instance is wasted
 * work. Zero is drawn explicitly when the series crosses it, because a balance
 * going negative is the whole point of the ones in the queue.
 */

import { cn } from '@repo/ui/lib/utils';

interface SparklineProps {
  values: number[];
  className?: string;
  /** Draw the zero line and shade below it. */
  showZero?: boolean;
}

export function Sparkline({ values, className, showZero = false }: SparklineProps) {
  if (values.length < 2) return <span className={cn('inline-block', className)} />;

  const width = 100;
  const height = 28;
  const min = Math.min(...values, showZero ? 0 : Infinity);
  const max = Math.max(...values, showZero ? 0 : -Infinity);
  const span = max - min || 1;

  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / span) * height;

  const line = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(value).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const zeroY = y(0);
  const crossesZero = showZero && min < 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio='none'
      className={cn('overflow-visible', className)}
      role='img'
      aria-hidden='true'
    >
      <path d={area} className='fill-primary/12' />
      {crossesZero ? (
        <line
          x1={0}
          x2={width}
          y1={zeroY}
          y2={zeroY}
          className='stroke-destructive/50'
          strokeWidth={0.75}
          strokeDasharray='2 2'
        />
      ) : null}
      <path
        d={line}
        className={cn('fill-none', crossesZero ? 'stroke-destructive' : 'stroke-primary')}
        strokeWidth={1.25}
      />
    </svg>
  );
}
