query "device/code" verb=POST {
  api_group = "sckeys"
  description = "Generate a device code and user code for CLI authentication"

  input {}

  stack {
    // Generate a secure device_code (long, opaque — used by CLI to poll)
    security.create_uuid as $device_code_raw
    security.create_uuid as $extra_entropy
    var $device_code { value = $device_code_raw ~ "-" ~ $extra_entropy }

    // Generate a short, human-friendly user_code (8 chars, uppercase alphanumeric)
    security.create_password {
      character_count = 8
      require_lowercase = false
      require_uppercase = true
      require_digit = true
      require_symbol = false
      symbol_whitelist = ""
    } as $user_code_raw

    // Format as XXXX-XXXX for readability
    var $user_code { value = ($user_code_raw|substr:0:4) ~ "-" ~ ($user_code_raw|substr:4:4) }

    // Expires in 15 minutes
    // Expires in 15 minutes
    var $expires_at { value = now + 900000 }

    // Clean up any expired codes first
    db.bulk.delete "device_code" {
      where = $db.device_code.expires_at < now
    }

    // Store the device code
    db.add "device_code" {
      data = {
        device_code: $device_code,
        user_code: ($user_code|to_upper),
        status: "pending",
        expires_at: $expires_at,
        created_at: now
      }
    } as $record
  }

  response = {
    device_code: $device_code,
    user_code: ($user_code|to_upper),
    verification_uri: "https://auth.statechange.ai/device",
    expires_in: 900,
    interval: 5
  }
}
