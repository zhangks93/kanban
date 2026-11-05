import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-heading page-header ${className}`}>
      <div className="page-header-copy">
        {eyebrow && <span className="eyebrow page-header-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p className="muted page-header-description">{description}</p>}
      </div>
      {(actions || children) && (
        <div className="page-header-actions">
          {actions}
          {children}
        </div>
      )}
    </header>
  );
}

export function PageSection({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`page-section ${className}`}>
      {(title || description || actions) && (
        <div className="page-section-heading">
          <div className="page-section-copy">
            {title && <h2>{title}</h2>}
            {description && <p className="muted page-section-description">{description}</p>}
          </div>
          {actions && <div className="page-section-actions">{actions}</div>}
        </div>
      )}
      <div className="page-section-body">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error' | 'loading';
}) {
  return (
    <div
      className={`empty page-empty is-${tone}${tone === 'error' ? ' error' : ''}`}
      role={tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined}
    >
      {icon && (
        <span className="page-empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <strong className="page-empty-title">{title}</strong>
      {description && <p className="muted page-empty-description">{description}</p>}
      {action && <div className="page-empty-action">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  icon,
  className = '',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`stat-card ${className}`}>
      <div className="stat-label">
        <span>{label}</span>
        {icon && (
          <span className="stat-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <strong className="stat-value">{value}</strong>
      {detail && <span className="muted stat-detail">{detail}</span>}
    </div>
  );
}
