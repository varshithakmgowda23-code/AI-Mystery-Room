import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../pages/session.js';

/** Top bar used on the landing, auth, generating and 404 pages. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const user = useCurrentUser().data;
  return (
    <header className="site-header">
      <Link className="wordmark" to="/" aria-label="AI Mystery Room home">
        <span className="wordmark-icon">M</span>
        <span className="wordmark-text">Mystery Room</span>
      </Link>
      <nav className="site-header__nav" aria-label="Account">
        {children}
        {user ? (
          <Link to="/cases">{user.isGuest ? 'My cases (guest)' : 'My cases'}</Link>
        ) : (
          <>
            <Link to="/login">Sign in</Link>
            <Link to="/register" className="site-header__cta">
              Create account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
