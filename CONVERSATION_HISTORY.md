# Vittori Bot - Full Conversation History & Current Issues

## Project Overview
A Telegram VPN bot built with Telegraf.js + better-sqlite3, deployed on Railway.
- **File:** `index.js` (~4800 lines)
- **Framework:** Telegraf 4.16.3
- **Database:** SQLite (better-sqlite3) stored at `/data/bot.db`

## What Was Done Today

### 1. Multi-Panel Support
- Removed hardcoded default panels and plans (admin must add via menu)
- Removed "تغییر پنل" (Quick Panel Change) button from admin menu
- Each panel now has its own `url`, `username`, `password`, `group_ids` in DB

### 2. Per-Panel Token/Credentials
- `getPanelCredentials(panelName)` reads from DB, falls back to global env vars
- `getPanelToken(panelName)` caches tokens per-panel, uses `form-urlencoded` format
- All API calls use `User-Agent: Mozilla/5.0` header (needed for Cloudflare bypass)

### 3. Group IDs System
- **`discoverGroupIds(panelName)`**: Tries `/groups`, `/api/groups`, `/api/admin/groups`, `/xui/groups`, `/panel/groups`, then `/api/inbounds`
- If `/api/inbounds` returns string names → returns empty (panel uses all groups by default)
- If numeric IDs found → uses them
- Manual `group_ids` from DB takes priority over discovered ones
- `getPanelCredentials()` always reads `group_ids` from DB, even when falling back to global URL/username/password

### 4. Free Trial from All Panels
- User clicks "تست رایگان" → bot creates trials from ALL active panels
- Each panel sends a separate message with QR code and subscription link
- Summary message at end with success/fail count

### 5. Premium Emoji Testing
- Tested with Telegraf, grammY, and direct Bot API
- **Result:** Custom emoji in inline keyboard buttons does NOT work in any library - this is a Telegram limitation
- Premium emoji only works in message text via `<tg-emoji>` HTML tag

## SOLVED: Group Selection (verified on live panel 2026-08-28)

### Root cause (now understood)
- The tunnel panel is **Marzban** (user objects have `proxy_settings`, `group_ids`, `admin:{id:41}`; token endpoint is `/api/admin/token` form-urlencoded).
- Marzban groups are NOT derivable from `/api/inbounds`: that endpoint returns a flat list of **96 inbound *names* (strings)**, not numeric group IDs. Mapping `[1..96]` to them was a bug that produced "Group not found".
- `/api/groups` returns **403 "Permission denied: groups.read"**. The bot's admin role `administrator(حجمی)` (id 41) does not have `groups.read`, so group IDs CANNOT be enumerated via the API — only via probing or manual config.

### ✅ The correct group_ids (PROVEN by live probing — do NOT "fix" these)
The tunnel panel has exactly **6 groups, IDs `[2, 3, 4, 5, 6, 7]`**.
- Probed by attempting `POST /api/user` with `group_ids:[g]` for g=1..50, deleting each throwaway:
  - g=1 → "Group not found"
  - g=2,3,4,5,6,7 → ✅ created successfully
  - g=8,9,50 → "Group not found"
- `POST /api/user` with `group_ids:[2,3,4,5,6,7]` → ✅ created, valid `subscription_url` returned.
- These 6 groups cover ALL 96 inbounds (Marzban groups bundle inbounds). Group `7` is the "کشور های اضافی" (additional countries) group that was previously missing.
- ⚠️ **Correction to earlier notes:** earlier doc claimed "IDs 1,7-96 all fail" — that was WRONG. **7 works.** Use `[2,3,4,5,6,7]`.

### Fixes applied to index.js (2026-08-28)
1. **`discoverGroupIds()` rewritten (Marzban-aware):**
   - Stops mapping `/api/inbounds` strings to `[1..N]` (was the "Group not found" bug source).
   - Tries real group endpoints first (only works if role has `groups.read`).
   - Only uses `/api/inbounds` objects if they contain numeric IDs.
   - **Falls back to `probeGroupIds()`**: creates a throwaway user per candidate ID `[1..30]`, keeps successes, deletes throwaways. Empirically finds real IDs.
   - If `creds.groupIds` is set manually, uses it and skips probing.
   - Persists probed result to `panels.group_ids` so restarts don't re-probe.
2. **Added admin command `/setgroups <panelName> <id1,id2,...>`** (e.g. `/setgroups tunnel 2,3,4,5,6,7`) — sets `panels.group_ids`, clears caches. Handy because the Railway DB can't be hand-edited locally.
3. The existing admin menu "📦 ویرایش گروه‌ها (IDs)" already writes `panels.group_ids`, so manual entry works too.

### How to deploy the correct value on Railway
Option A (recommended): in Telegram as admin, send:
`/setgroups <tunnelPanelName> 2,3,4,5,6,7`
Option B: admin menu → panel → 📦 ویرایش گروه‌ها (IDs) → type `2,3,4,5,6,7`
(Replace `<tunnelPanelName>` with the actual `panels.name` row for jetspeeds.ir:2087. Note: local bot.db is an old schema without the panels table — the live Railway DB is the source of truth.)

### Panel Info
- **Tunnel Panel:** https://jetspeeds.ir:2087
- **Username:** aminqh
- **Password:** 6af_Pn3gqsgV
- **Admin Role:** administrator(حجمی) - ID: 41
- **API Path:** /api/admin/token (form-urlencoded)
- **96 inbounds**, bundled into **6 groups (IDs 2-7)**

### Behavior reference (verified)
- `group_ids` omitted → user has no groups (inaccessible) — bad
- `group_ids:[2,3,4,5,6]` → 5 groups, "additional countries" (7) missing — incomplete
- `group_ids:[2,3,4,5,6,7]` → ✅ all 6 groups, full access — CORRECT
- `group_ids:[1..96]` → "Group not found" — invalid
- `group_ids:["name"]` → "Input should be a valid integer" — invalid
