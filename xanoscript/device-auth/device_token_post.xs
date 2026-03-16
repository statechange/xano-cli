query "device/token" verb=POST {
  api_group = "sckeys"
  description = "Poll for device authorization status. Returns API key once user authorizes."

  input {
    text device_code filters=trim
  }

  stack {
    // Look up the device code
    db.get "device_code" {
      field_name = "device_code"
      field_value = $input.device_code
    } as $record

    // Not found
    precondition ($record != null) {
      error_type = "notfound"
      error = "Invalid or unknown device code"
    }

    // Expired
    conditional {
      if ($record.expires_at < now) {
        // Mark as expired
        db.edit "device_code" {
          field_name = "id"
          field_value = $record.id
          data = { status: "expired" }
        }

        throw {
          name = "ExpiredToken"
          value = "Device code has expired. Please start a new authentication flow."
        }
      }
    }

    // Check status
    var $result { value = {} }

    conditional {
      if ($record.status == "pending") {
        var.update $result { value = { status: "authorization_pending" } }
      }
      elseif ($record.status == "authorized") {
        var.update $result {
          value = {
            status: "complete",
            api_key: $record.api_key
          }
        }

        // Clean up — one-time use
        db.del "device_code" {
          field_name = "id"
          field_value = $record.id
        }
      }
    }
  }

  response = $result
}
