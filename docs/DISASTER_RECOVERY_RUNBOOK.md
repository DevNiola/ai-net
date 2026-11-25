# 🚨 Disaster Recovery Runbook — ai-net Production

> **On-call engineers**: Follow this runbook during production incidents. Each section has the same four-part structure: **Symptoms → Diagnosis → Recovery Steps → Verification**. Work top-to-bottom in each section. Do not skip steps.

---

## Table of Contents

1. [Estimated RTO Per Scenario](#1-estimated-rto-per-scenario)
2. [On-Call Escalation Contact Matrix](#2-on-call-escalation-contact-matrix)
3. [Scenario A — Database Corruption Recovery](#3-scenario-a--database-corruption-recovery-from-s3-backup)
4. [Scenario B — All Agents Offline](#4-scenario-b--all-agents-offline)
5. [Scenario C — Stellar Horizon Unreachable](#5-scenario-c--stellar-horizon-unreachable)
6. [Scenario D — Venice AI Unavailable](#6-scenario-d--venice-ai-unavailable)
7. [Scenario E — Payment Escrow Stuck](#7-scenario-e--payment-escrow-stuck)
8. [Scenario F — Full Cluster Failure](#8-scenario-f--full-cluster-failure)
9. [Post-Incident Review Checklist](#9-post-incident-review-checklist)

---

## 1. Estimated RTO Per Scenario

| Scenario | Description | Estimated RTO |
|---|---|---|
| A | Database corruption recovery from S3 backup | 60–120 minutes |
| B | All agents offline | 10–20 minutes |
| C | Stellar Horizon unreachable | 5–15 minutes |
| D | Venice AI unavailable (degraded mode) | 2–5 minutes to activate degraded mode |
| E | Payment escrow stuck | 15–30 minutes |
| F | Full cluster failure (complete bring-up) | 45–90 minutes |

> RTOs assume on-call engineer has access to production secrets, AWS credentials with S3 read access, and the Stellar admin keypair.

---

## 2. On-Call Escalation Contact Matrix

| Scenario | First Responder Role | Escalation Role | External Contact |
|---|---|---|---|
| A — Database | Backend On-Call Engineer | Senior DBA / Database Lead | AWS Support (if S3 access issue) |
| B — Agents Offline | Backend On-Call Engineer | Platform / DevOps Lead | — |
| C — Stellar Horizon | Stellar Integration Engineer | Protocol Lead | Stellar Development Foundation (SDF) Developer Support |
| D — Venice AI | Backend On-Call Engineer | AI Integration Lead | Venice AI Support Team |
| E — Escrow Stuck | Stellar Integration Engineer | Smart Contract Engineer | Stellar Development Foundation (SDF) |
| F — Full Cluster | DevOps / Platform Lead | CTO / Engineering Lead | Cloud Provider Support (AWS/GCP) |

> All roles are defined in the internal team directory. Page the on-call engineer first; escalate only if the incident is not mitigated within the RTO window.

---

## 3. Scenario A — Database Corruption Recovery from S3 Backup

### Symptoms

- PostgreSQL returns `ERROR: could not read block N in file base/...` or similar page-corruption errors in backend logs.
- Backend health endpoint (`GET /api/v1/health`) reports `"database": {"status": "error"}`.
- Task submissions fail with `500 Internal Server Error`; existing task records are unreadable.
- `pg_dump` exits with a non-zero code or checksum errors during scheduled backup.

### Diagnosis

```bash
# 1. Check PostgreSQL system logs for corruption messages
sudo journalctl -u postgresql -n 200 --no-pager | grep -i "corrupt\|invalid page\|checksum"

# 2. Confirm backend health
curl -sf http://localhost:3001/api/v1/health | jq .database

# 3. Test a simple query
psql -U ainet_user -d ainet_db -c "SELECT COUNT(*) FROM tasks;" 2>&1

# 4. Check disk health (rule out hardware)
sudo dmesg | tail -50 | grep -i "error\|fail\|bad"
df -h /var/lib/postgresql
```

If step 3 fails with page corruption errors and disk health is normal → proceed with restore.

### Recovery Steps

> ⚠️ **This procedure causes downtime**. Coordinate with the team before stopping services.

**Step A.1 — Stop all dependent services**

```bash
# Stop the backend node first (stops writes to DB)
sudo systemctl stop ainet-node
# Or Docker:
docker compose stop ainet-node

# Confirm no active DB connections
psql -U ainet_user -d postgres -c "SELECT pid, usename, state FROM pg_stat_activity WHERE datname = 'ainet_db';"
# Terminate remaining connections if needed
psql -U ainet_user -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ainet_db' AND pid <> pg_backend_pid();"
```

**Step A.2 — List available S3 backups**

```bash
# List backups sorted by date (newest first)
aws s3 ls s3://${BACKUP_BUCKET}/ainet/db-backups/ --recursive | sort -r | head -20

# Identify the latest clean snapshot before the corruption event
# Example output: 2024-01-15 02:00:12  52428800 ainet/db-backups/ainet_20240115_020012.dump
export RESTORE_KEY="ainet/db-backups/ainet_20240115_020012.dump"
```

**Step A.3 — Download the backup**

```bash
mkdir -p /var/restore/ainet
aws s3 cp "s3://${BACKUP_BUCKET}/${RESTORE_KEY}" /var/restore/ainet/restore.dump
# Verify download integrity
aws s3api head-object --bucket "${BACKUP_BUCKET}" --key "${RESTORE_KEY}" --query 'ContentLength'
wc -c /var/restore/ainet/restore.dump   # sizes must match
```

**Step A.4 — Drop and recreate the database**

```bash
# Drop the corrupted database
psql -U postgres -c "DROP DATABASE IF EXISTS ainet_db;"
psql -U postgres -c "CREATE DATABASE ainet_db OWNER ainet_user;"
```

**Step A.5 — Restore from backup**

```bash
pg_restore -U ainet_user -d ainet_db -v --no-owner --no-privileges /var/restore/ainet/restore.dump 2>&1 | tee /var/log/ainet-restore.log
# Check for errors
grep -i "error\|failed" /var/log/ainet-restore.log | grep -v "^pg_restore: warning"
```

**Step A.6 — Replay WAL if applicable**

If WAL archiving is configured and the backup is older than 1 hour, replay archived WAL segments:

```bash
# Point-in-time recovery: set recovery target in postgresql.conf
# recovery_target_time = '2024-01-15 03:45:00'  # Last known good time
# restore_command = 'aws s3 cp s3://${BACKUP_BUCKET}/ainet/wal/%f %p'
# Then restart PostgreSQL to trigger recovery mode
sudo systemctl restart postgresql
# Monitor recovery progress
sudo tail -f /var/log/postgresql/postgresql-*.log | grep "recovery"
```

**Step A.7 — Run integrity checks**

```bash
# Verify row counts on critical tables
psql -U ainet_user -d ainet_db -c "
  SELECT
    'tasks'       AS tbl, COUNT(*) FROM tasks
  UNION ALL SELECT 'agents',      COUNT(*) FROM agents
  UNION ALL SELECT 'transactions', COUNT(*) FROM transactions;
"

# Run PostgreSQL's built-in consistency check
vacuumdb -U ainet_user -d ainet_db --analyze --verbose
```

**Step A.8 — Restart services in order**

```bash
# 1. Confirm PostgreSQL is healthy
psql -U ainet_user -d ainet_db -c "SELECT 1;" && echo "DB OK"

# 2. Start the backend node
sudo systemctl start ainet-node
# Or Docker:
docker compose start ainet-node

# 3. Wait for health check to pass
sleep 15
curl -sf http://localhost:3001/api/v1/health | jq .
```

### Verification

```bash
# Health endpoint shows database connected
curl -sf http://localhost:3001/api/v1/health | jq '.database.status'
# Expected: "connected"

# Backend can serve agents
curl -sf http://localhost:3001/api/v1/agents | jq '.length // length'

# Confirm backup schedule is re-enabled
systemctl list-timers | grep backup
```

---

## 4. Scenario B — All Agents Offline

### Symptoms

- Heartbeat monitor alert fires: all 5 agent workers (Research, Risk, Coding, Design, Report) are in `offline` state.
- `GET /api/v1/agents` returns all agents with `status: "inactive"` or empty.
- New task submissions queue indefinitely or return `503 No agents available`.
- Dashboard shows 0 active agents.

### Diagnosis

```bash
# 1. Check agent worker process / container status
docker compose ps | grep ainet-node
# or
sudo systemctl status ainet-node

# 2. Check backend logs for agent crash reason
docker compose logs --tail=200 ainet-node 2>&1 | grep -i "agent\|heartbeat\|OOM\|killed\|error"

# 3. Check system memory (OOM scenario)
dmesg | grep -i "killed process\|out of memory" | tail -20
free -h

# 4. Check network connectivity to upstream services
curl -sf https://horizon-testnet.stellar.org/fee_stats | jq .last_ledger_base_fee
curl -sf https://api.venice.ai/health 2>/dev/null || echo "Venice unreachable"

# 5. Check for bad deployment (recently deployed?)
docker compose images | grep ainet-node
git -C /opt/ai-net log --oneline -5
```

### Recovery Steps

**Step B.1 — Identify root cause** (pick the matching sub-path)

- **OOM kill** (`dmesg` shows killed process): Restart with memory limit increase → Step B.2
- **Network partition** (Stellar/Venice unreachable): Fix network first → Scenario C/D, then B.2
- **Bad deployment** (new image): Roll back image → Step B.3
- **Unknown**: Restart and monitor → Step B.2

**Step B.2 — Restart agent workers**

```bash
# Graceful restart
docker compose restart ainet-node
# Wait for startup
sleep 20
# Monitor heartbeat re-registration
docker compose logs -f ainet-node 2>&1 | grep -i "heartbeat\|registered\|online" &
curl -sf http://localhost:3001/api/v1/agents | jq '[.[] | {id:.id, status:.status}]'
```

**Step B.3 — Roll back a bad deployment**

```bash
# Identify the last good image tag
docker image ls | grep ainet-node

# Roll back to previous tag
docker compose stop ainet-node
# Edit docker-compose.yml image tag to the previous stable version
# Then:
docker compose up -d ainet-node
```

**Step B.4 — Force re-registration if agents remain offline**

If agents restart but heartbeat shows stale data:

```bash
# Delete stale agent records from DB (they will re-register on startup)
psql -U ainet_user -d ainet_db -c "
  UPDATE agents SET status='offline', last_heartbeat=NULL
  WHERE last_heartbeat < NOW() - INTERVAL '10 minutes';
"
# Then restart the node so agents re-register
docker compose restart ainet-node
sleep 30
curl -sf http://localhost:3001/api/v1/agents | jq '[.[] | .status] | group_by(.) | map({(.[0]): length}) | add'
```

### Verification

```bash
# All 5 agent types should be online
curl -sf http://localhost:3001/api/v1/agents | jq '[.[] | select(.status=="active")] | length'
# Expected: 5 (or the number of registered workers)

# Submit a test task to confirm routing
curl -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Ping test","budgetStroops":1000000}' | jq .status
# Expected: "pending" or "running" (not "error")

# Confirm heartbeat metric
curl -sf http://localhost:3001/metrics | grep ainet_active_agents
# Expected: ainet_active_agents 5 (or agent count)
```

---

## 5. Scenario C — Stellar Horizon Unreachable

### Symptoms

- Backend logs show repeated `Horizon connection refused` or HTTP 503/504 errors from `STELLAR_HORIZON_URL`.
- `GET /api/v1/health` returns `"stellar": {"connected": false}`.
- Escrow lock and payment release transactions fail with `HorizonConnectionError`.
- Metric `ainet_stellar_rpc_latency_seconds` returns no data or spikes > 10s.

### Diagnosis

```bash
# 1. Test Horizon connectivity directly
curl -sf "${STELLAR_HORIZON_URL}/fee_stats" | jq .last_ledger_base_fee
# If this times out, Horizon is unreachable

# 2. Check if SDF's status page has an incident
# https://status.stellar.org  — check manually

# 3. Test backup Horizon endpoint (if configured)
curl -sf "${STELLAR_HORIZON_BACKUP_URL:-https://horizon.stellar.org}/fee_stats" | jq .last_ledger_base_fee

# 4. Rule out local network issue
curl -sf https://1.1.1.1 && echo "Internet OK" || echo "No internet"
traceroute horizon-testnet.stellar.org 2>/dev/null | tail -5
```

### Recovery Steps

**Step C.1 — Switch to backup Horizon endpoint**

```bash
# Edit backend/.env (do not restart yet)
# Change:  STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
# To:      STELLAR_HORIZON_URL=https://horizon-backup.example.com
# (or a commercial provider: Blockdaemon, NowNodes, etc.)

# Reload environment without full restart if the backend supports SIGHUP,
# otherwise do a graceful restart:
sudo systemctl restart ainet-node
# Or Docker:
docker compose restart ainet-node
```

**Step C.2 — Activate read-only / degraded mode**

While Horizon is unreachable, the node will not submit new on-chain transactions. Users can still:
- View existing tasks and agent listings (database reads)
- Submit task requests (they will queue, not execute)

They **cannot**:
- Lock new escrow funds (requires Horizon)
- Receive payment releases

No manual action required — the circuit breaker activates automatically. Confirm it:

```bash
docker compose logs ainet-node 2>&1 | grep -i "degraded\|circuit\|horizon"
```

**Step C.3 — Communicate status**

Post an incident update on the status page or team channel:

> "Stellar Horizon connectivity issue detected at [TIME]. New task payments and escrow operations are temporarily suspended. Existing in-flight tasks are unaffected. We are monitoring and will restore full service once Horizon recovers."

**Step C.4 — Re-enable full mode when Horizon recovers**

```bash
# Test Horizon is back
curl -sf "${STELLAR_HORIZON_URL}/fee_stats" | jq .last_ledger_base_fee

# If the backup URL was set, restore the original:
# STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
# Then restart:
sudo systemctl restart ainet-node
```

### Verification

```bash
# Health endpoint shows Stellar connected
curl -sf http://localhost:3001/api/v1/health | jq '.stellar.connected'
# Expected: true

# Confirm a test transaction can be submitted
curl -sf "${STELLAR_HORIZON_URL}/accounts/${COORDINATOR_PUBLIC_KEY}" | jq '.sequence'
# Expected: a numeric sequence string

# Monitor for queued transactions draining
docker compose logs ainet-node 2>&1 | grep "tx_submitted\|escrow_locked" | tail -20
```

---

## 6. Scenario D — Venice AI Unavailable (Degraded Mode)

### Symptoms

- Backend logs show `CircuitBreakerOpenError` or repeated 5xx/timeout errors from Venice AI API.
- Task execution stalls at `running` state; agents never return a result.
- `GET /api/v1/health` shows Venice AI as degraded (if implemented).
- Metric or log line: `circuit_breaker_open` for the Venice AI client.

### Diagnosis

```bash
# 1. Check Venice AI API directly (replace with actual endpoint)
curl -sf -H "Authorization: Bearer ${VENICE_API_KEY}" \
  https://api.venice.ai/health 2>/dev/null | jq . || echo "Venice unreachable"

# 2. Check circuit breaker state in logs
docker compose logs ainet-node 2>&1 | grep -i "circuit\|venice\|inference" | tail -30

# 3. Verify API key is still valid
curl -sf -H "Authorization: Bearer ${VENICE_API_KEY}" \
  https://api.venice.ai/v1/models 2>/dev/null | jq '.data[0].id' || echo "API key invalid"

# 4. Check Venice AI status page manually: https://status.venice.ai
```

### Recovery Steps

**Step D.1 — Manually open the circuit breaker (if auto-trigger failed)**

The circuit breaker opens automatically after consecutive failures. If it has not triggered:

```bash
# Trigger manual pause of Venice AI inference via admin API (if endpoint exists)
curl -X POST http://localhost:3001/api/v1/admin/circuit-breaker/open \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"service": "venice_ai"}'

# Or restart the node to reset the circuit to OPEN state:
docker compose restart ainet-node
```

**Step D.2 — Assess partial functionality**

While Venice AI is unavailable, the following still work:
- ✅ Agent registry browsing (`/agents`)
- ✅ Existing task status queries
- ✅ Wallet and payment history views
- ✅ Escrow lock/unlock (Stellar is unaffected)
- ❌ New task execution (requires Venice AI inference)
- ❌ Agent capability testing

**Step D.3 — Communicate status to users**

Post on status page:

> "AI inference is temporarily unavailable due to upstream Venice AI issues. Task submissions are paused. Existing completed tasks are unaffected. We will resume normal operation once Venice AI recovers."

**Step D.4 — Monitor for recovery**

```bash
# Watch logs for circuit breaker half-open attempts (every 60s by default)
docker compose logs -f ainet-node 2>&1 | grep -i "circuit\|half.open\|probe"

# Or manually probe Venice AI every 30s
watch -n 30 'curl -sf -H "Authorization: Bearer '"${VENICE_API_KEY}"'" \
  https://api.venice.ai/health | jq .status'
```

**Step D.5 — Re-enable when Venice AI recovers**

```bash
# Close the circuit breaker manually (if it hasn't auto-recovered)
curl -X POST http://localhost:3001/api/v1/admin/circuit-breaker/close \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"service": "venice_ai"}'

# Confirm tasks begin executing
docker compose logs -f ainet-node 2>&1 | grep "task_completed\|inference_ok"
```

### Verification

```bash
# Submit a small test task and verify it completes
TEST_TASK=$(curl -sf -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Echo test: reply with OK","budgetStroops":1000000}' | jq -r .id)
echo "Task ID: $TEST_TASK"

# Poll for completion (max 2 minutes)
for i in $(seq 1 24); do
  STATUS=$(curl -sf "http://localhost:3001/api/v1/tasks/${TEST_TASK}" | jq -r .status)
  echo "[$i] Status: $STATUS"
  [ "$STATUS" = "completed" ] && break
  sleep 5
done

# Confirm circuit breaker is closed
docker compose logs ainet-node 2>&1 | grep -i "circuit" | tail -5
```

---

## 7. Scenario E — Payment Escrow Stuck

### Symptoms

- A task has been in `completed` state for more than 3× the task timeout (typically > 3 hours) but the escrow has not been released.
- The on-chain escrow account still shows a locked balance on Stellar Horizon.
- Worker agent has not received payment; they may report a stale `pending_payment` state.
- No `EscrowReleasedEvent` is visible in Horizon for the affected task's escrow contract entry.

### Diagnosis

```bash
# 1. Identify stuck escrow(s)
psql -U ainet_user -d ainet_db -c "
  SELECT id, escrow_id, stellar_escrow_address, status, created_at, completed_at
  FROM tasks
  WHERE status = 'completed'
    AND escrow_released = false
    AND completed_at < NOW() - INTERVAL '3 hours'
  ORDER BY completed_at ASC
  LIMIT 10;
"

# 2. Check the escrow on-chain
export ESCROW_ID="<escrow_id_from_above>"
curl -sf "https://horizon-testnet.stellar.org/accounts/${ESCROW_CONTRACT_ADDRESS}" | jq '.balances'

# 3. Check Horizon for recent contract events on this escrow
curl -sf "https://horizon-testnet.stellar.org/accounts/${ESCROW_CONTRACT_ADDRESS}/transactions?limit=10&order=desc" | jq '._embedded.records[].memo'

# 4. Check backend release queue
docker compose logs ainet-node 2>&1 | grep -i "escrow\|release\|${ESCROW_ID}" | tail -30
```

### Recovery Steps

> ⚠️ **This involves on-chain admin transactions**. Confirm escrow ID and recipient address carefully before executing. All admin keypair operations must be performed from the cold wallet in a secure environment. This action is irreversible.

**Step E.1 — Gather required parameters**

```bash
# From the database query above, collect:
export ESCROW_ID="<escrow_contract_id>"       # Soroban contract ID (C...)
export TASK_WORKER_ADDRESS="<worker_stellar_address>"  # Agent worker's public key
export ADMIN_SECRET="<admin_cold_wallet_secret>"  # Admin keypair (from cold wallet / KMS)

# Verify worker address is correct
curl -sf "https://horizon-testnet.stellar.org/accounts/${TASK_WORKER_ADDRESS}" | jq '{sequence: .sequence, balances: .balances}'
```

**Step E.2 — Execute `force_release` admin contract function**

The `payment_escrow` contract exposes an admin function: `force_release(env: Env, task_id: Symbol, recipient: Address)`.

```bash
# Using Stellar CLI to invoke the admin force_release function
stellar contract invoke \
  --id "${ESCROW_ID}" \
  --network testnet \
  --source "${ADMIN_SECRET}" \
  -- \
  force_release \
  --task_id "${TASK_ESCROW_SYMBOL}" \
  --recipient "${TASK_WORKER_ADDRESS}"
```

If the task outcome is disputed or the worker address is incorrect, use `force_refund` to return funds to the original payer:

```bash
# force_refund(env: Env, task_id: Symbol, refund_to: Address)
stellar contract invoke \
  --id "${ESCROW_ID}" \
  --network testnet \
  --source "${ADMIN_SECRET}" \
  -- \
  force_refund \
  --task_id "${TASK_ESCROW_SYMBOL}" \
  --refund_to "${ORIGINAL_PAYER_ADDRESS}"
```

**Step E.3 — Update the database to reflect the release**

```bash
psql -U ainet_user -d ainet_db -c "
  UPDATE tasks
  SET escrow_released = true,
      escrow_released_at = NOW(),
      escrow_release_method = 'admin_force_release',
      notes = 'Force released via admin intervention during incident'
  WHERE escrow_id = '${ESCROW_ID}';
"
```

**Step E.4 — Log for governance review**

Escrow admin interventions must be logged for the post-incident governance audit. Record:
- Task ID and escrow contract address
- Reason for force release (stuck, timeout × 3)
- Admin address used
- Horizon transaction hash
- Timestamp

```bash
# Create incident log entry
cat >> /var/log/ainet-escrow-interventions.log << EOF
[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] FORCE_RELEASE | escrow=${ESCROW_ID} | task=${TASK_ID} | worker=${TASK_WORKER_ADDRESS} | admin=${ADMIN_PUBLIC_KEY} | horizon_tx=<TX_HASH>
EOF
```

### Verification

```bash
# 1. Confirm escrow balance is zero on-chain
curl -sf "https://horizon-testnet.stellar.org/accounts/${ESCROW_CONTRACT_ADDRESS}" | jq '.balances[] | select(.asset_type=="native") | .balance'
# Expected: "0.0000000" or the account no longer exists

# 2. Confirm worker received payment
curl -sf "https://horizon-testnet.stellar.org/accounts/${TASK_WORKER_ADDRESS}" | jq '.balances[] | select(.asset_type=="native") | .balance'

# 3. Confirm database reflects release
psql -U ainet_user -d ainet_db -c "SELECT escrow_released, escrow_released_at FROM tasks WHERE escrow_id = '${ESCROW_ID}';"

# 4. Check Horizon for the EscrowReleasedEvent
curl -sf "https://horizon-testnet.stellar.org/accounts/${ESCROW_CONTRACT_ADDRESS}/transactions?order=desc&limit=5" | jq '._embedded.records[0].id'
```

---

## 8. Scenario F — Full Cluster Failure

> Use this runbook when the entire production environment is offline (all services down, e.g., after catastrophic host failure, cloud provider outage, or botched infrastructure change).

### Symptoms

- All service health checks fail: PostgreSQL, backend API, frontend all return errors or timeouts.
- Monitoring system shows no data (Prometheus scrape failure).
- SSH into the production host may fail or return degraded state.

### Diagnosis

```bash
# 1. Check host reachability
ping -c 4 <production-host-ip>
ssh ainet@<production-host-ip> "uptime && df -h && free -h"

# 2. Check cloud provider console for host/region status
# AWS: https://health.aws.amazon.com | GCP: https://status.cloud.google.com

# 3. If host is reachable, check container/service state
docker compose ps
sudo systemctl list-units --state=failed
```

### Recovery Steps — Bring-Up Order

> ⚠️ Always bring services up in this exact order. Each step includes a health gate before proceeding.

**Step F.1 — PostgreSQL (Estimated: 5–10 minutes)**

```bash
# Start PostgreSQL
docker compose up -d postgres
# Or systemd:
sudo systemctl start postgresql

# Health gate: wait until PostgreSQL accepts connections
until psql -U ainet_user -d ainet_db -c "SELECT 1;" 2>/dev/null; do
  echo "Waiting for PostgreSQL..." && sleep 5
done
echo "✅ PostgreSQL ready"
```

**Step F.2 — Redis (if used for caching/queues) (Estimated: 2–3 minutes)**

```bash
docker compose up -d redis
until redis-cli ping 2>/dev/null | grep -q PONG; do
  echo "Waiting for Redis..." && sleep 3
done
echo "✅ Redis ready"
```

**Step F.3 — Backend / Coordinator Node (Estimated: 10–15 minutes)**

```bash
docker compose up -d ainet-node

# Health gate: wait for backend health endpoint
for i in $(seq 1 30); do
  STATUS=$(curl -sf http://localhost:3001/api/v1/health 2>/dev/null | jq -r '.status' 2>/dev/null)
  [ "$STATUS" = "ok" ] && echo "✅ Backend ready" && break
  echo "[$i] Waiting for backend... status=$STATUS" && sleep 10
done
# Confirm Stellar connection
curl -sf http://localhost:3001/api/v1/health | jq '{db: .database.status, stellar: .stellar.connected}'
```

**Step F.4 — Agent Workers (Estimated: 5–10 minutes)**

Agents re-register automatically on node startup. Verify:

```bash
# Wait for all agent workers to report online
for i in $(seq 1 24); do
  ACTIVE=$(curl -sf http://localhost:3001/api/v1/agents 2>/dev/null | jq '[.[] | select(.status=="active")] | length' 2>/dev/null)
  echo "[$i] Active agents: ${ACTIVE:-0}"
  [ "${ACTIVE:-0}" -ge 5 ] && echo "✅ All agents online" && break
  sleep 10
done
```

**Step F.5 — Frontend (Estimated: 3–5 minutes)**

```bash
docker compose up -d frontend
# Or if served via Nginx/CDN, verify static files are accessible:
curl -sf http://localhost:3000/ | grep -i "ai-net\|dashboard" && echo "✅ Frontend OK"
```

**Step F.6 — End-to-end smoke test (Estimated: 5 minutes)**

```bash
echo "--- Smoke Test ---"

# 1. Database
psql -U ainet_user -d ainet_db -c "SELECT COUNT(*) FROM tasks;" && echo "✅ DB query OK"

# 2. Backend health
curl -sf http://localhost:3001/api/v1/health | jq . && echo "✅ Health OK"

# 3. Agents
AGENT_COUNT=$(curl -sf http://localhost:3001/api/v1/agents | jq 'length')
echo "✅ Agents loaded: ${AGENT_COUNT}"

# 4. Stellar connectivity
curl -sf "${STELLAR_HORIZON_URL}/fee_stats" | jq .last_ledger_base_fee && echo "✅ Stellar OK"

# 5. Submit test task
TASK=$(curl -sf -X POST http://localhost:3001/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Cluster recovery smoke test","budgetStroops":1000000}' | jq -r .id)
echo "✅ Test task submitted: ${TASK}"

echo "--- Smoke Test Complete ---"
```

**Estimated Total Time**: 45–90 minutes (excluding data restore, which adds 60–120 minutes if DB recovery is also needed).

### Verification

```bash
# All health checks green
curl -sf http://localhost:3001/api/v1/health | jq '{
  status,
  db: .database.status,
  stellar_connected: .stellar.connected,
  uptime: .uptime
}'
# Expected: status "ok", db "connected", stellar_connected true

# Prometheus scraping successfully
curl -sf http://localhost:3001/metrics | grep "ainet_active_agents"

# Frontend accessible
curl -sf http://localhost:3000/ | grep -c "html" | grep -v "^0" && echo "Frontend OK"
```

---

## 9. Post-Incident Review Checklist

Use this checklist after every **P0 or P1 incident**. The review meeting should be held within 48 hours of incident resolution.

- [ ] **Incident timeline documented**: Exact timestamps for detection, escalation, mitigation, and resolution are recorded in the incident report.
- [ ] **Root cause identified**: The underlying technical cause (not just the symptom) has been documented. Distinguish between trigger, root cause, and contributing factors.
- [ ] **Impact quantified**: Number of users affected, tasks failed, transactions delayed, and estimated revenue impact recorded.
- [ ] **Runbook accuracy verified**: Steps in this runbook matched actual recovery actions. Flag any steps that were inaccurate, missing, or required deviation.
- [ ] **RTO met or missed**: Compare actual time-to-recovery against the estimated RTO in Section 1. If missed, document why.
- [ ] **Detection gap assessed**: Was the incident detected by monitoring before users reported it? If users reported first, identify what monitoring alert was missing or mis-configured.
- [ ] **Escrow / funds integrity confirmed**: Any in-flight escrow transactions during the incident have been verified as either completed or safely rolled back. No funds are stuck.
- [ ] **On-chain state verified**: Confirm no orphaned escrow entries, duplicate agent registrations, or corrupted registry state on Stellar.
- [ ] **Action items assigned**: Each corrective action has an owner, a priority (P0/P1/P2), and a due date.
- [ ] **Follow-up monitoring added**: Any new alert rules, dashboard panels, or anomaly detectors identified during the incident have been created or ticketed.
- [ ] **Communication post-mortem**: User-facing communications during the incident were reviewed. If messaging was unclear or delayed, a communication improvement is ticketed.
- [ ] **Runbook updated**: This document has been updated to reflect any new steps, corrected procedures, or new scenarios discovered during the incident.
- [ ] **Review meeting notes published**: Meeting notes, root cause, and action items are posted in the team's incident retrospective channel or wiki within 48 hours.
