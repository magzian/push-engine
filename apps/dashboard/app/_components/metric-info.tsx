interface MetricInfoProps {
  label: string;
  description: string;
}

// Native <details> keeps this help control keyboard-accessible and usable
// without client-side JavaScript on server-rendered analytics pages.
export function MetricInfo({ label, description }: MetricInfoProps) {
  return (
    <details className="metric-info">
      <summary aria-label={`What ${label} means`}>
        <span aria-hidden="true">i</span>
      </summary>
      <div className="metric-info-popover" role="tooltip">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
    </details>
  );
}
