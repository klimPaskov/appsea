# Opportunity scoring

## Purpose

The scoring system ranks opportunities without hiding uncertainty, source gaps, or policy risk.

A score is a decision aid. It is not proof that an app will succeed.

## Score outputs

Every score snapshot contains:

- raw opportunity score from 0 to 100
- risk penalty from 0 to 35
- risk-adjusted score from 0 to 100
- evidence confidence from 0 to 1
- ranking score from 0 to 100
- source coverage summary
- freshness summary
- scoring profile
- scoring-model version
- evidence snapshot identifier
- explanation for every component

## Balanced raw score

### Demand evidence, 30 points

| Factor              | Weight | What it measures                                                       |
| ------------------- | -----: | ---------------------------------------------------------------------- |
| Complaint frequency |      8 | Normalized recurring evidence, adjusted for duplicates and source size |
| Independent users   |      6 | Estimated unique people or organizations reporting the problem         |
| Source diversity    |      5 | Evidence across independent platforms or authorized data sources       |
| Recent velocity     |      5 | Change in complaint rate after baseline and seasonality adjustment     |
| Time persistence    |      3 | Recurrence over meaningful periods rather than one spike               |
| Segment density     |      3 | Concentration inside a reachable target segment                        |

### Pain value, 20 points

| Factor               | Weight | What it measures                                           |
| -------------------- | -----: | ---------------------------------------------------------- |
| Severity             |      7 | Consequence to work, money, data, trust, safety, or access |
| Workflow criticality |      5 | Importance of the blocked job                              |
| Workaround cost      |      4 | Time, money, staff, or complexity spent coping             |
| Switching intent     |      4 | Search for alternatives, churn, or replacement behavior    |

### Market opening, 20 points

| Factor                     | Weight | What it measures                                                                                |
| -------------------------- | -----: | ----------------------------------------------------------------------------------------------- |
| Competitor dissatisfaction |      6 | Repeated, current failure across existing products                                              |
| Unresolved solution gap    |      7 | Specific outcome missing from current options                                                   |
| Substitute weakness        |      4 | Cost or friction in manual and adjacent solutions                                               |
| Timing                     |      3 | Technical, regulatory, distribution, or behavior change that makes the solution newly practical |

### Business quality, 15 points

| Factor                   | Weight | What it measures                                                            |
| ------------------------ | -----: | --------------------------------------------------------------------------- |
| Willingness-to-pay proxy |      5 | Existing spend, paid workarounds, business loss, or explicit payment intent |
| Repeat use and retention |      4 | Whether the job recurs and can support ongoing value                        |
| Audience reachability    |      3 | Practical channels for finding the target user                              |
| Expansion potential      |      3 | Adjacent workflows, teams, integrations, or higher-value segments           |

### Execution quality, 15 points

| Factor                           | Weight | What it measures                                                       |
| -------------------------------- | -----: | ---------------------------------------------------------------------- |
| MVP feasibility                  |      5 | Ability to deliver a narrow useful version with normal resources       |
| Data and integration feasibility |      4 | Availability and stability of required inputs and APIs                 |
| Trust and compliance feasibility |      3 | Ability to meet privacy, security, safety, and regulatory expectations |
| Platform independence            |      3 | Ability to survive a policy or distribution change by one platform     |

## Risk penalties

Risk penalties apply to concrete red flags that the positive dimensions do not fully capture.

| Penalty                    |   Range | Trigger examples                                                               |
| -------------------------- | ------: | ------------------------------------------------------------------------------ |
| Source or legal access     | 0 to 10 | Core evidence or product function depends on unavailable or restricted access  |
| Platform concentration     |  0 to 7 | One platform controls data, distribution, and user identity                    |
| Commoditization            |  0 to 5 | The core mechanism is easy to copy and has weak data or workflow advantage     |
| Regulatory or trust burden |  0 to 5 | High-risk data, safety, finance, health, minors, or enterprise security burden |
| Manipulation risk          |  0 to 4 | Coordinated complaints, review bombing, bots, or competitor campaigns          |
| Event-driven demand        |  0 to 4 | Signal depends mainly on a temporary outage, scandal, or release incident      |

## Calculation

```text
raw_score = sum(weighted_positive_factors)
risk_adjusted_score = clamp(raw_score - risk_penalty, 0, 100)
uncertainty_margin = 20 * (1 - evidence_confidence)
ranking_score = clamp(risk_adjusted_score - uncertainty_margin, 0, 100)
```

The leaderboard sorts by `ranking_score` in the balanced profile.

It still displays the other values so a user can see whether an opportunity is promising but uncertain, well-supported but risky, or safe but small.

## Evidence confidence

| Factor                            | Weight |
| --------------------------------- | -----: |
| Effective sample size             |    25% |
| Source diversity and independence |    20% |
| Directness and context            |    15% |
| Entity-resolution confidence      |    10% |
| Time stability                    |    10% |
| Manipulation and spam control     |    10% |
| Method agreement and human review |    10% |

Confidence bands:

| Band      |          Range | UI label            |
| --------- | -------------: | ------------------- |
| Very low  |     below 0.35 | Weak evidence       |
| Low       |   0.35 to 0.54 | Early signal        |
| Medium    |   0.55 to 0.74 | Developing evidence |
| High      |   0.75 to 0.89 | Strong evidence     |
| Very high | 0.90 and above | Verified evidence   |

## Source normalization

The scoring system must stop large sources from dominating by volume.

Use:

- per-source caps
- logarithmic count scaling
- duplicate and repost adjustment
- unique-author estimates
- source-diversity bonuses with saturation
- separate public and tenant-private evidence summaries
- category baselines
- time-window normalization

The exact functions belong in a versioned scoring package and benchmark suite.

## Scoring profiles

### Balanced

Uses the weights above.

### Fast MVP

Increases MVP feasibility, data access, reachability, and narrow segment density. Reduces expansion weight.

### High upside

Increases severity, market opening, willingness to pay, and expansion. Accepts higher build complexity.

### Durable B2B

Increases workflow criticality, recurring use, business impact, trust feasibility, and distribution through identifiable roles.

### Low dependency

Increases platform independence, open standards, data portability, and direct customer relationships.

### Privacy-first or local-first

Increases privacy demand, trust gap, offline potential, and ownership of user data.

Profiles change the ranking view. They do not rewrite the underlying evidence.

## Explainability

For each factor, the UI shows:

- value
- weight
- contribution
- evidence records used
- transformation applied
- confidence
- last updated
- reason for change from the previous snapshot

A report should be able to say that a candidate moved because independent-user count rose across two new sources, or fell because a competitor shipped the missing feature.

## Calibration

Maintain a reviewed benchmark set with:

- accepted opportunities
- rejected opportunities
- known false positives
- event-driven spikes
- crowded categories
- high-demand but inaccessible ideas
- low-volume high-value B2B problems
- international and multilingual cases

Evaluate:

- ranking correlation with human review
- top-k precision
- stability under duplicate injection
- sensitivity to one large source
- sensitivity to deleted evidence
- source-ablation behavior
- manipulation resistance
- score drift after model changes

## Anti-gaming rules

- Do not count identical posts as independent demand.
- Do not reward a campaign for collecting more from one source after saturation.
- Do not let sentiment intensity replace severity evidence.
- Do not infer willingness to pay only from angry wording.
- Do not allow sponsored content or affiliate pages to count as user demand.
- Do not hide missing competitor research.
- Do not tune weights to force a preferred idea to the top without recording a new profile.

## Versioning

A scoring snapshot is immutable.

When weights, transformations, classifiers, or entity mappings change, create a new snapshot with:

- previous version
- new version
- changed inputs
- changed logic
- before and after values
- migration reason
- evaluator result
- approver when required
