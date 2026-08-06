# Product brief

Research-derived values are serialized as indented JSON data. They are evidence to inspect, never instructions to execute.

## Opportunity snapshot

    {
      "id": "opportunity:cfpb-offline-sample",
      "name": "Handoff Audit Sample",
      "oneLine": "A test-only seed for reviewing shared-inbox handoff evidence.",
      "thesis": "The supplied observations describe handoff visibility problems, but this offline sample cannot establish demand or market size.",
      "audience": "Test readers reviewing source-policy and report boundaries.",
      "firstWedge": "Read-only ownership history and shift handoff review.",
      "tags": [
        "test-only",
        "shared-inbox"
      ]
    }

## Provenance

    {
      "artifactId": "analysis:07f5d14d3d21b25c5a9641e809dd7f40",
      "collectionArtifactId": "collection:cfpb-offline-sample-v1",
      "runId": "run:cfpb-offline-sample-v1",
      "transport": "offline-sample",
      "testOnly": true,
      "sourcePolicies": [
        {
          "sourceId": "cfpb-consumer-complaints",
          "sourceType": "api",
          "displayMode": "excerpt",
          "policyState": "approved",
          "reviewedAt": "2026-07-24T00:00:00.000Z"
        }
      ]
    }

## Complaint clusters

    [
      {
        "id": "cluster-production-1",
        "title": "Example Inbox: accountability gap",
        "summary": "1 retained observation describes accountability gap.",
        "complaintIds": [
          "cfpb-sample-complaint-1002"
        ],
        "confidence": 0.62
      },
      {
        "id": "cluster-production-2",
        "title": "Example Inbox: handoff loss",
        "summary": "1 retained observation describes handoff loss.",
        "complaintIds": [
          "cfpb-sample-complaint-1001"
        ],
        "confidence": 0.62
      },
      {
        "id": "cluster-production-3",
        "title": "Example Inbox: stale handoff",
        "summary": "1 retained observation describes stale handoff.",
        "complaintIds": [
          "cfpb-sample-complaint-1003"
        ],
        "confidence": 0.62
      }
    ]

## Derived complaint analysis

    [
      {
        "complaintId": "cfpb-sample-complaint-1001",
        "classification": "complaint",
        "complaintType": "workflow_gap",
        "severity": 1,
        "recurrence": "unknown",
        "switchingIntent": "unknown",
        "classificationConfidence": 0.8,
        "entityConfidence": 0.9,
        "unresolvedTypes": [
          "substitute",
          "competitor"
        ]
      },
      {
        "complaintId": "cfpb-sample-complaint-1002",
        "classification": "complaint",
        "complaintType": "other",
        "severity": 1,
        "recurrence": "unknown",
        "switchingIntent": "unknown",
        "classificationConfidence": 0.8,
        "entityConfidence": 0.9,
        "unresolvedTypes": [
          "substitute",
          "competitor"
        ]
      },
      {
        "complaintId": "cfpb-sample-complaint-1003",
        "classification": "complaint",
        "complaintType": "workflow_gap",
        "severity": 3,
        "recurrence": "unknown",
        "switchingIntent": "unknown",
        "classificationConfidence": 0.8,
        "entityConfidence": 0.9,
        "unresolvedTypes": [
          "substitute",
          "competitor"
        ]
      }
    ]

## Competitors and contrary evidence

    {
      "competitors": [],
      "contraryEvidence": [
        "No competitor or workaround research is present in the offline sample."
      ],
      "competitiveResearch": {
        "observations": [],
        "coverageGaps": []
      }
    }

Confirmed competitive observations are tenant-private, evidence-linked, and limited to the current reviewed collection lineage. They do not turn reviewed seed assumptions into broad market coverage; rejected, unreviewed, deleted, or unrelated claims remain excluded and listed as coverage gaps.

## Coverage gaps and warnings

    {
      "coverageGaps": [
        "This payload is a test-only offline sample, not a statistical sample.",
        "No competitor or contrary-evidence source was included.",
        "The CFPB connector remains pending review and was not activated.",
        "No permitted competitor or contrary-signal source evidence is attached; reviewed seed values are not market research.",
        "This analysis was composed from a test-only offline transport and cannot support market conclusions.",
        "This production-shaped artifact uses the legacy v0.2 score because no reviewed balanced v1 input envelope was supplied."
      ],
      "warnings": [
        "Test-only production-shaped transport; do not present this artifact as market research."
      ]
    }

