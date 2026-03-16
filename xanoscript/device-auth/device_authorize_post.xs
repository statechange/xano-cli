query "device/authorize" verb=POST {
  api_group = "sckeys"
  description = "Authorize a device code. Called by the sc-auth frontend after user logs in and confirms."
  auth = "user"

  input {
    text user_code filters=trim
  }

  stack {
    // Normalize — uppercase and strip hyphens
    var $clean_code { value = ($input.user_code|to_upper)|replace:"-":"" }

    // Look up pending device codes, match without hyphen
    db.query "device_code" {
      where = $db.device_code.status == "pending" && $db.device_code.expires_at > now
      return = { type: "list" }
    } as $pending_codes

    // Find matching code (strip hyphens for comparison)
    var $matched { value = $pending_codes|find:($$.user_code|replace:"-":"") == $clean_code }

    precondition ($matched != null) {
      error_type = "notfound"
      error = "Invalid or expired user code. Please check the code and try again."
    }

    // Generate a fresh auth token for the CLI
    security.create_auth_token {
      table = "user"
      extras = {}
      expiration = 86400
      id = $auth.id
    } as $authToken

    // Mark authorized and store the token for the CLI to retrieve
    db.edit "device_code" {
      field_name = "id"
      field_value = $matched.id
      data = {
        status: "authorized",
        user_id: $auth.id,
        api_key: $authToken
      }
    }
  }

  response = { success: true }
}
