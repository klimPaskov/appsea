import Link from 'next/link'
import { seedOpportunities } from '@appsea/catalog'

export default function LeaderboardPage() {
  return (
    <main className="leaderboard-page">
      <h1>Leaderboard</h1>
      <div className="leaderboard" role="table" aria-label="App opportunity leaderboard">
        <div className="leaderboard-row leaderboard-head" role="row">
          <span role="columnheader">Rank</span>
          <span role="columnheader">Opportunity</span>
          <span role="columnheader" className="number-cell">
            Complaints
          </span>
          <span role="columnheader" className="number-cell">
            Score
          </span>
        </div>
        {seedOpportunities.map((opportunity, index) => (
          <Link
            className="leaderboard-row leaderboard-entry"
            href={`/opportunities/${opportunity.slug}`}
            key={opportunity.id}
            role="row"
          >
            <span className="rank" role="cell" aria-label={`Rank ${index + 1}`}>
              <span className="rank-badge">{index + 1}</span>
            </span>
            <span className="opportunity-name" role="cell">
              {opportunity.name}
            </span>
            <span className="number-cell complaint-count" role="cell">
              {opportunity.complaintCount.toLocaleString('en-US')}
            </span>
            <span className="number-cell score-cell" role="cell">
              <span className="score">{opportunity.scoreSnapshot.score.toFixed(1)}</span>
              <span className="score-meter" aria-hidden="true">
                <span
                  className="score-meter-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, opportunity.scoreSnapshot.score))}%`
                  }}
                />
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="fixture-note">
        Synthetic fixture ranking for product and interface validation.
      </p>
    </main>
  )
}
