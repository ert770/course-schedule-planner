CREATE TABLE IF NOT EXISTS Learned_Preference_Weights (
  subject_id VARCHAR(67) PRIMARY KEY,
  model_version VARCHAR(64) NOT NULL,
  interest_weight DECIMAL(4,3) NOT NULL,
  compact_weight DECIMAL(4,3) NOT NULL,
  easy_weight DECIMAL(4,3) NOT NULL,
  sufficiency_status VARCHAR(16) NOT NULL,
  usable_event_count INT UNSIGNED NOT NULL,
  required_event_count INT UNSIGNED NOT NULL,
  evidence_json JSON NOT NULL,
  computed_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_learned_weights_subject
    FOREIGN KEY (subject_id) REFERENCES Privacy_Subject_State(subject_id),
  INDEX idx_learned_weights_expiry (expires_at)
)
