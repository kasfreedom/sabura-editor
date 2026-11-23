---
description: An architecture map with a framed group of services.
tags: [create, groups]
max_turns: 30
timeout_seconds: 600
---

Draw our system architecture on a Sabura board and save it as
architecture.html: a web app talks to an API gateway, which calls an orders
service and a payments service; both services use a Postgres database, and the
payments service also calls Stripe. Put the two services and the database in a
visible frame labelled Backend.
