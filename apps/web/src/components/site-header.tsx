import Link from 'next/link'
import Image from 'next/image'

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/leaderboard" aria-label="AppSea leaderboard">
          <Image
            className="brand-mark"
            src="/appsea-mark-generated.png"
            width={32}
            height={32}
            alt=""
            aria-hidden="true"
            priority
          />
          <span>AppSea</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className="nav-link" href="/leaderboard">
            Leaderboard
          </Link>
          <Link className="nav-link nav-sign-in" href="/login">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  )
}
