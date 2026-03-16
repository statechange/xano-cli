table "device_code" {
  auth = false
  schema {
    int id
    text device_code filters=trim
    text user_code filters=trim
    enum status?="pending" {
      values = ["pending", "authorized", "expired"]
    }
    int user_id? {
      table = "user"
    }
    text api_key?
    timestamp expires_at
    timestamp created_at?=now
  }
  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "device_code"}]}
    {type: "btree|unique", field: [{name: "user_code"}]}
    {type: "btree", field: [{name: "status"}]}
    {type: "btree", field: [{name: "expires_at"}]}
  ]
}
