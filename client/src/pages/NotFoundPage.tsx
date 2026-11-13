import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="not-found min-h-screen">
      <p className="eyebrow">404 · DEAD END</p>
      <h1>This room has no case file.</h1>
      <Link to="/">
        Return to the entrance <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}
