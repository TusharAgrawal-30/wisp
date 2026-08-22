export function Nav() {
  return (
    <header className="topbar">
      <a href="/" className="brand">
        <span className="brand-orb" /> wisp
      </a>
      <nav className="topnav">
        <a href="/about">how it works</a>
        <a href="/vault">vault</a>
        <a href="/" className="cta">
          new drop
        </a>
      </nav>
    </header>
  );
}
