# Evidence model and complaint ontology

## Evidence layers

AppSea keeps four layers separate.

### Source item

The platform-native post, comment, issue, review, document, transcript segment, or imported record.

### Evidence record

A policy-safe normalized representation used for analysis.

### Derived observation

A structured claim extracted from one evidence record, such as a billing failure, missing integration, or workaround.

### Research finding

A conclusion supported by several observations, such as a complaint cluster or market gap.

A report must not blur these layers.

## Complaint ontology

### Product defects

- crash or freeze
- data loss or corruption
- incorrect output
- broken workflow
- sync failure
- notification failure
- authentication failure
- billing error
- compatibility problem
- performance degradation
- outage or availability

### Missing capability

- missing feature
- missing integration
- missing import or export
- missing automation
- missing platform support
- missing accessibility support
- missing collaboration
- missing admin control
- missing customization
- missing offline behavior

### Experience and trust

- confusing workflow
- onboarding difficulty
- discoverability problem
- excessive steps
- poor error recovery
- privacy concern
- security concern
- misleading behavior
- unwanted content or ads
- lock-in concern
- support failure

### Commercial friction

- price too high
- pricing mismatch
- forced subscription
- unclear billing
- poor value
- plan limitation
- enterprise procurement problem
- regional payment problem

### Workflow gap

- manual copy and paste
- spreadsheet workaround
- repeated data entry
- tool switching
- missing cross-app workflow
- coordination overhead
- reporting overhead
- compliance overhead
- quality-control overhead

### Switching and demand signals

- asking for alternatives
- announcing churn
- comparing products
- paying for a workaround
- building an internal tool
- hiring a person to perform the job
- requesting a template or script
- expressing urgency

### Non-opportunity categories

- one-time outage
- unsupported configuration
- policy disagreement outside a software problem
- abusive or vague rant
- duplicate repost
- marketing content
- satire
- coordinated manipulation
- complaint solved by existing setting
- complaint about illegal or harmful activity
- unclear target

## Required complaint fields

A normalized complaint record should include:

- complaint identifier
- source evidence identifier
- target app identifiers
- target feature or workflow
- complaint type
- problem statement
- expected outcome
- observed outcome
- trigger
- consequence
- severity
- frequency language
- user segment candidates
- environment
- workaround
- requested feature
- switching intent
- willingness-to-pay proxy
- business-impact proxy
- sentiment as a supporting field
- actionability probability
- classification confidence
- entity confidence
- manipulation risk
- PII flags
- policy flags

## Severity model

Severity should reflect consequence, not writing style.

| Level | Meaning                | Examples of consequence                                              |
| ----- | ---------------------- | -------------------------------------------------------------------- |
| 0     | No actionable harm     | General dislike without a problem                                    |
| 1     | Minor friction         | Small delay or preference                                            |
| 2     | Repeated inconvenience | Workaround needed, lost time                                         |
| 3     | Workflow blocked       | Core task cannot complete                                            |
| 4     | Material loss or risk  | Lost revenue, lost data, compliance or safety exposure               |
| 5     | Critical               | Widespread data loss, severe security, safety, or operational impact |

A dramatic post does not automatically receive a high severity score.

## Directness

| Grade | Evidence type                                             |
| ----- | --------------------------------------------------------- |
| A     | First-person report with context, target, and consequence |
| B     | First-person report with limited context                  |
| C     | Second-hand report with useful detail                     |
| D     | General claim or summary without direct evidence          |
| E     | Speculation, marketing, or unclear source                 |

## Independence

Raw item count must be adjusted for:

- reposts
- quotes
- copied review text
- syndicated news
- coordinated campaigns
- repeated posts by one person
- bot activity
- support-agent duplicates
- mirrored repositories

The leaderboard should show raw items and estimated independent authors separately.

## Freshness and stability

A stable opportunity needs more than a spike.

Track:

- first observed
- last observed
- active weeks or months
- recurrence pattern
- velocity change
- source continuity
- product-version context
- outage windows
- seasonality

A short spike can still matter, but it should be labeled as emerging or event-driven.

## PII minimization

Keep public usernames only when a source contract and product need justify it. The default research view should use source links and pseudonymous author identifiers.

Redact or restrict:

- email addresses
- phone numbers
- home addresses
- access tokens
- account identifiers
- payment details
- health information
- private customer records
- names of minors
- confidential company data

The system may preserve necessary technical context such as device type, app version, operating system, or error code when permitted.

## Translation

Store:

- original text when permitted
- detected language
- translated analysis text
- translation model and version
- translation confidence

Use the original for evidence review. Do not treat machine translation as exact wording.

## Evidence confidence

An evidence record’s confidence can combine:

- source integrity
- directness
- context completeness
- entity confidence
- language confidence
- manipulation risk
- policy integrity
- extraction agreement across models or methods

Confidence is never a substitute for source coverage.

## Contrary evidence

Each deep research run must search for evidence that weakens the opportunity:

- users satisfied with existing solutions
- settings or integrations that already solve the problem
- low willingness to switch
- problem fixed in recent releases
- complaint concentrated in obsolete versions
- legal or platform barriers
- low repeat usage
- strong free substitutes
- narrow user population
- demand driven by a temporary event

Contrary evidence belongs beside supporting evidence.

## Evidence display

The complaint list should show:

- source
- date
- app
- complaint type
- cluster
- severity
- confidence
- short excerpt or paraphrase
- link when allowed
- inclusion reason
- policy state

The user can open an evidence drawer for provenance and extraction details.
