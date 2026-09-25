# Join placement

- Join placement
  - ETL time
    - materialised views
    - nightly load
  - Query time
    - fresh reads
  - Client
    - extra round trips
- gd-integrations
  - finance dashboard
  - orders sync

- ETL time -> finance dashboard : because it is read all day
- Query time <-> orders sync : freshness against cost
- [[nightly load]] → [[orders sync]]
- Client -> billing service : not drawn yet
