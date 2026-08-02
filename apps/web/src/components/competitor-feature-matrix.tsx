import type { Competitor } from '@appsea/contracts'

const statusLabels: Record<Competitor['featureMatrix'][number]['status'], string> = {
  supported: 'Supported',
  partial: 'Partial',
  missing: 'Missing',
  unknown: 'Unknown'
}

const evidenceLabels: Record<Competitor['featureMatrix'][number]['evidenceBasis'], string> = {
  fixture: 'Synthetic fixture',
  'reviewed-seed': 'Reviewed seed assumption',
  'source-observation': 'Permitted source observation',
  mixed: 'Mixed reviewed evidence'
}

export function CompetitorFeatureMatrix({ competitor }: { competitor: Competitor }) {
  if (competitor.featureMatrix.length === 0) {
    return <p className="muted-note">No feature comparison has been recorded.</p>
  }

  return (
    <div className="feature-matrix-scroll">
      <table className="feature-matrix">
        <caption>Feature coverage for {competitor.name}</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Coverage</th>
            <th scope="col">Evidence basis</th>
            <th scope="col">Notes and provenance</th>
          </tr>
        </thead>
        <tbody>
          {competitor.featureMatrix.map((entry) => (
            <tr key={entry.feature}>
              <th scope="row">{entry.feature}</th>
              <td>{statusLabels[entry.status]}</td>
              <td>{evidenceLabels[entry.evidenceBasis]}</td>
              <td>
                {entry.notes ?? 'No note recorded.'}
                {entry.observationIds.length > 0 ? (
                  <small className="feature-matrix-provenance">
                    Observation IDs: {entry.observationIds.join(' · ')}
                  </small>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
