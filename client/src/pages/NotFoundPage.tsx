import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/layout/SiteHeader.js';

export default function NotFoundPage() {
  return (
    <div className="auth-page">
      <SiteHeader />
      <main className="auth-main">
        <section className="auth-panel">
          <h1>This room has no case file.</h1>
          <p className="auth-copy">The page you followed does not exist. It may have been moved or deleted.</p>
          <Link className="primary-button" to="/">
            Go to the front desk
          </Link>
        </section>
      </main>
    </div>
  );
}
