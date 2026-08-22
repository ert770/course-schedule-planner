CREATE TABLE IF NOT EXISTS Privacy_Subject_State (
  subject_id VARCHAR(67) PRIMARY KEY,
  last_active_at DATETIME(3) NOT NULL,
  service_withdrawn_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS Privacy_Consents (
  recorded_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  consent_id CHAR(36) PRIMARY KEY,
  subject_id VARCHAR(67) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  granted BOOLEAN NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  decided_at DATETIME(3) NOT NULL,
  source VARCHAR(32) NOT NULL,
  request_id VARCHAR(128) NULL,
  INDEX idx_privacy_consents_subject_decided (subject_id, purpose, decided_at, recorded_sequence),
  CONSTRAINT fk_privacy_consents_subject
    FOREIGN KEY (subject_id) REFERENCES Privacy_Subject_State(subject_id)
);

CREATE TABLE IF NOT EXISTS Privacy_Audit_Log (
  audit_id CHAR(36) PRIMARY KEY,
  subject_id VARCHAR(67) NOT NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  request_id VARCHAR(128) NULL,
  occurred_at DATETIME(3) NOT NULL,
  metadata_json JSON NULL,
  INDEX idx_privacy_audit_subject_occurred (subject_id, occurred_at),
  CONSTRAINT fk_privacy_audit_subject
    FOREIGN KEY (subject_id) REFERENCES Privacy_Subject_State(subject_id)
);

CREATE TABLE IF NOT EXISTS Privacy_Data_Requests (
  request_id CHAR(36) PRIMARY KEY,
  subject_id VARCHAR(67) NOT NULL,
  request_type VARCHAR(32) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_privacy_request_subject_created (subject_id, created_at),
  CONSTRAINT fk_privacy_requests_subject
    FOREIGN KEY (subject_id) REFERENCES Privacy_Subject_State(subject_id)
);

CREATE TABLE IF NOT EXISTS Chat_Messages (
  message_id CHAR(36) PRIMARY KEY,
  subject_id VARCHAR(67) NOT NULL,
  role VARCHAR(16) NOT NULL,
  ciphertext MEDIUMTEXT NOT NULL,
  iv VARCHAR(32) NOT NULL,
  auth_tag VARCHAR(32) NOT NULL,
  key_version VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_chat_subject_created (subject_id, created_at),
  INDEX idx_chat_expiry (expires_at),
  CONSTRAINT fk_chat_subject
    FOREIGN KEY (subject_id) REFERENCES Privacy_Subject_State(subject_id)
);
