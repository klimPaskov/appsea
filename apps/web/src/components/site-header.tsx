import Link from 'next/link'

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="AppSea leaderboard">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>AppSea</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className="nav-link" href="/">
            Leaderboard
          </Link>
          <Link className="nav-link" href="/login">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}
