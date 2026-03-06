# StateChange Backend API Requirements for Xano Token Management

This document specifies the API endpoints that the StateChange backend must implement to support Xano token management between the browser extension and CLI.

## Base URL

All endpoints are under:
```
https://api.statechange.ai/api:jKMCYXQa/
```

**Note:** The actual Xano instance behind `api.statechange.ai` is:
```
https://xw8v-tcfi-85ay.n7.xano.io/api:jKMCYXQa
```

## API Group Information

- **API Group ID:** 39
- **Canonical Name:** `jKMCYXQa`
- **Display Name:** "XXT - Xano Extension API"
- **Workspace ID:** 19 (internal Xano workspace)
- **Current Endpoints:** 41 endpoints (as of inspection)

**Existing Endpoint Patterns:**
- Most endpoints require authentication (marked with 🔐)
- Authentication uses `Authorization: Bearer <token>` header
- Endpoints follow RESTful patterns with path parameters
- Example existing endpoint: `GET /auth/me` (ID: 272) - returns user record with feature flags

## Authentication

### Extension Authentication
The browser extension uses the existing StateChange authentication mechanism:
- Temporary redirect-based token stored in `browser.storage.local` as `scpAuthToken`
- Token is refreshed via `POST /auth/refresh` when needed
- Requests include `Authorization: Bearer <token>` header

### CLI Authentication
The CLI uses a long-lived API key:
- Provided via `~/.statechange/auth.json`, `STATECHANGE_API_KEY` env var, or `--api-key` flag
- Requests include `Authorization: Bearer <api-key>` header
- This is a different authentication mechanism than the extension's temporary tokens

## Endpoints

### 1. POST /xano-tokens

**Purpose:** Browser extension pushes Xano tokens to the backend when detected.

**Authentication:** Extension's temporary token (via `scpAuthenticatedFetchJson`)

**Request:**
```json
{
  "instanceId": "app.xano.com",
  "rawXanoToken": "client:abc123...",
  "workspaceId": 123,
  "branchId": 0,
  "ttl": 86400
}
```

**Request Fields:**
- `instanceId` (string, required): Xano instance hostname (e.g., "app.xano.com")
- `rawXanoToken` (string, required): The Xano API token (e.g., "client:abc123..." or "master:xyz789...")
- `workspaceId` (number, optional): Workspace ID if available
- `branchId` (number, optional): Branch ID (default: 0)
- `ttl` (number, optional): Time-to-live in seconds (default: 86400 = 24 hours)

**Response:**
- `200 OK`: Token successfully stored
- `401 Unauthorized`: Invalid or expired extension token
- `400 Bad Request`: Invalid request body

**Response Body:** (on success)
```json
{
  "success": true,
  "instanceId": "app.xano.com"
}
```

**Notes:**
- The extension silently fails if this endpoint is unavailable or user is not authenticated
- Tokens should be associated with the authenticated user
- If a token already exists for the same `instanceId`, it should be updated

---

### 2. GET /xano-tokens

**Purpose:** CLI lists all available Xano tokens for the authenticated user.

**Authentication:** CLI's long-lived API key

**Request:**
```
GET /xano-tokens
Authorization: Bearer <api-key>
```

**Response:**
- `200 OK`: List of tokens returned
- `401 Unauthorized`: Invalid API key
- `403 Forbidden`: API key valid but insufficient permissions

**Response Body:**
```json
{
  "tokens": [
    {
      "instanceId": "app.xano.com",
      "instanceName": "app.xano.com",
      "workspaceId": 123,
      "branchId": 0,
      "createdAt": 1705804800000,
      "ttl": 86400
    },
    {
      "instanceId": "api.example.com",
      "instanceName": "api.example.com",
      "workspaceId": 456,
      "branchId": 1,
      "createdAt": 1705891200000,
      "ttl": 86400
    }
  ]
}
```

**Response Fields:**
- `tokens` (array): List of available Xano token metadata
  - `instanceId` (string): Xano instance hostname
  - `instanceName` (string, optional): Display name for the instance
  - `workspaceId` (number, optional): Workspace ID if available
  - `branchId` (number, optional): Branch ID
  - `createdAt` (number, optional): Unix timestamp in milliseconds when token was stored
  - `ttl` (number, optional): Time-to-live in seconds

**Notes:**
- This endpoint should only return tokens for the authenticated user
- Tokens that have expired (based on `ttl` and `createdAt`) may be filtered out or marked
- The `rawXanoToken` is NOT included in this list response (use GET /xano-tokens/:instanceId)

---

### 3. GET /xano-tokens/:instanceId

**Purpose:** CLI fetches a specific Xano token by instance ID.

**Authentication:** CLI's long-lived API key

**Request:**
```
GET /xano-tokens/app.xano.com
Authorization: Bearer <api-key>
```

**URL Parameters:**
- `instanceId` (string, URL-encoded): Xano instance hostname (e.g., "app.xano.com")

**Response:**
- `200 OK`: Token returned
- `401 Unauthorized`: Invalid API key
- `403 Forbidden`: API key valid but insufficient permissions
- `404 Not Found`: No token found for the specified instance

**Response Body:**
```json
{
  "rawXanoToken": "client:abc123...",
  "instanceId": "app.xano.com",
  "instanceName": "app.xano.com",
  "workspaceId": 123,
  "branchId": 0,
  "createdAt": 1705804800000,
  "ttl": 86400
}
```

**Response Fields:**
- `rawXanoToken` (string, required): The Xano API token (e.g., "client:abc123..." or "master:xyz789...")
- `instanceId` (string, required): Xano instance hostname
- `instanceName` (string, optional): Display name for the instance
- `workspaceId` (number, optional): Workspace ID if available
- `branchId` (number, optional): Branch ID
- `createdAt` (number, required): Unix timestamp in milliseconds when token was stored
- `ttl` (number, required): Time-to-live in seconds

**Notes:**
- This endpoint should only return tokens for the authenticated user
- Tokens that have expired (based on `ttl` and `createdAt`) should return `404 Not Found`
- The `instanceId` should be URL-encoded in the request path

---

## Data Model

### Database Table Structure

Create a `xano_tokens` table in the Xano database with the following structure:

**Table: `xano_tokens`**
- `id` (integer, primary key, auto-increment)
- `user_id` (integer, foreign key to `user.id`, indexed)
- `instance_id` (string, indexed) - Xano instance hostname
- `raw_xano_token` (text) - The actual Xano API token (encrypted at rest)
- `workspace_id` (integer, nullable)
- `branch_id` (integer, nullable, default: 0)
- `ttl` (integer, default: 86400) - Time-to-live in seconds
- `created_at` (timestamp, default: now)
- `updated_at` (timestamp, nullable)

**Indexes:**
- Primary: `id`
- Unique: `(user_id, instance_id)` - One token per user per instance
- Index: `user_id` - For fast user lookups
- Index: `instance_id` - For fast instance lookups

### Xano Token Record

Each token record should be stored with the following structure:

```typescript
interface XanoTokenRecord {
  // Primary identifier
  instanceId: string;           // Xano instance hostname (unique per user)
  
  // Token data
  rawXanoToken: string;          // The actual Xano API token
  
  // Metadata
  instanceName?: string;         // Optional display name
  workspaceId?: number;          // Workspace ID if available
  branchId?: number;             // Branch ID (default: 0)
  
  // Timestamps
  createdAt: number;             // Unix timestamp (milliseconds) when stored
  updatedAt?: number;            // Unix timestamp (milliseconds) when last updated
  
  // Expiration
  ttl: number;                   // Time-to-live in seconds (default: 86400)
  
  // User association
  userId: string;                // ID of the user who owns this token
}
```

### Token Expiration

Tokens should be considered expired if:
```
currentTime - createdAt > ttl * 1000
```

Expired tokens:
- Should not be returned by `GET /xano-tokens` (or should be marked as expired)
- Should return `404 Not Found` from `GET /xano-tokens/:instanceId`
- May be automatically deleted by the backend

---

## Error Responses

All endpoints should return consistent error responses:

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired authentication token"
}
```

**403 Forbidden:**
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions"
}
```

**404 Not Found:**
```json
{
  "error": "Not Found",
  "message": "No token found for instance: app.xano.com"
}
```

**400 Bad Request:**
```json
{
  "error": "Bad Request",
  "message": "Invalid request body",
  "details": {
    "field": "instanceId",
    "issue": "instanceId is required"
  }
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
```

---

## Security Considerations

1. **Token Storage:**
   - Xano tokens are sensitive credentials and should be encrypted at rest
   - Tokens should only be accessible to the user who stored them

2. **Authentication:**
   - Extension tokens are temporary and should expire after a reasonable time
   - CLI API keys are long-lived and should be revocable
   - Both authentication methods should validate permissions before allowing access

3. **Rate Limiting:**
   - Consider rate limiting token push operations to prevent abuse
   - Consider rate limiting token fetch operations

4. **Token Validation:**
   - Backend may optionally validate Xano tokens before storing them
   - Invalid tokens should be rejected with `400 Bad Request`

5. **User Isolation:**
   - Tokens must be isolated per user
   - Users should only see/modify their own tokens

---

## Current Implementation Status

**As of inspection:** The `xano-tokens` endpoints do not yet exist in the StateChange backend.

**Existing similar endpoints for reference:**
- `POST /log` (ID: 1008) - Authenticated logging endpoint
- `POST /report` (ID: 706) - Authenticated reporting endpoint  
- `GET /auth/me` (ID: 272) - Returns user data with authentication
- `POST /auth/refresh` (ID: 294, 620) - Token refresh endpoint

**Implementation Guidance:**
1. Create the three new endpoints in API group 39 (`jKMCYXQa`)
2. Follow the authentication pattern of existing endpoints (most use `auth = "user"` in XanoScript)
3. Use database operations similar to existing endpoints (e.g., `db.get`, `db.create`, `db.edit`)
4. Store tokens in a table with user association (similar to how `vlt_user_settings` endpoints work)
5. Implement TTL-based expiration logic similar to existing token refresh mechanisms

## Implementation Notes

### Extension Integration

The extension calls this endpoint from `src/workers/hooks.ts` when a new Xano API key is detected:

```typescript
await scpAuthenticatedFetchJson("xano-tokens", {
  method: "POST",
  body: JSON.stringify({
    instanceId: payload.instanceId,
    rawXanoToken: payload.rawXanoToken,
    workspaceId: payload.workspaceId,
    branchId: payload.branchId,
    ttl: payload.ttl ?? 86400,
  }),
});
```

The extension silently fails if the endpoint is unavailable or the user is not authenticated.

### CLI Integration

The CLI uses these endpoints in `cli/src/registry-client.ts`:

- `listXanoTokens(apiKey)` → `GET /xano-tokens`
- `getXanoToken(instanceId, apiKey)` → `GET /xano-tokens/:instanceId`

The CLI falls back to `XANO_TOKEN` environment variable or `--token` flag if the backend is unavailable.

### XanoScript Implementation Example

Based on existing endpoint patterns (e.g., `GET /auth/me`), here's a suggested structure for the endpoints:

**POST /xano-tokens:**
```xanoscript
query "xano-tokens" verb=POST {
  api_group = "XXT - Xano Extension API"
  auth = "user"

  input {
    instanceId: string (required)
    rawXanoToken: string (required)
    workspaceId?: number
    branchId?: number
    ttl?: number
  }

  stack {
    // Check if token exists for this user + instance
    db.get xano_tokens {
      field_name = "user_id"
      field_value = $auth.id
      addon = [{
        name: "xano_tokens_of_user_01"
        field_name: "instance_id"
        field_value: $input.instanceId
        as: "existing_token"
      }]
    }

    // Create or update token
    if ($existing_token) {
      db.edit xano_tokens {
        field_name = "id"
        field_value = $existing_token.id
        data = {
          raw_xano_token: $input.rawXanoToken
          workspace_id: $input.workspaceId
          branch_id: $input.branchId ?? 0
          ttl: $input.ttl ?? 86400
          updated_at: now
        }
      } as $token
    } else {
      db.create xano_tokens {
        data = {
          user_id: $auth.id
          instance_id: $input.instanceId
          raw_xano_token: $input.rawXanoToken
          workspace_id: $input.workspaceId
          branch_id: $input.branchId ?? 0
          ttl: $input.ttl ?? 86400
          created_at: now
        }
      } as $token
    }
  }

  response = {
    success: true
    instanceId: $input.instanceId
  }
}
```

**GET /xano-tokens:**
```xanoscript
query "xano-tokens" verb=GET {
  api_group = "XXT - Xano Extension API"
  auth = "api_key"  // Note: Different auth for CLI

  input {
  }

  stack {
    // Get all non-expired tokens for this user
    db.get xano_tokens {
      field_name = "user_id"
      field_value = $auth.user_id
      output = ["id", "instance_id", "workspace_id", "branch_id", "created_at", "ttl"]
      // Filter expired tokens in XanoScript or database query
    } as $tokens

    // Filter out expired tokens
    var $valid_tokens {
      value = $tokens.filter(token => {
        age = now - token.created_at
        return age < (token.ttl * 1000)
      })
    }
  }

  response = {
    tokens: $valid_tokens.map(token => {
      instanceId: token.instance_id
      workspaceId: token.workspace_id
      branchId: token.branch_id
      createdAt: token.created_at
      ttl: token.ttl
    })
  }
}
```

**GET /xano-tokens/:instanceId:**
```xanoscript
query "xano-tokens/{instanceId}" verb=GET {
  api_group = "XXT - Xano Extension API"
  auth = "api_key"  // Note: Different auth for CLI

  input {
    instanceId: string (from path)
  }

  stack {
    db.get xano_tokens {
      field_name = "user_id"
      field_value = $auth.user_id
      addon = [{
        name: "xano_tokens_of_user_01"
        field_name: "instance_id"
        field_value: $input.instanceId
        as: "token"
      }]
    }

    // Check if token exists and is not expired
    if (!$token) {
      error {
        message: "No token found for instance: " + $input.instanceId
        status: 404
      }
    }

    var $age {
      value = now - $token.created_at
    }

    if ($age > ($token.ttl * 1000)) {
      error {
        message: "Token expired for instance: " + $input.instanceId
        status: 404
      }
    }
  }

  response = {
    rawXanoToken: $token.raw_xano_token
    instanceId: $token.instance_id
    workspaceId: $token.workspace_id
    branchId: $token.branch_id
    createdAt: $token.created_at
    ttl: $token.ttl
  }
}
```

**Note:** The authentication mechanism for CLI (`auth = "api_key"`) may need to be implemented differently than the extension's `auth = "user"`. You may need to:
- Create a custom authentication function that validates long-lived API keys
- Map API keys to user IDs
- Or use a different authentication approach that works with both extension tokens and CLI API keys

---

## Testing

To test the implementation:

1. **Extension Push:**
   - Log into StateChange extension
   - Navigate to a Xano instance
   - Verify token is pushed to `POST /xano-tokens`

2. **CLI List:**
   - Run `sc-cli auth init --api-key <key>`
   - Run `sc-cli auth whoami`
   - Verify list of tokens is displayed

3. **CLI Fetch:**
   - Run `sc-cli xray function --id 123 --instance app.xano.com`
   - Verify token is fetched from `GET /xano-tokens/app.xano.com`

---

## Future Enhancements

Potential future additions:

- `DELETE /xano-tokens/:instanceId` - Remove a token
- `PUT /xano-tokens/:instanceId` - Update token metadata
- Token refresh mechanism (if Xano tokens can be refreshed)
- Token sharing between team members
- Token usage analytics
- Bulk operations (e.g., `POST /xano-tokens/bulk` for multiple instances)
- Token validation endpoint (verify token is still valid with Xano)

## Reference: Existing Endpoint Examples

For implementation reference, here are similar existing endpoints in the same API group:

**GET /auth/me (ID: 272):**
- Returns user data with feature flags
- Uses `auth = "user"` authentication
- Includes addon queries for related data
- Updates user record on access

**POST /log (ID: 1008):**
- Authenticated POST endpoint
- Accepts structured data
- Similar pattern to token storage

**POST /report (ID: 706):**
- Authenticated POST endpoint
- Stores user-associated data
- Similar to token push pattern

These endpoints can serve as templates for implementing the `xano-tokens` endpoints.
